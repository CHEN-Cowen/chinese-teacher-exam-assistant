/**
 * v7.2 工作包 3/4：官方来源适配器契约。
 *
 * 不变量（R-WP3-04 / PRD 8.2）：
 * - Adapter 只接收“已安全下载”的不可变快照字节，**不自行联网**；
 * - **不写数据库**、不抽取用户资格结论；
 * - 输出规范化 URL 与最小元数据（标题/发布时间/正文/附件）；
 * - 选择器/DOM 失配必须抛出明确错误，**绝不静默返回 0 条**（静默 0 条视为故障）。
 */

/** 已下载的不可变快照（由 SafeFetcher 产出；Adapter 只读） */
export interface DownloadedSnapshot {
  /** 快照来源 URL（用于把相对路径解析为绝对 URL） */
  url: string;
  mimeType: string;
  content: string;
  fetchedAt: string;
}

export interface ParsedListItem {
  title: string;
  /** YYYY-MM-DD */
  publishedAt: string;
  /** 规范化后的绝对详情页 URL */
  detailUrl: string;
}

export interface ParsedAttachment {
  name: string;
  /** 规范化后的绝对 URL */
  url: string;
}

export interface ParsedDetail {
  canonicalUrl: string;
  title: string;
  publishedAt: string;
  bodyText: string;
  attachments: ParsedAttachment[];
}

export type AdapterErrorCode = 'DOM_MISMATCH';

/** 解析失败：结构/DOM 与预期不符时抛出，不允许静默降级 */
export class AdapterParseError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = 'AdapterParseError';
    this.code = code;
  }
}

/** D. 单来源 Adapter：只吃快照、只吐结构化最小元数据 */
export interface OfficialSiteAdapter {
  readonly sourceId: string;
  /** 列表页 → 条目（标题/时间/详情绝对 URL）；空结果视为 DOM_MISMATCH */
  listItems(snapshot: DownloadedSnapshot): ParsedListItem[];
  /** 正文页 → 正文/时间/附件（绝对 URL） */
  parseDetail(snapshot: DownloadedSnapshot): ParsedDetail;
}

/** 把相对路径解析为绝对 URL；失败时抛 DOM_MISMATCH（不返回半成品） */
export function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `无法把相对地址解析为绝对 URL：base=${base} href=${href}`,
    );
  }
}

/** 去除标签、合并空白，得到正文纯文本 */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从含日期的文本中提取第一个 YYYY-MM-DD */
export function extractDate(text: string, path: string): string {
  const match = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    throw new AdapterParseError('DOM_MISMATCH', `${path} 未找到 YYYY-MM-DD 日期`);
  }
  return match[1];
}
