/**
 * v7.2 工作包 3/4：官方来源适配器契约。
 *
 * 不变量（R-WP3-04 / PRD 8.2）：
 * - Adapter 只接收“已安全下载”的不可变快照字节，**不自行联网**；
 * - **不写数据库**、不抽取用户资格结论（学历/专业/年龄等业务规则）；
 * - 只描述页面结构与链接位置，输出规范化 URL 与最小元数据（标题/发布时间/正文/附件）；
 * - 选择器/DOM 失配必须抛出明确错误，**绝不静默返回 0 条**（静默 0 条视为故障）。
 */

/** 已下载的列表页不可变快照（由 SafeFetcher 产出；Adapter 只读） */
export interface ListPageSnapshot {
  /** 快照来源 URL（用于把相对路径解析为绝对 URL） */
  url: string;
  mimeType: string;
  content: string;
  fetchedAt: string;
}

/** 已下载的公告正文页不可变快照（由 SafeFetcher 产出；Adapter 只读） */
export interface ArticlePageSnapshot {
  url: string;
  mimeType: string;
  content: string;
  fetchedAt: string;
}

/** 文档形态：公告 / 附件 / 补充 / 延期 / 取消 */
export type DocumentKind =
  | 'announcement'
  | 'attachment'
  | 'supplement'
  | 'delay'
  | 'cancel';

/** 列表页发现的一条文档（最小元数据） */
export interface DiscoveredDocument {
  title: string;
  /** YYYY-MM-DD */
  publishedAt: string;
  /** 规范化后的绝对详情页 URL */
  url: string;
  kind: DocumentKind;
}

/** 正文页内的附件链接 */
export interface LocatedAttachment {
  name: string;
  /** 规范化后的绝对 URL */
  url: string;
}

/** 正文页定位结果 */
export interface LocatedArticle {
  canonicalUrl: string;
  title: string;
  publishedAt: string;
  bodyText: string;
  attachments: LocatedAttachment[];
}

/** 解析失败：结构/DOM 与预期不符时抛出，不允许静默降级 */
export class AdapterParseError extends Error {
  readonly code: 'DOM_MISMATCH';
  constructor(code: 'DOM_MISMATCH', message: string) {
    super(message);
    this.name = 'AdapterParseError';
    this.code = code;
  }
}

/** 单来源 Adapter：只吃快照、只吐结构化最小元数据 */
export interface OfficialSiteAdapter {
  readonly key: string;
  /** 列表页 → 已发现文档；空结果视为 DOM_MISMATCH */
  discover(input: ListPageSnapshot): DiscoveredDocument[];
  /** 正文页 → 正文/时间/附件（绝对 URL） */
  locateArticle(input: ArticlePageSnapshot): LocatedArticle;
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

/** 规范化绝对 URL：去掉常见跟踪参数（utm_*），保留其余查询参数 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AdapterParseError('DOM_MISMATCH', `无法解析为绝对 URL：${url}`);
  }
  const tracking: string[] = [];
  parsed.searchParams.forEach((_value, key) => {
    if (/^utm_/i.test(key)) tracking.push(key);
  });
  for (const key of tracking) parsed.searchParams.delete(key);
  return parsed.toString();
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

/** 依据标题中的中文关键词判定文档形态（只描述形态，不做业务资格判断） */
export function classifyDocumentKind(title: string): DocumentKind {
  if (title.includes('补充')) return 'supplement';
  if (/延期|推迟|延后/.test(title)) return 'delay';
  if (/取消|终止|撤销/.test(title)) return 'cancel';
  return 'announcement';
}
