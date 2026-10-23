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
  extractionIdempotencyKey,
  findHighImpactFieldsWithoutAnchor,
  materialPackKey,
  type CandidateField,
  type ExtractionCandidate,
} from '../domain.js';
import {
  FIELD_EXTRACTOR_VERSION,
  extractFields,
  prepareAutoCandidateFields,
} from '../extraction/field-extractor.js';
import { reconcileFields, type ReconcileSource } from '../field-reconciler.js';
import type { MaterialFileStatus } from '../manual-extraction.service.js';
// 必须是值导入而非 import type：DocumentParseStore 由构造函数注入，
// import type 会让运行时元数据退化为 Function，Worker 启动时抛
// UnknownDependenciesException（index [1] 不可用）。
import { DocumentParseStore } from '../../document-processing/document-parse-store.js';
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

  async handle(payload: {
    snapshotId: string;
    parserVersion: string;
    documentId?: string;
  }): Promise<AnnouncementExtractOutcome> {
    const version = FIELD_EXTRACTOR_VERSION;
    const material = await this.loadMaterialPack(payload);
    const idempotencyKey = extractionIdempotencyKey(
      material.body.snapshotId,
      version,
      material.fingerprint,
    );

    const existing = await this.prisma.extractionRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing && existing.status !== 'failed') {
      return { status: 'skipped_already_done', runId: existing.id };
    }
    if (material.error) {
      return this.failRun(
        idempotencyKey,
        material.body.snapshotId,
        version,
        material.error.code,
        material.error.message,
      );
    }

    const sources: ReconcileSource[] = [];
    const files: MaterialFileStatus[] = [];
    const allDropped: unknown[] = [];
    const allWarnings: string[] = [];
    for (const item of material.files) {
      const parsedRun = item.parseRun;
      if (!parsedRun || parsedRun.status !== 'parsed') {
        return this.failRun(
          idempotencyKey,
          material.body.snapshotId,
          version,
          parsedRun?.status === 'pending_manual' ? 'PENDING_MANUAL_PARSE' : 'MATERIAL_PACK_INCOMPLETE',
          parsedRun?.status === 'pending_manual'
            ? `待人工处理：${parsedRun.errorSummary ?? item.name}`
            : parsedRun?.errorSummary ?? `材料文件尚未完成解析：${item.name}`,
        );
      }
      const parsed = reconstructParsedDocument(parsedRun);
      const extracted = extractFields(parsed);
      sources.push({
        file: {
          documentId: item.documentId,
          snapshotId: item.snapshotId,
          name: item.name,
          kind: item.kind,
          relationType: item.relationType,
        },
        fields: extracted.fields,
      });
      files.push({
        documentId: item.documentId,
        snapshotId: item.snapshotId,
        name: item.name,
        kind: item.kind,
        readStatus: 'ok',
        format: parsed.format,
      });
      allDropped.push(...extracted.dropped);
      allWarnings.push(...extracted.warnings);
    }

    const reconciled = reconcileFields(sources);
    allWarnings.push(...reconciled.report.warnings);
    const candidate: ExtractionCandidate = {
      fields: reconciled.fields,
      parserVersion: version,
      rawJson: {
        documentParseRunId: material.body.parseRun.id,
        snapshotId: material.body.snapshotId,
        contentHash: material.body.contentHash,
        sourceUrl: material.body.parseRun.sourceUrl,
        dropped: allDropped,
        warnings: allWarnings,
        files,
        reconciliation: reconciled.report,
      },
    };

    if (candidate.fields.length === 0) {
      return this.failRun(
        idempotencyKey,
        material.body.snapshotId,
        version,
        'NO_CANDIDATE_FIELDS',
        '未抽到任何候选字段（高影响字段无证据不产出，绝不编造）',
      );
    }
    const missing = findHighImpactFieldsWithoutAnchor(candidate);
    if (missing.length > 0) {
      return this.failRun(
        idempotencyKey,
        material.body.snapshotId,
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
      snapshotId: material.body.snapshotId,
      announcementId: material.body.documentId || undefined,
      parserVersion: version,
      idempotencyKey,
      materialFingerprint: material.fingerprint,
      status: 'pending_review',
      progress: 100,
      candidate: candidate as unknown as object,
      finishedAt: new Date(),
    };
    const run = existing
      ? await this.prisma.extractionRun.update({ where: { id: existing.id }, data })
      : await this.prisma.extractionRun.create({ data: { ...data, submittedBy: null } });
    await this.prisma.evidenceAnchor.deleteMany({ where: { runId: run.id } });
    if (anchorRows.length > 0) {
      await this.prisma.evidenceAnchor.createMany({
        data: anchorRows.map((a) => ({ ...a, runId: run.id })),
      });
    }
    return { status: 'pending_review', runId: run.id, fieldCount: candidate.fields.length };
  }

  private async loadMaterialPack(payload: {
    snapshotId: string;
    documentId?: string;
  }): Promise<{
    body: { documentId: string; snapshotId: string; contentHash: string; parseRun: DocumentParseRunRecord };
    files: Array<{
      documentId: string;
      snapshotId: string;
      contentHash: string;
      name: string;
      kind: 'body' | 'attachment';
      relationType: string | null;
      parseRun: DocumentParseRunRecord | null;
    }>;
    fingerprint?: string;
    error?: { code: string; message: string };
  }> {
    const bodyParseRun =
      (await this.parseStore.findLatestParsedRun(payload.snapshotId)) ??
      (await this.parseStore.findLatestRun(payload.snapshotId));
    if (!bodyParseRun) {
      return {
        body: { documentId: payload.documentId ?? '', snapshotId: payload.snapshotId, contentHash: '', parseRun: null as never },
        files: [],
        error: { code: 'NO_PARSE_RUN', message: '尚未解析的快照，无法抽取' },
      };
    }
    const documentId = payload.documentId ?? bodyParseRun.documentId;
    if (!documentId) {
      return {
        body: { documentId: '', snapshotId: payload.snapshotId, contentHash: bodyParseRun.contentHash, parseRun: bodyParseRun },
        files: [{ documentId: '', snapshotId: payload.snapshotId, contentHash: bodyParseRun.contentHash, name: bodyParseRun.sourceUrl ?? payload.snapshotId, kind: 'body', relationType: null, parseRun: bodyParseRun }],
      };
    }
    const bodyDocument = await this.prisma.sourceDocument.findUnique({ where: { id: documentId } });
    if (!bodyDocument) {
      return {
        body: { documentId, snapshotId: payload.snapshotId, contentHash: bodyParseRun.contentHash, parseRun: bodyParseRun },
        files: [],
        error: { code: 'MATERIAL_ROOT_NOT_FOUND', message: `材料包根文档不存在：${documentId}` },
      };
    }
    const rootId = bodyDocument.parentDocumentId ?? bodyDocument.id;
    const root = rootId === bodyDocument.id
      ? bodyDocument
      : await this.prisma.sourceDocument.findUnique({ where: { id: rootId } });
    if (!root) {
      return {
        body: { documentId, snapshotId: payload.snapshotId, contentHash: bodyParseRun.contentHash, parseRun: bodyParseRun },
        files: [],
        error: { code: 'MATERIAL_ROOT_NOT_FOUND', message: `材料包根文档不存在：${rootId}` },
      };
    }
    const rootSnapshotId = root.latestSnapshotId ?? payload.snapshotId;
    const rootSnapshot = await this.prisma.sourceSnapshot.findUnique({ where: { id: rootSnapshotId } });
    const rootRun = rootSnapshotId === payload.snapshotId ? bodyParseRun :
      (await this.parseStore.findLatestParsedRun(rootSnapshotId)) ?? (await this.parseStore.findLatestRun(rootSnapshotId));
    if (!rootSnapshot || !rootRun) {
      return {
        body: { documentId: root.id, snapshotId: rootSnapshotId, contentHash: rootSnapshot?.contentHash ?? bodyParseRun.contentHash, parseRun: rootRun ?? bodyParseRun },
        files: [],
        error: { code: 'MATERIAL_PACK_INCOMPLETE', message: '公告正文尚未完成解析，材料包暂不抽取' },
      };
    }
    const children = await this.prisma.sourceDocument.findMany({
      where: { parentDocumentId: root.id, kind: 'attachment' },
    });
    const files: Array<{
      documentId: string;
      snapshotId: string;
      contentHash: string;
      name: string;
      kind: 'body' | 'attachment';
      relationType: string | null;
      parseRun: DocumentParseRunRecord;
    }> = [{
      documentId: root.id,
      snapshotId: rootSnapshot.id,
      contentHash: rootSnapshot.contentHash,
      name: root.canonicalUrl,
      kind: 'body',
      relationType: null,
      parseRun: rootRun,
    }];
    for (const child of children) {
      if (!child.latestSnapshotId) {
        return {
          body: { documentId: root.id, snapshotId: rootSnapshot.id, contentHash: rootSnapshot.contentHash, parseRun: rootRun },
          files,
          error: { code: 'MATERIAL_PACK_INCOMPLETE', message: `附件尚未下载：${child.canonicalUrl}` },
        };
      }
      const snapshot = await this.prisma.sourceSnapshot.findUnique({ where: { id: child.latestSnapshotId } });
      const parseRun = snapshot
        ? (await this.parseStore.findLatestParsedRun(snapshot.id)) ?? (await this.parseStore.findLatestRun(snapshot.id))
        : null;
      if (!snapshot || !parseRun) {
        return {
          body: { documentId: root.id, snapshotId: rootSnapshot.id, contentHash: rootSnapshot.contentHash, parseRun: rootRun },
          files,
          error: { code: 'MATERIAL_PACK_INCOMPLETE', message: `附件尚未完成解析：${child.canonicalUrl}` },
        };
      }
      files.push({
        documentId: child.id,
        snapshotId: snapshot.id,
        contentHash: snapshot.contentHash,
        name: child.canonicalUrl,
        kind: 'attachment',
        relationType: child.relationType ?? null,
        parseRun,
      });
    }
    const fingerprint = materialPackKey(
      rootSnapshot.contentHash,
      files.slice(1).map((file) => ({ name: file.name, contentHash: file.contentHash })),
    );
    return {
      body: { documentId: root.id, snapshotId: rootSnapshot.id, contentHash: rootSnapshot.contentHash, parseRun: rootRun },
      files,
      fingerprint,
    };
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
