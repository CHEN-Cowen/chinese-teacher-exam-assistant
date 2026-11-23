import { describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { SnapshotRetentionService } from './snapshot-retention.js';
import type { ObjectStore } from './storage/object-store.js';
import { snapshotStorageKey } from './storage/object-store.js';

interface Row {
  id: string;
  sourceId: string;
  officialUrl: string | null;
  storageKey: string;
  contentHash: string;
  mimeType: string;
  fetchedAt: Date;
}

const DAY = 86_400_000;

function makeRow(input: {
  id: string;
  sourceId?: string;
  officialUrl?: string;
  contentHash: string;
  mimeType?: string;
  daysAgo: number;
}): Row {
  return {
    id: input.id,
    sourceId: input.sourceId ?? 'src-1',
    officialUrl: input.officialUrl ?? 'https://a.example/list.htm',
    storageKey: snapshotStorageKey(input.contentHash),
    contentHash: input.contentHash,
    mimeType: input.mimeType ?? 'text/html',
    fetchedAt: new Date(Date.now() - input.daysAgo * DAY),
  };
}

class FakePrisma {
  snapshots: Row[] = [];
  documentLatest: (string | null)[] = [];
  cacheSnapshotIds: string[] = [];
  parseRunSnapshotIds: string[] = [];
  extractionRunSnapshotIds: string[] = [];
  deletedIds: string[] = [];

  readonly sourceSnapshot = {
    findMany: async (args: {
      where: { mimeType?: { contains?: string }; fetchedAt?: { lt?: Date } };
      take?: number;
    }) => {
      const rows = this.snapshots
        .filter((row) => {
          const contains = args.where.mimeType?.contains;
          if (contains && !row.mimeType.includes(contains)) return false;
          const lt = args.where.fetchedAt?.lt;
          if (lt && !(row.fetchedAt.getTime() < lt.getTime())) return false;
          return true;
        })
        .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
      return args.take ? rows.slice(0, args.take) : rows;
    },
    groupBy: async (args: { where: { contentHash: { in: string[] } } }) => {
      const wanted = new Set(args.where.contentHash.in);
      const counts = new Map<string, number>();
      for (const row of this.snapshots) {
        if (!wanted.has(row.contentHash)) continue;
        counts.set(row.contentHash, (counts.get(row.contentHash) ?? 0) + 1);
      }
      return [...counts.entries()].map(([contentHash, n]) => ({
        contentHash,
        _count: { _all: n },
      }));
    },
    delete: async (args: { where: { id: string } }) => {
      const index = this.snapshots.findIndex((row) => row.id === args.where.id);
      if (index < 0) {
        const error = new Error('record not found') as Error & { code?: string };
        error.code = 'P2025';
        throw error;
      }
      this.snapshots.splice(index, 1);
      this.deletedIds.push(args.where.id);
      return { id: args.where.id };
    },
  };

  private byIds(ids: string[], field: 'latestSnapshotId' | 'snapshotId') {
    return ids.filter((id) => id).map((id) => ({ [field]: id }));
  }

  readonly sourceDocument = {
    findMany: async (args: { where: { latestSnapshotId: { in: string[] } } }) =>
      this.documentLatest
        .filter((id): id is string => !!id && args.where.latestSnapshotId.in.includes(id))
        .map((latestSnapshotId) => ({ latestSnapshotId })),
  };

  readonly sourceUrlCache = {
    findMany: async (args: { where: { snapshotId: { in: string[] } } }) =>
      this.byIds(
        this.cacheSnapshotIds.filter((id) => args.where.snapshotId.in.includes(id)),
        'snapshotId',
      ),
  };

  readonly documentParseRun = {
    findMany: async (args: { where: { snapshotId: { in: string[] } } }) =>
      this.byIds(
        this.parseRunSnapshotIds.filter((id) => args.where.snapshotId.in.includes(id)),
        'snapshotId',
      ),
  };

  readonly extractionRun = {
    findMany: async (args: { where: { snapshotId: { in: string[] } } }) =>
      this.byIds(
        this.extractionRunSnapshotIds.filter((id) =>
          args.where.snapshotId.in.includes(id),
        ),
        'snapshotId',
      ),
  };
}

function makeStore(): ObjectStore & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    put: async (input) => snapshotStorageKey(input.contentHash),
    putBinary: async (input) => snapshotStorageKey(input.contentHash),
    get: async () => '',
    getBinary: async () => Buffer.alloc(0),
    delete: async (storageKey) => {
      deleted.push(storageKey);
    },
    statSize: async () => 1024,
  };
}

function setup() {
  const prisma = new FakePrisma();
  const store = makeStore();
  const service = new SnapshotRetentionService(
    prisma as unknown as PrismaService,
    store,
  );
  return { prisma, store, service };
}

