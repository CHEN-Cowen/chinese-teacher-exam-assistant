/**
 * 武汉教育局 navbox 静态锚点分页族（武汉市教育局等湖北政务 TRS WCM 站点）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目列表页 /zwdt/tsgg/ 为目录形态 URL、完全服务端渲染：
 *   `li.box-sizing > a.item-li-a[href='./YYYYMM/tYYYYMMDD_<id>.shtml'][title]`
 *   + `h2.text-ellipsis` 标题 + `div.other`（`时间：YYYY-MM-DD`），首屏 10 条；
 * - 分页控件 `div#navbox` 为静态锚点：`span#pagenav_0` 当前页 +
 *   `a#pagenav_N[href='index_N.shtml']` 数字页码 + `a#pagenav_tail`（尾页，
 *   href 直接给出官方总页数，通知公告 index_49.shtml = 50 页 / 约 500 条）；
 *   页码映射：栏目目录为第 1 页，`index_1.shtml` 为第 2 页，依此类推；
 * - 详情页 GET HTML（/zwdt/tsgg/YYYYMM/tYYYYMMDD_<id>.shtml）：标题/日期/
 *   来源在官方 meta（ArticleTitle / PubDate YYYY-MM-DD HH:mm:ss /
 *   ContentSource），正文在 `div#article-box`（内层 TRS_UEDITOR），
 *   附件为正文内 `./P0<数字>.pdf|docx|xlsx|zip` 相对路径（TRS WCM 命名）；
 * - 与 NFCMS 族区别：栏目 URL 为目录形态（非 /index.html）、分页后缀
 *   .shtml、锚点容器 div#navbox（pagenav_*），nfcmsIndexPages 不匹配本族。
 *
 * 本模块只读快照：产出记录与后续页 URL，不自行联网、不写库。
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

/** 单来源分页窗口：host → 监测的最大页数；未登记 host 用默认预算 */
export const WHSNAV_PAGE_WINDOWS: Record<string, number> = {
  'jyj.wuhan.gov.cn': 6,
};
export const WHSNAV_DEFAULT_MAX_PAGES = 20;

/** host 对应的分页窗口；目录中未登记的 host 用默认窗口，超预算显式失败 */
export function whsnavPageWindow(url: string): number {
  try {
    return WHSNAV_PAGE_WINDOWS[new URL(url).hostname] ?? WHSNAV_DEFAULT_MAX_PAGES;
  } catch {
    return WHSNAV_DEFAULT_MAX_PAGES;
  }
}

/** 详情地址形态：./YYYYMM/tYYYYMMDD_<id>.shtml（TRS WCM 静态发布命名） */
const WHSNAV_DETAIL_PATTERN = /t\d{8}_\d+\.shtml(?:[?#]|$)/;

/**
 * 武汉 navbox 列表（栏目目录首屏或 index_N.shtml 分页页，同结构）→ 已发现文档；
 * 空列表视为 DOM_MISMATCH（静默 0 条视为故障）。
 */
export function discoverWhsnavRecords(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const $ = load(content);
  const rows = $('li').filter(
    (_i, e) => $(e).children('a.item-li-a').length > 0,
  );
  if (!rows.length) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '武汉 navbox 列表未找到 li > a.item-li-a 结构',
    );
  }
  const items: DiscoveredDocument[] = [];
  const seen = new Set<string>();
  rows.each((_i, e) => {
    const link = $(e).children('a.item-li-a').first();
    const href = link.attr('href') ?? '';
    // 只收详情形态条目（栏目内导航锚点不具备 t<日期>_<id>.shtml 形态时跳过）
    if (!WHSNAV_DETAIL_PATTERN.test(href)) return;
    const title = (link.attr('title') ?? link.text())
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        '武汉 navbox 列表条目缺少文章标题',
      );
    }
    const dateText = link.find('div.other').first().text();
    const date = extractDate(
      dateText,
      `武汉 navbox 列表日期（时间：YYYY-MM-DD）: ${title}`,
    );
    const url = normalizeUrl(resolveUrl(baseUrl, href));
    if (seen.has(url)) return;
    seen.add(url);
    items.push({
      title,
      publishedAt: date,
      url,
      kind: classifyDocumentKind(title),
    });
  });
  if (!items.length) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '武汉 navbox 列表无任何条目（静默 0 条视为故障）',
    );
  }
  return items;
}

/**
 * 从栏目目录页的 div#navbox 派生后续页 URL（index_1..index_K.shtml，即第 2..K+1 页）。
 * - 分页页（pathname 非目录形态）不重复派生，返回 []；
 * - 页面无 div#navbox 或 index_N.shtml 锚点时返回 []（非本族页面不误报）；
 * - 末页优先取 `a#pagenav_tail` href，否则取数字页码锚点最大值；
 * - 官方末页超出预算：已登记 host 封顶到窗口，未登记 host 显式失败，
 *   与烟台/潍坊/福州/广州/石家庄的分页窗口口径一致。
 */
export function whsnavPages(
  baseUrl: string,
  content: string,
  maxPages = whsnavPageWindow(baseUrl),
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  // 栏目目录形态（.../tsgg/）才派生；index_N.shtml 分页页与详情页不派生
  if (!base.pathname.endsWith('/')) return [];
  const $ = load(content);
  const navbox = $('#navbox');
  if (!navbox.length) return [];

  const parseIndex = (href: string): number | null => {
    let target: URL;
    try {
      target = new URL(href, baseUrl);
    } catch {
      return null;
    }
    if (target.hostname !== base.hostname) return null;
    const match = target.pathname.match(/\/index_(\d+)\.shtml$/);
    if (!match) return null;
    const page = Number(match[1]);
    return Number.isSafeInteger(page) && page >= 1 ? page : null;
  };

  let lastIndex = 0;
  const tailHref = navbox.find('a#pagenav_tail[href]').first().attr('href');
  if (tailHref) {
    const parsed = parseIndex(tailHref);
    if (parsed !== null) lastIndex = parsed;
  }
  navbox.find('a[href]').each((_i, e) => {
    const href = $(e).attr('href');
    if (!href) return;
    // 数字页码锚点：文本必须为纯数字，避免把「下一页/下10页/尾页」误判为页码
    if (!/^\d+$/.test($(e).text().trim())) return;
    const page = parseIndex(href);
    if (page !== null && page > lastIndex) lastIndex = page;
  });
  if (lastIndex === 0) return [];

  // index_N 的 N = 页码 - 1：官方总页数 = lastIndex + 1
  const totalPages = lastIndex + 1;
  const sourceWindow = WHSNAV_PAGE_WINDOWS[base.hostname];
  if (totalPages > maxPages && sourceWindow === undefined) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `武汉 navbox 分页超出窗口预算（${totalPages} > ${maxPages}），需在账本登记窗口后接入`,
    );
  }
  const lastPage = Math.min(totalPages, sourceWindow ?? maxPages);
  const urls: string[] = [];
  for (let page = 2; page <= lastPage; page += 1) {
    const pageUrl = new URL(base.href);
    pageUrl.pathname = `${base.pathname}index_${page - 1}.shtml`;
    urls.push(pageUrl.toString());
  }
  return urls;
}
