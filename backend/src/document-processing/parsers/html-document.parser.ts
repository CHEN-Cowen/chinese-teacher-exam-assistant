/**
 * v7.2 附件解析：HTML 解析器（Cheerio）。
 *
 * 只做"字节 → 标准文档"：
 * - 按 heading/paragraph/list-item 拆块，每块带 CSS 选择器路径定位；
 * - 移除 script/style/iframe/object/embed 等危险节点（不执行、不外发请求），
 *   发现时记录告警；
 * - 不做任何业务字段判断（分层边界）。
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { DocumentParser, ParsedBlock, ParsedDocument } from '../parsed-document.js';
import { clampText, type ParseLimits } from '../parse-guard.js';

export const HTML_PARSER_VERSION = 'html-parser@1.0.0';

/** 危险/无正文价值标签：整体移除并告警 */
const DANGEROUS_TAGS = ['script', 'style', 'iframe', 'object', 'embed'];
const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li';

export class HtmlDocumentParser implements DocumentParser {
  readonly format = 'html' as const;

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
    const html = decodeHtmlBytes(input.bytes, warnings);

    const $ = cheerio.load(html);
    for (const tag of DANGEROUS_TAGS) {
      const nodes = $(tag);
      if (nodes.length > 0) {
        warnings.push(`已移除 ${nodes.length} 个 ${tag} 节点（不执行、不加载）`);
        nodes.remove();
      }
    }

    const blocks: ParsedBlock[] = [];
    /** 已被外层块吞掉的元素（嵌套 p/li 不重复成块） */
    const visited = new Set<Element>();

    $(BLOCK_SELECTOR).each((_i, el) => {
      if (blocks.length >= this.limits.maxBlocks) {
        warnings.push(`内容块数量超过上限 ${this.limits.maxBlocks}，已截断`);
        return false;
      }
      if (visited.has(el)) return;
      visited.add(el);
      $(el)
        .find(BLOCK_SELECTOR)
        .each((_j, child) => {
          visited.add(child);
        });

      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (!text) return;

      const [clamped, truncated] = clampText(text, this.limits.maxBlockTextLength);
      if (truncated) warnings.push(`第 ${blocks.length + 1} 块文本超长已截断`);
      const tag = el.tagName?.toLowerCase() ?? '';
      blocks.push({
        kind: /^h[1-6]$/.test(tag) ? 'heading' : tag === 'li' ? 'list-item' : 'paragraph',
        text: clamped,
        locator: {
          kind: 'html',
          selector: buildSelector(el),
          textFragment: clamped.slice(0, 120),
          sourceUrl: input.sourceUrl ?? undefined,
        },
      });
    });

    const title = $('title').first().text().trim() || undefined;

    return {
      snapshotId: input.snapshotId,
      sourceUrl: input.sourceUrl,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      format: 'html',
      formatDetails: {
        detectedBy: 'magic-bytes',
        declaredMime: input.declaredMime,
        declaredExtension: input.declaredExtension,
        detectedMime: 'text/html',
      },
      parserVersion: HTML_PARSER_VERSION,
      title,
      blocks,
      scanned: false,
      warnings,
    };
  }
}

/** 构造简化的 CSS 选择器路径（祖先链最多 3 层 + 自身 nth-of-type） */
function buildSelector(el: Element): string {
  const chain: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; depth < 4 && node; depth += 1) {
    const tag = node.tagName?.toLowerCase() ?? 'unknown';
    chain.unshift(`${tag}:nth-of-type(${nthOfType(node)})`);
    node = parentElement(node);
  }
  return chain.join(' > ');
}

function parentElement(el: Element): Element | null {
  const parent = el.parent;
  if (parent && parent.type === 'tag') return parent as Element;
  return null;
}

function nthOfType(el: Element): number {
  const tag = el.tagName;
  const siblings = el.parent?.children ?? [];
  let index = 0;
  for (const sibling of siblings) {
    if ((sibling as Element).tagName === tag) index += 1;
    if (sibling === el) break;
  }
  return Math.max(1, index);
}

/** 解码 HTML 字节：优先 BOM/meta charset，默认 UTF-8 */
function decodeHtmlBytes(bytes: Buffer, warnings: string[]): string {
  const head = bytes.subarray(0, 2048).toString('latin1');
  if (head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  const meta = head.match(/charset\s*=\s*["']?([\w-]+)/i);
  const charset = (meta?.[1] ?? 'utf-8').toLowerCase();
  try {
    const decoded = new TextDecoder(charset).decode(bytes);
    if (charset !== 'utf-8' && charset !== 'utf8') {
      warnings.push(`按声明编码 ${charset} 解码（非 UTF-8）`);
    }
    return decoded;
  } catch {
    warnings.push(`不支持的编码 ${charset}，按 UTF-8 解码`);
    return bytes.toString('utf8');
  }
}
