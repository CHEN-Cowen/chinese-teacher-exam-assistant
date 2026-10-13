import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  assertCanApprove,
  assertCanPublish,
  assertTransition,
  buildReviewRecord,
  computeContentHash,
  extractionIdempotencyKey,
  findDuplicateSnapshot,
  isApprovalAction,
  markAutoFieldsConfirmed,
  nextStatusAfterReview,
  publishVersion,
  retryFailedRun,
  withdrawVersion,
  type CandidateField,
  type ExtractionCandidate,
  type ReviewAction,
} from './domain.js';
import { parseAnnouncement } from './parser.js';
import {
  ProjectionError,
  projectCatalogVersion,
} from '../catalog/publication-projector.js';

export interface SubmitSourceInput {
  publisher: string;
  officialUrl: string;
  sourceType: string;
  /** 原始内容（HTML/文本）；首版支持 URL 抓取失败后人工粘贴 */
  content: string;
  mimeType: string;
  regionCode?: string;
  announcementId?: string;
}

export interface SubmitReviewInput {
  runId: string;
  action: ReviewAction;
  reason: string;
  /** approve_with_edit 时审核员修改后的候选字段 */
  editedFields?: CandidateField[];
}

/**
 * 公告数据流水线服务。
 *
 * 职责：提交来源 → 留档快照 → 提取候选 → 人工审核 → 发布不可变版本 → 版本差异。
 * 所有规则判定委托给 domain 纯函数；本服务负责持久化、事务与权限上下文。
 */
