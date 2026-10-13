/**
 * v7.2 工作包 4：测试替身（内存 Prisma / 内存队列 / 内存对象存储 / 离线抓取工厂）。
 *
 * 目的：让抓取执行器的测试矩阵在没有真实 PostgreSQL、Redis 与网络的情况下
 * 确定性运行。生产代码不引用本文件；它同时被 tsconfig.build.json 排除，不入镜像。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CRAWL_TASK_QUEUE } from '../sourcing.tokens.js';
import { OBJECT_STORE } from '../storage/storage.tokens.js';
import {
  QueueUnavailableError,
  type CrawlTaskName,
  type CrawlTaskPayloadByName,
  type CrawlTaskQueue,
  type EnqueueResult,
} from '../jobs/task-queue.js';
import type { ObjectStore } from '../storage/object-store.js';
import { snapshotStorageKey } from '../storage/object-store.js';
import { SafeFetcher, type SafeFetcherOptions } from '../fetch/safe-fetcher.js';
import {
  SafeFetcherFactory,
  resolveAllowedHosts,
} from '../fetch/safe-fetcher-factory.js';
import type { SourceRecord } from '../crawl-run-store.js';

export { CRAWL_TASK_QUEUE, OBJECT_STORE };

/** ---------- 内存 Prisma ---------- */

interface SourceRow extends Record<string, unknown> {
  id: string;
  publisher: string;
  officialUrl: string;
  enabled: boolean;
  adapterKey: string | null;
  listUrls: unknown;
  allowedHosts: unknown;
  pollEveryMinutes: number;
  nextCheckAt: Date | null;
  healthStatus: string;
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  etag: string | null;
  lastModified: string | null;
}

function applyUpdate(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      'increment' in (value as Record<string, unknown>)
    ) {
      const current = Number(target[key] ?? 0);
      target[key] = current + Number((value as { increment: number }).increment);
    } else {
      target[key] = value;
    }
  }
}

/** 模拟 Prisma select：只挑出 select 标记为 true 的字段 */
function pickSelect(
  row: Record<string, unknown>,
  select?: Record<string, boolean>,
): Record<string, unknown> {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) out[key] = row[key];
  }
  return out;
}

/** 覆盖抓取执行器用到的最小 Prisma 接口；不实现未用到的能力 */
export class FakePrisma {
  sources: SourceRow[] = [];
  runs: Array<Record<string, unknown> & { id: string; sourceId: string }> = [];
  documents: Array<Record<string, unknown> & { id: string }> = [];
  snapshots: Array<Record<string, unknown> & { id: string }> = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  seedSource(partial: Partial<SourceRow> & { publisher: string; officialUrl: string }): SourceRow {
    const row: SourceRow = {
      id: partial.id ?? this.nextId('src'),
      publisher: partial.publisher,
      officialUrl: partial.officialUrl,
      enabled: partial.enabled ?? true,
      // null 是合法取值（表示未配置适配器），必须与“未传参”区分
      adapterKey:
        partial.adapterKey !== undefined ? partial.adapterKey : 'hangzhou-education',
      listUrls: partial.listUrls ?? null,
      allowedHosts: partial.allowedHosts ?? null,
      pollEveryMinutes: partial.pollEveryMinutes ?? 60,
      nextCheckAt: partial.nextCheckAt ?? null,
      healthStatus: partial.healthStatus ?? 'healthy',
      consecutiveFailures: partial.consecutiveFailures ?? 0,
      lastCheckedAt: partial.lastCheckedAt ?? null,
      etag: partial.etag ?? null,
      lastModified: partial.lastModified ?? null,
    };
    this.sources.push(row);
    return row;
  }

  seedSnapshot(input: {
    sourceId: string;
    contentHash: string;
    storageKey?: string;
    officialUrl?: string | null;
    mimeType?: string;
  }) {
    const row = {
      id: this.nextId('snap'),
      sourceId: input.sourceId,
      officialUrl: input.officialUrl ?? null,
      storageKey: input.storageKey ?? `snapshots/${input.contentHash}`,
      mimeType: input.mimeType ?? 'text/html',
      contentHash: input.contentHash,
      fetchedAt: new Date(),
      httpStatus: 200,
    };
    this.snapshots.push(row);
    return row;
  }

