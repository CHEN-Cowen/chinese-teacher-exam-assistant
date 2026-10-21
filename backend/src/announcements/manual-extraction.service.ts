/**
 * M1：手动提交/提取统一真实输入与新提取入口。
 *
 * 让后台「提交来源 → 执行提取 → 重试」真实复用 v7.2 新多岗位抽取链路，
 * 与队列路径（DocumentParseService → AnnouncementExtractService）共用同一套
 * 业务抽取纯函数 extractFields，消除旧 parser.ts（公告级无 scope）断点。
 *
 * 职责边界（本文件不做跨文件智能裁决，那是 M3）：
 * - 一份公告正文（URL 抓取或人工粘贴）+ 若干岗位附件（当前解析器可读），
 *   各自落 SourceSnapshot + SourceDocument，正文为 parent、附件为 child，
 *   建立最小「公告材料包」关联（同批可追溯，附件文本不无位置拼接）；
 * - 手动触发与队列最终复用同一业务抽取版本 FIELD_EXTRACTOR_VERSION；
 * - URL 模式必须拿到真实正文/附件内容才报告读取成功；抓取失败切换明确标记的
 *   人工输入，绝不把 URL 字符串当成功正文；
 * - 不可读格式/扫描件明确显示未处理范围，未配置 OCR/DOCX 保持未启用，
 *   不以空结果伪装成功。
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  computeContentHash,
  extractionIdempotencyKey,
  findHighImpactFieldsWithoutAnchor,
  type CandidateField,
  type ExtractionCandidate,
} from './domain.js';
import { FIELD_EXTRACTOR_VERSION, extractFields } from './extraction/field-extractor.js';
import { reconcileFields, type ReconcileSource } from './field-reconciler.js';
import { DocumentParserService, GuardError } from '../document-processing/document-parser.service.js';
import { DocumentParseStore } from '../document-processing/document-parse-store.js';
import type { ObjectStore } from '../sourcing/storage/object-store.js';
import { OBJECT_STORE } from '../sourcing/storage/storage.tokens.js';
import { snapshotStorageKey } from '../sourcing/storage/object-store.js';
import type { ParsedDocument } from '../document-processing/parsed-document.js';

/** 附件输入（人工上传/粘贴路径的最小形态） */
export interface AttachmentInput {
  /** 文件标识（文件名；用于展示与审计，不参与业务判定） */
  name: string;
  /** 声明 MIME（可空；最终格式由 magic bytes 判定） */
  mimeType?: string;
  /** 原始字节（附件原件，二进制通道） */
  bytes: Buffer;
}

export interface SubmitManualInput {
  publisher: string;
  officialUrl: string;
  sourceType: string;
  regionCode?: string;
  announcementId?: string;
  /** 正文：HTML 或纯文本（URL 模式时由调用方抓取后回填） */
  content: string;
  /** 正文声明 MIME（html/text） */
  mimeType: string;
  /** 岗位附件列表（可为空；当前解析器可读的 XLS/XLSX/PDF 等） */
  attachments?: AttachmentInput[];
}

/** 材料包内单个文件的读取状态（供界面展示与失败恢复） */
export interface MaterialFileStatus {
  /** 逻辑文档 id（正文/附件各自的 SourceDocument） */
  documentId: string;
  /** 快照 id（正文/附件各自的 SourceSnapshot） */
  snapshotId: string;
  /** 文件标识（名称/URL） */
  name: string;
  /** 类型：正文 body / 附件 attachment */
  kind: 'body' | 'attachment';
  /** 读取状态：ok / unreadable / unsupported / pending_manual */
  readStatus: 'ok' | 'unreadable' | 'unsupported' | 'pending_manual';
  /** 失败/未处理原因（readStatus != ok 时非空） */
  reason?: string;
  /** 解析格式（可读时为 html/pdf/spreadsheet 等） */
  format?: string;
}

