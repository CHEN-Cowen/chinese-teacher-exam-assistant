/**
 * NFCMS 集约化平台静态锚点分页族（广州市教育局等广东省政务站点）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目列表页完全服务端渲染：`div.news_list ul li > a[href][title]`
 *   + 同级 `<span> [YYYY-MM-DD]</span>`（日期带方括号），首屏 20 条；
 * - 分页控件为静态锚点：数字页码 + `a.next`（下一页）+ `a.last`（最后一页），
 *   实际路径是同目录 `index_<n>.html`（网上公示 20 页）；
 * - **陷阱**：页面内仍残留 `createPageHTML('page_div',3,1,'list','shtml',60)`
 *   声明，指向 `list_2.shtml`，实测 404——声明已失效，不能据此派生分页，
 *   否则每轮都会请求不存在的页面并让整次发现被记为 partial。
 *
 * 本模块只读快照：产出后续页 URL，不自行联网、不写库。
 */
import { load } from 'cheerio';
import { AdapterParseError } from './official-site-adapter.js';

/** 单来源分页窗口：host → 监测的最大页数；未登记 host 用默认预算 */
export const NFCMS_PAGE_WINDOWS: Record<string, number> = {
  'jyj.gz.gov.cn': 6,
};
export const NFCMS_DEFAULT_MAX_PAGES = 20;

/** 计数页末页上限：官方 20 页 / 每页 20 条 = 400 条，只监测最新窗口 */
export function nfcmsPageWindow(url: string): number {
  try {
    return (
      NFCMS_PAGE_WINDOWS[new URL(url).hostname] ?? NFCMS_DEFAULT_MAX_PAGES
    );
  } catch {
    return NFCMS_DEFAULT_MAX_PAGES;
  }
}

/** 仅 /index.html 形态的栏目列表页参与锚点分页（限定 NFCMS 族，避免误伤其他站点） */
export function isNfcmsIndexUrl(url: string): boolean {
  try {
    return /^\/[\s\S]*\/index\.html$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * 从静态分页锚点派生后续页 URL（第 2..N 页）。
 * - 末页优先取 `a.last`（最后一页）href，否则取数字页码锚点最大值；
 * - 页面无 `index_<n>.html` 锚点时返回 []（非本族页面不误报）；
 * - 已是第 2 页及以后不重复派生；
 * - 官方末页超出预算：已登记 host 封顶到窗口，未登记 host 显式失败，
 *   与烟台/潍坊/福州的分页窗口口径一致。
 */
export function nfcmsIndexPages(
  baseUrl: string,
  content: string,
  maxPages = nfcmsPageWindow(baseUrl),
): string[] {
  if (!isNfcmsIndexUrl(baseUrl)) return [];
  const base = new URL(baseUrl);
  if (/index_\d+\.html$/.test(base.pathname)) return [];
  const $ = load(content);
  const isIndexPage = (href: string): number | null => {
    let target: URL;
    try {
      target = new URL(href, baseUrl);
    } catch {
      return null;
    }
    if (target.hostname !== base.hostname) return null;
    const dir = base.pathname.replace(/index\.html$/, '');
    if (!target.pathname.startsWith(dir)) return null;
    const match = target.pathname.slice(dir.length).match(/^index_(\d+)\.html$/);
    if (!match) return null;
    const page = Number(match[1]);
    return Number.isSafeInteger(page) && page >= 2 ? page : null;
  };

  let lastIndex = 0;
  const lastHref = $('a.last[href], a[class*="last"][href]').first().attr('href');
  if (lastHref) {
    const parsed = isIndexPage(lastHref);
    if (parsed !== null) lastIndex = parsed;
  }
  $('a[href]').each((_i, e) => {
    const href = $(e).attr('href');
    if (!href) return;
    const text = $(e).text().trim();
    // 数字页码锚点：文本必须为纯数字，避免把导航/正文里的同类链接误判为分页
    if (!/^\d+$/.test(text)) return;
    const page = isIndexPage(href);
    if (page !== null && page > lastIndex) lastIndex = page;
  });
  if (lastIndex === 0) return [];

  const sourceWindow = NFCMS_PAGE_WINDOWS[base.hostname];
  if (lastIndex > maxPages && sourceWindow === undefined) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `NFCMS 分页超出窗口预算（${lastIndex} > ${maxPages}），需在账本登记窗口后接入`,
    );
  }
  const lastPage = Math.min(lastIndex, sourceWindow ?? maxPages);
  const urls: string[] = [];
  for (let page = 2; page <= lastPage; page += 1) {
    const pageUrl = new URL(base.href);
    pageUrl.pathname = base.pathname.replace(/index\.html$/, `index_${page}.html`);
    urls.push(pageUrl.toString());
  }
  return urls;
}
