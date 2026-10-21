/**
 * v7.2 附件解析：PDF 解析器（pdfjs-dist legacy 构建）。
 *
 * 只做"字节 → 标准文档"：
 * - 逐页提取文本行，保留页码与坐标框（PDF 用户空间）；
 * - 计算每页文字密度：文本极少且存在大面积图片时判定为扫描件（进入 OCR 流程）；
 * - 加密 PDF → pending_manual（不伪造结果）；损坏 → failed；
 * - 禁用求值（isEvalSupported=false），不联网（useWorkerFetch=false）。
 *
 * 分层边界：本文件不做任何资格/业务判断。
 */
import {
  GuardError,
  clampText,
  type ParseLimits,
} from '../parse-guard.js';
import type {
  DocumentParser,
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
  TableHeaderCandidate,
} from '../parsed-document.js';
import {
  detectPdfTable,
  tableToParsedBlocks,
} from './pdf-table-detector.js';

export const PDF_PARSER_VERSION = 'pdf-parser@1.0.0';

/** 每页最少有效字符数：低于该值视为"无有效文本层" */
const MIN_TEXT_CHARS_PER_PAGE = 60;

/** pdfjs-dist 的最小类型面（避免依赖其内部类型导出路径） */
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
interface PdfTextContent {
  items: Array<PdfTextItem | { type: string }>;
}
interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
  getOperatorList(): Promise<{ fnArray: number[] }>;
}
interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}
/** pdfjs v4+：destroy 在 loadingTask 上，文档代理只有 cleanup */
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}
interface GetDocumentInput {
  data: Uint8Array;
  isEvalSupported: boolean;
  useSystemFonts: boolean;
  useWorkerFetch: boolean;
  verbosity: number;
  password?: string;
}
interface PdfjsModule {
  getDocument(src: GetDocumentInput): PdfLoadingTask;
  OPS?: Record<string, number>;
  PasswordException?: new (msg: string) => Error;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** 懒加载 pdfjs-dist（Node 环境使用 legacy 构建；不满足时给出可诊断错误） */
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
    pdfjsPromise = import(specifier) as Promise<PdfjsModule>;
  }
  return pdfjsPromise;
}

export class PdfDocumentParser implements DocumentParser {
  readonly format = 'pdf' as const;

  constructor(private readonly limits: ParseLimits) {}