describe('快照保留策略', () => {
  it('只清理 HTML，附件原件永不进入候选', async () => {
    const { prisma, service } = setup();
    prisma.snapshots = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeRow({ id: `html-${i}`, contentHash: `h${i}`, daysAgo: 40 + i }),
      ),
      makeRow({
        id: 'xlsx-0',
        contentHash: 'x0',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        daysAgo: 400,
      }),
    ];
    const report = await service.prune({ keepVersions: 1, minAgeDays: 30 }, true);
    expect(report.candidates).toBe(4);
    expect(report.samples.every((item) => !item.snapshotId.startsWith('xlsx'))).toBe(
      true,
    );
    expect(report.samples.map((item) => item.snapshotId)).not.toContain('xlsx-0');
  });

  it('同一来源同一 URL 只保留最新 N 份，最旧的先删', async () => {
    const { prisma, service } = setup();
    prisma.snapshots = Array.from({ length: 6 }, (_, i) =>
      makeRow({ id: `s${i}`, contentHash: `h${i}`, daysAgo: 100 - i }),
    );
    const report = await service.prune({ keepVersions: 2, minAgeDays: 1 }, true);
    expect(report.keptByVersion).toBe(2);
    expect(report.candidates).toBe(4);
    const keptIds = new Set(['s5', 's4']);
    for (const item of report.samples) {
      expect(keptIds.has(item.snapshotId)).toBe(false);
    }
  });

  it('被文档最新指针、URL 缓存、解析或抽取运行引用的快照一律保留', async () => {
    const { prisma, service } = setup();
    prisma.snapshots = Array.from({ length: 8 }, (_, i) =>
      makeRow({ id: `s${i}`, contentHash: `h${i}`, daysAgo: 200 - i }),
    );
    prisma.documentLatest = ['s0'];
    prisma.cacheSnapshotIds = ['s1'];
    prisma.parseRunSnapshotIds = ['s2'];
    prisma.extractionRunSnapshotIds = ['s3'];
    const report = await service.prune({ keepVersions: 1, minAgeDays: 1 }, true);
    expect(report.protectedCount).toBe(4);
    const candidateIds = report.samples.map((item) => item.snapshotId);
    for (const id of ['s0', 's1', 's2', 's3']) {
      expect(candidateIds).not.toContain(id);
    }
    expect(report.candidates).toBe(3);
  });

  it('同一 contentHash 还有其他快照行在用时，只删行不删对象', async () => {
    const { prisma, store, service } = setup();
    prisma.snapshots = [
      makeRow({ id: 'old', sourceId: 'src-1', contentHash: 'shared', daysAgo: 99 }),
      makeRow({ id: 'old2', sourceId: 'src-1', contentHash: 'other', daysAgo: 98 }),
      // 另一个来源转载了同一页面：哈希相同，但它是该来源的唯一版本，必须保留
      makeRow({ id: 'keep', sourceId: 'src-2', contentHash: 'shared', daysAgo: 50 }),
    ];
    const report = await service.prune({ keepVersions: 1, minAgeDays: 1 }, false);
    expect(report.deletedRows).toBe(1);
    expect(report.deletedObjects).toBe(0);
    expect(store.deleted).toEqual([]);
    expect(prisma.snapshots.map((row) => row.id)).toEqual(['old2', 'keep']);
  });

  it('候选哈希在全表内唯一时才删除对象字节', async () => {
    const { prisma, store, service } = setup();
    prisma.snapshots = [
      makeRow({ id: 'a', contentHash: 'unique-a', daysAgo: 99 }),
      makeRow({ id: 'b', contentHash: 'unique-b', daysAgo: 98 }),
    ];
    const report = await service.prune({ keepVersions: 1, minAgeDays: 1 }, false);
    expect(report.deletedObjects).toBe(1);
    expect(store.deleted).toEqual([snapshotStorageKey('unique-a')]);
  });

  it('dryRun 只出计划，不删行也不删对象', async () => {
    const { prisma, store, service } = setup();
    prisma.snapshots = Array.from({ length: 4 }, (_, i) =>
      makeRow({ id: `s${i}`, contentHash: `h${i}`, daysAgo: 90 - i }),
    );
    const report = await service.prune({ keepVersions: 1, minAgeDays: 1 }, true);
    expect(report.dryRun).toBe(true);
    expect(report.candidates).toBe(3);
    expect(report.deletedRows).toBe(0);
    expect(report.deletedObjects).toBe(0);
    expect(prisma.snapshots).toHaveLength(4);
    expect(store.deleted).toEqual([]);
    expect(report.bytesFreed).toBe(3 * 1024);
  });

  it('扫描窗口被打满时标记 truncated，提示不能认为已清干净', async () => {
    const { prisma, service } = setup();
    prisma.snapshots = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `s${i}`, contentHash: `h${i}`, daysAgo: 90 - i }),
    );
    const report = await service.prune(
      { keepVersions: 1, minAgeDays: 1, scanLimit: 3 },
      true,
    );
    expect(report.scanned).toBe(3);
    expect(report.truncated).toBe(true);
  });

  it('早于 minAgeDays 的限制生效：新快照即使超版本数也不动', async () => {
    const { prisma, service } = setup();
    prisma.snapshots = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `s${i}`, contentHash: `h${i}`, daysAgo: i * 2 }),
    );
    const report = await service.prune({ keepVersions: 1, minAgeDays: 3 }, false);
    // 只有 4/6/8 天前的 s2、s3、s4 进入扫描窗口；保留 1 份，候选 2 条
    expect(report.scanned).toBe(3);
    expect(report.candidates).toBe(2);
  });
});
