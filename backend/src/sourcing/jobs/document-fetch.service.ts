/**
 * v7.2 工作包 4：下载处理器（document.fetch）。
 *
 * 职责（在独立 Worker 内执行）：
 * 1. 安全下载公告正文/附件页；
 * 2. 304 不创建快照；
 * 3. 相同内容哈希复用快照，幂等补投解析与附件检查；
 * 4. 新内容写入对象存储并绑定到逻辑文档，投递解析任务；
 * 5. 公告页调用 Adapter.locateArticle 校验结构并发现附件，附件再进入下载；
 * 6. 失败只累加计数，绝不覆盖已存在的旧数据。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
} from '../official-site-adapter.js';
import { AdapterRegistry } from '../adapter-registry.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import { SourcingMetrics } from '../observability.js';
import type { ObjectStore } from '../storage/object-store.js';
import { OBJECT_STORE } from '../storage/storage.tokens.js';
import { SafeFetcherFactory } from '../fetch/safe-fetcher-factory.js';
import {
  SafeFetchError,
  RequestBlockedError,
  type ExtraRequestHeaders,
} from '../fetch/safe-fetcher.js';
import type { TrialBudgetSnapshot } from '../crawl-budget.js';
import { PrismaCrawlBudgetStore } from '../crawl-budget.store.js';
import { detectFormat, extensionOf } from '../../document-processing/format-detector.js';
import {
  interventionFromBody,
  interventionFromError,
} from '../intervention.js';
import {
  fetchJobId,
  isTransientFetchFailure,
  parseJobId,
  type CrawlTaskQueue,
  type DocumentFetchPayload,
} from './task-queue.js';
import { CRAWL_TASK_QUEUE } from '../sourcing.tokens.js';

/** 文档格式解析器版本（独立于业务抽取器版本） */
export const DOCUMENT_PARSER_VERSION = 'wp4-v1';

export interface FetchOutcome {
  status:
    | 'downloaded'
    | 'unchanged'
    | 'structure_changed'
    | 'blocked'
    | 'failed'
    | 'skipped';
  snapshotId?: string;
  contentHash?: string;
  errorSummary?: string;
}

const ARTICLE_KINDS = new Set([
  'announcement',
  'supplement',
  'delay',
  'cancel',
]);

/** 应返回二进制原件的附件扩展名（用于识别“200 但实际是限流/验证 HTML”）。 */
const BINARY_ATTACHMENT_EXTENSIONS = new Set([
  'pdf',
  'xls',
  'xlsx',
  'xlsb',
  'et',
  'doc',
  'docx',
  'wps',
  'zip',
  'rar',
  '7z',
]);

@Injectable()
export class DocumentFetchService {
  constructor(
    private readonly runStore: CrawlRunStore,
    private readonly documentStore: SourceDocumentStore,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    private readonly fetcherFactory: SafeFetcherFactory,
    private readonly registry: AdapterRegistry,
    @Inject(CRAWL_TASK_QUEUE) private readonly queue: CrawlTaskQueue,
    // 可选指标出口：测试缺省不传则完全不产生日志
    @Optional() private readonly metrics?: SourcingMetrics,
    // 可选试跑预算：常规运行不注入预算行，行为与之前一致
    @Optional() private readonly budget?: PrismaCrawlBudgetStore,
  ) {}

  async handle(
    payload: DocumentFetchPayload,
    attemptsRemaining = 0,
  ): Promise<FetchOutcome> {
    await this.runStore.recordFetchOutcome(
      payload.runId,
      payload.canonicalUrl,
      'queued',
    );
    try {
      const outcome = await this.execute(payload);
      await this.runStore.recordFetchOutcome(
        payload.runId,
        payload.canonicalUrl,
        attemptsRemaining > 0 &&
          outcome.status === 'failed' &&
          isTransientFetchFailure(outcome.errorSummary)
          ? 'retrying'
          : outcome.status,
        outcome.errorSummary,
      );
      return outcome;
    } catch (error) {
      await this.runStore.recordFetchOutcome(
        payload.runId,
        payload.canonicalUrl,
        attemptsRemaining > 0 ? 'retrying' : 'failed',
        'downstream_delivery_failed',
      );
      throw error;
    }
  }

