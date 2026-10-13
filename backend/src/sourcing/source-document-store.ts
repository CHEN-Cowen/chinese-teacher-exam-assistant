/**
 * v7.2 工作包 4：逻辑文档与不可变快照的持久化访问（Seam）。
 *
 * - SourceDocument：一个 canonicalUrl 一条逻辑文档；
 * - SourceSnapshot：某一时刻的不可变字节版本（contentHash 在同一来源下唯一）；
 * - 相同来源 + 文档 + 哈希保持幂等：命中已有快照时复用，不新建、不重复解析。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { DocumentKind } from './official-site-adapter.js';

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
}
