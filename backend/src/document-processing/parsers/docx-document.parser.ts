/**
 * v7.2.2 按需：DOCX 解析器（Mammoth）。
 *
 * - 转成语义化 HTML 后按段落/表格单元格拆块；
 * - Mammoth 不还原复杂版式：证据锚点用段落序号或表格单元格，不虚构页码；
 * - 是否启用由 Feature Flag（FEATURE_DOCX_PARSE）在上层控制；本文件假定已启用。
 */
import { GuardError, clampText, type ParseLimits } from '../parse-guard.js';
import type {
  DocumentParser,
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
} from '../parsed-document.js';

export const DOCX_PARSER_VERSION = 'docx-parser@1.0.0';

interface MammothResult {
  value: string;
  messages: Array<{ type: string; message: string }>;
}
interface MammothModule {
  convertToHtml(input: { buffer: Buffer }): Promise<MammothResult>;
  extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}

let mammothPromise: Promise<MammothModule> | null = null;
async function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    const mod = (await import('mammoth')) as unknown as {
      default?: MammothModule;
    } & MammothModule;
    mammothPromise = Promise.resolve(mod.default ?? mod);
  }
  return mammothPromise;
}

export class DocxDocumentParser implements DocumentParser {
  readonly format = 'docx' as const;

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
    const mammoth = await loadMammoth();

    let html = '';
    try {
      const result = await mammoth.convertToHtml({ buffer: input.bytes });
      html = result.value;
      for (const message of result.messages) {
        warnings.push(`Mammoth：${message.message}`);
      }
    } catch (error) {
      throw new GuardError(
        'CORRUPT_FILE',
        `DOCX 损坏或无法解析：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const blocks: ParsedBlock[] = [];
    let paragraphIndex = 0;
    let tableIndex = -1;

    // mammoth 输出结构化 HTML：<p>、<table><tr><td>、<li>
    for (const match of html.matchAll(
      /<table[\s\S]*?<\/table>|<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>|<tr[^>]*>([\s\S]*?)<\/tr>/g,
    )) {
      if (blocks.length >= this.limits.maxBlocks) {
        warnings.push(`内容块数量超过上限 ${this.limits.maxBlocks}，已截断`);
        break;
      }
      const [full, paraOrLi, tr] = match;
      if (full.startsWith('<table')) {
        tableIndex += 1;
        continue;
      }
      if (paraOrLi !== undefined) {
        const text = stripInline(paraOrLi);
        if (!text) continue;
        paragraphIndex += 1;
        const [clamped, truncated] = clampText(text, this.limits.maxBlockTextLength);
        if (truncated) warnings.push(`段落 ${paragraphIndex} 文本超长已截断`);
        const locator: DocumentLocator = {
          kind: 'docx-paragraph',
          index: paragraphIndex,
          textFragment: clamped.slice(0, 120),
        };
        blocks.push({
          kind: full.startsWith('<li') ? 'list-item' : 'paragraph',
          text: clamped,
          locator,
          rawValue: clamped,
          displayValue: clamped,
        });
        continue;
      }
      if (tr !== undefined && tableIndex >= 0) {
        let col = 0;
        for (const td of tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)) {
          const text = stripInline(td[1]);
          col += 1;
          if (!text) continue;
          const [clamped] = clampText(text, this.limits.maxBlockTextLength);
          const locator: DocumentLocator = {
            kind: 'docx-table-cell',
            table: tableIndex,
            row: blocks.filter(
              (b) =>
                b.locator.kind === 'docx-table-cell' &&
                (b.locator as { table: number }).table === tableIndex,
            ).length + 1,
            column: col,
          };
          blocks.push({
            kind: 'table-cell',
            text: clamped,
            locator,
            rawValue: clamped,
            displayValue: clamped,
          });
        }
      }
    }

    if (blocks.length === 0) {
      throw new GuardError('CORRUPT_FILE', 'DOCX 中没有可读取的文本内容');
    }

    return {
      snapshotId: input.snapshotId,
      sourceUrl: input.sourceUrl,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      format: 'docx',
      formatDetails: {
        detectedBy: 'magic-bytes',
        declaredMime: input.declaredMime,
        declaredExtension: input.declaredExtension,
        detectedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      parserVersion: DOCX_PARSER_VERSION,
      blocks,
      scanned: false,
      warnings,
    };
  }
}

/** 去掉行内标签与实体（mammoth 输出可信任结构，但仍不保留标签） */
function stripInline(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
