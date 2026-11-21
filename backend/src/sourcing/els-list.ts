/**
 * els-service JSON 文章列表族（潍坊市教育局等官网）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目列表页 /jyjlist/?cataId=… 是 JS 壳，服务端不渲染任何记录；
 * - 记录必须 POST application/json 到 /els-service/article/{page}/{size}，
 *   请求体固定模板 {"dq":"162","dwid":"55332","catas":["trs1308521"]}，
 *   page/size 只出现在 URL 路径中；
 * - 响应为 {"success":true,"data":{"totalPages":49,"currentPage":1,
 *   "contents":[{"subject","url","xxid","fwdate"}]}}；
 * - 条目详情 URL 优先 item.url，否则 /{dwid}/{xxid}.html；
 * - 部分历史条目 subject 内嵌 HTML（<DIV>/<SPAN>），必须剥离后再判型。
 *
 * 页面 URL 携带全部请求体参数（query），因此分页请求可由 URL 确定性派生；
 * 本模块只读快照：产出记录与后续页 URL + JSON 请求体，不自行联网、不写库。
 */
import { load } from 'cheerio';
import {
  AdapterParseError,
  classifyDocumentKind,
  extractDate,
  resolveUrl,
  type DiscoveredDocument,
} from './official-site-adapter.js';
import type { RequestOptions } from './fetch/safe-fetcher.js';

export const ELS_ARTICLE_PATH = '/els-service/article/';

/** 单来源分页窗口：host → 监测的最大页数；未登记 host 用默认值 */
export const ELS_PAGE_WINDOWS: Record<string, number> = {
  'jyj.weifang.gov.cn': 6,
};
export const ELS_DEFAULT_MAX_PAGES = 20;

export function isElsArticleUrl(url: string): boolean {
  try {
    return /^\/els-service\/article\/\d+\/\d+\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** host 对应的分页窗口；目录中未登记的 host 用默认窗口，超预算显式失败 */
export function elsPageWindow(url: string): number {
  try {
    return ELS_PAGE_WINDOWS[new URL(url).hostname] ?? ELS_DEFAULT_MAX_PAGES;
  } catch {
    return ELS_DEFAULT_MAX_PAGES;
  }
}

interface ElsListResponse {
  success?: boolean;
  data?: {
    totalPages?: number;
    currentPage?: number;
    contents?: {
      subject?: string;
      url?: string;
      xxid?: string;
      fwdate?: string;
    }[];
  };
}

function parseElsResponse(content: string): ElsListResponse {
  let parsed: ElsListResponse;
  try {
    parsed = JSON.parse(content) as ElsListResponse;
  } catch {
    throw new AdapterParseError('DOM_MISMATCH', 'els 列表响应不是合法 JSON');
  }
  if (parsed.success !== true || !parsed.data) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `els 列表接口返回失败（success=${String(parsed.success)}）`,
    );
  }
  return parsed;
}

/**
 * 由 els 分页 URL 派生 POST JSON 请求体。
 * URL query 必须携带 dq/dwid/catas（catas 可多值），body 只含固定模板字段。
 */
export function elsJsonRequest(url: string): RequestOptions {
  const parsed = new URL(url);
  const dq = parsed.searchParams.get('dq');
  const dwid = parsed.searchParams.get('dwid');
  const catas = parsed.searchParams.getAll('catas');
  if (!dq || !dwid || catas.length === 0) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'els 分页 URL 缺少 dq/dwid/catas 参数，无法派生请求体',
    );
  }
  return {
    method: 'POST',
    body: JSON.stringify({ dq, dwid, catas }),
    contentType: 'application/json',
  };
}

/** els JSON 响应 → 已发现文档；空列表视为 DOM_MISMATCH（静默 0 条视为故障） */
export function discoverElsRecords(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const response = parseElsResponse(content);
  const contents = response.data?.contents ?? [];
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'els 列表无任何记录（静默 0 条视为故障）',
    );
  }
  // 详情 URL 前缀由请求参数 dwid 决定（官网 JS：/{dwid}/{xxid}.html），
  // 优先取接口返回的 url 字段；缺 dwid 无法派生详情地址，显式失败。
  const dwid = new URL(baseUrl).searchParams.get('dwid');
  if (!dwid) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'els 列表 URL 缺少 dwid 参数，无法派生详情地址',
    );
  }
  const items: DiscoveredDocument[] = [];
  for (const entry of contents) {
    // 历史条目 subject 可能内嵌 <DIV>/<SPAN>，剥标签后合并空白再判型。
    const title = load(`<div>${entry.subject ?? ''}</div>`)('div')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const xxid = entry.xxid?.trim();
    const href = entry.url?.trim() || (xxid ? `/${dwid}/${xxid}.html` : '');
    if (!title || !href) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        'els 记录缺少标题或详情链接',
      );
    }
    items.push({
      title,
      publishedAt: extractDate(entry.fwdate ?? '', 'els 列表日期'),
      url: resolveUrl(baseUrl, href),
      kind: classifyDocumentKind(title),
    });
  }
  return items;
}

/**
 * 首屏 JSON 已含第 1 页；按响应 totalPages 补第 2..N 页 URL。
 * 非 els JSON 形态静默返回 []（与其他分页助手一致，HTML 列表页不误报）；
 * 确认是 els 响应但缺 totalPages 视为结构漂移显式抛错。
 * 官方总页数超过窗口预算时显式失败，不静默截断；窗口按 host 登记
 * （潍坊 6 页），与烟台 PUBLIC_COLUMN_PAGE_WINDOWS 的口径一致。
 */
export function elsArticlePages(
  baseUrl: string,
  content: string,
  maxPages = elsPageWindow(baseUrl),
): string[] {
  let parsed: ElsListResponse;
  try {
    parsed = JSON.parse(content) as ElsListResponse;
  } catch {
    return [];
  }
  // els 形态必须含 contents 数组；jpaas 等其他 JSON 接口（success/data/html）
  // 不匹配即静默返回，避免把别的接口误判为 els 结构漂移。
  if (
    parsed.success !== true ||
    !parsed.data ||
    !Array.isArray(parsed.data.contents)
  )
    return [];
  const totalPages = parsed.data.totalPages ?? 0;
  if (!Number.isSafeInteger(totalPages) || totalPages <= 0) {
    throw new AdapterParseError('DOM_MISMATCH', 'els 列表缺少有效总页数');
  }
  if (totalPages > maxPages) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `els 分页超出窗口预算（${totalPages} > ${maxPages}），需在账本登记窗口后接入`,
    );
  }
  const base = new URL(baseUrl);
  const size = base.pathname.split('/')[4] ?? '20';
  const urls: string[] = [];
  for (let page = 2; page <= totalPages && urls.length < maxPages - 1; page++) {
    const pageUrl = new URL(base);
    pageUrl.pathname = `${ELS_ARTICLE_PATH}${page}/${size}`;
    urls.push(pageUrl.toString());
  }
  return urls;
}