  async parse(input: {
    snapshotId: string;
    sourceUrl: string | null;
    storageKey: string;
    contentHash: string;
    declaredMime: string;
    declaredExtension: string;
    bytes: Buffer;
  }): Promise<ParsedDocument> {
    const warnings: string[] = [];
    const pdfjs = await loadPdfjs();

    let doc: PdfDocument;
    let loadingTask: PdfLoadingTask | null = null;
    try {
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(input.bytes),
        isEvalSupported: false,
        useSystemFonts: false,
        useWorkerFetch: false,
        verbosity: 0,
      });
      doc = await loadingTask.promise;
    } catch (error) {
      const name = (error as { name?: string }).name ?? '';
      if (name === 'PasswordException') {
        throw new GuardError(
          'ENCRYPTED_PDF',
          'PDF 已加密，无法自动解析内容，需人工处理',
        );
      }
      throw new GuardError(
        'CORRUPT_FILE',
        `PDF 损坏或无法解析：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      if (doc.numPages > this.limits.maxPdfPages) {
        throw new GuardError(
          'TOO_MANY_PAGES',
          `PDF 页数超过上限（${doc.numPages} > ${this.limits.maxPdfPages}）`,
        );
      }

      const blocks: ParsedBlock[] = [];
      const tableHeaders: TableHeaderCandidate[] = [];
      let scannedPages = 0;

      for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
        const page = await doc.getPage(pageNo);
        const text = await page.getTextContent();
        const items = text.items.filter(
          (item): item is PdfTextItem => typeof (item as PdfTextItem).str === 'string',
        );
        const pageChars = items.reduce((sum, item) => sum + item.str.trim().length, 0);

        let pageHasImage = false;
        try {
          const ops = await page.getOperatorList();
          pageHasImage = ops.fnArray.length > 0 && hasImageOp(pdfjs, ops.fnArray);
        } catch {
          warnings.push(`第 ${pageNo} 页渲染指令读取失败（不影响文本提取）`);
        }

        if (pageChars < MIN_TEXT_CHARS_PER_PAGE && pageHasImage) {
          scannedPages += 1;
          warnings.push(
            `第 ${pageNo} 页无有效文本层（仅 ${pageChars} 字符且含图片），疑似扫描件`,
          );
          continue;
        }
        if (pageChars < MIN_TEXT_CHARS_PER_PAGE) {
          warnings.push(`第 ${pageNo} 页文本层内容极少（仅 ${pageChars} 字符）`);
        }

        // 尝试按坐标还原表格：检测到可靠表格结构时，产出 worksheet 风格的
        // cell 块 + 表头候选（供下游业务抽取层按"岗位×字段"精确抽取）；
        // 否则回退到逐行文本段落（保持原有行为，不伪造表格）。
        const table = detectPdfTable(
          items.map((it) => ({
            page: pageNo,
            x: it.transform[4],
            y: it.transform[5],
            width: it.width,
            height: it.height,
            str: it.str,
          })),
          pageNo,
        );
        if (table) {
          const result = tableToParsedBlocks(table);
          if (blocks.length + result.blocks.length <= this.limits.maxBlocks) {
            blocks.push(...result.blocks);
            tableHeaders.push(...result.tableHeaders);
            warnings.push(
              `第 ${pageNo} 页检测到表格结构，已按行列还原（${table.headers.length} 列，含表头行 ${table.headerRow}）`,
            );
            continue;
          }
          // 表格块超出预算：回退到逐行文本（保持可读，不静默丢失内容）
        }

        for (const line of groupLines(items)) {
          if (blocks.length >= this.limits.maxBlocks) {
            warnings.push(`内容块数量超过上限 ${this.limits.maxBlocks}，已截断`);
            break;
          }
          const [clamped, truncated] = clampText(line.text, this.limits.maxBlockTextLength);
          if (truncated) warnings.push(`第 ${pageNo} 页一行文本超长已截断`);
          const locator: DocumentLocator = {
            kind: 'pdf-text',
            page: pageNo,
            bbox: line.bbox,
            textFragment: clamped.slice(0, 120),
          };
          blocks.push({
            kind: 'paragraph',
            text: clamped,
            locator,
            rawValue: clamped,
            displayValue: clamped,
          });
        }
      }

      const scanned = scannedPages > 0 && scannedPages >= Math.ceil(doc.numPages / 2);

      return {
        snapshotId: input.snapshotId,
        sourceUrl: input.sourceUrl,
        contentHash: input.contentHash,
        storageKey: input.storageKey,
        format: 'pdf',
        formatDetails: {
          detectedBy: 'magic-bytes',
          declaredMime: input.declaredMime,
          declaredExtension: input.declaredExtension,
          detectedMime: 'application/pdf',
        },
        parserVersion: PDF_PARSER_VERSION,
        blocks,
        ...(tableHeaders.length > 0 ? { tableHeaders } : {}),
        scanned,
        pageCount: doc.numPages,
        ocr: scanned
          ? { required: true, status: 'pending_manual', reason: '扫描件需要 OCR 或人工处理' }
          : { required: false, status: 'not_triggered' },
        warnings,
      };
    } finally {
      await loadingTask?.destroy().catch(() => undefined);
    }
  }
}

interface TextLine {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
}

/** 把同页文本项按基线分组为行，行内按 x 排序；bbox 取并集 */
function groupLines(items: PdfTextItem[]): TextLine[] {
  const usable = items
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height,
    }))
    .filter((item) => item.str.trim().length > 0);
  if (usable.length === 0) return [];

  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ items: typeof usable; y: number }> = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= Math.max(2, item.height * 0.5)) {
      current.items.push(item);
    } else {
      lines.push({ items: [item], y: item.y });
    }
  }

  return lines.map((line) => {
    const ordered = [...line.items].sort((a, b) => a.x - b.x);
    const text = ordered
      .map((item) => item.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const minX = Math.min(...ordered.map((i) => i.x));
    const minY = Math.min(...ordered.map((i) => i.y));
    const maxX = Math.max(...ordered.map((i) => i.x + i.width));
    const maxY = Math.max(...ordered.map((i) => i.y + i.height));
    return {
      text,
      bbox: {
        x: Math.round(minX * 100) / 100,
        y: Math.round(minY * 100) / 100,
        width: Math.round((maxX - minX) * 100) / 100,
        height: Math.round((maxY - minY) * 100) / 100,
      },
    };
  });
}

/** 判断指令序列中是否包含图片绘制（识别扫描页） */
function hasImageOp(pdfjs: PdfjsModule, fnArray: number[]): boolean {
  const OPS = pdfjs.OPS;
  if (!OPS) return fnArray.length > 0;
  const imageOps = new Set(
    [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject].filter(
      (op) => typeof op === 'number',
    ),
  );
  return fnArray.some((op) => imageOps.has(op));
}
