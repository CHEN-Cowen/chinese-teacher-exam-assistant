/**
 * v7.2 工作包 4：发现处理器（source.discover）。
 *
 * 职责（在独立 Worker 内执行）：
 * 1. 读取来源与对应 Adapter；
 * 2. 用 SafeFetcher 安全获取栏目页（条件请求，304 视为未变化）；
 * 3. 调用 Adapter.discover 得到公告链接；
 * 4. URL 规范化去重，upsert SourceDocument；
 * 5. 投递 document.fetch 任务（新文档或栏目版本变化时）；
 * 6. 维护来源健康与 CrawlRun 审计。
 *
 * DOM 失配（AdapterParseError）→ 记为 structure_changed，绝不当作“无新公告”。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AdapterParseError,
  type DiscoveredDocument,
} from '../official-site-adapter.js';
import { AdapterRegistry } from '../adapter-registry.js';
import {
  CrawlRunStore,
  SUSPECTED_ZERO_RESULTS,
  shouldAlertZeroResults,
} from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import { SafeFetcherFactory } from '../fetch/safe-fetcher-factory.js';
import { SafeFetchError } from '../fetch/safe-fetcher.js';
import { SourcingMetrics } from '../observability.js';
import {
  interventionFromBody,
  interventionFromError,
  type InterventionReason,
} from '../intervention.js';
import {
  fetchJobId,
  type CrawlTaskQueue,
  type DocumentFetchPayload,
  type SourceDiscoverPayload,
} from './task-queue.js';
import { CRAWL_TASK_QUEUE } from '../sourcing.tokens.js';

export interface DiscoverOutcome {
  status:
    | 'succeeded'
    | 'no_new'
    | 'zero_suspect'
    | 'structure_changed'
    | 'blocked'
    | 'failed';
  discoveredCount: number;
  downloadedCount: number;
  unchangedCount: number;
  /** 本轮失败计数（部分栏目失败时成功路径也可能 >0） */
  failedCount?: number;
  errorSummary?: string;
}

/** 本轮获取的观测信息（HTTP 状态与 304 命中，供结构化日志使用） */
interface FetchTelemetry {
  httpStatus?: number;
  notModified: boolean;
}

@Injectable()
export class SourceDiscoverService {
  constructor(
    private readonly runStore: CrawlRunStore,
    private readonly documentStore: SourceDocumentStore,
    private readonly fetcherFactory: SafeFetcherFactory,
    private readonly registry: AdapterRegistry,
    @Inject(CRAWL_TASK_QUEUE) private readonly queue: CrawlTaskQueue,
    // 可选指标出口：测试缺省不传则完全不产生日志
    @Optional() private readonly metrics?: SourcingMetrics,
  ) {}

  async handle(payload: SourceDiscoverPayload): Promise<DiscoverOutcome> {
    const startedAt = Date.now();
    const telemetry: FetchTelemetry = { notModified: false };
    const outcome = await this.execute(payload, telemetry);
    // 来源检查完成统一出口（成功 / 异常零结果 / 失败都记录）
    this.metrics?.sourceCheckCompleted({
      sourceId: payload.sourceId,
      runId: payload.runId,
      trigger: payload.trigger,
      durationMs: Date.now() - startedAt,
      ...(telemetry.httpStatus !== undefined
        ? { httpStatus: telemetry.httpStatus }
        : {}),
      notModified: telemetry.notModified,
      discovered: outcome.discoveredCount,
      downloaded: outcome.downloadedCount,
      unchanged: outcome.unchangedCount,
      failed: outcome.failedCount ?? 0,
    });
    return outcome;
  }

