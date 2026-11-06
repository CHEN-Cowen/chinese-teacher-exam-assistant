/**
 * PageFront 表单 POST 分页族（石家庄市教育局等河北政务站点）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目列表页 /a/zwgk/tzgg/index.html 完全服务端渲染：
 *   `li.clearF > div.ul_zi > a[栏目] + a[文章绝对地址]` + 同级
 *   `div.ul_ziriqi`（YYYY-MM-DD），首屏 20 条；
 *   详情地址形态 /a/YYYY/MM/DD/<id>.html；
 * - 分页为表单提交：`form[name=pageForm]` POST /dynamic/PageFront.jsp，
 *   隐藏字段 parseId/categoryId/keyword + pageNo=N，页码锚点
 *   `javascript:page(N)`，末页锚点给出官方总页数（通知公告 6 页 / 120 条）；
 * - POST 响应为完整 HTML 页面（同一 ul_zi 列表结构），无 Referer 要求
 *   （实测带与不带 Referer 均 200，与福州 fjdz 不同）；
 * - 混合栏目偶发微信公众号等站外转载条目（无站内详情地址），按详情路径过滤；
 * - 静态分页 index_N.html 不存在，createPageHTML 声明也没有。
 *
 * 分页 URL 携带全部表单字段（query），因此分页请求可由 URL 确定性派生；
 * 本模块只读快照：产出记录与后续页 URL + POST 请求体，不自行联网、不写库。
 */
import { load } from 'cheerio';
import {
  AdapterParseError,
  classifyDocumentKind,
  extractDate,
  normalizeUrl,
  resolveUrl,
  type DiscoveredDocument,
} from './official-site-adapter.js';
import type { RequestOptions } from './fetch/safe-fetcher.js';

export const PAGEFRONT_PATH = '/dynamic/PageFront.jsp';

/** 单来源分页窗口：host → 监测的最大页数；未登记 host 用默认预算 */
export const PAGEFRONT_PAGE_WINDOWS: Record<string, number> = {
  'sjzjyj.sjz.gov.cn': 6,
};
export const PAGEFRONT_DEFAULT_MAX_PAGES = 20;

export function isPagefrontUrl(url: string): boolean {
  try {
    return new URL(url).pathname === PAGEFRONT_PATH;
  } catch {
    return false;
  }
}

/** host 对应的分页窗口；目录中未登记的 host 用默认窗口，超预算显式失败 */
export function pagefrontPageWindow(url: string): number {
  try {
    return PAGEFRONT_PAGE_WINDOWS[new URL(url).hostname] ?? PAGEFRONT_DEFAULT_MAX_PAGES;
  } catch {
    return PAGEFRONT_DEFAULT_MAX_PAGES;
  }
}

/** 详情地址形态：/a/YYYY/MM/DD/<id>.html */
const PAGEFRONT_DETAIL_PATTERN = /\/a\/\d{4}\/\d{2}\/\d{2}\/\d+\.html(?:[?#]|$)/;

/**
 * 由 PageFront 分页 URL 派生 POST 表单体。
 * URL query 必须携带 parseId/categoryId/pageNo（keyword 缺省空串）；
 * 字段顺序与官网表单一致（parseId/categoryId/keyword/pageNo），保证确定性。
 */
export function pagefrontRequest(url: string): RequestOptions {
  const parsed = new URL(url);
  const parseId = parsed.searchParams.get('parseId');
  const categoryId = parsed.searchParams.get('categoryId');
  const pageNo = parsed.searchParams.get('pageNo');
  if (!parseId || !categoryId || !pageNo) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'PageFront 分页 URL 缺少 parseId/categoryId/pageNo 参数，无法派生请求体',
    );
  }
  const body = new URLSearchParams();
  body.set('parseId', parseId);
  body.set('categoryId', categoryId);
  body.set('keyword', parsed.searchParams.get('keyword') ?? '');
  body.set('pageNo', pageNo);
  return {
    method: 'POST',
    body: body.toString(),
    contentType: 'application/x-www-form-urlencoded',
  };
}

/**
 * PageFront 列表（栏目首屏或分页响应，同为 ul_zi 结构）→ 已发现文档；
 * 空列表视为 DOM_MISMATCH（静默 0 条视为故障）。
 * 每个 li 内含栏目锚点与文章锚点两个 a，按详情路径形态取文章锚点。
 */
