/**
 * v7.2 工作包 4：下载处理器（document.fetch）。
 *
 * 职责（在独立 Worker 内执行）：
 * 1. 安全下载公告正文/附件页；
 * 2. 304 不创建快照；
 * 3. 相同内容哈希不重复创建快照、不重复解析；
 * 4. 新内容写入对象存储并绑定到逻辑文档，投递解析任务；
 * 5. 公告页调用 Adapter.locateArticle 校验结构并发现附件，附件再进入下载；
 * 6. 失败只累加计数，绝不覆盖已存在的旧数据。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
} from '../official-site-adapter.js';
import { AdapterRegistry } from '../adapter-registry.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import type { ObjectStore } from '../storage/object-store.js';
import { OBJECT_STORE } from '../storage/storage.tokens.js';
import { SafeFetcherFactory } from '../fetch/safe-fetcher-factory.js';
import { SafeFetchError } from '../fetch/safe-fetcher.js';
import { detectFormat } from '../../document-processing/format-detector.js';
import {
  interventionFromBody,
  interventionFromError,
} from '../intervention.js';
import {
  fetchJobId,
  parseJobId,
  type CrawlTaskQueue,
  type DocumentFetchPayload,
} from './task-queue.js';
import { CRAWL_TASK_QUEUE } from '../sourcing.tokens.js';

/** 文档格式解析器版本（独立于业务抽取器版本） */
export const DOCUMENT_PARSER_VERSION = 'wp4-v1';

export interface FetchOutcome {
  status: 'downloaded' | 'unchanged' | 'structure_changed' | 'blocked' | 'failed';
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
  ) {}

  async handle(payload: DocumentFetchPayload): Promise<FetchOutcome> {
    const source = await this.runStore.getSource(payload.sourceId);
    if (!source) {
      await this.markFailed(payload.runId, 'source_not_found');
      return { status: 'failed', errorSummary: 'source_not_found' };
    }
    const adapter = this.registry.get(source.adapterKey);
    if (!adapter) {
      await this.markFailed(payload.runId, 'adapter_not_configured');
      return { status: 'failed', errorSummary: 'adapter_not_configured' };
    }

    const fetcher =
      payload.kind === 'attachment'
        ? this.fetcherFactory.createForAttachment(source)
        : this.fetcherFactory.create(source);
    let result;
    try {
      result = await fetcher.fetch(payload.canonicalUrl);
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
      await this.markFailed(payload.runId, summary);
      return { status: 'failed', errorSummary: summary };
    }

    if (result.status === 304) {
      await this.runStore.incrementRunCounters(payload.runId, { unchanged: 1 });
      return { status: 'unchanged' };
    }

    // 挑战页（成功返回但要求人机验证）：转人工，不建快照、不解析
    const pageSignal = interventionFromBody(result.body, result.mimeType);
    if (pageSignal) {
      await this.runStore.setHealth(source.id, 'blocked', `人工介入（${pageSignal}）`);
      return { status: 'blocked', errorSummary: pageSignal };
    }

    const document = await this.documentStore.upsertDocument({
      sourceId: source.id,
      canonicalUrl: payload.canonicalUrl,
      kind: payload.kind,
      parentDocumentId: payload.parentDocumentId ?? null,
    });

    // 相同内容哈希：复用已有快照，不新建、不重复解析
    const existing = await this.documentStore.findSnapshotByHash(
      source.id,
      result.contentHash,
    );
    if (existing) {
      await this.documentStore.attachSnapshot(document.id, {
        snapshotId: existing.id,
        contentHash: result.contentHash,
      });
      await this.runStore.incrementRunCounters(payload.runId, { unchanged: 1 });
      return {
        status: 'unchanged',
        snapshotId: existing.id,
        contentHash: result.contentHash,
      };
    }

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
    const storageKey = isAttachment
      ? await this.objectStore.putBinary({
          content: result.bodyBytes,
          mimeType,
          contentHash: result.contentHash,
        })
      : await this.objectStore.put({
          content: result.body,
          mimeType,
          contentHash: result.contentHash,
        });
    const { snapshot, created } = await this.documentStore.upsertSnapshot({
      sourceId: source.id,
      officialUrl: result.finalUrl,
      storageKey,
      mimeType,
      contentHash: result.contentHash,
      fetchedAt: new Date(),
      httpStatus: result.status,
    });
    if (!created) {
      // 并发竞态：其他任务已写入同哈希快照，视为未变化
      await this.documentStore.attachSnapshot(document.id, {
        snapshotId: snapshot.id,
        contentHash: result.contentHash,
      });
      await this.runStore.incrementRunCounters(payload.runId, { unchanged: 1 });
      return { status: 'unchanged', snapshotId: snapshot.id };
    }
    await this.documentStore.attachSnapshot(document.id, {
      snapshotId: snapshot.id,
      contentHash: result.contentHash,
    });
    await this.runStore.incrementRunCounters(payload.runId, { downloaded: 1 });

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
        await this.queue.enqueue(
          'document.fetch',
          {
            sourceId: source.id,
            runId: payload.runId,
            canonicalUrl: attachment.url,
            kind: 'attachment',
            parentDocumentId: document.id,
          },
          { jobId: fetchJobId(source.id, attachment.url, result.contentHash) },
        );
      }
    }

    // 投递解析任务（独立解析器版本，幂等键 snapshotId + version）
    await this.queue.enqueue(
      'document.parse',
      { snapshotId: snapshot.id, documentParserVersion: DOCUMENT_PARSER_VERSION },
      { jobId: parseJobId(snapshot.id, DOCUMENT_PARSER_VERSION) },
    );

    return {
      status: 'downloaded',
      snapshotId: snapshot.id,
      contentHash: result.contentHash,
    };
  }

  private async markFailed(runId: string, summary: string): Promise<void> {
    await this.runStore.incrementRunCounters(runId, { failed: 1 });
    void summary;
  }
}