  private async execute(payload: DocumentFetchPayload): Promise<FetchOutcome> {
    const source = await this.runStore.getSource(payload.sourceId);
    if (!source) {
      return { status: 'failed', errorSummary: 'source_not_found' };
    }
    const adapter = this.registry.get(source.adapterKey);
    if (!adapter) {
      return { status: 'failed', errorSummary: 'adapter_not_configured' };
    }

    // 试跑预算：先看运行是否已停止/额度是否用尽，再复核准入，
    // 防止直接投递、旧任务重放或重试绕过入队时的预算校验。
    let trial: TrialBudgetSnapshot | null = null;
    if (this.budget) {
      trial = await this.budget.get(payload.runId);
      if (trial) {
        if (trial.status === 'stopped') {
          return { status: 'skipped', errorSummary: 'run_stopped' };
        }
        if (trial.status === 'exhausted') {
          return { status: 'skipped', errorSummary: 'budget_exhausted' };
        }
        const kind = payload.kind === 'attachment' ? 'attachment' : 'document';
        let admitted = await this.budget.isAdmitted(
          payload.runId,
          kind,
          payload.canonicalUrl,
        );
        if (admitted === false && payload.kind === 'attachment') {
          // 列表级附件链接在发现阶段可能按详情准入；两种准入都算数
          admitted = await this.budget.isAdmitted(
            payload.runId,
            'document',
            payload.canonicalUrl,
          );
        }
        if (admitted === false) {
          return { status: 'skipped', errorSummary: 'budget_not_admitted' };
        }
      }
    }
    const requestGuard =
      trial && this.budget
        ? {
            beforeRequest: async () => {
              const gate = await this.budget!.consumeHttpAttempt(payload.runId);
              if (gate === 'ok' || gate === 'unbudgeted') return;
              throw new RequestBlockedError(gate);
            },
          }
        : undefined;

    const fetcher =
      payload.kind === 'attachment'
        ? this.fetcherFactory.createForAttachment(source)
        : this.fetcherFactory.create(source);
    const document = await this.documentStore.upsertDocument({
      sourceId: source.id,
      canonicalUrl: payload.canonicalUrl,
      kind: payload.kind,
      parentDocumentId: payload.parentDocumentId ?? null,
    });
    const cache = await this.documentStore.getUrlCache(
      source.id,
      payload.canonicalUrl,
    );
    // 部分官网（如常州市教育局）对附件做 Referer 防盗链校验：缺失时 302 跳回首页，
    // 返回 HTML 而非真实二进制。这里用父公告页 URL 作为同源 Referer。
    const extraHeaders = await this.attachmentHeaders(payload);
    let result;
    try {
      result = await fetcher.fetch(
        payload.canonicalUrl,
        {
          ifNoneMatch: cache?.etag ?? undefined,
          ifModifiedSince: cache?.lastModified ?? undefined,
        },
        extraHeaders,
        {},
        requestGuard,
      );
      if (result.status === 304) {
        if (!cache) throw new Error('not_modified_without_snapshot');
        const bodyBytes =
          payload.kind === 'attachment'
            ? await this.objectStore.getBinary(cache.snapshot.storageKey)
            : Buffer.from(
                await this.objectStore.get(cache.snapshot.storageKey),
                'utf8',
              );
        result = {
          ...result,
          bodyBytes,
          body: bodyBytes.toString('utf8'),
          mimeType: cache.snapshot.mimeType,
          contentHash: cache.snapshot.contentHash,
        };
      }
    } catch (error) {
      // 预算闸门在发请求前拦截：不发 HTTP；预算耗尽记 skipped 且不再重试
      if (error instanceof RequestBlockedError) {
        return {
          status: 'skipped',
          errorSummary:
            error.reason === 'stopped'
              ? 'run_stopped'
              : 'budget_http_exhausted',
        };
      }
      // 验证码 / 登录 / 封禁：转人工并暂停自动化，不计入普通失败
      const signal = interventionFromError(error);
      if (signal) {
        await this.runStore.setHealth(
          source.id,
          'blocked',
          `人工介入（${signal}）`,
        );
        return { status: 'blocked', errorSummary: signal };
      }
      // 已知官方反爬端点（如宁波 jpaas document/download）：允许 host 但路径命中 denylist，
      // 非基础设施故障，也不是解析结构问题；跳过，不计入失败、不触发重试、不降级来源健康。
      if (
        error instanceof SafeFetchError &&
        error.code === 'BLOCKED_ENDPOINT'
      ) {
        return {
          status: 'skipped',
          errorSummary: `blocked_endpoint:${error.message.slice(0, 200)}`,
        };
      }
      const summary =
        error instanceof SafeFetchError
          ? `${error.code}:${error.status ?? ''}`
          : (error as Error).message;
      return { status: 'failed', errorSummary: summary };
    }

    // 挑战页（成功返回但要求人机验证）：转人工，不建快照、不解析
    const pageSignal = interventionFromBody(result.body, result.mimeType);
    if (pageSignal) {
      await this.runStore.setHealth(
        source.id,
        'blocked',
        `人工介入（${pageSignal}）`,
      );
      return { status: 'blocked', errorSummary: pageSignal };
    }

    // 已有快照只复用存储对象；仍执行下方结构校验及幂等下游补投，恢复中断任务。
    const existing = await this.documentStore.findSnapshotByHash(
      source.id,
      result.contentHash,
    );

    // 新内容：写对象存储 + 建快照 + 绑定文档
    // 附件走二进制通道并用 magic bytes 判定真实格式（不信任声明 Content-Type）；
    // 页面（HTML）沿用文本通道。
    const isAttachment = payload.kind === 'attachment';
    let mimeType = result.mimeType;
    if (isAttachment) {
      const detected = detectFormat(result.bodyBytes);
      // 部分官网在限流/人机校验时仍返回 HTTP 200 + HTML（如“访问过于频繁，请稍后再试”）。
      // 若附件 URL 本应是二进制原件却拿到 HTML，绝不能当作成功快照入库，否则岗位表会被静默替换为错误页。
      if (
        detected.format === 'html' &&
        BINARY_ATTACHMENT_EXTENSIONS.has(extensionOf(payload.canonicalUrl))
      ) {
        return {
          status: 'failed',
          errorSummary: 'ATTACHMENT_HTML:rate_limited_or_antibot',
        };
      }
      mimeType =
        detected.detectedBy === 'magic-bytes'
          ? detected.mime
          : result.mimeType || 'application/octet-stream';
    }
    const storageKey =
      existing?.storageKey ??
      (isAttachment
        ? await this.objectStore.putBinary({
            content: result.bodyBytes,
            mimeType,
            contentHash: result.contentHash,
          })
        : await this.objectStore.put({
            content: result.body,
            mimeType,
            contentHash: result.contentHash,
          }));
    const { snapshot, created } = existing
      ? { snapshot: existing, created: false }
      : await this.documentStore.upsertSnapshot({
          sourceId: source.id,
          officialUrl: result.finalUrl,
          storageKey,
          mimeType,
          contentHash: result.contentHash,
          fetchedAt: new Date(),
          httpStatus: result.status,
        });
    await this.documentStore.attachSnapshot(document.id, {
      snapshotId: snapshot.id,
      contentHash: result.contentHash,
    });
    await this.documentStore.updateUrlCache(
      source.id,
      payload.canonicalUrl,
      snapshot.id,
      {
        etag:
          result.headers.etag ?? (result.status === 304 ? cache?.etag : null),
        lastModified:
          result.headers.lastModified ??
          (result.status === 304 ? cache?.lastModified : null),
      },
    );
    // 新快照创建：contentHash 只记前 12 字符前缀（脱敏边界）
    if (created)
      this.metrics?.snapshotCreated({
        sourceId: source.id,
        documentId: document.id,
        contentHashPrefix: result.contentHash.slice(0, 12),
      });

    // 公告类页面：校验结构并发现附件
    if (ARTICLE_KINDS.has(payload.kind)) {
      let located;
      try {
        located = adapter.locateArticle({
          url: result.finalUrl,
          mimeType: result.mimeType,
          content: result.body,
          fetchedAt: new Date().toISOString(),
        } satisfies ArticlePageSnapshot);
      } catch (error) {
        if (error instanceof AdapterParseError) {
          await this.runStore.setHealth(
            source.id,
            'structure_changed',
            error.message,
          );
          return { status: 'structure_changed', errorSummary: error.message };
        }
        throw error;
      }
      const attachments = located.attachments;
      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index];
        if (trial && this.budget) {
          // 附件同时受“每篇上限”和“整轮上限”约束；重复派生按 URL 幂等
          const admission = await this.budget.admitAttachment(
            payload.runId,
            document.id,
            attachment.url,
          );
          if (admission === 'stopped') {
            for (const pending of attachments.slice(index)) {
              await this.runStore.recordFetchOutcome(
                payload.runId,
                pending.url,
                'skipped',
                'run_stopped',
              );
            }
            break;
          }
          if (admission === 'exhausted') {
            await this.runStore.recordFetchOutcome(
              payload.runId,
              attachment.url,
              'skipped',
              'budget_deferred',
            );
            continue;
          }
        }
        await this.documentStore.upsertDocument({
          sourceId: source.id,
          canonicalUrl: attachment.url,
          kind: 'attachment',
          parentDocumentId: document.id,
        });
        await this.runStore.recordFetchOutcome(
          payload.runId,
          attachment.url,
          'queued',
        );
        try {
          await this.queue.enqueue(
            'document.fetch',
            {
              sourceId: source.id,
              runId: payload.runId,
              canonicalUrl: attachment.url,
              kind: 'attachment',
              parentDocumentId: document.id,
            },
            { jobId: fetchJobId(source.id, attachment.url, payload.runId) },
          );
        } catch (error) {
          await this.runStore.recordFetchOutcome(
            payload.runId,
            attachment.url,
            'failed',
            'queue_enqueue_failed',
          );
          throw error;
        }
      }
    }

    // 已停止的运行不再派生解析任务；已入队任务由解析器入口的停止检查兜底
    const stoppedNow =
      trial && this.budget ? await this.budget.isStopped(payload.runId) : false;

    // 投递解析任务（独立解析器版本，幂等键 snapshotId + version）
    if (!stoppedNow) {
      await this.queue.enqueue(
        'document.parse',
        {
          snapshotId: snapshot.id,
          documentId: document.id,
          documentParserVersion: DOCUMENT_PARSER_VERSION,
          runId: payload.runId,
        },
        { jobId: parseJobId(snapshot.id, DOCUMENT_PARSER_VERSION) },
      );
    }

    return {
      status: result.status === 304 || !created ? 'unchanged' : 'downloaded',
      snapshotId: snapshot.id,
      contentHash: result.contentHash,
    };
  }

  /**
   * 附件请求头：Referer 指向父公告页。
   * 只有父文档存在且 URL 合法时才带；缺父文档不影响其余流程。
   */
  private async attachmentHeaders(
    payload: DocumentFetchPayload,
  ): Promise<ExtraRequestHeaders> {
    if (payload.kind !== 'attachment') return {};
    if (!payload.parentDocumentId) return {};
    const parent = await this.documentStore.getDocument(
      payload.parentDocumentId,
    );
    if (!parent) return {};
    return { referer: parent.canonicalUrl };
  }
}