  seedDocument(input: {
    sourceId: string;
    canonicalUrl: string;
    kind?: string;
    latestSnapshotId?: string | null;
    contentHash?: string | null;
    parentDocumentId?: string | null;
  }) {
    const row = {
      id: this.nextId('doc'),
      sourceId: input.sourceId,
      canonicalUrl: input.canonicalUrl,
      kind: input.kind ?? 'announcement',
      parentDocumentId: input.parentDocumentId ?? null,
      relationType: null,
      contentHash: input.contentHash ?? null,
      latestSnapshotId: input.latestSnapshotId ?? null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    };
    this.documents.push(row);
    return row;
  }

  readonly source = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.sources.find((s) => s.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { officialUrl?: string } }) =>
      this.sources.find(
        (s) => where.officialUrl === undefined || s.officialUrl === where.officialUrl,
      ) ?? null,
    findMany: async ({
      where,
      take,
      orderBy,
    }: {
      where?: {
        enabled?: boolean;
        healthStatus?: { not?: string; notIn?: string[] };
        OR?: Array<{ nextCheckAt: null } | { nextCheckAt: { lte: Date } }>;
      };
      take?: number;
      orderBy?: unknown;
    } = {}) => {
      void orderBy;
      let rows = [...this.sources];
      if (where?.enabled !== undefined) rows = rows.filter((s) => s.enabled === where.enabled);
      if (where?.healthStatus?.not) {
        rows = rows.filter((s) => s.healthStatus !== where.healthStatus!.not);
      }
      if (where?.healthStatus?.notIn) {
        const excluded = where.healthStatus.notIn;
        rows = rows.filter((s) => !excluded.includes(s.healthStatus));
      }
      if (where?.OR) {
        rows = rows.filter((s) =>
          (where.OR as Array<Record<string, unknown>>).some((clause) => {
            if ('nextCheckAt' in clause && clause.nextCheckAt === null) {
              return s.nextCheckAt === null;
            }
            const lte = (clause as { nextCheckAt: { lte: Date } }).nextCheckAt?.lte;
            return s.nextCheckAt !== null && s.nextCheckAt <= lte;
          }),
        );
      }
      return take ? rows.slice(0, take) : rows;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: this.nextId('src'), ...data } as unknown as SourceRow;
      this.sources.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.sources.find((s) => s.id === where.id);
      if (!row) throw new Error(`source not found: ${where.id}`);
      applyUpdate(row, data);
      return row;
    },
  };

  readonly crawlRun = {
    create: async ({
      data,
    }: {
      data: Record<string, unknown>;
      select?: unknown;
    }) => {
      const row = {
        id: this.nextId('run'),
        status: 'queued',
        startedAt: new Date(),
        finishedAt: null,
        discoveredCount: 0,
        downloadedCount: 0,
        unchangedCount: 0,
        failedCount: 0,
        errorSummary: null,
        adapterVersion: null,
        ...data,
      } as Record<string, unknown> & { id: string; sourceId: string };
      this.runs.push(row);
      return { id: row.id };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.runs.find((r) => r.id === where.id);
      if (!row) throw new Error(`crawlRun not found: ${where.id}`);
      applyUpdate(row, data);
      return row;
    },
    findMany: async ({
      where,
      take,
    }: {
      where: { sourceId: string };
      take?: number;
    }) => {
      const rows = this.runs.filter((r) => r.sourceId === where.sourceId);
      return take ? rows.slice(-take) : rows;
    },
    findFirst: async ({
      where,
      orderBy,
      select,
    }: {
      where: {
        sourceId: string;
        status?: { in: string[] };
        startedAt?: { gte: Date };
        discoveredCount?: { gt: number };
      };
      orderBy?: { startedAt?: 'asc' | 'desc' };
      select?: Record<string, boolean>;
    }) => {
      let rows = this.runs.filter((r) => r.sourceId === where.sourceId);
      if (where.status?.in) {
        const allowed = where.status.in;
        rows = rows.filter((r) => allowed.includes(String(r.status)));
      }
      if (where.startedAt?.gte) {
        const gte = where.startedAt.gte;
        rows = rows.filter((r) => (r.startedAt as Date) >= gte);
      }
      if (where.discoveredCount?.gt !== undefined) {
        const gt = where.discoveredCount.gt;
        rows = rows.filter((r) => Number(r.discoveredCount ?? 0) > gt);
      }
      rows = [...rows].sort(
        (a, b) =>
          (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime(),
      );
      void orderBy;
      const row = rows[0] ?? null;
      return row ? pickSelect(row, select) : null;
    },
  };

  readonly sourceDocument = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { sourceId_canonicalUrl: { sourceId: string; canonicalUrl: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = where.sourceId_canonicalUrl;
      let row = this.documents.find(
        (d) =>
          d.sourceId === key.sourceId && d.canonicalUrl === key.canonicalUrl,
      );
      if (!row) {
        row = {
          id: this.nextId('doc'),
          latestSnapshotId: null,
          contentHash: null,
          relationType: null,
          parentDocumentId: null,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          ...create,
        } as Record<string, unknown> & { id: string };
        this.documents.push(row);
      } else {
        applyUpdate(row, update);
      }
      return {
        id: row.id,
        sourceId: row.sourceId,
        canonicalUrl: row.canonicalUrl,
        kind: row.kind,
        latestSnapshotId: row.latestSnapshotId ?? null,
        contentHash: row.contentHash ?? null,
      };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.documents.find((d) => d.id === where.id);
      if (!row) throw new Error(`document not found: ${where.id}`);
      applyUpdate(row, data);
      return row;
    },
    findMany: async ({ where }: { where: { sourceId: string } }) =>
      this.documents.filter((d) => d.sourceId === where.sourceId),
    findFirst: async ({
      where,
      select,
    }: {
      where: { sourceId: string };
      select?: Record<string, boolean>;
    }) => {
      const row =
        this.documents.find((d) => d.sourceId === where.sourceId) ?? null;
      return row ? pickSelect(row as Record<string, unknown>, select) : null;
    },
  };

  readonly sourceSnapshot = {
    findUnique: async ({
      where,
    }: {
      where: { id?: string; sourceId_contentHash?: { sourceId: string; contentHash: string } };
    }) => {
      if (where.id) return this.snapshots.find((s) => s.id === where.id) ?? null;
      const key = where.sourceId_contentHash!;
      return (
        this.snapshots.find(
          (s) => s.sourceId === key.sourceId && s.contentHash === key.contentHash,
        ) ?? null
      );
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: this.nextId('snap'), ...data } as Record<string, unknown> & {
        id: string;
      };
      this.snapshots.push(row);
      return row;
    },
  };

  /** 供断言：把内部数组按 id 查找 */
  findRun(runId: string) {
    return this.runs.find((r) => r.id === runId) ?? null;
  }

  /** ---------- documentParseRun / extractionRun / evidenceAnchor（v7.2 附件解析） ---------- */

  parseRuns: Array<Record<string, unknown> & { id: string }> = [];
  extractionRuns: Array<Record<string, unknown> & { id: string }> = [];
  evidenceAnchors: Array<Record<string, unknown> & { id: string; runId: string }> = [];
  private modelSeq = 0;

  private nextModelId(prefix: string): string {
    this.modelSeq += 1;
    return `${prefix}-${this.modelSeq}`;
  }

  private sortDesc<T extends { createdAt?: Date }>(rows: T[]): T[] {
    return [...rows].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
  }

  readonly documentParseRun = {
    findUnique: async ({
      where,
    }: {
      where: { id?: string; snapshotId_parserVersion?: { snapshotId: string; parserVersion: string } };
    }) => {
      if (where.id) return this.parseRuns.find((r) => r.id === where.id) ?? null;
      const key = where.snapshotId_parserVersion;
      if (!key) return null;
      return (
        this.parseRuns.find(
          (r) =>
            r.snapshotId === key.snapshotId && r.parserVersion === key.parserVersion,
        ) ?? null
      );
    },
    /** 支持 snapshotId 直查与经 SourceSnapshot 关联的 sourceId 查询（listHealth 聚合用） */
    findFirst: async ({
      where,
      orderBy,
      select,
    }: {
      where: { snapshotId?: string; snapshot?: { sourceId?: string } };
      orderBy?: { createdAt?: 'asc' | 'desc' };
      select?: Record<string, boolean>;
    }) => {
      let rows = [...this.parseRuns];
      if (where.snapshotId) {
        rows = rows.filter((r) => r.snapshotId === where.snapshotId);
      }
      const sourceId = where.snapshot?.sourceId;
      if (sourceId) {
        const snapshotIds = new Set(
          this.snapshots.filter((s) => s.sourceId === sourceId).map((s) => s.id),
        );
        rows = rows.filter((r) => snapshotIds.has(String(r.snapshotId)));
      }
      const sorted = this.sortDesc(
        rows as Array<Record<string, unknown> & { id: string; createdAt?: Date }>,
      );
      void orderBy;
      const row = sorted[0] ?? null;
      return row ? pickSelect(row, select) : null;
    },
    findMany: async ({
      where,
      take,
    }: {
      where: { snapshotId: string; status?: string };
      take?: number;
    }) => {
      let rows = this.parseRuns.filter((r) => r.snapshotId === where.snapshotId);
      if (where.status) rows = rows.filter((r) => r.status === where.status);
      const sorted = this.sortDesc(rows as Array<Record<string, unknown> & { id: string; createdAt?: Date }>);
      return take ? sorted.slice(0, take) : sorted;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: this.nextModelId('dpr'),
        createdAt: new Date(),
        ...data,
      } as Record<string, unknown> & { id: string };
      this.parseRuns.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.parseRuns.find((r) => r.id === where.id);
      if (!row) throw new Error(`documentParseRun not found: ${where.id}`);
      applyUpdate(row, data);
      return row;
    },
  };

  readonly extractionRun = {
    findUnique: async ({
      where,
    }: {
      where: { id?: string; idempotencyKey?: string };
    }) => {
      if (where.id) return this.extractionRuns.find((r) => r.id === where.id) ?? null;
      if (where.idempotencyKey) {
        return (
          this.extractionRuns.find((r) => r.idempotencyKey === where.idempotencyKey) ??
          null
        );
      }
      return null;
    },
    /** 支持 status 过滤与经 SourceSnapshot 关联的 sourceId 过滤（待审核积压统计用） */
    count: async ({
      where,
    }: {
      where: { status?: string; snapshot?: { sourceId?: string } };
    }) => {
      let rows = [...this.extractionRuns];
      if (where.status) rows = rows.filter((r) => r.status === where.status);
      const sourceId = where.snapshot?.sourceId;
      if (sourceId) {
        const snapshotIds = new Set(
          this.snapshots.filter((s) => s.sourceId === sourceId).map((s) => s.id),
        );
        rows = rows.filter((r) => snapshotIds.has(String(r.snapshotId)));
      }
      return rows.length;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: this.nextModelId('er'),
        createdAt: new Date(),
        ...data,
      } as Record<string, unknown> & { id: string };
      this.extractionRuns.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.extractionRuns.find((r) => r.id === where.id);
      if (!row) throw new Error(`extractionRun not found: ${where.id}`);
      applyUpdate(row, data);
      return row;
    },
  };

  readonly evidenceAnchor = {
    deleteMany: async ({ where }: { where: { runId: string } }) => {
      const before = this.evidenceAnchors.length;
      this.evidenceAnchors = this.evidenceAnchors.filter((a) => a.runId !== where.runId);
      return { count: before - this.evidenceAnchors.length };
    },
    createMany: async ({
      data,
    }: {
      data: Array<Record<string, unknown> & { runId: string }>;
    }) => {
      for (const row of data) {
        this.evidenceAnchors.push({
          id: this.nextModelId('ea'),
          createdAt: new Date(),
          ...row,
        });
      }
      return { count: data.length };
    },
    findMany: async ({ where }: { where: { runId: string } }) =>
      this.evidenceAnchors.filter((a) => a.runId === where.runId),
  };
}

