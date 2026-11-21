/**
 * 官方材料结构化切分（W2）。
 *
 * 原则：
 * - 切分保留原文，不摘要、不改写；
 * - 每个 chunk 带可回到原件的 locator（页码/工作表/行/段落/选择器）；
 * - 表格按“行”组织，段落按长度合并，标题作为 headingPath 上下文；
 * - 版本化：解析器/切分器版本进入索引幂等键，升级会生成新索引而不是覆盖旧证据。
 */
import { createHash } from 'node:crypto';
import type {
  DocumentLocator,
  ParsedBlock,
} from '../document-processing/parsed-document.js';

export const CHUNKER_VERSION = 'w2-chunker-v1';
export const DEFAULT_MAX_CHARS = 600;

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  kind: 'paragraph' | 'table_row' | 'excerpt';
  content: string;
  headingPath: string[];
  locator: DocumentLocator;
  spans: DocumentLocator[];
  charCount: number;
}

function rowKey(locator: DocumentLocator): string | null {
  if (locator.kind === 'worksheet') return `${locator.sheet}#${locator.row}`;
  if (locator.kind === 'docx-table-cell') {
    return `docx#${locator.table}#${locator.row}`;
  }
  return null;
}

function rowPrefix(locator: DocumentLocator): string {
  if (locator.kind === 'worksheet') {
    return `工作表「${locator.sheet}」第 ${locator.row} 行：`;
  }
  if (locator.kind === 'docx-table-cell') {
    return `表格 ${locator.table} 第 ${locator.row} 行：`;
  }
  return '';
}

/** 同一行内的单元格按列号排序，避免解析顺序变化导致文本漂移。 */
function sortRowCells(cells: ParsedBlock[]): ParsedBlock[] {
  return [...cells].sort((a, b) => {
    if (a.locator.kind === 'worksheet' && b.locator.kind === 'worksheet') {
      return a.locator.column - b.locator.column;
    }
    if (
      a.locator.kind === 'docx-table-cell' &&
      b.locator.kind === 'docx-table-cell'
    ) {
      return a.locator.column - b.locator.column;
    }
    return 0;
  });
}

/**
 * 把标准解析块切为可检索片段。
 * @param blocks 解析器输出的块（保持原文顺序）
 * @param maxChars 单片段目标长度（超出先切段，不跨标题合并）
 */
export function chunkParsedBlocks(
  blocks: readonly ParsedBlock[],
  maxChars = DEFAULT_MAX_CHARS,
): KnowledgeChunkDraft[] {
  const chunks: KnowledgeChunkDraft[] = [];
  let heading = '';
  let buffer: { text: string; locators: DocumentLocator[] } | null = null;

  const pushChunk = (
    text: string,
    locators: DocumentLocator[],
    kind: KnowledgeChunkDraft['kind'],
  ) => {
    const content = text.trim();
    if (!content || locators.length === 0) return;
    chunks.push({
      chunkIndex: chunks.length,
      kind,
      content,
      headingPath: heading ? [heading] : [],
      locator: locators[0]!,
      spans: locators,
      charCount: content.length,
    });
  };

  const flushParagraph = () => {
    if (!buffer) return;
    pushChunk(buffer.text, buffer.locators, 'paragraph');
    buffer = null;
  };

  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index]!;
    const text = (block.displayValue ?? block.text).trim();
    if (!text) {
      index += 1;
      continue;
    }

    if (block.kind === 'heading') {
      flushParagraph();
      heading = text;
      index += 1;
      continue;
    }

    const key = rowKey(block.locator);
    if (block.kind === 'table-cell' && key) {
      flushParagraph();
      const rowBlocks: ParsedBlock[] = [];
      let cursor = index;
      while (cursor < blocks.length) {
        const next = blocks[cursor]!;
        if (next.kind !== 'table-cell' || rowKey(next.locator) !== key) break;
        if ((next.displayValue ?? next.text).trim().length > 0) rowBlocks.push(next);
        cursor += 1;
      }
      const sorted = sortRowCells(rowBlocks);
      const cells = sorted
        .map((cell) => {
          const value = (cell.displayValue ?? cell.text).trim();
          return cell.locator.kind === 'worksheet'
            ? `${cell.locator.cell}=${value}`
            : value;
        })
        .join('；');
      const prefix = rowPrefix(sorted[0]?.locator ?? block.locator);
      pushChunk(
        `${prefix}${cells}`,
        sorted.map((cell) => cell.locator),
        'table_row',
      );
      index = cursor;
      continue;
    }

    if (key) {
      // 没有文字的表格行（空中断）直接跳过。
      index += 1;
      continue;
    }

    // 段落 / 列表项：按长度合并；跨页时保留 spans，定位仍回到首块。
    const prepared = { text, locator: block.locator };
    if (buffer && buffer.text.length + prepared.text.length + 1 > maxChars) {
      flushParagraph();
    }
    if (!buffer) buffer = { text: '', locators: [] };
    buffer.text = buffer.text ? `${buffer.text}\n${prepared.text}` : prepared.text;
    buffer.locators.push(prepared.locator);
    if (buffer.text.length >= maxChars) flushParagraph();
    index += 1;
  }
  flushParagraph();
  return chunks;
}

/** 管理员直接粘贴官方正文：按段落生成 excerpt 定位，保证可追溯片段。 */
export function textToBlocks(content: string): ParsedBlock[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      kind: 'paragraph',
      text: line,
      locator: {
        kind: 'excerpt',
        textFragment: line.length > 90 ? `${line.slice(0, 90)}…` : line,
      },
    }));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 切分内容指纹：用于“同文档同内容同切分器”幂等判断。 */
export function chunkSignature(chunks: readonly KnowledgeChunkDraft[]): string {
  return sha256(
    chunks
      .map((chunk) => `${chunk.chunkIndex}:${chunk.content}`)
      .join('\u0001'),
  );
}
