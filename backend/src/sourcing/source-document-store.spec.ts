/**
 * v7.2 SourceDocumentStore 公告关系（补充/延期/取消）测试（内存 fake prisma）。
 *
 * 覆盖：confirmRelation 写入确定值与来源校验；listPendingRelations 只返回
 * relationType 以 Candidate 结尾的文档。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SourceDocumentStore } from './source-document-store.js';

function makeDoc(params: Partial<any> = {}): any {
  return {
    id: params.id ?? 'doc-1',
    sourceId: params.sourceId ?? 'src-1',
    canonicalUrl: params.canonicalUrl ?? 'https://example.gov.cn/n/1',
    kind: params.kind ?? 'announcement',
    parentDocumentId: params.parentDocumentId ?? null,
    relationType: params.relationType ?? null,
    contentHash: null,
    latestSnapshotId: null,
    firstSeenAt: new Date('2026-10-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-10-10T00:00:00.000Z'),
  };
}

function makePrisma(initialRows: any[]) {
  const rows = initialRows.map((row) => ({ ...row }));
  const prisma: any = {
    sourceDocument: {
      findUnique: vi.fn(async ({ where }: any) => {
        return rows.find((row) => row.id === where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any = {}) => {
        // fake 只支持 sourceId 过滤；relationType in 过滤由 store 层兜底再过滤
        return rows.filter((row) =>
          where?.sourceId ? row.sourceId === where.sourceId : true,
        );
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('row not found');
        Object.assign(row, data);
        return row;
      }),
    },
  };
  return { prisma, rows };
}

describe('SourceDocumentStore.confirmRelation', () => {
  const announcement = makeDoc({ id: 'doc-ann', kind: 'announcement' });
  const candidate = makeDoc({
    id: 'doc-sup',
    kind: 'supplement',
    canonicalUrl: 'https://example.gov.cn/n/2',
    relationType: 'supplementCandidate',
  });

  it('候选关系确认为确定值：写入 relationType 与 parentDocumentId', async () => {
    const { prisma, rows } = makePrisma([announcement, candidate]);
    const store = new SourceDocumentStore(prisma);

    const result = await store.confirmRelation('doc-sup', {
      relationType: 'supplement',
      parentDocumentId: 'doc-ann',
    });

    expect(result.relationType).toBe('supplement');
    expect(result.parentDocumentId).toBe('doc-ann');
    expect(rows.find((r) => r.id === 'doc-sup').relationType).toBe('supplement');
  });

  it('delay / cancel 同样可确认', async () => {
    const { prisma } = makePrisma([
      announcement,
      makeDoc({ id: 'doc-delay', kind: 'delay', relationType: 'delayCandidate' }),
    ]);
    const store = new SourceDocumentStore(prisma);

    const result = await store.confirmRelation('doc-delay', {
      relationType: 'delay',
      parentDocumentId: 'doc-ann',
    });
    expect(result.relationType).toBe('delay');
  });

  it('relationType 非确定关系值 → BadRequest', async () => {
    const { prisma } = makePrisma([announcement, candidate]);
    const store = new SourceDocumentStore(prisma);

    await expect(
      store.confirmRelation('doc-sup', {
        relationType: 'supplementCandidate' as never,
        parentDocumentId: 'doc-ann',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('文档不存在 → NotFound', async () => {
    const { prisma } = makePrisma([announcement]);
    const store = new SourceDocumentStore(prisma);

    await expect(
      store.confirmRelation('missing', {
        relationType: 'supplement',
        parentDocumentId: 'doc-ann',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('父文档不存在或跨来源 → BadRequest', async () => {
    const otherSourceAnn = makeDoc({
      id: 'doc-ann-other',
      sourceId: 'src-2',
      canonicalUrl: 'https://other.gov.cn/n/1',
    });
    const { prisma } = makePrisma([announcement, candidate, otherSourceAnn]);
    const store = new SourceDocumentStore(prisma);

    await expect(
      store.confirmRelation('doc-sup', {
        relationType: 'supplement',
        parentDocumentId: 'missing-parent',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      store.confirmRelation('doc-sup', {
        relationType: 'supplement',
        parentDocumentId: 'doc-ann-other',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SourceDocumentStore.listPendingRelations', () => {
  it('只返回 relationType 以 Candidate 结尾的文档', async () => {
    const { prisma } = makePrisma([
      makeDoc({ id: 'doc-ann', kind: 'announcement' }),
      makeDoc({ id: 'doc-s1', kind: 'supplement', relationType: 'supplementCandidate' }),
      makeDoc({ id: 'doc-s2', kind: 'delay', relationType: 'delayCandidate' }),
      makeDoc({ id: 'doc-s3', kind: 'cancel', relationType: 'cancelCandidate' }),
      makeDoc({ id: 'doc-ok', kind: 'supplement', relationType: 'supplement', parentDocumentId: 'doc-ann' }),
      makeDoc({ id: 'doc-other', sourceId: 'src-2', kind: 'delay', relationType: 'delayCandidate' }),
    ]);
    const store = new SourceDocumentStore(prisma);

    const pending = await store.listPendingRelations('src-1');

    expect(
      pending.map((row: any) => row.id).sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual([
      'doc-s1',
      'doc-s2',
      'doc-s3',
    ]);
  });

  it('不传 sourceId 时聚合全部来源的候选', async () => {
    const { prisma } = makePrisma([
      makeDoc({ id: 'doc-s1', relationType: 'supplementCandidate' }),
      makeDoc({ id: 'doc-s2', sourceId: 'src-2', relationType: 'cancelCandidate' }),
      makeDoc({ id: 'doc-ok', relationType: 'delay' }),
    ]);
    const store = new SourceDocumentStore(prisma);

    const pending = await store.listPendingRelations();

    expect(
      pending.map((row: any) => row.id).sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual(['doc-s1', 'doc-s2']);
  });
});
