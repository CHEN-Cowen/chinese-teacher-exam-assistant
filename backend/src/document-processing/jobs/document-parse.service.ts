/**
 * v7.2 附件解析：document.parse 处理器（在独立 Worker 内执行）。
 *
 * 流程：读快照字节（不可变原件）→ 格式解析 → DocumentParseRun 留痕 →
 * 投递 announcement.extract（业务抽取独立版本与幂等键）。
 *
 * 幂等：同 snapshotId + parserVersion 已 parsed 直接复用，不重复解析；
 * 失败/待人工只落自身记录，绝不覆盖已成功的旧标准文档，更不影响已发布版本。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { SourceDocumentStore } from '../../sourcing/source-document-store.js';
import type { ObjectStore } from '../../sourcing/storage/object-store.js';
import { OBJECT_STORE } from '../../sourcing/storage/storage.tokens.js';
import { CRAWL_TASK_QUEUE } from '../../sourcing/sourcing.tokens.js';
import { SourcingMetrics } from '../../sourcing/observability.js';
import {
  extractJobId,
  type CrawlTaskQueue,
  type DocumentParsePayload,
} from '../../sourcing/jobs/task-queue.js';
import { DocumentParserService, GuardError } from '../document-parser.service.js';
import { DocumentParseStore } from '../document-parse-store.js';
import type { DocumentParseStatus } from '../parsed-document.js';

/**
 * 业务抽取版本（与格式解析版本独立：解析器升级不重跑业务抽取，
 * 业务规则升级不重跑解析）。
 */
export const EXTRACTION_JOB_VERSION = 'rule-field-extractor@1.0.0';

export interface DocumentParseOutcome {
  status: 'parsed' | 'pending_manual' | 'unsupported_format' | 'failed' | 'already_parsed';
  parseRunId?: string;
  blockCount?: number;
  errorSummary?: string;
}

@Injectable()
export class DocumentParseService {
  constructor(
    private readonly parserService: DocumentParserService,
    private readonly parseStore: DocumentParseStore,
    private readonly documentStore: SourceDocumentStore,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    @Inject(CRAWL_TASK_QUEUE) private readonly queue: CrawlTaskQueue,
    // 可选指标出口（v7.2 抓取可观测性）：测试缺省不传则完全不产生日志
    @Optional() private readonly metrics?: SourcingMetrics,
  ) {}

  async handle(payload: DocumentParsePayload): Promise<DocumentParseOutcome> {
    const snapshot = await this.documentStore.getSnapshot(payload.snapshotId);
    if (!snapshot) {
      return { status: 'failed', errorSummary: 'snapshot_not_found' };
    }

    // 幂等：同快照同解析器版本已成功解析 → 复用，不重复解析
    const existing = await this.parseStore.findRun(snapshot.id, payload.documentParserVersion);
    if (existing?.status === 'parsed') {
      return { status: 'already_parsed', parseRunId: existing.id };
    }

    const { run } = await this.parseStore.ensureRun({
      snapshotId: snapshot.id,
      format: 'unknown',
      parserVersion: payload.documentParserVersion,
      contentHash: snapshot.contentHash,
      sourceUrl: snapshot.officialUrl,
    });
    if (run.status === 'parsed') {
      // 并发竞态：另一任务刚完成解析
      return { status: 'already_parsed', parseRunId: run.id };
    }

    // 读原始字节（层 2 不可变存储）
    let bytes: Buffer;
    try {
      bytes = await this.objectStore.getBinary(snapshot.storageKey);
    } catch (error) {
      const summary = `原始快照读取失败：${error instanceof Error ? error.message : String(error)}`;
      await this.parseStore.completeRun(run.id, { status: 'failed', errorSummary: summary });
      return { status: 'failed', parseRunId: run.id, errorSummary: summary };
    }

    // 层 3：格式解析（含安全防护）
    const parseStartedAt = Date.now();
    try {
      const parsed = await this.parserService.parse({
        snapshotId: snapshot.id,
        sourceUrl: snapshot.officialUrl,
        storageKey: snapshot.storageKey,
        contentHash: snapshot.contentHash,
        declaredMime: snapshot.mimeType,
        bytes,
      });
      const pendingManual =
        Boolean(parsed.pendingManualReason) || parsed.ocr?.status === 'pending_manual';
      const status: DocumentParseStatus = pendingManual ? 'pending_manual' : 'parsed';
      const completed = await this.parseStore.completeRun(run.id, {
        status,
        format: parsed.format,
        blocks: parsed.blocks,
        tableHeaders: parsed.tableHeaders ?? null,
        blockCount: parsed.blocks.length,
        warnings: parsed.warnings,
        scanned: parsed.scanned,
        ocrRequired: parsed.ocr?.required ?? false,
        ocrStatus: parsed.ocr?.status ?? null,
      });
      this.metrics?.parseCompleted({
        snapshotId: snapshot.id,
        format: parsed.format,
        parserVersion: payload.documentParserVersion,
        status,
        warningCount: parsed.warnings.length,
        durationMs: Date.now() - parseStartedAt,
      });

      // 成功与待人工都投递业务抽取：pending_manual 会生成诚实的"待人工"提取记录
      if (parsed.blocks.length > 0 || pendingManual) {
        await this.queue.enqueue(
          'announcement.extract',
          { snapshotId: snapshot.id, parserVersion: EXTRACTION_JOB_VERSION },
          { jobId: extractJobId(snapshot.id, EXTRACTION_JOB_VERSION) },
        );
      }
      return {
        status,
        parseRunId: completed.id,
        blockCount: parsed.blocks.length,
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      const code = error instanceof GuardError ? error.code : 'PARSE_ERROR';
      const status: DocumentParseStatus =
        code === 'ENCRYPTED_PDF'
          ? 'pending_manual'
          : code === 'UNKNOWN_FORMAT'
            ? 'unsupported_format'
            : 'failed';
      await this.parseStore.completeRun(run.id, {
        status,
        format: 'unknown',
        errorSummary: `${code}:${summary}`,
        ...(status === 'pending_manual' ? { warnings: [summary] } : {}),
      });
      this.metrics?.parseCompleted({
        snapshotId: snapshot.id,
        format: 'unknown',
        parserVersion: payload.documentParserVersion,
        status,
        warningCount: status === 'pending_manual' ? 1 : 0,
        durationMs: Date.now() - parseStartedAt,
      });
      // 待人工（如加密 PDF）也投递业务抽取：生成诚实的"待人工"提取记录，供人工跟进
      if (status === 'pending_manual') {
        await this.queue.enqueue(
          'announcement.extract',
          { snapshotId: snapshot.id, parserVersion: EXTRACTION_JOB_VERSION },
          { jobId: extractJobId(snapshot.id, EXTRACTION_JOB_VERSION) },
        );
      }
      return { status, parseRunId: run.id, errorSummary: summary };
    }
  }
}
