/**
 * 福建 fjdzapp/search JSON POST 列表族（福州市教育局等 TRS WCM 官网）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目列表页 /zwgk/tzgg/ 是 JS 壳，静态分页 index_N.htm 404；
 * - 记录必须 POST application/x-www-form-urlencoded 到 /fjdzapp/search，
 *   且必须携带同源 Referer（缺 Referer 返回
 *   {"error":true,"info":"获取站点配置失败"}；X-Requested-With/Origin 非必需）；
 * - 请求体固定模板：channelid=<站点频道>、classsql=chnlid=<栏目ID>、
 *   sortfield=-docorderpri,-docreltime、classcol=publishyear、classsort=0、
 *   page=N、prepage=15；
 * - doctitle like 检索不生效（返回全站 10000 条），不得使用检索参数；
 * - 响应为 {"error":false,"page":1,"prepage":15,"pageCount":178,
 *   "recordCount":2658,"data":[{"chnldocurl","doctitle","docreltime",...}]}；
 * - 条目详情 URL chnldocurl 为绝对地址（/zwgk/tzgg/YYYYMM/tYYYYMMDD_id.htm）。
 *
 * 页面 URL 携带全部请求体参数（query），因此分页请求可由 URL 确定性派生；
 * 本模块只读快照：产出记录与后续页 URL + POST 请求体，不自行联网、不写库。
 */
import {
  AdapterParseError,
  classifyDocumentKind,
  extractDate,
  resolveUrl,
  type DiscoveredDocument,
} from './official-site-adapter.js';
import type { RequestOptions } from './fetch/safe-fetcher.js';

export const FJ_SEARCH_PATH = '/fjdzapp/search';

/** 单来源分页窗口：host → 监测的最大页数；未登记 host 用默认预算 */
export const FJ_PAGE_WINDOWS: Record<string, number> = {
  'jyj.fuzhou.gov.cn': 6,
};
export const FJ_DEFAULT_MAX_PAGES = 20;

export function isFjdzSearchUrl(url: string): boolean {
  try {
    return new URL(url).pathname === FJ_SEARCH_PATH;
  } catch {
    return false;
  }
}

/** host 对应的分页窗口；目录中未登记的 host 用默认窗口，超预算显式失败 */
export function fjdzPageWindow(url: string): number {
  try {
    return FJ_PAGE_WINDOWS[new URL(url).hostname] ?? FJ_DEFAULT_MAX_PAGES;
  } catch {
    return FJ_DEFAULT_MAX_PAGES;
  }
}

export interface FjdzSearchResponse {
  error?: boolean;
  info?: string;
  page?: number;
  prepage?: number;
  pageCount?: number;
  recordCount?: number;
  data?: {
    chnldocurl?: string;
    doctitle?: string;
    docreltime?: string;
  }[];
}

/**
 * 由 fjdz 分页 URL 派生 POST 表单体。
 * URL query 必须携带 channelid/chnlid/page（prepage 缺省 15）；
 * classsql=chnlid=<栏目ID> 与 sortfield/classcol/classsort 为官网脚本固定模板。
 */
export function fjdzSearchRequest(url: string): RequestOptions {
  const parsed = new URL(url);
  const channelid = parsed.searchParams.get('channelid');
  const chnlid = parsed.searchParams.get('chnlid');
  const page = parsed.searchParams.get('page');
  const prepage = parsed.searchParams.get('prepage') ?? '15';
  if (!channelid || !chnlid || !page) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'fjdz 分页 URL 缺少 channelid/chnlid/page 参数，无法派生请求体',
    );
  }
  const body = new URLSearchParams();
  body.set('channelid', channelid);
  body.set('classsql', `chnlid=${chnlid}`);
  body.set('sortfield', '-docorderpri,-docreltime');
  body.set('classcol', 'publishyear');
  body.set('classsort', '0');
  body.set('page', page);
  body.set('prepage', prepage);
  return {
    method: 'POST',
    body: body.toString(),
    contentType: 'application/x-www-form-urlencoded',
  };
}

function parseFjdzResponse(content: string): FjdzSearchResponse {
  let parsed: FjdzSearchResponse;
  try {
    parsed = JSON.parse(content) as FjdzSearchResponse;
  } catch {
    throw new AdapterParseError('DOM_MISMATCH', 'fjdz 列表响应不是合法 JSON');
  }
  if (parsed.error !== false) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `fjdz 列表接口返回失败（error=${String(parsed.error)}${
        parsed.info ? `：${parsed.info}` : ''
      }）`,
    );
  }
  return parsed;
}

/** fjdz JSON 响应 → 已发现文档；空列表视为 DOM_MISMATCH（静默 0 条视为故障） */
export function discoverFjdzRecords(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const response = parseFjdzResponse(content);
  const data = response.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'fjdz 列表无任何记录（静默 0 条视为故障）',
    );
  }
  const items: DiscoveredDocument[] = [];
  for (const entry of data) {
    const title = (entry.doctitle ?? '').replace(/\s+/g, ' ').trim();
    const href = entry.chnldocurl?.trim() ?? '';
    if (!title || !href) {
      throw new AdapterParseError('DOM_MISMATCH', 'fjdz 记录缺少标题或详情链接');
    }
    items.push({
      title,
      publishedAt: extractDate(entry.docreltime ?? '', 'fjdz 列表日期'),
      url: resolveUrl(baseUrl, href),
      kind: classifyDocumentKind(title),
    });
  }
  return items;
}

/**
 * 首屏 JSON 已含第 1 页；按响应 pageCount 补第 2..N 页 URL（保留全部 query）。
 * 非 fjdz JSON 形态静默返回 []（与其他分页助手一致，其他接口不误报）；
 * 确认是 fjdz 响应但缺 pageCount 视为结构漂移显式抛错。
 * 官方总页数超过预算时：host 已登记分页窗口则封顶到窗口（混合栏目全量翻页
 * 会让单来源每轮入队上千条历史文档），未登记 host 显式失败，不静默截断。
 */
export function fjdzSearchPages(
  baseUrl: string,
  content: string,
  maxPages = fjdzPageWindow(baseUrl),
): string[] {
  let parsed: FjdzSearchResponse;
  try {
    parsed = JSON.parse(content) as FjdzSearchResponse;
  } catch {
    return [];
  }
  // fjdz 形态必须为 error=false 且 data 数组；其他 JSON 接口不匹配即静默返回，
  // 避免把别的接口误判为 fjdz 结构漂移。
  if (parsed.error !== false || !Array.isArray(parsed.data)) return [];
  const pageCount = parsed.pageCount ?? 0;
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) {
    throw new AdapterParseError('DOM_MISMATCH', 'fjdz 列表缺少有效总页数');
  }
  const base = new URL(baseUrl);
  const sourceWindow = FJ_PAGE_WINDOWS[base.hostname];
  if (pageCount > maxPages && sourceWindow === undefined) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `fjdz 分页超出窗口预算（${pageCount} > ${maxPages}），需在账本登记窗口后接入`,
    );
  }
  const lastPage = Math.min(pageCount, sourceWindow ?? maxPages);
  // 后续页响应不再派生分页 URL（列表只从首屏展开一次）
  if ((base.searchParams.get('page') ?? '1') !== '1') return [];
  const urls: string[] = [];
  for (let page = 2; page <= lastPage; page += 1) {
    const pageUrl = new URL(base);
    pageUrl.searchParams.set('page', String(page));
    urls.push(pageUrl.toString());
  }
  return urls;
}