  private async execute(
    payload: SourceDiscoverPayload,
    telemetry: FetchTelemetry,
  ): Promise<DiscoverOutcome> {
    const now = new Date();
    const source = await this.runStore.getSource(payload.sourceId);
    if (!source) {
      await this.runStore.finishRun(payload.runId, {
        status: 'failed',
        errorSummary: 'source_not_found',
      });
      return this.failed(0, 'source_not_found');
    }

    const adapter = this.registry.get(source.adapterKey);
    if (!adapter) {
      await this.runStore.finishRun(payload.runId, {
        status: 'failed',
        errorSummary: `adapter_not_configured:${source.adapterKey ?? 'null'}`,
      });
      await this.runStore.setHealth(
        source.id,
        'degraded',
        `未配置适配器：${source.adapterKey ?? '(空)'}`,
      );
      return this.failed(0, 'adapter_not_configured');
    }

    const listUrls =
      source.listUrls && source.listUrls.length > 0
        ? source.listUrls
        : [source.officialUrl];
    const fetcher = this.fetcherFactory.create(source);
    const prevHint = `${source.etag ?? ''}|${source.lastModified ?? ''}`;

    const discovered = new Map<string, DiscoveredDocument>();
    const errors: string[] = [];
    let structureMismatch: string | null = null;
    let intervention: InterventionReason | null = null;
    let listVersionHint = prevHint;
    let newEtag = source.etag;
    let newLastModified = source.lastModified;
    // 实际拿回 200 并交给适配器解析的栏目页数（304 不算“抓取到内容”）
    let fetchedPages = 0;

    for (const listUrl of listUrls) {
      let result;
      try {
        result = await fetcher.fetch(listUrl, {
          ifNoneMatch: source.etag ?? undefined,
          ifModifiedSince: source.lastModified ?? undefined,
        });
        telemetry.httpStatus = result.status;
        if (result.status === 304) telemetry.notModified = true;
      } catch (error) {
        if (error instanceof SafeFetchError && typeof error.status === 'number') {
          telemetry.httpStatus = error.status;
        }
        // 验证码 / 登录 / 封禁：转人工，不计入普通失败
        const signal = interventionFromError(error);
        if (signal) {
          intervention = signal;
          continue;
        }
        errors.push(this.describeFetchError(listUrl, error));
        continue;
      }
      if (result.status === 304) continue; // 栏目未变化

      // 挑战页（成功返回但要求人机验证）：转人工，不解析
      const pageSignal = interventionFromBody(result.body, result.mimeType);
      if (pageSignal) {
        intervention = pageSignal;
        continue;
      }

      fetchedPages += 1;
      listVersionHint =
        result.headers.etag || result.headers.lastModified
          ? `${result.headers.etag ?? ''}|${result.headers.lastModified ?? ''}`
          : result.contentHash;
      newEtag = result.headers.etag ?? newEtag;
      newLastModified = result.headers.lastModified ?? newLastModified;
      try {
        const items = adapter.discover({
          url: result.finalUrl,
          mimeType: result.mimeType,
          content: result.body,
          fetchedAt: new Date().toISOString(),
        });
        for (const item of items) {
          discovered.set(item.url, item);
        }
      } catch (error) {
        if (error instanceof AdapterParseError) {
          structureMismatch = error.message;
        } else {
          errors.push(this.describeFetchError(listUrl, error));
        }
      }
    }

    // 栏目页条件请求缓存推进（即使本轮有错误仍推进已成功获取的部分）
    await this.runStore.updateConditionalHeaders(source.id, {
      etag: newEtag ?? null,
      lastModified: newLastModified ?? null,
    });

    // 人工介入优先：验证码/登录/封禁需要停止自动化，交由管理员处理
    if (intervention) {
      const reason = `人工介入（${intervention}）`;
      await this.runStore.setHealth(source.id, 'blocked', reason);
      await this.runStore.finishRun(payload.runId, {
        status: 'blocked',
        discoveredCount: discovered.size,
        errorSummary: reason,
      });
      return {
        status: 'blocked',
        discoveredCount: discovered.size,
        downloadedCount: 0,
        unchangedCount: 0,
        errorSummary: reason,
      };
    }

    // 结构失配优先于任何“无新公告”判断
    if (structureMismatch) {
      await this.runStore.setHealth(
        source.id,
        'structure_changed',
        structureMismatch,
      );
      await this.runStore.finishRun(payload.runId, {
        status: 'structure_changed',
        discoveredCount: discovered.size,
        errorSummary: structureMismatch,
      });
      return {
        status: 'structure_changed',
        discoveredCount: discovered.size,
        downloadedCount: 0,
        unchangedCount: 0,
        errorSummary: structureMismatch,
      };
    }

    if (discovered.size === 0 && errors.length > 0) {
      const summary = errors.join('; ').slice(0, 500);
      await this.runStore.recordFailure(source.id, {
        checkedAt: now,
        nextCheckAt: this.runStore.nextCheckAt(now, source.pollEveryMinutes),
        reason: summary,
        countTowardsSource: true,
      });
      await this.runStore.finishRun(payload.runId, {
        status: 'failed',
        errorSummary: summary,
        failedCount: errors.length,
      });
      return this.failed(errors.length, summary);
    }

    // 静默 0 条告警：成功抓取（确有 200 页面被解析，非纯 304）却 0 条发现时，
    // 若该来源曾有历史发现 → 异常零结果，必须告警（计入连续失败，不得记成功）；
    // 新来源冷启动 0 条属正常，走 no_new + recordSuccess。
    if (discovered.size === 0 && fetchedPages > 0) {
      const hasHistory = await this.runStore.hasHistoryDiscovery(source.id);
      if (shouldAlertZeroResults(hasHistory, discovered.size)) {
        await this.runStore.recordFailure(source.id, {
          checkedAt: now,
          nextCheckAt: this.runStore.nextCheckAt(now, source.pollEveryMinutes),
          reason: SUSPECTED_ZERO_RESULTS,
          countTowardsSource: true,
        });
        await this.runStore.finishRun(payload.runId, {
          status: 'zero_suspect',
          discoveredCount: 0,
          errorSummary: SUSPECTED_ZERO_RESULTS,
        });
        return {
          status: 'zero_suspect',
          discoveredCount: 0,
          downloadedCount: 0,
          unchangedCount: 0,
          failedCount: 0,
          errorSummary: SUSPECTED_ZERO_RESULTS,
        };
      }
    }

    // 栏目版本是否变化：决定是否需要重新检查已有文档
    const listChanged = listVersionHint !== prevHint;

    let enqueued = 0;
    let unchanged = 0;
    for (const item of discovered.values()) {
      const document = await this.documentStore.upsertDocument({
        sourceId: source.id,
        canonicalUrl: item.url,
        kind: item.kind,
      });
      const shouldFetch = document.latestSnapshotId === null || listChanged;
      if (!shouldFetch) {
        unchanged += 1;
        continue;
      }
      const fetchPayload: DocumentFetchPayload = {
        sourceId: source.id,
        runId: payload.runId,
        canonicalUrl: item.url,
        kind: item.kind,
      };
      const jobId = fetchJobId(source.id, item.url, listVersionHint);
      await this.queue.enqueue('document.fetch', fetchPayload, { jobId });
      enqueued += 1;
    }

    const status = discovered.size > 0 ? 'succeeded' : 'no_new';
    await this.runStore.recordSuccess(source.id, {
      checkedAt: now,
      nextCheckAt: this.runStore.nextCheckAt(now, source.pollEveryMinutes),
    });
    await this.runStore.finishRun(payload.runId, {
      status,
      discoveredCount: discovered.size,
      downloadedCount: enqueued,
      unchangedCount: unchanged,
      errorSummary: errors.length > 0 ? errors.join('; ').slice(0, 500) : null,
      failedCount: errors.length,
    });
    return {
      status,
      discoveredCount: discovered.size,
      downloadedCount: enqueued,
      unchangedCount: unchanged,
      failedCount: errors.length,
      errorSummary: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  private failed(failedCount: number, summary: string): DiscoverOutcome {
    return {
      status: 'failed',
      discoveredCount: 0,
      downloadedCount: 0,
      unchangedCount: 0,
      failedCount,
      errorSummary: summary,
    };
  }

  private describeFetchError(url: string, error: unknown): string {
    if (error instanceof SafeFetchError) {
      return `${error.code}@${url}:${error.status ?? ''}`;
    }
    return `${(error as Error).name}@${url}`;
  }
}