/** ---------- 内存队列 ---------- */

export class FakeCrawlTaskQueue implements CrawlTaskQueue {
  readonly jobs = new Map<string, { name: string; payload: unknown }>();
  readonly enqueued: Array<{ name: CrawlTaskName; jobId: string }> = [];
  /** false 模拟 Redis 暂时不可达 */
  available = true;

  async enqueue<T extends CrawlTaskName>(
    name: T,
    payload: CrawlTaskPayloadByName[T],
    options: { jobId: string },
  ): Promise<EnqueueResult> {
    if (!this.available) throw new QueueUnavailableError();
    if (this.jobs.has(options.jobId)) {
      return { jobId: options.jobId, deduplicated: true };
    }
    this.jobs.set(options.jobId, { name, payload });
    this.enqueued.push({ name, jobId: options.jobId });
    return { jobId: options.jobId, deduplicated: false };
  }

  payloadOf<T extends CrawlTaskName>(jobId: string): CrawlTaskPayloadByName[T] | undefined {
    return this.jobs.get(jobId)?.payload as CrawlTaskPayloadByName[T] | undefined;
  }

  count(name: CrawlTaskName): number {
    return this.enqueued.filter((job) => job.name === name).length;
  }
}

/** ---------- 内存对象存储 ---------- */

