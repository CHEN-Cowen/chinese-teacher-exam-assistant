/**
 * 快照保留策略（单机小磁盘保护）。
 *
 * 背景：快照是内容寻址的（`snapshots/<hash前2位>/<sha256>`），内容变一次就多一份
 * 不可变对象，从不覆盖。列表页每天抓数次，若页面里带访问计数器/时间戳/NONCE，
 * 每次抓取都会产出新哈希——对象存储上感觉不到，落到 40GB 单机磁盘上会撑爆。
 *
 * 安全边界（任何一条不满足就不删）：
 * 1. 只处理 HTML（正文页与列表页）。PDF/XLS 附件原件永不清理；
 * 2. 被 SourceDocument.latestSnapshotId / SourceUrlCache.snapshotId /
 *    DocumentParseRun.snapshotId / ExtractionRun.snapshotId 引用的，一律保留；
 * 3. 同一 (sourceId, officialUrl) 下按 fetchedAt 保留最新 N 份，其余才算候选；
 * 4. 只清理早于 minAgeDays 的，避免把正在进行的抓取链打断；
 * 5. 同一 contentHash 若还有其他快照行引用（跨来源转载同一页面很常见），
 *    只删数据库行，不删对象字节。
 *
 * 删除顺序：先删数据库行，再删对象。反过来的话，对象删成功而行删失败会留下
 * 「行还在、字节没了」的坏指针（读取直接 500）；先删行最坏只留下孤儿字节，
 * 属于可回收的无害浪费。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service.js';
import { OBJECT_STORE } from './storage/storage.tokens.js';
import type { ObjectStore } from './storage/object-store.js';

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export interface RetentionPolicy {
  /** 每个 (sourceId, officialUrl) 下保留的 HTML 版本数 */
  keepVersions: number;
  /** 只清理早于该天数的快照 */
  minAgeDays: number;
  /** 单轮扫描上限（防止一次拉全表） */
  scanLimit: number;
}

export interface RetentionCandidate {
  snapshotId: string;
  sourceId: string;
  officialUrl: string | null;
  storageKey: string;
  contentHash: string;
  fetchedAt: Date;
  /** 对象字节是否可随行一并删除（false = 其他快照行仍共享同一 storageKey） */
  objectDeletable: boolean;
  sizeBytes: number | null;
}

export interface RetentionReport {
  dryRun: boolean;
  policy: RetentionPolicy;
  /** 落入扫描窗口的 HTML 快照数 */
  scanned: number;
  /** 因被引用而受保护的快照数 */
  protectedCount: number;
  /** 因版本数未超上限而保留的快照数 */
  keptByVersion: number;
  candidates: number;
  deletedRows: number;
  deletedObjects: number;
  /** 删除行失败（外键/并发）被跳过的数量 */
  skipped: number;
  failed: number;
  bytesFreed: number | null;
  /**
   * 扫描窗口是否被打满（scanned === scanLimit）。
   * true 表示还有更早的快照本轮没看到，需要再跑几轮或调大 limit，
   * 不能据此认为已经清理干净。
   */
  truncated: boolean;
  /** 响应里最多回传的样本，避免大表把接口撑爆 */
  samples: RetentionCandidate[];
}

export const DEFAULT_RETENTION_POLICY = (): RetentionPolicy => ({
  keepVersions: intFromEnv(process.env.SNAPSHOT_RETENTION_KEEP_VERSIONS, 20),
  minAgeDays: intFromEnv(process.env.SNAPSHOT_RETENTION_MIN_AGE_DAYS, 30),
  scanLimit: intFromEnv(process.env.SNAPSHOT_RETENTION_SCAN_LIMIT, 20_000),
});

/** 同步在响应里回传的候选样本上限 */
const SAMPLE_LIMIT = 200;

