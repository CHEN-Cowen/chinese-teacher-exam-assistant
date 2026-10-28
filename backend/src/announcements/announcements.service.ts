import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  applyFieldDecisions,
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
  validateFieldDecisions,
  withdrawVersion,
  type CandidateField,
  type ExtractionCandidate,
  type FieldDecisionInput,
  type ReviewAction,
} from './domain.js';
import { buildCompletenessReport, assertPublishable, buildChecklistQuality } from './quality-gates.js';
import {
  buildChecklist,
  type ExpectedChecklist,
} from './expected-checklist.js';
import {
  ProjectionError,
  projectCatalogVersion,
} from '../catalog/publication-projector.js';
import {
  buildCatalogPayload,
  CatalogPayloadError,
  isCatalogPayload,
  type CatalogDataset,
} from './catalog-payload-assembler.js';
import { ManualExtractionService } from './manual-extraction.service.js';
import { SafeFetcherFactory } from '../sourcing/fetch/safe-fetcher-factory.js';
import type { SourceRecord } from '../sourcing/crawl-run-store.js';
import { OBJECT_STORE } from '../sourcing/storage/storage.tokens.js';
import { LocalObjectStore, type ObjectStore } from '../sourcing/storage/object-store.js';

export interface SubmitSourceInput {
  publisher: string;
  officialUrl: string;
  sourceType: string;
  /** 原始内容（HTML/文本）；URL 模式时为官方公告链接（M1 抓取后回填正文） */
  content: string;
  mimeType: string;
  regionCode?: string;
  announcementId?: string;
  /** M1：岗位附件（当前解析器可读的 XLS/XLSX/PDF 等），与正文组成材料包 */
  attachments?: Array<{
    name: string;
    mimeType?: string;
    bytes: Buffer;
  }>;
}

export interface SubmitReviewInput {
  runId: string;
  action: ReviewAction;
  reason: string;
  /** approve_with_edit 时审核员修改后的候选字段 */
  editedFields?: CandidateField[];
  /**
   * WB4：字段级审核决策（adopt/edit/reject/pending），随 run 级 review 一并提交。
   * 供按岗位审核工作台使用；后端用 applyFieldDecisions 应用到候选字段并留痕。
   */
  fieldDecisions?: FieldDecisionInput[];
  /**
   * WB4：乐观并发基线。前端提交时带上它读取到的 run.updatedAt；
   * 后端若发现已变化（他人已提交）则返回 409，避免覆盖他人修改。
   */
  baseUpdatedAt?: string;
}

/**
 * 目录载荷版本差异（WB5）：两个目录载荷之间按 unit + requirement 对齐的差异。
 * legacy ExtractionCandidate 载荷走 domain.diffVersions；目录载荷走本函数。
 * 差异不因 payload 类型变化崩溃。
 */
function catalogVersionDiff(
  a: { id: string; versionNumber: number; payload: unknown },
  b: { id: string; versionNumber: number; payload: unknown },
): Array<{ field: string; before: string; after: string; changed: boolean }> {
  const pa = (a.payload ?? {}) as { version?: { units?: Array<{ code?: string; headcount?: number }> } };
  const pb = (b.payload ?? {}) as { version?: { units?: Array<{ code?: string; headcount?: number }> } };
  const unitsA = new Map(
    (pa.version?.units ?? []).map((u) => [u.code ?? '', u.headcount ?? 0]),
  );
  const unitsB = new Map(
    (pb.version?.units ?? []).map((u) => [u.code ?? '', u.headcount ?? 0]),
  );
  const codes = new Set([...unitsA.keys(), ...unitsB.keys()]);
  const diffs: Array<{ field: string; before: string; after: string; changed: boolean }> = [];
  for (const code of codes) {
    const before = unitsA.has(code) ? String(unitsA.get(code)) : '';
    const after = unitsB.has(code) ? String(unitsB.get(code)) : '';
    diffs.push({ field: `unit:${code}:headcount`, before, after, changed: before !== after });
  }
  return diffs;
}