export class FakeObjectStore implements ObjectStore {
  readonly files = new Map<string, string>();
  readonly binaries = new Map<string, Buffer>();
  readonly writes: string[] = [];

  async put(input: { content: string; contentHash: string }): Promise<string> {
    return this.putBinary({
      content: Buffer.from(input.content, 'utf8'),
      contentHash: input.contentHash,
    });
  }

  async putBinary(input: { content: Buffer; contentHash: string }): Promise<string> {
    const key = snapshotStorageKey(input.contentHash);
    if (!this.binaries.has(key)) {
      this.binaries.set(key, input.content);
      this.files.set(key, input.content.toString('utf8'));
      this.writes.push(key);
    }
    return key;
  }

  async get(storageKey: string): Promise<string> {
    const value = this.files.get(storageKey);
    if (value === undefined) throw new Error(`object not found: ${storageKey}`);
    return value;
  }

  async getBinary(storageKey: string): Promise<Buffer> {
    const value = this.binaries.get(storageKey);
    if (value === undefined) throw new Error(`object not found: ${storageKey}`);
    return value;
  }
}

/** ---------- 离线抓取工厂 ---------- */

export interface OfflineRoute {
  [url: string]: string | { status: number; headers?: Record<string, string>; body?: string };
}

/** 304/204/205 属“无响应体”状态：Node fetch 不允许携带 body */
const NO_BODY_STATUS = new Set([204, 205, 304]);

