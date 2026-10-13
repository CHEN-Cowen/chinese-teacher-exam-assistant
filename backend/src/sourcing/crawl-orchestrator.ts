/**
 * v7.2 工作包 4：抓取编排器（Sourcing Module 的外部 Interface）。
 *
 * 对外只暴露 `checkSource(sourceId, trigger)`：
 * - 校验触发方式（只接受 schedule / admin / retry）；
 * - 创建 CrawlRun 业务审计；
 * - 把发现任务投递到队列（Worker 执行真正的抓取，API 进程不解析）；
 * - 维护来源健康与下次检查时间。
 *
 * 调度、限速、安全获取、URL 规范化、去重、快照与任务投递都在实现内部处理。
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CrawlRunStore, type SourceRecord } from './crawl-run-store.js';
import {
  QueueUnavailableError,
  computeCheckWindow,
  discoverJobId,
  isCrawlTrigger,
  type CrawlTaskQueue,
  type CrawlTrigger,
  type SourceDiscoverPayload,
} from './jobs/task-queue.js';
import { CRAWL_TASK_QUEUE } from './sourcing.tokens.js';

/** 本版适配器版本标识，随适配器实现升级 */
export const SOURCE_ADAPTER_VERSION = 'wp4-v1';

/** 进行中运行的判活窗口：超过 15 分钟的 queued/running 视为僵尸，不再阻塞新运行 */
export const ACTIVE_RUN_WINDOW_MS = 15 * 60_000;

export interface CrawlRunRef {
  runId: string;
  sourceId: string;
  trigger: CrawlTrigger;
  status: string;
  /** 投递任务 id；来源暂停时为 null */
  jobId: string | null;
  deduplicated: boolean;
}

export interface CheckSourceOptions {
  /** 触发时间的注入点（便于测试与调度对齐） */
  now?: Date;
  /** 非 schedule 触发时的窗口 nonce（每次手动检查应不同） */
  nonce?: string;
}

@Injectable()
export class CrawlOrchestrator {
  constructor(
    private readonly store: CrawlRunStore,
    @Inject(CRAWL_TASK_QUEUE) private readonly queue: CrawlTaskQueue,
  ) {}

  async checkSource(
    sourceId: string,
    trigger: CrawlTrigger,
    options: CheckSourceOptions = {},
  ): Promise<CrawlRunRef> {
    if (!isCrawlTrigger(trigger)) {
      throw new Error(
        `不支持的触发方式：${String(trigger)}（只接受 schedule / admin / retry）`,
      );
    }
    const source = await this.store.getSource(sourceId);
    if (!source) {
      throw new NotFoundException(`来源不存在：${sourceId}`);
    }

    const now = options.now ?? new Date();

    // 来源暂停（enabled=false / paused）或封禁待人工处理（blocked）：不投递，不抓取
    const blocked = source.healthStatus === 'blocked';
    if (!source.enabled || source.healthStatus === 'paused' || blocked) {
      const run = await this.store.createRun({
        sourceId,
        trigger,
        adapterVersion: this.adapterVersion(source),
      });
      await this.store.finishRun(run.id, {
        status: blocked ? 'skipped_blocked' : 'skipped_paused',
        errorSummary: blocked
          ? '来源待人工处理（验证码/登录/封禁），跳过自动抓取'
          : '来源已暂停，跳过自动抓取',
      });
      return {
        runId: run.id,
        sourceId,
        trigger,
        status: blocked ? 'skipped_blocked' : 'skipped_paused',
        jobId: null,
        deduplicated: false,
      };
    }

    // 重复点击受控：近 15 分钟内已有进行中运行 → 复用该运行，不新建、不投递队列；
    // 超过窗口的 queued/running 视为僵尸（Worker 崩溃残留），允许发起新运行。
    // schedule 触发同样适用（窗口幂等之外的双保险）。
    const active = await this.store.findActiveRun(
      sourceId,
      new Date(now.getTime() - ACTIVE_RUN_WINDOW_MS),
    );
    if (active) {
      return {
        runId: active.id,
        sourceId,
        trigger,
        status: 'already_running',
        jobId: null,
        deduplicated: true,
      };
    }

    const adapterVersion = this.adapterVersion(source);
    const run = await this.store.createRun({ sourceId, trigger, adapterVersion });

    const checkWindow = computeCheckWindow(
      trigger,
      source.pollEveryMinutes,
      now,
      options.nonce,
    );
    const jobId = discoverJobId(sourceId, checkWindow);
    const payload: SourceDiscoverPayload = {
      sourceId,
      runId: run.id,
      trigger,
      checkWindow,
    };

    try {
      const result = await this.queue.enqueue('source.discover', payload, {
        jobId,
      });
      await this.store.recordCheck(sourceId, {
        checkedAt: now,
        nextCheckAt: this.store.nextCheckAt(now, source.pollEveryMinutes),
      });
      return {
        runId: run.id,
        sourceId,
        trigger,
        status: 'queued',
        jobId: result.jobId,
        deduplicated: result.deduplicated,
      };
    } catch (error) {
      // 队列（Redis）暂时不可用：记录为失败但不计入来源连续失败，
      // 也不让 API 进程崩溃；调用方可重试。
      const reason =
        error instanceof QueueUnavailableError
          ? 'queue_unavailable'
          : 'enqueue_failed';
      await this.store.finishRun(run.id, {
        status: 'failed',
        errorSummary: reason,
      });
      await this.store.recordFailure(sourceId, {
        checkedAt: now,
        nextCheckAt: this.store.nextCheckAt(now, source.pollEveryMinutes),
        reason,
        countTowardsSource: false,
      });
      throw error;
    }
  }

  private adapterVersion(source: SourceRecord): string {
    return `${source.adapterKey ?? 'unknown'}@${SOURCE_ADAPTER_VERSION}`;
  }
}
