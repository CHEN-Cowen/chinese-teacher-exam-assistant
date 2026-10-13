/**
 * v7.2.2 按需：OCR 解析（接口先行，供应商未接入）。
 *
 * 原则（网络基线 §4.3 / 用户要求）：
 * - 业务代码只依赖 OcrProvider 接口，不依赖供应商 SDK；前端永不直连；
 * - OCR 只在没有有效文本层（scanned）时触发；
 * - 输出保留页码、坐标、置信度、OCR 标记与服务版本；
 * - 未配置供应商 / 未启用开关 → 一律"待人工处理"，不伪装成功；
 * - 低于置信度阈值的结果必须人工确认，不得自动发布。
 */
import type {
  DocumentParser,
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
} from '../parsed-document.js';
import type { OcrConfig } from '../feature-flags.js';

export const OCR_PARSER_VERSION = 'ocr-parser@1.0.0';

/** OCR 单页识别结果 */
export interface OcrPageResult {
  page: number;
  /** 文本行（含坐标与置信度） */
  lines: Array<{
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
}

/**
 * OCR 供应商接口（接口先行，境内可直连供应商未来实现）。
 * 供应商故障时调用方回退为待人工处理，核心流程不依赖其实时可用性。
 */
export interface OcrProvider {
  readonly serviceVersion: string;
  recognize(input: { bytes: Buffer; mime: string; maxPages: number }): Promise<OcrPageResult[]>;
}

export class OcrDocumentParser implements DocumentParser {
  readonly format = 'ocr' as const;

  constructor(
    private readonly config: OcrConfig,
    private readonly provider: OcrProvider | null,
    private readonly maxPages: number,
  ) {}

  async parse(input: {
    snapshotId: string;
    sourceUrl: string | null;
    storageKey: string;
    contentHash: string;
    declaredMime: string;
    declaredExtension: string;
    bytes: Buffer;
  }): Promise<ParsedDocument> {
    // 供应商未接入：待人工处理（不伪装成功）
    if (!this.provider) {
      return this.pendingManual(input, 'OCR 供应商未接入（接口已定义，待批准的境内供应商）');
    }
    try {
      const pages = await this.provider.recognize({
        bytes: input.bytes,
        mime: input.declaredMime,
        maxPages: this.maxPages,
      });
      const blocks: ParsedBlock[] = [];
      const warnings: string[] = [];
      for (const page of pages) {
        for (const line of page.lines) {
          const locator: DocumentLocator = {
            kind: 'ocr',
            page: page.page,
            bbox: line.bbox,
            confidence: line.confidence,
            ocrMarked: true,
            serviceVersion: this.provider.serviceVersion,
            textFragment: line.text.slice(0, 120),
          };
          blocks.push({
            kind: 'paragraph',
            text: line.text,
            locator,
            rawValue: line.text,
            displayValue: line.text,
          });
          if (line.confidence < this.config.lowConfidenceThreshold) {
            warnings.push(
              `第 ${page.page} 页一行文本置信度 ${line.confidence.toFixed(2)} 低于阈值 ${this.config.lowConfidenceThreshold}，必须人工确认`,
            );
          }
        }
      }
      return {
        snapshotId: input.snapshotId,
        sourceUrl: input.sourceUrl,
        contentHash: input.contentHash,
        storageKey: input.storageKey,
        format: 'ocr',
        formatDetails: {
          detectedBy: 'magic-bytes',
          declaredMime: input.declaredMime,
          declaredExtension: input.declaredExtension,
          detectedMime: 'application/pdf',
        },
        parserVersion: `${OCR_PARSER_VERSION}+${this.provider.serviceVersion}`,
        blocks,
        scanned: true,
        pageCount: pages.length,
        ocr: { required: true, status: 'completed' },
        warnings,
      };
    } catch (error) {
      // 供应商故障：回退为待人工处理，不抛错、不伪装成功
      return this.pendingManual(
        input,
        `OCR 服务调用失败（${error instanceof Error ? error.message : String(error)}），转人工处理`,
      );
    }
  }

  private pendingManual(
    input: { snapshotId: string; sourceUrl: string | null; storageKey: string; contentHash: string; declaredMime: string; declaredExtension: string },
    reason: string,
  ): ParsedDocument {
    return {
      snapshotId: input.snapshotId,
      sourceUrl: input.sourceUrl,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      format: 'ocr',
      formatDetails: {
        detectedBy: 'magic-bytes',
        declaredMime: input.declaredMime,
        declaredExtension: input.declaredExtension,
        detectedMime: 'application/pdf',
      },
      parserVersion: OCR_PARSER_VERSION,
      blocks: [],
      scanned: true,
      ocr: { required: true, status: 'pending_manual', reason },
      pendingManualReason: reason,
      warnings: [reason],
    };
  }
}
