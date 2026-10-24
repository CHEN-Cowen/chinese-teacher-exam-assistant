/**
 * v7.2 工作包 4：抓取任务队列契约（Seam）。
 *
 * - 任务内容与幂等键在这里定义，与具体队列实现解耦；
 * - 生产用 BullMQ + Redis 实现（bullmq-task-queue.ts）；
 * - 测试用内存假实现注入，不需要真实 Redis。
 *
 * 幂等原则：重复投递允许发生，但重复写入不允许发生。
 * 幂等键（技术方案 §4.2）：
 * - 发现：sourceId + checkWindow
 * - 下载：sourceId + canonicalUrl + remoteVersionHint
 * - 解析：snapshotId + documentParserVersion
 * - 业务抽取：snapshotId + parserVersion
 * - 投影：publishedVersionId + projectorVersion
 *
 * ⚠️ jobId 一律用 `-` 分隔、禁止冒号：BullMQ 校验「含冒号时必须恰好 3 段」
 * （job.js Custom Id cannot contain :），段数不符直接抛错。fetch 曾是 4 段，
 * 2026-10-22 生产首次真实抓取时踩中（发现成功、投递下载全部失败）。
 */
import { createHash } from 'node:crypto';
import type { DocumentKind } from '../official-site-adapter.js';

const TRANSIENT_FETCH_CODES = new Set([
  'TIMEOUT',
  'NETWORK_ERROR',
  'DNS_FAILED',
]);
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isTransientFetchFailure(errorSummary?: string): boolean {
  if (!errorSummary) return false;
  return errorSummary.split('; ').some((part) => {
    const code = part.match(/^(TIMEOUT|NETWORK_ERROR|DNS_FAILED)(?::|@)/)?.[1];
    if (code && TRANSIENT_FETCH_CODES.has(code)) return true;
    const status = part.match(/^HTTP_ERROR(?::|@.+:)(\d+)$/)?.[1];
    return status !== undefined && TRANSIENT_HTTP_STATUSES.has(Number(status));
  });
}

/** 触发方式：只接受 schedule / admin / retry */
export type CrawlTrigger = 'schedule' | 'admin' | 'retry';

export const CRAWL_TRIGGERS: readonly CrawlTrigger[] = [
  'schedule',
  'admin',
  'retry',
];

export function isCrawlTrigger(value: string): value is CrawlTrigger {
  return (CRAWL_TRIGGERS as readonly string[]).includes(value);
}

/** 首版五类任务 */
export type CrawlTaskName =
  | 'source.discover'
  | 'document.fetch'
  | 'document.parse'
  | 'announcement.extract'
  | 'catalog.project';

export interface SourceDiscoverPayload {
  sourceId: string;
  runId: string;
  trigger: CrawlTrigger;
  /** 本次检查窗口标识（幂等键的一部分），由调用方生成 */
  checkWindow: string;
}

export interface DocumentFetchPayload {
  sourceId: string;
  runId: string;
  canonicalUrl: string;
  kind: DocumentKind;
  /** 附件所属公告文档 id */
  parentDocumentId?: string;
}

export interface DocumentParsePayload {
  snapshotId: string;
  /** 逻辑文档身份，供材料包聚合回溯正文/附件关系 */
  documentId?: string;
  documentParserVersion: string;
}

export interface AnnouncementExtractPayload {
  snapshotId: string;
  /** 当前解析所属逻辑文档；用于回溯公告材料包 */
  documentId?: string;
  parserVersion: string;
}

export interface CatalogProjectPayload {
  publishedVersionId: string;
  projectorVersion: string;
}

export interface CrawlTaskPayloadByName {
  'source.discover': SourceDiscoverPayload;
  'document.fetch': DocumentFetchPayload;
  'document.parse': DocumentParsePayload;
  'announcement.extract': AnnouncementExtractPayload;
  'catalog.project': CatalogProjectPayload;
}

export interface EnqueueResult {
  jobId: string;
  /** true 表示同幂等键任务已存在，本次未新建（重复投递被吸收） */
  deduplicated: boolean;
}

/** 队列积压计数（观测用）；队列不可用时调用方降级为 null */
export interface QueueJobCounts {
  waiting: number;
  delayed: number;
  active: number;
}

export interface CrawlTaskQueue {
  enqueue<T extends CrawlTaskName>(
    name: T,
    payload: CrawlTaskPayloadByName[T],
    options: { jobId: string },
  ): Promise<EnqueueResult>;
  /** 可选：读取队列积压计数（BullMQ getJobCounts）；测试假实现可不提供 */
  getJobCounts?(): Promise<QueueJobCounts>;
}

/** 队列不可用（Redis 暂时不可达）：调用方必须降级而不是让进程崩溃 */
export class QueueUnavailableError extends Error {
  constructor(message = '抓取队列暂时不可用（Redis 不可达）') {
    super(message);
    this.name = 'QueueUnavailableError';
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function discoverJobId(sourceId: string, checkWindow: string): string {
  return `discover-${sourceId}-${checkWindow}`;
}

export function fetchJobId(
  sourceId: string,
  canonicalUrl: string,
  remoteVersionHint: string,
): string {
  const versionHash = sha256(remoteVersionHint || 'noversion').slice(0, 32);
  return `fetch-${sourceId}-${sha256(canonicalUrl).slice(0, 32)}-${versionHash}`;
}

export function parseJobId(
  snapshotId: string,
  documentParserVersion: string,
): string {
  return `parse-${snapshotId}-${documentParserVersion}`;
}

export function extractJobId(
  snapshotId: string,
  parserVersion: string,
): string {
  return `extract-${snapshotId}-${parserVersion}`;
}

export function projectJobId(
  publishedVersionId: string,
  projectorVersion: string,
): string {
  return `project-${publishedVersionId}-${projectorVersion}`;
}

/**
 * 计算“检查窗口”标识：schedule 触发按周期对齐到同一窗口，避免同一时间段内
 * 多个定时器/实例重复投递；admin/retry 立即执行，使用独立窗口（每次新键）。
 */
export function computeCheckWindow(
  trigger: CrawlTrigger,
  pollEveryMinutes: number,
  now: Date,
  nonce?: string,
): string {
  if (trigger !== 'schedule') return nonce ?? String(now.getTime());
  const periodMs = Math.max(1, pollEveryMinutes) * 60_000;
  return String(Math.floor(now.getTime() / periodMs));
}
