/**
 * W2：官方材料入库、审核、发布与版本管理。
 *
 * 沿用“官方采集/管理员上传 → 原件快照/对象存储 → 解析（Worker）→ 审核 →
 * 发布”的既有链路，新增知识文档与版本记录：
 * - 上传只生成 draft 版本，不自动公开，也不默认进入用户检索；
 * - 同文档新内容追加版本号，已发布版本不可原地修改；
 * - 发布后投递异步索引任务；队列不可用时如实返回未投递并可重试；
 * - 撤回立即把版本移出公开检索，并清理该版本向量（历史记录保留）。
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { OBJECT_STORE } from '../sourcing/storage/storage.tokens.js';
import type { ObjectStore } from '../sourcing/storage/object-store.js';
import { AiService } from '../ai/ai.service.js';
import { CHUNKER_VERSION } from './chunker.js';
import {
  KNOWLEDGE_DOCUMENT_TYPES,
  type CreateKnowledgeDocumentInput,
} from './knowledge.types.js';
import { KnowledgeQueueService } from './knowledge-queue.service.js';
import { VectorStoreService } from './vector-store.service.js';

/** 版本创建时的解析器版本占位；索引成功后写回真实解析器版本 */
export const PARSER_PENDING = 'pending';

export const KNOWLEDGE_VERSION_TRANSITIONS: Record<string, string[]> = {
  draft: ['review', 'withdrawn'],
  review: ['approved', 'draft', 'withdrawn'],
  approved: ['published', 'withdrawn'],
  published: ['withdrawn', 'superseded'],
  withdrawn: [],
  superseded: [],
};

