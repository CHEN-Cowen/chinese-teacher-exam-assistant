/**
 * v7.2 工作包 4：逻辑文档与不可变快照的持久化访问（Seam）。
 *
 * - SourceDocument：一个 canonicalUrl 一条逻辑文档；
 * - SourceSnapshot：某一时刻的不可变字节版本（contentHash 在同一来源下唯一）；
 * - 相同来源 + 文档 + 哈希保持幂等：命中已有快照时复用，不新建、不重复解析。
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { DocumentKind } from './official-site-adapter.js';
import {
  CANDIDATE_RELATION_TYPES,
  CONFIRMED_RELATION_TYPES,
  isRelationCandidate,
  type RelationKind,
} from '../announcements/relation.domain.js';

export interface SnapshotRecord {
  id: string;
  sourceId: string;
  officialUrl: string | null;
  storageKey: string;
  mimeType: string;
  contentHash: string;
  fetchedAt: Date;
  httpStatus: number | null;
}

export interface SourceDocumentRecord {
  id: string;
  sourceId: string;
  canonicalUrl: string;
  kind: string;
  latestSnapshotId: string | null;
  contentHash: string | null;
}

@Injectable()
export class SourceDocumentStore {
  constructor(private readonly prisma: PrismaService) {}

  async findSnapshotByHash(
    sourceId: string,
    contentHash: string,
  ): Promise<SnapshotRecord | null> {
    const row = await this.prisma.sourceSnapshot.findUnique({
      where: { sourceId_contentHash: { sourceId, contentHash } },
    });
    return row ?? null;
  }

  async getSnapshot(snapshotId: string): Promise<SnapshotRecord | null> {
    const row = await this.prisma.sourceSnapshot.findUnique({
      where: { id: snapshotId },
    });
    return row ?? null;
  }

  /** 已存在同哈希快照直接返回；否则新建（唯一约束兜底并发） */
  async upsertSnapshot(input: {
    sourceId: string;
    officialUrl: string | null;
    storageKey: string;
    mimeType: string;
    contentHash: string;
    fetchedAt: Date;
    httpStatus: number | null;
  }): Promise<{ snapshot: SnapshotRecord; created: boolean }> {
    const existing = await this.findSnapshotByHash(
      input.sourceId,
      input.contentHash,
    );
    if (existing) return { snapshot: existing, created: false };
    const row = await this.prisma.sourceSnapshot.create({ data: input });
    return { snapshot: row, created: true };
  }

  /** 按 canonicalUrl upsert 逻辑文档，返回文档记录 */
  async upsertDocument(input: {
    sourceId: string;
    canonicalUrl: string;
    kind: DocumentKind;
    parentDocumentId?: string | null;
    relationType?: string | null;
  }): Promise<SourceDocumentRecord> {
    const row = await this.prisma.sourceDocument.upsert({
      where: {
        sourceId_canonicalUrl: {
          sourceId: input.sourceId,
          canonicalUrl: input.canonicalUrl,
        },
      },
      create: {
        sourceId: input.sourceId,
        canonicalUrl: input.canonicalUrl,
        kind: input.kind,
        parentDocumentId: input.parentDocumentId ?? null,
        relationType: input.relationType ?? null,
      },
      update: {
        lastSeenAt: new Date(),
        ...(input.parentDocumentId !== undefined
          ? { parentDocumentId: input.parentDocumentId }
          : {}),
        ...(input.relationType !== undefined
          ? { relationType: input.relationType }
          : {}),
      },
      select: {
        id: true,
        sourceId: true,
        canonicalUrl: true,
        kind: true,
        latestSnapshotId: true,
        contentHash: true,
      },
    });
    return row;
  }

  /** 绑定文档的最新快照与哈希（内容变化时生成新快照并前移指针） */
  async attachSnapshot(
    documentId: string,
    input: { snapshotId: string; contentHash: string },
  ): Promise<void> {
    await this.prisma.sourceDocument.update({
      where: { id: documentId },
      data: {
        latestSnapshotId: input.snapshotId,
        contentHash: input.contentHash,
        lastSeenAt: new Date(),
      },
    });
  }

  async listDocuments(sourceId: string) {
    return this.prisma.sourceDocument.findMany({
      where: { sourceId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /**
   * 人工确认公告关系（v7.2）：把候选关系（*Candidate）确认为确定值。
   * - relationType 必须是确定关系值（supplement/delay/cancel）；
   * - 父文档必须存在且与本文档同来源；
   * - 文档必须确实存在。
   */
  async confirmRelation(
    documentId: string,
    input: { relationType: RelationKind; parentDocumentId: string },
  ) {
    if (!CONFIRMED_RELATION_TYPES.includes(input.relationType)) {
      throw new BadRequestException(
        `relationType 必须是确定关系值（${CONFIRMED_RELATION_TYPES.join('/')}），收到：${input.relationType}`,
      );
    }
    const doc = await this.prisma.sourceDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('文档不存在');

    const parent = await this.prisma.sourceDocument.findUnique({
      where: { id: input.parentDocumentId },
    });
    if (!parent || parent.sourceId !== doc.sourceId) {
      throw new BadRequestException('父文档不存在或与本文档不属于同一来源');
    }

    return this.prisma.sourceDocument.update({
      where: { id: documentId },
      data: {
        relationType: input.relationType,
        parentDocumentId: input.parentDocumentId,
      },
    });
  }

  /**
   * 待人工确认的关系队列（v7.2）：relationType 以 Candidate 结尾的文档。
   * 不传 sourceId 时返回全部来源的候选（供审核工作台聚合）。
   */
  async listPendingRelations(sourceId?: string) {
    const rows = await this.prisma.sourceDocument.findMany({
      where: {
        ...(sourceId ? { sourceId } : {}),
        relationType: { in: [...CANDIDATE_RELATION_TYPES] },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    // 兜底再过滤一次（fake prisma 等不支持 in 查询时仍保证口径正确）
    return rows.filter((row) => isRelationCandidate(row.relationType));
  }
}