export function discoverPagefrontRecords(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const $ = load(content);
  const rows = $('li').filter(
    (_i, e) => $(e).children('div.ul_zi').length > 0,
  );
  if (!rows.length) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'PageFront 列表未找到 li > div.ul_zi 结构',
    );
  }
  const items: DiscoveredDocument[] = [];
  const seen = new Set<string>();
  rows.each((_i, e) => {
    const link = $(e)
      .find('div.ul_zi a[href]')
      .filter((_j, a) => PAGEFRONT_DETAIL_PATTERN.test($(a).attr('href') ?? ''))
      .first();
    const href = link.attr('href');
    // 混合栏目偶发微信公众号等站外转载条目（无站内详情地址）：
    // 按详情路径过滤跳过，与阜阳/南昌跨站条目的口径一致。
    if (!href) return;
    const title = link.text().replace(/\s+/g, ' ').trim();
    if (!title) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        'PageFront 列表条目缺少文章标题',
      );
    }
    const date = $(e).find('div.ul_ziriqi').first().text().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        `PageFront 列表条目缺少发布日期（YYYY-MM-DD）: ${title}`,
      );
    }
    const url = normalizeUrl(resolveUrl(baseUrl, href));
    if (seen.has(url)) return;
    seen.add(url);
    items.push({
      title,
      publishedAt: extractDate(date, 'PageFront 列表日期'),
      url,
      kind: classifyDocumentKind(title),
    });
  });
  if (!items.length) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'PageFront 列表无任何条目（静默 0 条视为故障）',
    );
  }
  return items;
}

/**
 * 从栏目首屏的 pageForm 派生后续页 URL（第 2..N 页，query 携带全部表单字段）。
 * - 分页响应页（PageFront.jsp）不再派生，返回 []；
 * - 页面无 pageForm 或 action 非 PageFront.jsp 时返回 []（非本族页面不误报）；
 * - 确认是本族页面但缺 parseId/categoryId 视为结构漂移显式抛错；
 * - 无 page(N) 页码锚点（仅 1 页）返回 []；
 * - 官方末页超出预算：已登记 host 封顶到窗口，未登记 host 显式失败，
 *   与烟台/潍坊/福州/广州的分页窗口口径一致。
 */
export function pagefrontPages(
  baseUrl: string,
  content: string,
  maxPages = pagefrontPageWindow(baseUrl),
): string[] {
  if (isPagefrontUrl(baseUrl)) return [];
  const $ = load(content);
  const form = $('form[name="pageForm"]').filter((_i, e) =>
    ($(e).attr('action') ?? '').includes(PAGEFRONT_PATH),
  );
  if (!form.length) return [];
  const field = (name: string): string | undefined =>
    form.first().find(`input[name="${name}"]`).attr('value');
  const parseId = field('parseId');
  const categoryId = field('categoryId');
  if (!parseId || !categoryId) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'PageFront 分页表单缺少 parseId/categoryId 隐藏字段',
    );
  }
  const keyword = field('keyword') ?? '';

  let lastIndex = 0;
  form.find('a[href]').each((_i, e) => {
    const match = ($(e).attr('href') ?? '').match(/javascript:page\((\d+)\)/i);
    if (!match) return;
    const page = Number(match[1]);
    if (Number.isSafeInteger(page) && page > lastIndex) lastIndex = page;
  });
  if (lastIndex <= 1) return [];

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const sourceWindow = PAGEFRONT_PAGE_WINDOWS[new URL(baseUrl).hostname];
  if (lastIndex > maxPages && sourceWindow === undefined) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `PageFront 分页超出窗口预算（${lastIndex} > ${maxPages}），需在账本登记窗口后接入`,
    );
  }
  const lastPage = Math.min(lastIndex, sourceWindow ?? maxPages);
  const urls: string[] = [];
  for (let page = 2; page <= lastPage; page += 1) {
    const pageUrl = new URL(`${origin}${PAGEFRONT_PATH}`);
    pageUrl.searchParams.set('parseId', parseId);
    pageUrl.searchParams.set('categoryId', categoryId);
    pageUrl.searchParams.set('keyword', keyword);
    pageUrl.searchParams.set('pageNo', String(page));
    urls.push(pageUrl.toString());
  }
  return urls;
}