interface PreparedSource {
  contentHash: string;
  storageKey: string;
  mimeType: string;
  snapshotId: string | null;
  sourceUrl: string | null;
  sourceCapturedAt: Date | null;
  sourceKind: 'snapshot' | 'upload' | 'text';
}

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  documentType: string;
  status: string;
  announcementId: string | null;
  regionCode: string | null;
  year: number | null;
  currentVersionId: string | null;
  activeIndexVersion: number | null;
  versionCount: number;
  updatedAt: Date;
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    private readonly queue: KnowledgeQueueService,
    private readonly vectorStore: VectorStoreService,
    private readonly ai: AiService,
  ) {}

  // ==================== 入库 ====================

  async createDocument(
    input: CreateKnowledgeDocumentInput,
    actorId: string | null,
  ): Promise<{
    documentId: string;
    versionId: string;
    versionNumber: number;
    status: string;
    indexJob: { jobId: string; indexVersion: number; queued: boolean; warning?: string } | null;
  }> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('缺少材料标题');
    if (title.length > 200) throw new BadRequestException('材料标题过长');
    if (
      !KNOWLEDGE_DOCUMENT_TYPES.includes(
        input.documentType as (typeof KNOWLEDGE_DOCUMENT_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        `不支持的文档类型：${String(input.documentType)}`,
      );
    }
    if (input.year !== undefined && (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100)) {
      throw new BadRequestException('适用年份不合法');
    }

    const source = await this.prepareSource(input);

    const created = await this.prisma.$transaction(async (tx) => {
      let document = input.documentId
        ? await tx.knowledgeDocument.findUnique({ where: { id: input.documentId } })
        : null;
      if (input.documentId && !document) {
        throw new NotFoundException('知识文档不存在');
      }
      if (document && document.documentType !== input.documentType) {
        throw new BadRequestException('追加版本不能改变文档类型');
      }

      if (document) {
        document = await tx.knowledgeDocument.update({
          where: { id: document.id },
          data: {
            title,
            ...(input.regionCode !== undefined ? { regionCode: input.regionCode } : {}),
            ...(input.provinceCode !== undefined ? { provinceCode: input.provinceCode } : {}),
            ...(input.year !== undefined ? { year: input.year } : {}),
            ...(input.publisher !== undefined ? { publisher: input.publisher } : {}),
            ...(input.officialUrl !== undefined ? { officialUrl: input.officialUrl } : {}),
            ...(input.applicableAudience !== undefined
              ? { applicableAudience: input.applicableAudience }
              : {}),
            ...(input.applicableSubjects !== undefined
              ? { applicableSubjects: input.applicableSubjects as Prisma.InputJsonValue }
              : {}),
            ...(input.applicableStages !== undefined
              ? { applicableStages: input.applicableStages as Prisma.InputJsonValue }
              : {}),
            ...(input.announcementId !== undefined
              ? { announcementId: input.announcementId }
              : {}),
            ...(input.announcementVersionId !== undefined
              ? { announcementVersionId: input.announcementVersionId }
              : {}),
          },
        });
      } else {
        document = await tx.knowledgeDocument.create({
          data: {
            title,
            documentType: input.documentType,
            sourceKind: source.sourceKind,
            status: 'draft',
            announcementId: input.announcementId ?? null,
            announcementVersionId: input.announcementVersionId ?? null,
            regionCode: input.regionCode ?? null,
            provinceCode: input.provinceCode ?? null,
            year: input.year ?? null,
            publisher: input.publisher ?? null,
            officialUrl: input.officialUrl ?? null,
            effectiveFrom: parseDate(input.effectiveFrom),
            effectiveTo: parseDate(input.effectiveTo),
            applicableAudience: input.applicableAudience ?? null,
            applicableSubjects: input.applicableSubjects
              ? (input.applicableSubjects as Prisma.InputJsonValue)
              : undefined,
            applicableStages: input.applicableStages
              ? (input.applicableStages as Prisma.InputJsonValue)
              : undefined,
            createdBy: actorId,
          },
        });
      }

      const latest = await tx.knowledgeDocumentVersion.findFirst({
        where: { documentId: document.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      const version = await tx.knowledgeDocumentVersion.create({
        data: {
          documentId: document.id,
          versionNumber,
          status: 'draft',
          contentHash: source.contentHash,
          parserVersion: PARSER_PENDING,
          chunkerVersion: CHUNKER_VERSION,
          snapshotId: source.snapshotId,
          storageKey: source.storageKey,
          mimeType: source.mimeType,
          sourceUrl: source.sourceUrl,
          sourceCapturedAt: source.sourceCapturedAt,
          ...(input.unitIds?.length
            ? { unitIds: input.unitIds as Prisma.InputJsonValue }
            : {}),
        },
      });

      // 已有发布版本时，新草稿不改变文档公开状态；否则保持 draft。
      if (document!.status !== 'published') {
        await tx.knowledgeDocument.update({
          where: { id: document!.id },
          data: { status: 'draft' },
        });
      }
      return { documentId: document!.id, versionId: version.id, versionNumber, status: 'draft' };
    });

    return { ...created, indexJob: null };
  }

  private async prepareSource(input: CreateKnowledgeDocumentInput): Promise<PreparedSource> {
    const provided = [
      input.content !== undefined,
      input.base64 !== undefined,
      input.snapshotId !== undefined,
    ].filter(Boolean).length;
    if (provided !== 1) {
      throw new BadRequestException(
        'content / base64 / snapshotId 必须且只能提供一个原件来源',
      );
    }

    if (input.snapshotId) {
      const snapshot = await this.prisma.sourceSnapshot.findUnique({
        where: { id: input.snapshotId },
      });
      if (!snapshot) throw new NotFoundException('来源快照不存在');
      return {
        contentHash: snapshot.contentHash,
        storageKey: snapshot.storageKey,
        mimeType: snapshot.mimeType,
        snapshotId: snapshot.id,
        sourceUrl: snapshot.officialUrl,
        sourceCapturedAt: snapshot.fetchedAt,
        sourceKind: 'snapshot',
      };
    }

    let bytes: Buffer;
    let mimeType: string;
    let extension: string;
    if (input.content !== undefined) {
      if (!input.content.trim()) throw new BadRequestException('材料正文为空');
      bytes = Buffer.from(input.content, 'utf8');
      mimeType =
        input.mimeType?.trim() ||
        (/^\s*</.test(input.content) ? 'text/html' : 'text/plain');
      extension = mimeToExtension(mimeType) ||
        (mimeType.startsWith('text/html') ? 'html' : 'txt');
    } else {
      const base64 = (input.base64 ?? '').replace(/\s+/g, '');
      if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw new BadRequestException('附件 base64 不合法');
      }
      bytes = Buffer.from(base64, 'base64');
      if (bytes.length === 0) throw new BadRequestException('附件内容为空');
      mimeType =
        input.mimeType?.trim() ||
        mimeFromFileName(input.fileName) ||
        'application/octet-stream';
      extension =
        extensionOfName(input.fileName) || mimeToExtension(mimeType) || 'bin';
    }

    const contentHash = sha256Hex(bytes);
    const storageKey = await this.objectStore.putBinary({
      content: bytes,
      mimeType,
      contentHash,
    });
    return {
      contentHash,
      storageKey,
      mimeType,
      snapshotId: null,
      sourceUrl: `knowledge://${input.content !== undefined ? 'text' : 'upload'}/${contentHash.slice(
        0,
        16,
      )}.${extension}`,
      sourceCapturedAt: new Date(),
      sourceKind: input.content !== undefined ? 'text' : 'upload',
    };
  }

  // ==================== 审核与发布 ====================

  async submitReview(versionId: string) {
    return this.transition(versionId, 'review', { reviewedBy: null, note: null });
  }

  async approve(versionId: string, actorId: string | null, note?: string) {
    if (!actorId) throw new BadRequestException('审核需要登录身份');
    return this.transition(versionId, 'approved', {
      reviewedBy: actorId,
      reviewedAt: new Date(),
      note: note ?? null,
    });
  }

  async rejectToDraft(versionId: string, actorId: string | null, note?: string) {
    if (!actorId) throw new BadRequestException('审核需要登录身份');
    return this.transition(versionId, 'draft', {
      reviewedBy: actorId,
      reviewedAt: new Date(),
      note: note ?? null,
    });
  }

  async publish(versionId: string, actorId: string | null) {
    if (!actorId) throw new BadRequestException('发布需要登录身份');
    const version = await this.getVersionOrThrow(versionId);
    if (version.status !== 'approved') {
      throw new BadRequestException(`当前版本状态 ${version.status} 不能发布`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeDocumentVersion.updateMany({
        where: {
          documentId: version.documentId,
          status: 'published',
          id: { not: versionId },
        },
        data: { status: 'superseded' },
      });
      await tx.knowledgeDocumentVersion.update({
        where: { id: versionId },
        data: { status: 'published', publishedAt: new Date() },
      });
      await tx.knowledgeDocument.update({
        where: { id: version.documentId },
        data: { status: 'published', currentVersionId: versionId },
      });
    });

    // 发布后异步索引；投递失败只记录，不回滚发布（可手动重试）
    const indexJob = await this.ensureIndexJob(versionId, { retry: false });
    return { versionId, status: 'published', indexJob };
  }

  async withdraw(
    documentId: string,
    actorId: string | null,
    reason: string | null | undefined,
  ) {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      include: { versions: true },
    });
    if (!document) throw new NotFoundException('知识文档不存在');
    const published = document.versions.filter((v) => v.status === 'published');
    if (published.length === 0) {
      throw new BadRequestException('该文档没有可撤回的已发布版本');
    }
    const withdrawReason = (reason ?? '').trim();
    if (!withdrawReason) throw new BadRequestException('撤回必须填写原因');

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeDocumentVersion.updateMany({
        where: { id: { in: published.map((v) => v.id) } },
        data: {
          status: 'withdrawn',
          withdrawnAt: new Date(),
          withdrawReason,
          reviewedBy: actorId,
        },
      });
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'withdrawn', currentVersionId: null },
      });
    });

    // 撤回后立即清理向量，保证不再出现在公开检索候选
    for (const version of published) {
      await this.vectorStore.deleteForVersion(version.id);
    }
    return { documentId, withdrawnVersions: published.map((v) => v.id) };
  }

  private async transition(
    versionId: string,
    target: string,
    extra: { reviewedBy?: string | null; reviewedAt?: Date | null; note?: string | null },
  ) {
    const version = await this.getVersionOrThrow(versionId);
    const allowed = KNOWLEDGE_VERSION_TRANSITIONS[version.status] ?? [];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `版本状态 ${version.status} 不能变更为 ${target}`,
      );
    }
    const updated = await this.prisma.knowledgeDocumentVersion.update({
      where: { id: versionId },
      data: {
        status: target,
        ...(extra.reviewedBy !== undefined ? { reviewedBy: extra.reviewedBy } : {}),
        ...(extra.reviewedAt !== undefined ? { reviewedAt: extra.reviewedAt } : {}),
        ...(extra.note !== undefined ? { reviewNote: extra.note } : {}),
      },
    });
    // 已发布文档追加新草稿/送审不改变公开状态，避免把线上材料降级为不可检索
    await this.prisma.knowledgeDocument.updateMany({
      where: { id: version.documentId, status: { not: 'published' } },
      data: {
        status: target === 'review' ? 'review' : target === 'approved' ? 'approved' : 'draft',
      },
    });
    return {
      versionId,
      status: updated.status,
      versionNumber: updated.versionNumber,
      documentId: version.documentId,
    };
  }

  // ==================== 索引任务 ====================

  /** 创建/复用索引任务并投递；幂等键含内容、切分器与向量模型，升级会生成新索引版本 */
  async ensureIndexJob(
    versionId: string,
    options: { retry?: boolean } = {},
  ): Promise<{
    jobId: string;
    indexVersion: number;
    queued: boolean;
    warning?: string;
    deduplicated?: boolean;
  }> {
    const version = await this.prisma.knowledgeDocumentVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('知识版本不存在');

    const embeddingModel =
      this.ai.mode === 'mock' ? 'mock-hash-1024' : this.ai.config.embedding.model;
    const dimension = this.ai.config.embedding.dimension;
    const idempotencyKey = indexJobKey(version, embeddingModel, dimension);

    const existing = await this.prisma.knowledgeIndexJob.findUnique({
      where: { idempotencyKey },
    });
    let job = existing;
    let reset = false;
    if (existing) {
      if (existing.status === 'failed') {
        job = await this.prisma.knowledgeIndexJob.update({
          where: { id: existing.id },
          data: {
            status: 'queued',
            errorClass: null,
            errorMessage: null,
            finishedAt: null,
          },
        });
        reset = true;
      }
    } else {
      const latest = await this.prisma.knowledgeIndexJob.findFirst({
        where: { versionId },
        orderBy: { indexVersion: 'desc' },
        select: { indexVersion: true },
      });
      job = await this.prisma.knowledgeIndexJob.create({
        data: {
          documentId: version.documentId,
          versionId,
          idempotencyKey,
          indexVersion: (latest?.indexVersion ?? 0) + 1,
          status: 'queued',
          embeddingModel,
          embeddingDim: dimension,
        },
      });
    }
    if (!job) throw new BadRequestException('索引任务创建失败');

    if (job.status === 'ready') {
      return {
        jobId: job.id,
        indexVersion: job.indexVersion,
        queued: false,
        deduplicated: true,
      };
    }

    const result = await this.queue.enqueue(job.id, {
      bullJobId: bullJobId(job.id),
      retry: Boolean(options.retry || reset),
    });
    return {
      jobId: job.id,
      indexVersion: job.indexVersion,
      queued: result.queued,
      warning: result.warning,
      deduplicated: result.deduplicated,
    };
  }

  // ==================== 查询 ====================

  async listDocuments(filters: {
    status?: string;
    documentType?: string;
    regionCode?: string;
    announcementId?: string;
    limit?: number;
  }): Promise<{ items: KnowledgeDocumentSummary[]; total: number }> {
    const take = Math.min(Math.max(1, Math.floor(filters.limit ?? 20)), 100);
    const where: Prisma.KnowledgeDocumentWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.documentType ? { documentType: filters.documentType } : {}),
      ...(filters.regionCode ? { regionCode: filters.regionCode } : {}),
      ...(filters.announcementId ? { announcementId: filters.announcementId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.knowledgeDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take,
        include: {
          _count: { select: { versions: true } },
        },
      }),
      this.prisma.knowledgeDocument.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        documentType: row.documentType,
        status: row.status,
        announcementId: row.announcementId,
        regionCode: row.regionCode,
        year: row.year,
        currentVersionId: row.currentVersionId,
        activeIndexVersion: row.activeIndexVersion,
        versionCount: row._count.versions,
        updatedAt: row.updatedAt,
      })),
      total,
    };
  }

  async getDocument(documentId: string) {
    const row = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            jobs: { orderBy: { createdAt: 'desc' } },
            _count: { select: { chunks: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('知识文档不存在');
    return row;
  }

  async listIndexJobs(filters: { status?: string; limit?: number }) {
    const take = Math.min(Math.max(1, Math.floor(filters.limit ?? 20)), 100);
    const rows = await this.prisma.knowledgeIndexJob.findMany({
      where: filters.status ? { status: filters.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { items: rows, total: rows.length };
  }

  async rebuildIndex(versionId: string, _actorId: string | null) {
    const version = await this.getVersionOrThrow(versionId);
    const result = await this.ensureIndexJob(versionId, { retry: true });
    return { documentId: version.documentId, ...result };
  }

  /**
   * Worker 重启恢复：把仍处于 queued/running 的索引任务重新投递。
   * BullMQ 中仍存在的任务由 enqueue 去重；已丢失或失败的任务会重新入队，
   * 任务本身可重入（run 会清理本 indexVersion 的旧产物）。
   */
  async recoverPendingIndexJobs(): Promise<{
    scanned: number;
    requeued: number;
    deduplicated: number;
    failed: number;
  }> {
    const rows = await this.prisma.knowledgeIndexJob.findMany({
      where: { status: { in: ['queued', 'running'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    let requeued = 0;
    let deduplicated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const result = await this.queue.enqueue(row.id, {
          bullJobId: bullJobId(row.id),
          retry: true,
        });
        if (result.queued) requeued += 1;
        else if (result.deduplicated) deduplicated += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { scanned: rows.length, requeued, deduplicated, failed };
  }

  async status() {
    const [documents, versions, jobs, chunks] = await this.prisma.$transaction([
      this.prisma.knowledgeDocument.count(),
      this.prisma.knowledgeDocumentVersion.count(),
      this.prisma.knowledgeIndexJob.count(),
      this.prisma.knowledgeChunk.count(),
    ]);
    return {
      ai: this.ai.describe(),
      vector: { pgvectorAvailable: await this.vectorStore.isAvailable() },
      counts: { documents, versions, jobs, chunks },
      enabled: this.ai.available,
    };
  }

  private async getVersionOrThrow(versionId: string) {
    const version = await this.prisma.knowledgeDocumentVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('知识版本不存在');
    return version;
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`日期不合法：${value}`);
  }
  return date;
}

export function indexJobKey(
  version: {
    id: string;
    contentHash: string;
    chunkerVersion: string;
  },
  embeddingModel: string,
  dimension: number,
): string {
  return createHash('sha256')
    .update(
      `${version.id}|${version.contentHash}|${version.chunkerVersion}|${embeddingModel}|${dimension}`,
    )
    .digest('hex');
}

/** BullMQ jobId：禁止冒号且需稳定；使用业务任务 id 前缀 + 短哈希 */
export function bullJobId(jobId: string): string {
  return `kidx-${createHash('sha256').update(jobId).digest('hex').slice(0, 32)}`;
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function extensionOfName(name: string | undefined): string {
  if (!name) return '';
  const base = name.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'text/html': 'html',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
  };
  return map[mime.split(';')[0].trim().toLowerCase()] ?? '';
}

function mimeFromFileName(name: string | undefined): string {
  const ext = extensionOfName(name);
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    txt: 'text/plain',
    md: 'text/markdown',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    et: 'application/vnd.ms-excel',
  };
  return map[ext] ?? '';
}