/**
 * 公告数据流水线服务。
 *
 * 职责：提交来源 → 留档快照 → 提取候选 → 人工审核 → 发布不可变版本 → 版本差异。
 * 所有规则判定委托给 domain 纯函数；本服务负责持久化、事务与权限上下文。
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    // M1：手动提交/提取委托给 ManualExtractionService（复用新多岗位抽取链路）。
    // @Optional 保持既有单测（new AnnouncementsService(prisma)）可构造；未注入时
    // submitSource/runExtraction 会回退旧 parser.ts 路径（仅用于兼容旧测试，生产恒注入）。
    @Optional() private readonly manualExtraction?: ManualExtractionService,
    @Optional() private readonly fetcherFactory?: SafeFetcherFactory,
    @Optional() @Inject(OBJECT_STORE) private readonly objectStore?: ObjectStore,
  ) {}

  // ==================== 1. 提交来源 + 留档快照 ====================

  async submitSource(input: SubmitSourceInput, userId: string) {
    // M1：URL 模式真正抓取正文（复用 SafeFetcher 的安全域名/SSRF/重定向/大小/类型约束），
    // 绝不把 URL 字符串当成功正文。抓取失败抛出明确错误，由前端切换人工粘贴。
    const isUrlMode = this.looksLikeUrl(input.content) && input.sourceType === 'government';
    let content = input.content;
    let mimeType = input.mimeType;
    let officialUrl = input.officialUrl;

    if (isUrlMode) {
      if (!this.fetcherFactory) {
        throw new BadRequestException('URL 抓取未配置，请切换「粘贴正文」人工输入');
      }
      const tempSource = {
        id: 'manual',
        publisher: input.publisher,
        officialUrl: input.officialUrl,
        allowedHosts: null,
      } as unknown as SourceRecord;
      const fetcher = this.fetcherFactory.create(tempSource);
      const fetched = await fetcher.fetch(input.content).catch((e) => {
        throw new BadRequestException(
          `公告链接抓取失败，请核对链接或切换「粘贴正文」人工输入：${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
      content = fetched.body;
      mimeType = fetched.mimeType || 'text/html';
      officialUrl = fetched.finalUrl || input.officialUrl;
    }

    // M1：委托 ManualExtractionService 走新链路（正文 + 附件材料包）。
    if (this.manualExtraction) {
      const result = await this.manualExtraction.submitSource(
        {
          publisher: input.publisher,
          officialUrl,
          sourceType: input.sourceType,
          regionCode: input.regionCode,
          announcementId: input.announcementId,
          content,
          mimeType,
          attachments: input.attachments,
        },
        userId,
      );
      return result.run;
    }

    // 兜底（仅旧单测无 manualExtraction 注入时）：保持原 parser.ts 路径语义不变。
    return this.submitSourceLegacy(input, userId);
  }

  // ==================== 1.1 URL 判定 ====================

  private looksLikeUrl(content: string): boolean {
    return /^https?:\/\//i.test(content.trim());
  }

  // ==================== 1.2 旧提交路径（仅兼容无 manualExtraction 注入的旧单测） ====================

  private async submitSourceLegacy(input: SubmitSourceInput, userId: string) {
    const contentHash = computeContentHash(input.content);

    const existingSnapshots = await this.prisma.sourceSnapshot.findMany({
      where: { source: { officialUrl: input.officialUrl } },
      select: { id: true, contentHash: true },
    });

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

    const dupId = findDuplicateSnapshot(existingSnapshots, contentHash);
    if (dupId) {
      const snapshot = await this.prisma.sourceSnapshot.findUnique({ where: { id: dupId } });
      return this.createExtractionRun(snapshot!.id, input.announcementId, userId);
    }

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
    // M1：复用新多岗位抽取链路（正文 + 附件材料包）。
    if (this.manualExtraction) {
      const outcome = await this.manualExtraction.runExtraction(runId);
      const run = await this.prisma.extractionRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('提取任务不存在');
      return { ...run, manualExtraction: outcome };
    }

    // 兜底（仅旧单测无 manualExtraction 注入时）：保持原 parser.ts 路径语义不变。
    return this.runExtractionLegacy(runId);
  }

  private async runExtractionLegacy(runId: string) {
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

      const { parseAnnouncement } = await import('./parser.js');
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
        expectedChecklist: true,
      },
    });
    if (!run) throw new NotFoundException('提取任务不存在');

    // WB4：附加 WB3 质量门禁报告（按岗位的可复算状态），供审核工作台展示。
    // UI 不自行计算「正确率」，只消费后端用 WB3 纯函数算出的质量状态。
    const quality = run.candidate
      ? buildCompletenessReport(run.candidate as unknown as ExtractionCandidate)
      : null;

    // M1：材料包文件状态（已持久化在 candidate.rawJson.files，刷新/重进可读）
    const manualExtraction = this.readMaterialPack(run.candidate, run.parserVersion);

    // M2：固定分母质量报告（基于期望清单）。有清单 → 固定分母评估；
    // 无清单 → completenessNotEvaluated=true，前端显示「未建立固定分母，完整性未评估」。
    const checklist = run.expectedChecklist
      ? this.checklistFromRow(run.expectedChecklist)
      : null;
    const checklistQuality = run.candidate
      ? buildChecklistQuality(
          checklist,
          run.candidate as unknown as ExtractionCandidate,
          this.unverifiableScopesFromMaterialPack(run.candidate),
        )
      : null;

    return { ...run, quality, manualExtraction, checklist, checklistQuality };
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

  // ==================== 管理员：跨阶段流水线汇总（D09 / U10） ====================

  /**
   * 采集管线各阶段真实持久化计数，供 /admin/pipeline 总览卡展示。
   * 只统计数据库事实，不做任何推断；调用方以 generatedAt 标注统计时间。
   * 「来源异常（覆盖缺口）」与「检查正常但无新增」由前端按健康状态分布区分。
   */
  async pipelineSummary() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [
      sourcesTotal,
      sourceHealthGroups,
      lastSourceSuccess,
      snapshotsTotal,
      snapshotsLast24h,
      parseStatusGroups,
      extractionStatusGroups,
      publishedGroups,
      lastPublished,
    ] = await Promise.all([
      this.prisma.source.count(),
      this.prisma.source.groupBy({ by: ['healthStatus'], _count: true }),
      this.prisma.source.findFirst({
        where: { lastSuccessAt: { not: null } },
        orderBy: { lastSuccessAt: 'desc' },
        select: { lastSuccessAt: true },
      }),
      this.prisma.sourceSnapshot.count(),
      this.prisma.sourceSnapshot.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.documentParseRun.groupBy({ by: ['status'], _count: true }),
      this.prisma.extractionRun.groupBy({ by: ['status'], _count: true }),
      this.prisma.publishedAnnouncementVersion.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.publishedAnnouncementVersion.findFirst({
        orderBy: { publishedAt: 'desc' },
        select: { publishedAt: true },
      }),
    ]);
    const groupCounts = (
      rows: Array<{ status?: string; healthStatus?: string; _count: number | { [key: string]: number } }>,
      key: 'status' | 'healthStatus',
    ): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const row of rows) {
        const raw = row[key];
        const count = row._count;
        out[String(raw)] = typeof count === 'number' ? count : (count._all ?? 0);
      }
      return out;
    };
    return {
      generatedAt: now.toISOString(),
      sources: {
        total: sourcesTotal,
        byHealthStatus: groupCounts(sourceHealthGroups, 'healthStatus'),
        lastSuccessAt: lastSourceSuccess?.lastSuccessAt?.toISOString() ?? null,
      },
      snapshots: { total: snapshotsTotal, last24h: snapshotsLast24h },
      parseRuns: {
        byStatus: groupCounts(parseStatusGroups, 'status'),
      },
      extractionRuns: {
        byStatus: groupCounts(extractionStatusGroups, 'status'),
      },
      publishedVersions: {
        byStatus: groupCounts(publishedGroups, 'status'),
        lastPublishedAt: lastPublished?.publishedAt?.toISOString() ?? null,
      },
    };
  }

  // ==================== 3.1 M2：期望清单（固定分母）构建与冻结 ====================

  /**
   * 冻结任务期望清单（固定分母）。
   *
   * 岗位集合由调用方显式传入（独立清点/人工补入），不从本轮候选推断；
   * 候选之后补建必须标 `source='retrospective'`（回顾性核对，不冒称独立基准）。
   * 冻结即持久化一份不可变清单；修改清单需新增版本（version 递增，保留历史）。
   *
   * 清单只保存「哪些项要检查」，绝不保存标准答案值。
   */
  async freezeChecklist(
    runId: string,
    input: {
      source?: 'independent' | 'retrospective';
      jobs: Array<{ key: string; jobCode?: string; sheet?: string; row?: number }>;
      applicabilityOverrides?: Array<{
        field: string;
        jobKey?: string;
        applicability: 'applicable' | 'not_applicable';
        basis: string;
      }>;
      note?: string;
    },
    operator: { id: string },
  ) {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: { snapshot: true },
    });
    if (!run) throw new NotFoundException('提取任务不存在');

    const checklist = buildChecklist({
      snapshotId: run.snapshotId,
      inputHash: run.snapshot?.contentHash ?? '',
      source: input.source ?? 'independent',
      jobs: input.jobs,
      applicabilityOverrides: input.applicabilityOverrides,
      frozenBy: operator.id,
      frozenAt: new Date().toISOString(),
      note: input.note,
    });

    const existing = await this.prisma.expectedChecklist.findUnique({
      where: { runId },
    });

    // 修改清单 → 新增版本（保留历史）；旧版本指标不被追溯修改。
    const nextVersion = existing ? existing.version + 1 : 1;

    const payload = {
      announcementSlots: checklist.announcementSlots,
      jobs: checklist.jobs,
    } as unknown as object;

    const saved = existing
      ? await this.prisma.expectedChecklist.update({
          where: { runId },
          data: {
            version: nextVersion,
            snapshotId: checklist.snapshotId,
            inputHash: checklist.inputHash,
            source: checklist.source,
            slots: payload,
            frozenAt: new Date(checklist.frozenAt),
            frozenBy: checklist.frozenBy,
            note: checklist.note ?? null,
          },
        })
      : await this.prisma.expectedChecklist.create({
          data: {
            runId,
            version: nextVersion,
            snapshotId: checklist.snapshotId,
            inputHash: checklist.inputHash,
            source: checklist.source,
            slots: payload,
            frozenAt: new Date(checklist.frozenAt),
            frozenBy: checklist.frozenBy,
            note: checklist.note ?? null,
          },
        });

    return { ...saved, checklist };
  }

  /** 读取任务期望清单（无则返回 null） */
  async getChecklist(runId: string) {
    const row = await this.prisma.expectedChecklist.findUnique({ where: { runId } });
    return row ? this.checklistFromRow(row) : null;
  }

  /** M1：从候选 rawJson.files 提取材料包文件状态（持久化后刷新可读） */
  private readMaterialPack(candidate: unknown, parserVersion: string) {
    const raw = candidate as {
      rawJson?: { files?: Array<Record<string, unknown>> };
      fields?: unknown[];
    } | null;
    const files = raw?.rawJson?.files;
    if (!Array.isArray(files) || files.length === 0) return null;
    return {
      runId: null,
      status: files.some((f) => f.readStatus !== 'ok') ? 'partial' : 'pending_review',
      parserVersion,
      fieldCount: (raw?.fields ?? []).length,
      files,
    };
  }

  /** M2：把持久化的 ExpectedChecklist 行还原为领域对象 */
  private checklistFromRow(row: {
    version: number;
    snapshotId: string;
    inputHash: string;
    source: string;
    slots: unknown;
    frozenAt: Date;
    frozenBy: string;
    note?: string | null;
  }): ExpectedChecklist {
    const slots = (row.slots ?? {}) as {
      announcementSlots?: ExpectedChecklist['announcementSlots'];
      jobs?: ExpectedChecklist['jobs'];
    };
    return {
      version: row.version,
      snapshotId: row.snapshotId,
      inputHash: row.inputHash,
      source: (row.source === 'retrospective' ? 'retrospective' : 'independent') as ExpectedChecklist['source'],
      announcementSlots: slots.announcementSlots ?? [],
      jobs: slots.jobs ?? [],
      frozenAt: row.frozenAt.toISOString(),
      frozenBy: row.frozenBy,
      note: row.note ?? undefined,
    };
  }

  /** M2：从材料包文件状态推导「无法核验」的 scope（不可读附件的岗位来源） */
  private unverifiableScopesFromMaterialPack(candidate: unknown): ReadonlySet<string> {
    const raw = candidate as {
      rawJson?: { files?: Array<{ readStatus?: string }> };
    } | null;
    const files = raw?.rawJson?.files;
    if (!Array.isArray(files) || files.length === 0) return new Set();
    const unreadable = files.some(
      (f) => f.readStatus !== 'ok' && f.readStatus !== undefined,
    );
    // 任一附件不可读时，无法判断哪些岗位槽位「原文未明示」还是「来源缺失」，
    // 保守标记全部范围为「无法核验」，避免把解析失败误判为原文没有。
    if (unreadable) return new Set(['__all__']);
    return new Set();
  }

  // ==================== 4. 提交审核 ====================

  async submitReview(input: SubmitReviewInput, reviewer: { id: string; name: string }) {
    const run = await this.prisma.extractionRun.findUnique({ where: { id: input.runId } });
    if (!run) throw new NotFoundException('提取任务不存在');
    if (!run.candidate) throw new BadRequestException('任务尚无提取结果，无法审核');

    // WB4：乐观并发校验——若客户端基线时间与当前记录不一致，说明他人已提交，
    // 拒绝覆盖（返回 409）。
    if (
      input.baseUpdatedAt &&
      run.updatedAt &&
      input.baseUpdatedAt !== run.updatedAt.toISOString()
    ) {
      throw new ConflictException('审核记录已被他人更新，请刷新后重试');
    }

    const current = run.candidate as unknown as ExtractionCandidate;

    // 高影响字段证据校验（domain 规则）
    if (isApprovalAction(input.action)) {
      assertCanApprove(run.status as never, current);
    }

    // 构造审核后候选
    let after: ExtractionCandidate = current;

    // WB4：先应用字段级决策（adopt/edit/reject/pending），再合并到候选
    if (input.fieldDecisions && input.fieldDecisions.length > 0) {
      const validationErrors = validateFieldDecisions(input.fieldDecisions);
      if (validationErrors.length > 0) {
        throw new BadRequestException(validationErrors.join('；'));
      }
      const decidedAt = new Date().toISOString();
      const fieldsWithDecisions = applyFieldDecisions(
        current.fields,
        input.fieldDecisions,
        reviewer.id,
        decidedAt,
      );
      after = { ...current, fields: fieldsWithDecisions };
    }

    if (input.action === 'approve_with_edit') {
      if (!input.editedFields || input.editedFields.length === 0) {
        throw new BadRequestException('修改后通过必须提供修改后的字段');
      }
      after = { ...after, fields: input.editedFields };
      // 修改后的候选也必须通过高影响字段证据校验
      assertCanApprove(run.status as never, after);
    }

    // WB4：审核通过前调用 WB3 质量门禁。
    // 审核级阻塞 = 高影响字段缺证据（assertCanApprove 已覆盖）+ 未裁决的冲突字段。
    // AI/OCR 未确认属「发布门禁」，由 approve 动作本身完成人工确认（markAutoFieldsConfirmed），
    // 因此不在这里阻断 approve，避免与既有「审核通过即人工确认」语义冲突。
    if (isApprovalAction(input.action)) {
      const conflicts = after.fields.filter(
        (f) => (f.status ?? 'extracted') === 'conflict',
      );
      if (conflicts.length > 0) {
        const names = conflicts.map((f) => f.field).join('、');
        throw new BadRequestException(
          `存在未裁决的冲突字段，不能审核通过：${names}`,
        );
      }
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

  /**
   * 发布（WB5：候选 → 目录载荷 → 严格校验 → 原子事务）。
   *
   * 顺序（严格）：
   * 1. 读取 run（含 snapshot.source 与 publishedVersion）与审核状态；
   * 2. 执行 `assertCanPublish`（approved + AI/OCR 已人工确认）与 WB3 质量门禁
   *    `assertPublishable`（conflict/unknown 必需/高影响缺证据阻塞）；
   * 3. 构造目录载荷（`buildCatalogPayload`，元数据不猜值）；
   * 4. 在数据库事务前调用 `projectCatalogVersion` 做严格结构验证；
   * 5. 通过后再执行 version supersede、新版本插入、run 状态更新的单一事务。
   *
   * 任何失败都不产生 published 半成品、不提前 supersede 旧版本、不把 run 标成 published。
   *
   * @param runId 提取任务 id
   * @param dataset 数据集合（受信配置/审核输入明确给出，只允许 test/demo/real）
   */
  async publish(runId: string, dataset: CatalogDataset = 'demo') {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: {
        publishedVersion: true,
        snapshot: { include: { source: true } },
      },
    });
    if (!run) throw new NotFoundException('提取任务不存在');

    // 1. 读取审核状态 + 候选
    if (!run.candidate) throw new BadRequestException('任务无候选结果，无法发布');
    const candidate = run.candidate as unknown as ExtractionCandidate;

    // 重复发布冲突（先于门禁，避免把已发布任务误报为「未审核」）
    if (run.publishedVersion) {
      throw new ConflictException('该任务已发布，不能重复发布');
    }

    // 2. 发布门禁：approved + AI/OCR 已确认 + WB3 质量门禁
    assertCanPublish(run.status as never, candidate);
    try {
      assertPublishable(candidate);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : '候选未通过发布门禁',
      );
    }

    // dataset 校验：只允许 test/demo/real
    if (dataset !== 'test' && dataset !== 'demo' && dataset !== 'real') {
      throw new BadRequestException('dataset 只能是 test/demo/real');
    }
    // real 发布要求官方来源证据；演示来源（example.gov.cn）不得标为 real
    const source = run.snapshot?.source;
    if (!source) {
      throw new BadRequestException('缺少来源信息，无法发布');
    }
    if (dataset === 'real' && /example\.(gov\.cn|com|org)/i.test(source.officialUrl)) {
      throw new BadRequestException('演示来源不能标为 real 数据集');
    }

    // 正式发布必须使用真实审核留痕，提交人及发布时间不能冒充复核信息。
    const review = dataset === 'real'
      ? await this.prisma.reviewRecord.findFirst({
          where: { runId },
          orderBy: { reviewedAt: 'desc' },
        })
      : null;
    if (dataset === 'real' && (!review ||
      !['approve', 'approve_with_edit'].includes(review.action) ||
      !review.reviewerId?.trim() || !review.reviewedAt)) {
      throw new BadRequestException('正式发布缺少有效的人工通过审核记录');
    }

    const announcementId = run.announcementId ?? run.id;

    // 查找该公告的当前已发布版本（用于版本链 + supersede）
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

    // 3. 构造目录载荷（元数据来自可信 DB 字段；缺失/非法抛结构化错误）
    let catalogPayload: ReturnType<typeof buildCatalogPayload>;
    try {
      catalogPayload = buildCatalogPayload(
        candidate,
        {
          announcementId,
          publisher: source.publisher,
          officialUrl: source.officialUrl,
          regionCode: source.regionCode ?? undefined,
          dataset,
          ...(dataset === 'real'
            ? {
                reviewedBy: review!.reviewerId,
                reviewedAt: review!.reviewedAt.toISOString(),
              }
            : {}),
        },
        {
          versionId: version.id,
          versionNumber: version.versionNumber,
          sourceKind: 'original',
          publishedAt: now.toISOString(),
        },
      );
    } catch (e) {
      throw new BadRequestException(
        e instanceof CatalogPayloadError ? e.message : '目录载荷构造失败',
      );
    }

    // 4. 事务前严格结构验证（projector 接受则通过，否则抛 ProjectionError）
    try {
      projectCatalogVersion(
        {
          id: version.id,
          announcementId,
          versionNumber: version.versionNumber,
          status: 'published',
          payload: catalogPayload,
        },
        now,
      );
    } catch (e) {
      // 投影失败：不进入事务，不写任何数据
      if (e instanceof ProjectionError) {
        throw new BadRequestException(
          `目录载荷结构校验失败（${e.fieldPath}）：${e.message}`,
        );
      }
      throw e;
    }

    // 5. 单一事务：supersede 旧版本 + 插入新版本 + run 状态更新
    return this.prisma.$transaction(async (tx) => {
      if (superseded) {
        await tx.publishedAnnouncementVersion.update({
          where: { id: superseded.id },
          data: { status: 'superseded', supersededAt: now },
        });
      }

      const published = await tx.publishedAnnouncementVersion.create({
        data: {
          id: version.id,
          announcementId,
          runId,
          versionNumber: version.versionNumber,
          status: 'published',
          payload: catalogPayload as unknown as object,
          publishedAt: now,
          previousVersionId: version.previousVersionId ?? null,
        },
      });

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

    // 显式载荷类型守卫：目录载荷（WB5 新契约）与 legacy ExtractionCandidate
    // 是两种契约，不得用 as unknown as 混用。二者都不含 legacy fields 时，
    // 版本差异无法按字段对齐，返回明确的「目录载荷差异」而非崩溃。
    if (isCatalogPayload(a.payload) || isCatalogPayload(b.payload)) {
      return catalogVersionDiff(a, b);
    }

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

    // 抓取与 M1 手动材料包都按 storageKey 保存；不能再猜旧版 hash.bin 路径。
    const store = this.objectStore ?? new LocalObjectStore();
    let bytes: Buffer;
    try {
      bytes = await store.getBinary(snapshot.storageKey);
    } catch (error) {
      // 仅兼容旧提交链路生成的 .bin 引用；远程存储/权限错误不伪装成丢失。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!snapshot.storageKey.endsWith('.bin')) {
        throw new NotFoundException('归档原件暂时无法读取，请检查快照存储；重新检查来源不会自动替代此历史证据');
      }
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      try {
        bytes = await fs.readFile(path.join(process.cwd(), '.data', 'snapshots', `${snapshot.contentHash}.bin`));
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError;
        throw new NotFoundException('归档原件暂时无法读取，请检查快照存储；重新检查来源不会自动替代此历史证据');
      }
    }
    if (/^(text\/|application\/(json|xml|xhtml\+xml))/i.test(snapshot.mimeType)) {
      return { content: bytes.toString('utf8'), mimeType: snapshot.mimeType };
    }
    // PDF/Excel/DOCX 原件是二进制，审核文本取自同一快照的解析记录，不能 UTF-8 乱解码。
    const parsed = await this.prisma.documentParseRun.findFirst({
      where: { snapshotId }, orderBy: { createdAt: 'desc' },
    });
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const content = blocks.flatMap((block) => {
      if (typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string') return [];
      return [block.text];
    }).join('\n');
    return {
      content: content
        ? `【同一归档快照的解析文本，非原始二进制文件】\n${content}`
        : '【归档原件存在，但暂无可显示的解析文本，请检查解析状态或人工处理扫描件】',
      mimeType: 'text/plain',
    };
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
