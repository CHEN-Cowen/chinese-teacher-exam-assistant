/**
 * v7.2 证据链：announcement.extract 处理器（层 4：业务字段抽取，Worker 内执行）。
 *
 * 流程：读取最近一次 DocumentParseRun（层 3 产物）→ 确定性字段抽取 →
 * ExtractionRun（候选，pending_review）+ EvidenceAnchor 留痕。
 *
 * 红线：
 * - 无证据的高影响字段不能进入候选（抽取器已保证，此处二次校验）；
 * - 解析为"待人工处理"（扫描件 OCR/DOCX 未启用）时生成诚实的 failed
 *   提取记录（errorCode=PENDING_MANUAL_PARSE），不伪装成功；
 * - 幂等键 = snapshotId + 抽取版本；重跑只更新 failed 记录，
 *   已进入 pending_review 的候选不被自动覆盖。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import {
  findHighImpactFieldsWithoutAnchor,
  type CandidateField,
  type ExtractionCandidate,
} from '../domain.js';
import {
  FIELD_EXTRACTOR_VERSION,
  extractFields,
  prepareAutoCandidateFields,
} from '../extraction/field-extractor.js';
import type { DocumentParseStore } from '../../document-processing/document-parse-store.js';
import type { DocumentParseRunRecord } from '../../document-processing/document-parse-store.js';
import type { ParsedDocument } from '../../document-processing/parsed-document.js';

export interface AnnouncementExtractOutcome {
  status: 'pending_review' | 'failed' | 'skipped_already_done';
  runId?: string;
  fieldCount?: number;
  errorSummary?: string;
}

@Injectable()
export class AnnouncementExtractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parseStore: DocumentParseStore,
  ) {}

  async handle(payload: { snapshotId: string; parserVersion: string }): Promise<AnnouncementExtractOutcome> {
    const version = payload.parserVersion || FIELD_EXTRACTOR_VERSION;
    const idempotencyKey = `${payload.snapshotId}:${version}`;

    // 幂等：同快照同抽取版本已有非失败任务 → 跳过
    const existing = await this.prisma.extractionRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing && existing.status !== 'failed') {
      return { status: 'skipped_already_done', runId: existing.id };
    }

    // 最近一次解析产物（parsed 或 pending_manual）
    const parseRun =
      (await this.parseStore.findLatestParsedRun(payload.snapshotId)) ??
      (await this.parseStore.findLatestRun(payload.snapshotId));
    if (!parseRun) {
      return this.failRun(idempotencyKey, payload.snapshotId, version, 'NO_PARSE_RUN', '尚未解析的快照，无法抽取');
    }

    if (parseRun.status === 'pending_manual') {
      const reason =
        (parseRun.warnings as string[] | null)?.[0] ??
        parseRun.errorSummary ??
        '解析结果待人工处理';
      return this.failRun(
        idempotencyKey,
        payload.snapshotId,
        version,
        'PENDING_MANUAL_PARSE',
        `待人工处理：${reason}`,
      );
    }
    if (parseRun.status !== 'parsed') {
      return this.failRun(
        idempotencyKey,
        payload.snapshotId,
        version,
        'PARSE_NOT_SUCCESSFUL',
        `最近一次解析状态为 ${parseRun.status}，不进入抽取`,
      );
    }

    // 重建标准文档（blocks 与快照元数据在解析阶段已留痕）
    const parsed = reconstructParsedDocument(parseRun);
    const extracted = extractFields(parsed);
    const candidate: ExtractionCandidate = {
      fields: extracted.fields,
      parserVersion: version,
      rawJson: {
        documentParseRunId: parseRun.id,
        snapshotId: parseRun.snapshotId,
        contentHash: parseRun.contentHash,
        sourceUrl: parseRun.sourceUrl,
        dropped: extracted.dropped,
        warnings: extracted.warnings,
      },
    };

    if (candidate.fields.length === 0) {
      return this.failRun(
        idempotencyKey,
        payload.snapshotId,
        version,
        'NO_CANDIDATE_FIELDS',
        '未抽到任何候选字段（高影响字段无证据不产出，绝不编造）',
      );
    }

    // 二次校验：高影响字段必须全部带锚点（无证据不能进入审核）
    const missing = findHighImpactFieldsWithoutAnchor(candidate);
    if (missing.length > 0) {
      return this.failRun(
        idempotencyKey,
        payload.snapshotId,
        version,
        'HIGH_IMPACT_MISSING_ANCHOR',
        `高影响字段缺少证据锚点：${missing.join('、')}`,
      );
    }

    const anchorRows = candidate.fields
      .filter((f) => f.anchor)
      .map((f) => ({
        field: f.field,
        locatorKind: f.anchor!.locator.kind,
        locatorData: (f.anchor!.locatorData ?? f.anchor!.locator) as object,
        excerpt: f.anchor!.excerpt ?? null,
      }));

    const data = {
      snapshotId: payload.snapshotId,
      parserVersion: version,
      idempotencyKey,
      status: 'pending_review',
      progress: 100,
      candidate: candidate as unknown as object,
      finishedAt: new Date(),
    };

    const run = existing
      ? await this.prisma.extractionRun.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.extractionRun.create({ data: { ...data, submittedBy: null } });

    // 重跑时替换锚点（幂等），成功记录不被降级
    await this.prisma.evidenceAnchor.deleteMany({ where: { runId: run.id } });
    if (anchorRows.length > 0) {
      await this.prisma.evidenceAnchor.createMany({
        data: anchorRows.map((a) => ({ ...a, runId: run.id })),
      });
    }

    return { status: 'pending_review', runId: run.id, fieldCount: candidate.fields.length };
  }

  /** 诚实的失败记录：failed 可重试（人工处理后重跑） */
  private async failRun(
    idempotencyKey: string,
    snapshotId: string,
    version: string,
    errorCode: string,
    message: string,
  ): Promise<AnnouncementExtractOutcome> {
    const existing = await this.prisma.extractionRun.findUnique({
      where: { idempotencyKey },
    });
    const data = {
      status: 'failed',
      errorCode,
      errorMessage: message,
      finishedAt: new Date(),
    };
    const run = existing
      ? await this.prisma.extractionRun.update({ where: { id: existing.id }, data })
      : await this.prisma.extractionRun.create({
          data: {
            snapshotId,
            parserVersion: version,
            idempotencyKey,
            status: 'failed',
            errorCode,
            errorMessage: message,
            finishedAt: new Date(),
          },
        });
    return { status: 'failed', runId: run.id, errorSummary: `${errorCode}:${message}` };
  }
}

/** 从 DocumentParseRun + 快照元数据重建 ParsedDocument（供纯函数抽取器） */
export function reconstructParsedDocument(run: DocumentParseRunRecord): ParsedDocument {
  const blocks = (run.blocks as ParsedDocument['blocks'] | null) ?? [];
  return {
    snapshotId: run.snapshotId,
    sourceUrl: run.sourceUrl,
    contentHash: run.contentHash,
    storageKey: `snapshots/${run.contentHash.slice(0, 2)}/${run.contentHash}`,
    format: run.format as ParsedDocument['format'],
    formatDetails: {
      detectedBy: 'magic-bytes',
      declaredMime: '',
      declaredExtension: '',
      detectedMime: '',
    },
    parserVersion: run.parserVersion,
    blocks,
    tableHeaders: (run.tableHeaders as ParsedDocument['tableHeaders']) ?? undefined,
    scanned: run.scanned,
    warnings: (run.warnings as string[] | null) ?? [],
  };
}

/** 兼容未来 AI 候选：整备 origin=ai/ocr 字段（当前只有规则抽取使用） */
export function integrateAutoFields(fields: CandidateField[]): CandidateField[] {
  return prepareAutoCandidateFields(fields);
}