@Injectable()
export class SnapshotRetentionService {
  private readonly logger = new Logger(SnapshotRetentionService.name);
  private readonly enabled =
    process.env.SNAPSHOT_RETENTION_ENABLED === 'true';
  private readonly dryRunByDefault =
    process.env.SNAPSHOT_RETENTION_DRY_RUN !== 'false';
  private readonly intervalMs = intFromEnv(
    process.env.SNAPSHOT_RETENTION_INTERVAL_MS,
    6 * 60 * 60 * 1000,
  );
  private running = false;
  private lastSweepAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
  ) {}

  /** 定时巡检：仅当 SNAPSHOT_RETENTION_ENABLED=true 生效，且同一时刻只跑一轮 */
  @Interval('snapshot-retention-sweep', 60 * 60 * 1000)
  async scheduledSweep(): Promise<void> {
    // @Interval 装饰器周期在类定义时就固定，这里按注入的 intervalMs 自行节流
    if (!this.enabled) return;
    const last = this.lastSweepAt ?? 0;
    if (Date.now() - last < this.intervalMs) return;
    if (this.running) return;
    this.running = true;
    this.lastSweepAt = Date.now();
    try {
      const report = await this.prune(undefined, this.dryRunByDefault);
      if (report.candidates > 0) {
        this.logger.log(
          `快照保留策略：候选 ${report.candidates} 条，删除行 ${report.deletedRows}，` +
            `删除对象 ${report.deletedObjects}，回收 ${
              report.bytesFreed === null ? '未知' : `${report.bytesFreed} 字节`
            }（dryRun=${report.dryRun}）`,
        );
      }
    } catch (error) {
      this.logger.error(
        `快照保留策略执行失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * 计算清理计划并（可选）执行。
   *
   * @param overrides 覆盖默认策略（来自运维接口）
   * @param dryRun    默认取 SNAPSHOT_RETENTION_DRY_RUN
   */
  async prune(
    overrides?: Partial<RetentionPolicy>,
    dryRun?: boolean,
  ): Promise<RetentionReport> {
    const policy: RetentionPolicy = {
      ...DEFAULT_RETENTION_POLICY(),
      ...sanitizeOverrides(overrides),
    };
    const effectiveDryRun = dryRun ?? this.dryRunByDefault;
    const cutoff = new Date(Date.now() - policy.minAgeDays * 86_400_000);

    const rows = await this.prisma.sourceSnapshot.findMany({
      where: {
        mimeType: { contains: 'html' },
        fetchedAt: { lt: cutoff },
      },
      select: {
        id: true,
        sourceId: true,
        officialUrl: true,
        storageKey: true,
        contentHash: true,
        fetchedAt: true,
      },
      orderBy: { fetchedAt: 'desc' },
      take: policy.scanLimit,
    });

    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      return emptyReport(policy, effectiveDryRun);
    }

    const protectedIds = await this.collectProtectedIds(ids);

    // 按 (sourceId, officialUrl) 分组；行已按 fetchedAt 倒序，前 keepVersions 个保留
    const seen = new Map<string, number>();
    const candidates: RetentionCandidate[] = [];
    let keptByVersion = 0;
    for (const row of rows) {
      if (protectedIds.has(row.id)) continue;
      const groupKey = `${row.sourceId}\u0000${row.officialUrl ?? ''}`;
      const index = seen.get(groupKey) ?? 0;
      seen.set(groupKey, index + 1);
      if (index < policy.keepVersions) {
        keptByVersion += 1;
        continue;
      }
      candidates.push({
        snapshotId: row.id,
        sourceId: row.sourceId,
        officialUrl: row.officialUrl,
        storageKey: row.storageKey,
        contentHash: row.contentHash,
        fetchedAt: row.fetchedAt,
        objectDeletable: false,
        sizeBytes: null,
      });
    }

    await this.markObjectDeletable(candidates);

    if (!effectiveDryRun) {
      await this.execute(candidates);
    }

    const sample = candidates.slice(0, SAMPLE_LIMIT);
    const bytesFreed = await this.sumBytes(candidates);
    return {
      dryRun: effectiveDryRun,
      policy,
      scanned: rows.length,
      protectedCount: protectedIds.size,
      keptByVersion,
      candidates: candidates.length,
      deletedRows: effectiveDryRun ? 0 : candidates.length,
      deletedObjects: effectiveDryRun
        ? 0
        : candidates.filter((item) => item.objectDeletable).length,
      skipped: 0,
      failed: 0,
      bytesFreed,
      truncated: rows.length >= policy.scanLimit,
      samples: sample,
    };
  }

  /** 收集被任意引用方占用的快照 id（四张表逐一排除，宁多留不误删） */
  private async collectProtectedIds(ids: string[]): Promise<Set<string>> {
    const protectedIds = new Set<string>();

    const documents = await this.prisma.sourceDocument.findMany({
      where: { latestSnapshotId: { in: ids } },
      select: { latestSnapshotId: true },
    });
    for (const row of documents) {
      if (row.latestSnapshotId) protectedIds.add(row.latestSnapshotId);
    }

    const caches = await this.prisma.sourceUrlCache.findMany({
      where: { snapshotId: { in: ids } },
      select: { snapshotId: true },
    });
    for (const row of caches) protectedIds.add(row.snapshotId);

    const parseRuns = await this.prisma.documentParseRun.findMany({
      where: { snapshotId: { in: ids } },
      select: { snapshotId: true },
    });
    for (const row of parseRuns) protectedIds.add(row.snapshotId);

    const extractionRuns = await this.prisma.extractionRun.findMany({
      where: { snapshotId: { in: ids } },
      select: { snapshotId: true },
    });
    for (const row of extractionRuns) protectedIds.add(row.snapshotId);

    return protectedIds;
  }

  /**
   * 判定每个候选的对象字节能否删。
   *
   * storageKey 由 contentHash 推导，与 sourceId 无关；同一页面被多个来源转载时
   * 会共享同一个对象。只有当「同哈希的全部快照行都在本次候选集里」时才安全。
   */
  private async markObjectDeletable(
    candidates: RetentionCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) return;
    const hashes = [...new Set(candidates.map((item) => item.contentHash))];
    const grouped = await this.prisma.sourceSnapshot.groupBy({
      by: ['contentHash'],
      where: { contentHash: { in: hashes } },
      _count: { _all: true },
    });
    const totalByHash = new Map<string, number>();
    for (const row of grouped) {
      totalByHash.set(row.contentHash, row._count._all);
    }
    const candidateByHash = new Map<string, number>();
    for (const item of candidates) {
      candidateByHash.set(
        item.contentHash,
        (candidateByHash.get(item.contentHash) ?? 0) + 1,
      );
    }
    for (const item of candidates) {
      const total = totalByHash.get(item.contentHash) ?? 0;
      const inBatch = candidateByHash.get(item.contentHash) ?? 0;
      item.objectDeletable = total > 0 && total === inBatch;
    }
  }

  /** 先删行再删对象；行删除失败（外键/并发）不阻断整轮 */
  private async execute(candidates: RetentionCandidate[]): Promise<void> {
    for (const item of candidates) {
      try {
        await this.prisma.sourceSnapshot.delete({ where: { id: item.snapshotId } });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'P2025' || code === 'P2003') {
          // 行已不存在 / 仍被外键引用：跳过，下一轮再评估
          item.objectDeletable = false;
          continue;
        }
        this.logger.warn(
          `快照 ${item.snapshotId} 删除失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        item.objectDeletable = false;
        continue;
      }
      if (!item.objectDeletable) continue;
      try {
        await this.objectStore.delete(item.storageKey);
      } catch (error) {
        // 行已删、对象残留：无害的孤儿字节，不视为失败
        this.logger.warn(
          `快照对象 ${item.storageKey} 删除失败（已保留孤儿字节）：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** 估算可回收字节；对象存储不支持廉价 stat 时返回 null */
  private async sumBytes(
    items: RetentionCandidate[],
  ): Promise<number | null> {
    const statSize = this.objectStore.statSize;
    if (typeof statSize !== 'function') return null;
    let total = 0;
    for (const item of items) {
      const size = await statSize.call(this.objectStore, item.storageKey);
      if (size === null) continue;
      item.sizeBytes = size;
      total += size;
    }
    return total;
  }
}

function sanitizeOverrides(
  overrides?: Partial<RetentionPolicy>,
): Partial<RetentionPolicy> {
  if (!overrides) return {};
  const clean: Partial<RetentionPolicy> = {};
  if (Number.isFinite(overrides.keepVersions) && overrides.keepVersions! >= 1) {
    clean.keepVersions = Math.floor(overrides.keepVersions!);
  }
  if (Number.isFinite(overrides.minAgeDays) && overrides.minAgeDays! >= 0) {
    clean.minAgeDays = Math.floor(overrides.minAgeDays!);
  }
  if (Number.isFinite(overrides.scanLimit) && overrides.scanLimit! >= 1) {
    clean.scanLimit = Math.floor(overrides.scanLimit!);
  }
  return clean;
}

function emptyReport(
  policy: RetentionPolicy,
  dryRun: boolean,
): RetentionReport {
  return {
    dryRun,
    policy,
    scanned: 0,
    protectedCount: 0,
    keptByVersion: 0,
    candidates: 0,
    deletedRows: 0,
    deletedObjects: 0,
    skipped: 0,
    failed: 0,
    bytesFreed: 0,
    truncated: false,
    samples: [],
  };
}
