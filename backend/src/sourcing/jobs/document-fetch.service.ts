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
  type ExtraRequestHeaders,
} from '../fetch/safe-fetcher.js';
import { detectFormat } from '../../document-processing/format-detector.js';
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
    'downloaded' | 'unchanged' | 'structure_changed' | 'blocked' | 'failed';
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
      for (const attachment of located.attachments) {
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

    // 投递解析任务（独立解析器版本，幂等键 snapshotId + version）
    await this.queue.enqueue(
      'document.parse',
      {
        snapshotId: snapshot.id,
        documentId: document.id,
        documentParserVersion: DOCUMENT_PARSER_VERSION,
      },
      { jobId: parseJobId(snapshot.id, DOCUMENT_PARSER_VERSION) },
    );

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