/** 手动提取结果：返回实际 run_id 与提取版本，以及材料包各文件状态 */
export interface ManualExtractOutcome {
  runId: string;
  status: 'pending_review' | 'failed' | 'partial';
  parserVersion: string;
  fieldCount: number;
  files: MaterialFileStatus[];
}

@Injectable()
export class ManualExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parserService: DocumentParserService,
    private readonly parseStore: DocumentParseStore,
    @Optional()
    @Inject(OBJECT_STORE)
    private readonly objectStore?: ObjectStore,
  ) {}

  // ==================== 1. 提交来源 + 建立材料包关联 ====================

  /**
   * 提交公告来源（正文 + 附件），落快照与逻辑文档，建立最小材料包关联
   * （正文 parent、附件 child），并创建提取任务（绑定正文快照）。
   *
   * URL 模式的正文/附件抓取由调用方（controller/service）在提交前用
   * SafeFetcher 完成后传入；本方法只负责落库，不重复抓取。
   */
  async submitSource(input: SubmitManualInput, userId: string): Promise<{ run: unknown }> {
    const bodyContentHash = computeContentHash(input.content);

    // 找到或创建来源（按 officialUrl 去重）
    let source = await this.prisma.source.findFirst({
      where: { officialUrl: input.officialUrl },
    });
    if (!source) {
      source = await this.prisma.source.create({
        data: {
          publisher: input.publisher,
          officialUrl: input.officialUrl,
          sourceType: input.sourceType,
          regionCode: input.regionCode ?? null,
        },
      });
    }

    // 正文：内容寻址落对象存储 + 建快照 + 逻辑文档（parent）
    const bodyBytes = Buffer.from(input.content, 'utf8');
    const bodyStorageKey = await this.putBinary(bodyBytes, bodyContentHash, input.mimeType);
    const bodySnapshot = await this.upsertSnapshot(source.id, {
      officialUrl: input.officialUrl,
      storageKey: bodyStorageKey,
      mimeType: input.mimeType,
      contentHash: bodyContentHash,
    });
    const bodyDocument = await this.upsertDocument(source.id, {
      canonicalUrl: input.officialUrl,
      kind: 'announcement',
    });
    await this.attachSnapshot(bodyDocument.id, bodySnapshot.id, bodyContentHash);

    // 附件：逐个落快照 + 逻辑文档（child，parentDocumentId 指向正文文档）
    for (const att of input.attachments ?? []) {
      const attHash = computeContentHash(att.bytes);
      const attKey = await this.putBinary(att.bytes, attHash, att.mimeType ?? 'application/octet-stream');
      const attSnapshot = await this.upsertSnapshot(source.id, {
        officialUrl: null,
        storageKey: attKey,
        mimeType: att.mimeType ?? 'application/octet-stream',
        contentHash: attHash,
      });
      const attCanonicalUrl = `attachment://${source.id}/${attHash.slice(0, 16)}/${encodeURIComponent(att.name)}`;
      const attDocument = await this.upsertDocument(source.id, {
        canonicalUrl: attCanonicalUrl,
        kind: 'attachment',
        parentDocumentId: bodyDocument.id,
      });
      await this.attachSnapshot(attDocument.id, attSnapshot.id, attHash);
    }

    // 创建提取任务（绑定正文快照；幂等键 = 正文快照 + 抽取版本）
    const run = await this.createExtractionRun(bodySnapshot.id, input.announcementId, userId);
    return { run };
  }

  // ==================== 2. 执行提取（复用新抽取链路） ====================

  async runExtraction(runId: string): Promise<ManualExtractOutcome> {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: { snapshot: true },
    });
    if (!run) throw new NotFoundException('提取任务不存在');

    if (run.status !== 'submitted' && run.status !== 'failed') {
      throw new BadRequestException(`当前状态 ${run.status} 不能开始提取`);
    }

    await this.prisma.extractionRun.update({
      where: { id: runId },
      data: { status: 'extracting', progress: 30 },
    });

    try {
      const bodySnapshot = run.snapshot;
      const bodyBytes = await this.readBytes(bodySnapshot.storageKey);

      // 材料包：正文 + 关联附件（经 SourceDocument.parentDocumentId 追溯，
      // 含 M3-07 的 relationType 更正/补充关系标注）
      const { bodyDocumentId, attachments } = await this.listAttachments(bodySnapshot.id);

      const files: MaterialFileStatus[] = [];
      // M3：逐文件独立收集候选与锚点，再进入跨文件归属与冲突复核
      const reconcileSources: ReconcileSource[] = [];
      const allDropped: unknown[] = [];
      const allWarnings: string[] = [];

      // 解析并抽取正文
      const bodyOutcome = await this.parseAndExtract(
        { id: bodySnapshot.id, storageKey: bodySnapshot.storageKey, mimeType: bodySnapshot.mimeType, officialUrl: bodySnapshot.officialUrl },
        bodyBytes,
        'body',
        bodyDocumentId,
      );
      files.push(bodyOutcome.file);
      reconcileSources.push({
        file: {
          documentId: bodyDocumentId,
          snapshotId: bodySnapshot.id,
          name: bodySnapshot.officialUrl ?? bodySnapshot.id,
          kind: 'body',
          relationType: null,
        },
        fields: bodyOutcome.fields,
      });
      allDropped.push(...bodyOutcome.dropped);
      allWarnings.push(...bodyOutcome.warnings);

      // 解析并抽取每个附件（岗位表附件产出多岗位 scope）
      for (const att of attachments) {
        let bytes: Buffer;
        try {
          bytes = await this.readBytes(att.storageKey);
        } catch {
          files.push({
            documentId: att.documentId,
            snapshotId: att.snapshotId,
            name: att.name,
            kind: 'attachment',
            readStatus: 'unreadable',
            reason: '附件原始字节缺失，无法解析',
          });
          continue;
        }
        const outcome = await this.parseAndExtract(
          { id: att.snapshotId, storageKey: att.storageKey, mimeType: att.mimeType, officialUrl: att.name },
          bytes,
          'attachment',
          att.documentId,
        );
        files.push(outcome.file);
        reconcileSources.push({
          file: {
            documentId: att.documentId,
            snapshotId: att.snapshotId,
            name: att.name,
            kind: 'attachment',
            relationType: att.relationType ?? null,
          },
          fields: outcome.fields,
        });
        allDropped.push(...outcome.dropped);
        allWarnings.push(...outcome.warnings);
      }

      // M3：跨文件归属与冲突复核——同岗位同字段不同值转 conflict（保留全部
      // 来源与证据），同值合并保留全部证据，不再通过首次命中静默丢弃另一来源。
      const reconciled = reconcileFields(reconcileSources);
      const allFields = reconciled.fields;
      allWarnings.push(...reconciled.report.warnings);

      const hasAnyUnreadable = files.some((f) => f.readStatus !== 'ok');

      // 无任何可读字段 → 诚实失败，不伪装成功
      if (allFields.length === 0) {
        const reasons = files
          .filter((f) => f.readStatus !== 'ok')
          .map((f) => `${f.name}:${f.reason ?? f.readStatus}`)
          .join('；');
        await this.prisma.extractionRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            errorCode: 'NO_CANDIDATE_FIELDS',
            errorMessage: reasons || '未抽到任何候选字段（高影响字段无证据不产出）',
            finishedAt: new Date(),
          },
        });
        return {
          runId,
          status: 'failed',
          parserVersion: FIELD_EXTRACTOR_VERSION,
          fieldCount: 0,
          files,
        };
      }

      const candidate: ExtractionCandidate = {
        fields: allFields,
        parserVersion: FIELD_EXTRACTOR_VERSION,
        rawJson: {
          snapshotId: bodySnapshot.id,
          contentHash: bodySnapshot.contentHash,
          dropped: allDropped,
          warnings: allWarnings,
          files: files.map((f) => ({
            documentId: f.documentId,
            snapshotId: f.snapshotId,
            name: f.name,
            kind: f.kind,
            readStatus: f.readStatus,
            reason: f.reason,
          })),
          // M3：跨文件复核报告（冲突/合并/待归属/适用关系对照），审计可追溯
          reconciliation: reconciled.report,
        },
      };

      // 二次校验：高影响字段必须带锚点
      const missing = findHighImpactFieldsWithoutAnchor(candidate);
      if (missing.length > 0) {
        await this.prisma.extractionRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            errorCode: 'HIGH_IMPACT_MISSING_ANCHOR',
            errorMessage: `高影响字段缺少证据锚点：${missing.join('、')}`,
            finishedAt: new Date(),
          },
        });
        return {
          runId,
          status: 'failed',
          parserVersion: FIELD_EXTRACTOR_VERSION,
          fieldCount: 0,
          files,
        };
      }

      const anchorRows = candidate.fields
        .filter((f) => f.anchor)
        .map((f) => ({
          field: f.field,
          locatorKind: f.anchor!.locator.kind,
          locatorData: (f.anchor!.locatorData ?? f.anchor!.locator) as object,
          excerpt: f.anchor!.excerpt ?? null,
        }));

      await this.prisma.extractionRun.update({
        where: { id: runId },
        data: {
          status: 'pending_review',
          progress: 100,
          candidate: candidate as unknown as object,
          finishedAt: new Date(),
        },
      });
      // 重跑时替换锚点（幂等），成功记录不被降级
      await this.prisma.evidenceAnchor.deleteMany({ where: { runId } });
      if (anchorRows.length > 0) {
        await this.prisma.evidenceAnchor.createMany({
          data: anchorRows.map((a) => ({ ...a, runId })),
        });
      }

      return {
        runId,
        status: hasAnyUnreadable ? 'partial' : 'pending_review',
        parserVersion: FIELD_EXTRACTOR_VERSION,
        fieldCount: candidate.fields.length,
        files,
      };
    } catch (e) {
      await this.prisma.extractionRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorCode: 'EXTRACTION_FAILED',
          errorMessage: e instanceof Error ? e.message : '提取失败',
          finishedAt: new Date(),
        },
      });
      throw e;
    }
  }

  // ==================== 内部：解析 + 抽取（正文/附件共用） ====================

  private async parseAndExtract(
    snapshot: { id: string; storageKey: string; mimeType: string; officialUrl: string | null },
    bytes: Buffer,
    kind: 'body' | 'attachment',
    documentId?: string,
  ): Promise<{
    file: MaterialFileStatus;
    fields: CandidateField[];
    dropped: unknown[];
    warnings: string[];
  }> {
    const fileName = snapshot.officialUrl ?? snapshot.id;
    const base = {
      documentId: documentId ?? '',
      snapshotId: snapshot.id,
      name: fileName,
      kind,
    };
    const contentHash = computeContentHash(bytes);

    // 解析（含安全防护与格式判定）
    let parsed: ParsedDocument;
    try {
      parsed = await this.parserService.parse({
        snapshotId: snapshot.id,
        sourceUrl: snapshot.officialUrl,
        storageKey: snapshot.storageKey,
        contentHash,
        declaredMime: snapshot.mimeType,
        bytes,
      });
    } catch (error) {
      const code = error instanceof GuardError ? error.code : 'PARSE_ERROR';
      const readStatus =
        code === 'UNKNOWN_FORMAT' || code === 'FILE_TOO_LARGE' || code === 'EMPTY_FILE'
          ? 'unsupported'
          : 'unreadable';
      const reason = error instanceof Error ? error.message : String(error);
      await this.persistParseFailure(snapshot.id, bytes, code, reason, readStatus);
      return {
        file: { ...base, readStatus, reason },
        fields: [],
        dropped: [],
        warnings: [],
      };
    }

    // 待人工（扫描件/OCR 未启用、DOCX 未启用）→ 明确未处理，不伪装成功
    if (parsed.pendingManualReason || parsed.ocr?.status === 'pending_manual') {
      const reason = parsed.pendingManualReason ?? parsed.ocr?.reason ?? '需要 OCR 或人工处理';
      await this.persistParsed(snapshot.id, bytes, parsed, 'pending_manual', reason);
      return {
        file: { ...base, readStatus: 'pending_manual', reason, format: parsed.format },
        fields: [],
        dropped: [],
        warnings: [],
      };
    }

    // 落 DocumentParseRun（parsed）
    await this.persistParsed(snapshot.id, bytes, parsed, 'parsed');

    // 业务抽取（复用 extractFields：多岗位逐行抽取，与队列路径一致）
    const extracted = extractFields(parsed);
    return {
      file: { ...base, readStatus: 'ok', format: parsed.format },
      fields: extracted.fields,
      dropped: extracted.dropped,
      warnings: extracted.warnings,
    };
  }

  /** 落 DocumentParseRun（成功/待人工） */
  private async persistParsed(
    snapshotId: string,
    bytes: Buffer,
    parsed: ParsedDocument,
    status: 'parsed' | 'pending_manual',
    pendingReason?: string,
  ): Promise<void> {
    const contentHash = computeContentHash(bytes);
    const { run } = await this.parseStore.ensureRun({
      snapshotId,
      format: 'unknown',
      parserVersion: parsed.parserVersion,
      contentHash,
      sourceUrl: parsed.sourceUrl,
    });
    if (run.status === 'parsed') return; // 幂等：已成功不覆盖
    await this.parseStore.completeRun(run.id, {
      status,
      format: parsed.format,
      blocks: parsed.blocks,
      tableHeaders: parsed.tableHeaders ?? null,
      blockCount: parsed.blocks.length,
      warnings: pendingReason ? [...parsed.warnings, pendingReason] : parsed.warnings,
      scanned: parsed.scanned,
      ocrRequired: parsed.ocr?.required ?? false,
      ocrStatus: parsed.ocr?.status ?? null,
    });
  }

  /** 落 DocumentParseRun（失败/不支持） */
  private async persistParseFailure(
    snapshotId: string,
    bytes: Buffer,
    code: string,
    reason: string,
    readStatus: 'unsupported' | 'unreadable',
  ): Promise<void> {
    const contentHash = computeContentHash(bytes);
    const status = readStatus === 'unsupported' ? 'unsupported_format' : 'failed';
    const { run } = await this.parseStore.ensureRun({
      snapshotId,
      format: 'unknown',
      parserVersion: 'pending-manual@1.0.0',
      contentHash,
      sourceUrl: null,
    });
    if (run.status === 'parsed') return;
    await this.parseStore.completeRun(run.id, {
      status,
      format: 'unknown',
      errorSummary: `${code}:${reason}`,
    });
  }

  // ==================== 内部：存储与材料包关联 ====================

  private async putBinary(bytes: Buffer, contentHash: string, mimeType = 'application/octet-stream'): Promise<string> {
    if (this.objectStore) {
      return this.objectStore.putBinary({ content: bytes, mimeType, contentHash });
    }
    // 无对象存储注入：本地 .data 目录兜底（与 LocalObjectStore 同一内容寻址 key）
    const key = snapshotStorageKey(contentHash);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const target = path.join(process.cwd(), '.data', key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.access(target);
    } catch {
      await fs.writeFile(target, bytes);
    }
    return key;
  }

  private async readBytes(storageKey: string): Promise<Buffer> {
    if (this.objectStore) {
      return this.objectStore.getBinary(storageKey);
    }
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    try {
      return await fs.readFile(path.join(process.cwd(), '.data', storageKey));
    } catch {
      throw new BadRequestException('原始快照内容丢失，请重新提交公告');
    }
  }

  private async upsertSnapshot(
    sourceId: string,
    input: { officialUrl: string | null; storageKey: string; mimeType: string; contentHash: string },
  ) {
    const existing = await this.prisma.sourceSnapshot.findUnique({
      where: { sourceId_contentHash: { sourceId, contentHash: input.contentHash } },
    });
    if (existing) return existing;
    return this.prisma.sourceSnapshot.create({
      data: {
        sourceId,
        officialUrl: input.officialUrl,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        contentHash: input.contentHash,
        fetchedAt: new Date(),
        httpStatus: 200,
      },
    });
  }

  private async upsertDocument(
    sourceId: string,
    input: { canonicalUrl: string; kind: string; parentDocumentId?: string },
  ) {
    return this.prisma.sourceDocument.upsert({
      where: {
        sourceId_canonicalUrl: { sourceId, canonicalUrl: input.canonicalUrl },
      },
      create: {
        sourceId,
        canonicalUrl: input.canonicalUrl,
        kind: input.kind,
        parentDocumentId: input.parentDocumentId ?? null,
      },
      update: input.parentDocumentId !== undefined
        ? { parentDocumentId: input.parentDocumentId }
        : {},
    });
  }

  private async attachSnapshot(documentId: string, snapshotId: string, contentHash: string) {
    await this.prisma.sourceDocument.update({
      where: { id: documentId },
      data: { latestSnapshotId: snapshotId, contentHash },
    });
  }

  /** 按正文快照找到其逻辑文档与 child 附件文档（含 M3-07 relationType 关系标注） */
  private async listAttachments(bodySnapshotId: string): Promise<{
    bodyDocumentId: string;
    attachments: Array<{
      documentId: string;
      snapshotId: string;
      storageKey: string;
      mimeType: string;
      name: string;
      /** 更正/补充关系（replacement/supplement 等；null=关系不明） */
      relationType?: string | null;
    }>;
  }> {
    const bodyDoc = await this.prisma.sourceDocument.findFirst({
      where: { latestSnapshotId: bodySnapshotId },
    });
    if (!bodyDoc) {
      return { bodyDocumentId: '', attachments: [] };
    }
    const children = await this.prisma.sourceDocument.findMany({
      where: { parentDocumentId: bodyDoc.id, kind: 'attachment' },
    });
    const out: Array<{
      documentId: string;
      snapshotId: string;
      storageKey: string;
      mimeType: string;
      name: string;
      relationType?: string | null;
    }> = [];
    for (const child of children) {
      if (!child.latestSnapshotId) continue;
      const snapshot = await this.prisma.sourceSnapshot.findUnique({
        where: { id: child.latestSnapshotId },
      });
      if (!snapshot) continue;
      out.push({
        documentId: child.id,
        snapshotId: snapshot.id,
        storageKey: snapshot.storageKey,
        mimeType: snapshot.mimeType,
        name: this.attachmentName(child.canonicalUrl, child.id),
        relationType: child.relationType ?? null,
      });
    }
    return { bodyDocumentId: bodyDoc.id, attachments: out };
  }

  /** 从附件 canonicalUrl 提取可读文件名（URL 解码，兜底用文档 id） */
  private attachmentName(canonicalUrl: string, documentId: string): string {
    const matched = canonicalUrl.match(/^attachment:\/\/[^/]+\/[0-9a-f]+\/(.+)$/);
    if (!matched) return documentId;
    try {
      return decodeURIComponent(matched[1]);
    } catch {
      return matched[1];
    }
  }

  private async createExtractionRun(
    snapshotId: string,
    announcementId: string | undefined,
    userId: string,
  ) {
    const parserVersion = FIELD_EXTRACTOR_VERSION;
    const idempotencyKey = extractionIdempotencyKey(snapshotId, parserVersion);
    const existing = await this.prisma.extractionRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing && existing.status !== 'failed') {
      return existing;
    }
    return this.prisma.extractionRun.create({
      data: {
        snapshotId,
        announcementId,
        parserVersion,
        idempotencyKey,
        status: 'submitted',
        submittedBy: userId,
      },
    });
  }
}
