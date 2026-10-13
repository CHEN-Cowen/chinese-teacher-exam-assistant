/**
 * v7.2 附件解析：格式解析调度器（层 3：文件格式解析）。
 *
 * 职责：
 * 1. 安全防护（大小/预算）→ 2. magic bytes 格式判定 → 3. 分发到具体格式解析器；
 * 4. 扫描件按需触发 OCR（仅 FEATURE_OCR_PARSE 开启且有供应商时）；
 * 5. DOCX 按需解析（FEATURE_DOCX_PARSE）。
 *
 * 分层边界：本类不做任何招聘业务字段判断（层 4 在 announcements/extraction）。
 * 任何失败都抛出带错误码的 GuardError，由调用方落为
 * failed / unsupported_format / pending_manual，绝不伪装成功。
 */
import { Injectable } from '@nestjs/common';
import { detectDocumentFormat } from './format-detector.js';
import { readFeatureFlags, readOcrConfig, type FeatureFlags, type OcrConfig } from './feature-flags.js';
import {
  GuardError,
  assertWithinLimits,
  readParseLimits,
  type ParseLimits,
} from './parse-guard.js';
import type { DocumentFormat, DocumentParser, ParsedDocument } from './parsed-document.js';
import { HtmlDocumentParser } from './parsers/html-document.parser.js';
import { PdfDocumentParser } from './parsers/pdf-document.parser.js';
import { SpreadsheetDocumentParser } from './parsers/spreadsheet-document.parser.js';
import { DocxDocumentParser } from './parsers/docx-document.parser.js';
import {
  OcrDocumentParser,
  type OcrProvider,
} from './parsers/ocr-document.parser.js';

export interface ParseDispatcherInput {
  snapshotId: string;
  sourceUrl: string | null;
  storageKey: string;
  contentHash: string;
  declaredMime: string;
  bytes: Buffer;
}

@Injectable()
export class DocumentParserService {
  readonly limits: ParseLimits;
  private readonly flags: FeatureFlags;
  private readonly ocrConfig: OcrConfig;
  private readonly ocrProvider: OcrProvider | null;

  constructor(options?: {
    limits?: ParseLimits;
    flags?: FeatureFlags;
    ocrConfig?: OcrConfig;
    ocrProvider?: OcrProvider | null;
  }) {
    this.limits = options?.limits ?? readParseLimits();
    this.flags = options?.flags ?? readFeatureFlags();
    this.ocrConfig = options?.ocrConfig ?? readOcrConfig();
    this.ocrProvider =
      options?.ocrProvider !== undefined
        ? options.ocrProvider
        : // 供应商未接入前恒为 null（接口先行，见 parsers/ocr-document.parser.ts）
          null;
  }

  async parse(input: ParseDispatcherInput): Promise<ParsedDocument> {
    assertWithinLimits(input.bytes, this.limits);
    const detected = detectDocumentFormat({
      bytes: input.bytes,
      declaredMime: input.declaredMime,
      sourceName: input.sourceUrl ?? input.storageKey,
    });
    const warnings = detected.mismatchWarning ? [detected.mismatchWarning] : [];

    if (detected.format === 'unknown') {
      throw new GuardError(
        'UNKNOWN_FORMAT',
        detected.detectedBy === 'magic-bytes'
          ? '文件魔数不是受支持的文档格式（支持 HTML/PDF/XLS/XLSX/XLSB/ET/DOCX）'
          : '无法通过魔数识别文件格式',
      );
    }

    const baseInput = {
      snapshotId: input.snapshotId,
      sourceUrl: input.sourceUrl,
      storageKey: input.storageKey,
      contentHash: input.contentHash,
      declaredMime: input.declaredMime,
      declaredExtension: extensionFrom(input.sourceUrl, input.storageKey),
      bytes: input.bytes,
    };

    let parsed: ParsedDocument;
    switch (detected.format) {
      case 'html':
        parsed = await this.withParser(new HtmlDocumentParser(this.limits), baseInput);
        break;
      case 'spreadsheet':
        parsed = await this.withParser(new SpreadsheetDocumentParser(this.limits), baseInput);
        break;
      case 'docx':
        if (!this.flags.docxParseEnabled) {
          return this.pendingManual(baseInput, 'docx', 'DOCX 解析未启用（v7.2.2 按需能力），待人工处理');
        }
        parsed = await this.withParser(new DocxDocumentParser(this.limits), baseInput);
        break;
      case 'pdf': {
        const doc = await this.withParser(new PdfDocumentParser(this.limits), baseInput);
        if (!doc.scanned) {
          parsed = doc;
          break;
        }
        // 扫描件：OCR 只在无有效文本层时触发；未启用 → 待人工处理
        if (this.flags.ocrParseEnabled && this.ocrProvider) {
          const ocrDoc = await this.withParser(
            new OcrDocumentParser(this.ocrConfig, this.ocrProvider, this.limits.maxPdfPages),
            baseInput,
          );
          parsed = {
            ...ocrDoc,
            warnings: [...doc.warnings, ...ocrDoc.warnings],
          };
        } else {
          parsed = {
            ...doc,
            ocr: {
              required: true,
              status: 'pending_manual',
              reason: this.flags.ocrParseEnabled
                ? 'OCR 供应商未接入，待人工处理'
                : 'OCR 未启用（FEATURE_OCR_PARSE=false），待人工处理',
            },
            pendingManualReason: '扫描件需要 OCR 或人工处理',
          };
        }
        break;
      }
      default:
        throw new GuardError('UNKNOWN_FORMAT', `不受支持的格式：${detected.format}`);
    }

    return { ...parsed, warnings: [...warnings, ...parsed.warnings] };
  }

  private async withParser(
    parser: DocumentParser,
    input: Parameters<DocumentParser['parse']>[0],
  ): Promise<ParsedDocument> {
    return parser.parse(input);
  }

  private pendingManual(
    input: { snapshotId: string; sourceUrl: string | null; storageKey: string; contentHash: string; declaredMime: string; declaredExtension: string },
    format: DocumentFormat,
    reason: string,
  ): ParsedDocument {
    return {
      snapshotId: input.snapshotId,
      sourceUrl: input.sourceUrl,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      format,
      formatDetails: {
        detectedBy: 'magic-bytes',
        declaredMime: input.declaredMime,
        declaredExtension: input.declaredExtension,
        detectedMime: format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream',
      },
      parserVersion: 'pending-manual@1.0.0',
      blocks: [],
      scanned: format === 'ocr',
      pendingManualReason: reason,
      warnings: [reason],
    };
  }
}

function extensionFrom(sourceUrl: string | null, storageKey: string): string {
  const raw = sourceUrl ?? storageKey;
  try {
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
    const base = path.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  } catch {
    return '';
  }
}

export { GuardError };