@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 1. 提交来源 + 留档快照 ====================

  async submitSource(input: SubmitSourceInput, userId: string) {
    const contentHash = computeContentHash(input.content);

    // 同一来源下相同内容哈希不创建重复快照
    const existingSnapshots = await this.prisma.sourceSnapshot.findMany({
      where: { source: { officialUrl: input.officialUrl } },
      select: { id: true, contentHash: true },
    });

    // 按官方 URL 找或创建 Source
    let source = await this.prisma.source.findFirst({
      where: { officialUrl: input.officialUrl },
    });
    if (!source) {
      source = await this.prisma.source.create({
        data: {
          publisher: input.publisher,
          officialUrl: input.officialUrl,
          sourceType: input.sourceType,
          regionCode: input.regionCode,
        },
      });
    }

    // 快照去重
    const dupId = findDuplicateSnapshot(existingSnapshots, contentHash);
    if (dupId) {
      // 复用已有快照，但仍创建新的提取任务（管理员可能想重新提取）
      const snapshot = await this.prisma.sourceSnapshot.findUnique({ where: { id: dupId } });
      return this.createExtractionRun(snapshot!.id, input.announcementId, userId);
    }

    // 保存原始内容（首版存本地文件；生产环境替换为对象存储）
    const storageKey = `snapshots/${source.id}/${contentHash.slice(0, 16)}.bin`;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const storageDir = path.join(process.cwd(), '.data', 'snapshots');
    await fs.mkdir(storageDir, { recursive: true });
    await fs.writeFile(path.join(storageDir, `${contentHash}.bin`), input.content, 'utf-8');

    const snapshot = await this.prisma.sourceSnapshot.create({
      data: {
        sourceId: source.id,
        officialUrl: input.officialUrl,
        storageKey,
        mimeType: input.mimeType,
        contentHash,
        httpStatus: 200,
      },
    });

    return this.createExtractionRun(snapshot.id, input.announcementId, userId);
  }

  private async createExtractionRun(snapshotId: string, announcementId: string | undefined, userId: string) {
    const parserVersion = 'deterministic-parser@1.0.0';
    const idempotencyKey = extractionIdempotencyKey(snapshotId, parserVersion);

    // 幂等：同一快照 + 同一解析器版本已有非失败任务时，不重复创建
    const existing = await this.prisma.extractionRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing && existing.status !== 'failed') {
      return existing;
    }

    return this.prisma.extractionRun.create({
      data: {
        snapshotId,
        announcementId,
        parserVersion,
        idempotencyKey,
        status: 'submitted',
        submittedBy: userId,
      },
    });
  }

  // ==================== 2. 执行提取（管理员手动触发） ====================

  async runExtraction(runId: string) {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: { snapshot: true },
    });
    if (!run) throw new NotFoundException('提取任务不存在');

    // 状态校验：submitted 或 failed（重试）可进入 extracting
    if (run.status !== 'submitted' && run.status !== 'failed') {
      throw new BadRequestException(`当前状态 ${run.status} 不能开始提取`);
    }

    await this.prisma.extractionRun.update({
      where: { id: runId },
      data: { status: 'extracting', progress: 30 },
    });

    try {
      // 首版：直接读取快照内容并解析。
      // 生产环境应从对象存储读取 storageKey 对应的文件。
      // 这里 content 未单独持久化到 DB（大文件不入库），首版从 snapshot 的 storageKey 对应文件读取。
      // 为了让流水线可走通，解析器接收 content 由调用方传入；此处从 DB 无法拿到原始内容，
      // 因此提交时已将 content 传入，runExtraction 需要重新获取。
      // 简化方案：将原始内容暂存到 snapshot 的 storageKey 路径，runExtraction 读取该文件。
      // 鉴于首版无对象存储，我们将 content 暂存到本地文件或内存。
      // 这里采用：提交时把 content 写入本地文件，runExtraction 读取。
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const storageDir = path.join(process.cwd(), '.data', 'snapshots');
      await fs.mkdir(storageDir, { recursive: true });
      const filePath = path.join(storageDir, `${run.snapshot.contentHash}.bin`);

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        throw new BadRequestException('原始快照内容丢失，请重新提交公告');
      }

      const candidate = parseAnnouncement(content, run.snapshot.mimeType);

      // 保存候选结果 + 证据锚点
      await this.prisma.$transaction(async (tx) => {
        await tx.extractionRun.update({
          where: { id: runId },
          data: {
            status: 'pending_review',
            progress: 100,
            candidate: candidate as unknown as object,
            finishedAt: new Date(),
          },
        });

        // 保存证据锚点（便于审计与查询）
        const anchors = candidate.fields
          .filter((f) => f.anchor)
          .map((f) => ({
            runId,
            field: f.field,
            locatorKind: f.anchor!.locator.kind,
            locatorData: f.anchor!.locator as unknown as object,
            excerpt: f.anchor!.excerpt,
          }));

        if (anchors.length > 0) {
          await tx.evidenceAnchor.createMany({ data: anchors });
        }
      });

      return this.prisma.extractionRun.findUnique({ where: { id: runId } });
    } catch (e) {
      await this.prisma.extractionRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorCode: 'EXTRACTION_FAILED',
          errorMessage: e instanceof Error ? e.message : '提取失败',
          finishedAt: new Date(),
        },
      });
      throw e;
    }
  }

  // ==================== 3. 读取任务 ====================

  async getRun(runId: string) {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: {
        snapshot: { include: { source: true } },
        evidenceAnchors: true,
        reviewRecords: { orderBy: { reviewedAt: 'desc' } },
        publishedVersion: true,
      },
    });
    if (!run) throw new NotFoundException('提取任务不存在');
    return run;
  }

  async listRuns(params: { status?: string; announcementId?: string } = {}) {
    return this.prisma.extractionRun.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.announcementId ? { announcementId: params.announcementId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { snapshot: { include: { source: true } } },
    });
  }

  // ==================== 4. 提交审核 ====================

  async submitReview(input: SubmitReviewInput, reviewer: { id: string; name: string }) {
    const run = await this.prisma.extractionRun.findUnique({ where: { id: input.runId } });
    if (!run) throw new NotFoundException('提取任务不存在');
    if (!run.candidate) throw new BadRequestException('任务尚无提取结果，无法审核');

    const current = run.candidate as unknown as ExtractionCandidate;

    // 高影响字段证据校验（domain 规则）
    if (isApprovalAction(input.action)) {
      assertCanApprove(run.status as never, current);
    }

    // 构造审核后候选
    let after: ExtractionCandidate = current;
    if (input.action === 'approve_with_edit') {
      if (!input.editedFields || input.editedFields.length === 0) {
        throw new BadRequestException('修改后通过必须提供修改后的字段');
      }
      after = { ...current, fields: input.editedFields };
      // 修改后的候选也必须通过高影响字段证据校验
      assertCanApprove(run.status as never, after);
    }

    // 审核通过 = 人工确认：为 AI/OCR 来源字段写入确认时间（发布门禁依据）
    if (isApprovalAction(input.action)) {
      after = {
        ...after,
        fields: markAutoFieldsConfirmed(after.fields, new Date().toISOString()),
      };
    }

    const now = new Date().toISOString();
    const record = buildReviewRecord({
      runId: input.runId,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      action: input.action,
      reason: input.reason,
      current,
      edited: input.action === 'approve_with_edit' ? after : undefined,
      reviewedAt: now,
    });

    const nextStatus = nextStatusAfterReview(input.action);
    assertTransition(run.status as never, nextStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.extractionRun.update({
        where: { id: input.runId },
        data: {
          status: nextStatus,
          candidate: (isApprovalAction(input.action) ? after : current) as unknown as object,
        },
      });

      await tx.reviewRecord.create({
        data: {
          runId: input.runId,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          action: input.action,
          reason: input.reason,
          beforePayload: record.beforePayload as unknown as object,
          afterPayload: record.afterPayload as unknown as object,
        },
      });

      return updated;
    });
  }

  // ==================== 5. 发布 ====================

  async publish(runId: string) {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: { publishedVersion: true },
    });
    if (!run) throw new NotFoundException('提取任务不存在');

    // 只有 approved 状态可发布；AI/OCR 字段必须已人工确认
    assertCanPublish(run.status as never, run.candidate
      ? (run.candidate as unknown as ExtractionCandidate)
      : undefined);
    if (run.publishedVersion) {
      throw new ConflictException('该任务已发布，不能重复发布');
    }
    if (!run.candidate) throw new BadRequestException('任务无候选结果，无法发布');

    const candidate = run.candidate as unknown as ExtractionCandidate;
    const announcementId = run.announcementId ?? run.id;

    // 查找该公告的当前已发布版本
    const previous = await this.prisma.publishedAnnouncementVersion.findFirst({
      where: { announcementId, status: 'published' },
      orderBy: { versionNumber: 'desc' },
    });

    const now = new Date();
    const { version, superseded } = publishVersion({
      announcementId,
      candidate,
      previousVersion: previous
        ? {
            id: previous.id,
            announcementId: previous.announcementId,
            versionNumber: previous.versionNumber,
            status: previous.status as never,
            payload: previous.payload as unknown as ExtractionCandidate,
            publishedAt: previous.publishedAt.toISOString(),
            previousVersionId: previous.previousVersionId ?? undefined,
          }
        : null,
      publishedAt: now.toISOString(),
    });

    return this.prisma.$transaction(async (tx) => {
      // 旧版本标记 superseded
      if (superseded) {
        await tx.publishedAnnouncementVersion.update({
          where: { id: superseded.id },
          data: { status: 'superseded', supersededAt: now },
        });
      }

      // 创建新版本
      const published = await tx.publishedAnnouncementVersion.create({
        data: {
          id: version.id,
          announcementId,
          runId,
          versionNumber: version.versionNumber,
          status: 'published',
          payload: version.payload as unknown as object,
          publishedAt: now,
          previousVersionId: version.previousVersionId ?? null,
        },
      });

      // 任务状态 → published（终态）
      await tx.extractionRun.update({
        where: { id: runId },
        data: { status: 'published' },
      });

      return published;
    });
  }

  // ==================== 6. 版本列表与差异 ====================

  async listVersions(announcementId: string) {
    return this.prisma.publishedAnnouncementVersion.findMany({
      where: { announcementId },
      orderBy: { versionNumber: 'asc' },
    });
  }

  // ==================== 6.1 撤回（v7.2：保留历史 + 原因 + 审计） ====================

  /**
   * 撤回当前发布中的版本。
   * 规则判定委托 domain.withdrawVersion：仅 published 可撤回、原因必填；
   * 事务内只更新该行（status + 撤回三字段），不删除、不新增版本、不动旧版。
   */
  async withdraw(
    announcementId: string,
    versionId: string,
    input: { reason: string },
    operator: { id: string },
  ) {
    const row = await this.prisma.publishedAnnouncementVersion.findUnique({
      where: { id: versionId },
    });
    if (!row || row.announcementId !== announcementId) {
      throw new NotFoundException('指定版本不存在');
    }

    const now = new Date();
    let withdrawn;
    try {
      withdrawn = withdrawVersion(
        {
          id: row.id,
          announcementId: row.announcementId,
          versionNumber: row.versionNumber,
          status: row.status as never,
          payload: row.payload as unknown as ExtractionCandidate,
          publishedAt: row.publishedAt.toISOString(),
          previousVersionId: row.previousVersionId ?? undefined,
          supersededAt: row.supersededAt?.toISOString(),
        },
        {
          reason: input.reason,
          withdrawnAt: now.toISOString(),
          withdrawnBy: operator.id,
        },
      );
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : '撤回校验失败',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      return tx.publishedAnnouncementVersion.update({
        where: { id: row.id },
        data: {
          status: withdrawn.status,
          supersededAt: now,
          withdrawnAt: now,
          withdrawReason: withdrawn.withdrawReason!,
          withdrawnBy: operator.id,
        },
      });
    });
  }

  // ==================== 6.2 投影状态（v7.2：审核详情用，只读） ====================

  /**
   * 查询公告当前发布版本的目录投影状态：
   * - 无 published 版本 → not_published；
   * - 投影成功 → projected（含单元数与版本号）；
   * - ProjectionError → failed（含 fieldPath 与 message，不回传 payload）。
   */
  async getProjectionStatus(announcementId: string) {
    const row = await this.getPublishedVersion(announcementId);
    if (!row) return { status: 'not_published' as const };

    try {
      const projected = projectCatalogVersion(
        {
          id: row.id,
          announcementId: row.announcementId,
          versionNumber: row.versionNumber,
          status: row.status,
          payload: row.payload,
        },
        new Date(),
      );
      return {
        status: 'projected' as const,
        unitCount: projected.version.units.length,
        versionNumber: row.versionNumber,
      };
    } catch (e) {
      if (e instanceof ProjectionError) {
        return {
          status: 'failed' as const,
          fieldPath: e.fieldPath,
          message: e.message,
          versionNumber: row.versionNumber,
        };
      }
      throw e;
    }
  }

  async getVersionDiff(announcementId: string, v1: number, v2: number) {
    const versions = await this.prisma.publishedAnnouncementVersion.findMany({
      where: {
        announcementId,
        versionNumber: { in: [v1, v2] },
      },
    });
    const map = new Map(versions.map((v) => [v.versionNumber, v]));
    const a = map.get(v1);
    const b = map.get(v2);
    if (!a || !b) throw new NotFoundException('指定版本不存在');

    const { diffVersions } = await import('./domain.js');
    return diffVersions(
      {
        id: a.id,
        announcementId: a.announcementId,
        versionNumber: a.versionNumber,
        status: a.status as never,
        payload: a.payload as unknown as ExtractionCandidate,
        publishedAt: a.publishedAt.toISOString(),
      },
      {
        id: b.id,
        announcementId: b.announcementId,
        versionNumber: b.versionNumber,
        status: b.status as never,
        payload: b.payload as unknown as ExtractionCandidate,
        publishedAt: b.publishedAt.toISOString(),
      },
    );
  }

  // ==================== 7. 失败重试 ====================

  async retryRun(runId: string) {
    const run = await this.prisma.extractionRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('提取任务不存在');

    const nextStatus = retryFailedRun(run.status as never);
    return this.prisma.extractionRun.update({
      where: { id: runId },
      data: {
        status: nextStatus,
        errorCode: null,
        errorMessage: null,
        retryCount: { increment: 1 },
        finishedAt: null,
        progress: 0,
      },
    });
  }

  // ==================== 管理员：读取快照原始内容 ====================

  async getSnapshotContent(snapshotId: string): Promise<{ content: string; mimeType: string }> {
    const snapshot = await this.prisma.sourceSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot) throw new NotFoundException('快照不存在');

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filePath = path.join(process.cwd(), '.data', 'snapshots', `${snapshot.contentHash}.bin`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { content, mimeType: snapshot.mimeType };
    } catch {
      throw new NotFoundException('原始快照内容已丢失，请重新提交公告');
    }
  }

  // ==================== 管理员：快照标准文档与来源变化（v7.2 三层对照） ====================

  /**
   * 审核详情第二层「标准文档」数据：
   * - parseRun：该快照最近一次 DocumentParseRun（无解析记录时为 null）；
   * - change：同一逻辑文档（SourceDocument）是否存在更早快照（来源变化提示）。
   */
  async getSnapshotParsed(snapshotId: string) {
    const snapshot = await this.prisma.sourceSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot) throw new NotFoundException('快照不存在');

    const parseRun = await this.prisma.documentParseRun.findFirst({
      where: { snapshotId },
      orderBy: { createdAt: 'desc' },
    });

    // 逻辑文档关联：优先取解析记录上的 documentId；
    // 缺失时回查 latestSnapshotId 指向本快照的文档（兼容旧数据）。
    const documentId =
      parseRun?.documentId ??
      (
        await this.prisma.sourceDocument.findFirst({
          where: { latestSnapshotId: snapshotId },
          select: { id: true },
        })
      )?.id ??
      null;

    const change = {
      hasPreviousSnapshot: false,
      previousFetchedAt: null as string | null,
      currentFetchedAt: snapshot.fetchedAt.toISOString(),
    };

    if (documentId) {
      const previousRun = await this.prisma.documentParseRun.findFirst({
        where: { documentId, snapshotId: { not: snapshotId } },
        orderBy: { createdAt: 'desc' },
        select: { snapshotId: true },
      });
      if (previousRun) {
        const previousSnapshot = await this.prisma.sourceSnapshot.findUnique({
          where: { id: previousRun.snapshotId },
          select: { fetchedAt: true },
        });
        change.hasPreviousSnapshot = true;
        change.previousFetchedAt =
          previousSnapshot?.fetchedAt.toISOString() ?? null;
      }
    }

    return {
      parseRun: parseRun
        ? {
            id: parseRun.id,
            format: parseRun.format,
            parserVersion: parseRun.parserVersion,
            status: parseRun.status,
            blocks: parseRun.blocks,
            tableHeaders: parseRun.tableHeaders,
            warnings: parseRun.warnings,
            warningCount: parseRun.warningCount,
            scanned: parseRun.scanned,
            ocrRequired: parseRun.ocrRequired,
            ocrStatus: parseRun.ocrStatus,
            finishedAt: parseRun.finishedAt?.toISOString() ?? null,
          }
        : null,
      change,
    };
  }

  // ==================== 用户端只读：获取已发布版本 ====================

  async getPublishedVersion(announcementId: string) {
    return this.prisma.publishedAnnouncementVersion.findFirst({
      where: { announcementId, status: 'published' },
      orderBy: { versionNumber: 'desc' },
    });
  }
}