/** 动态响应器：按 (url, 第几次调用) 返回响应，用于验证重试/退避行为 */
export type OfflineResponder = (
  url: string,
  callIndex: number,
) => Response | Promise<Response>;

/**
 * 继承真实工厂，仅把 SafeFetcher 的 fetch/DNS/sleep 换成注入实现：
 * 保留了 allowlist 等安全策略，同时完全不触网。
 */
export class OfflineFetcherFactory extends SafeFetcherFactory {
  readonly calls: string[] = [];
  private callCount = 0;

  constructor(
    private readonly routes: OfflineRoute,
    private readonly overrides: Partial<SafeFetcherOptions> = {},
    private readonly allowedHosts: string[] = [],
    private readonly responder?: OfflineResponder,
  ) {
    super();
  }

  override create(source: SourceRecord): SafeFetcher {
    const routes = this.routes;
    const fetchImpl: typeof fetch = async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      this.calls.push(url);
      const callIndex = this.callCount;
      this.callCount += 1;
      if (this.responder) return this.responder(url, callIndex);
      const route = routes[url];
      if (route === undefined) {
        // 未登记的 URL 视为 404，避免“未配置”被误当成成功
        return new Response('not found', {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (typeof route === 'string') {
        return new Response(route, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      // 304/204/205 属“无响应体”状态：Node fetch 不允许携带 body
      const body = NO_BODY_STATUS.has(route.status) ? null : (route.body ?? '');
      return new Response(body, {
        status: route.status,
        headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers },
      });
    };
    const routeHosts = Object.keys(routes)
      .map((url) => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })
      .filter((host): host is string => Boolean(host));
    const hosts =
      this.allowedHosts.length > 0
        ? this.allowedHosts
        : // 与生产一致：来源声明的 allowedHosts 优先，同时兼容按路由登记的 host
          [...new Set([...resolveAllowedHosts(source), ...routeHosts])];
    return new SafeFetcher({
      allowedHosts: hosts,
      resolveDns: async () => ['203.0.113.10'],
      fetchImpl,
      sleep: async () => {},
      ...this.overrides,
    });
  }
}

/** ---------- 黄金样本读取 ---------- */

export type GoldenSource = 'hangzhou' | 'ningbo' | 'yinzhou';

/** 从 cwd 逐级向上查找黄金样本目录（测试通常从 backend/ 运行） */
export function resolveGoldenDir(source: GoldenSource): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'tests', 'fixtures', 'golden-sources', source);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`未找到 tests/fixtures/golden-sources/${source} 目录`);
}

export function readGolden(source: GoldenSource, file: 'list.html' | 'detail.html'): string {
  return readFileSync(path.join(resolveGoldenDir(source), file), 'utf8');
}
