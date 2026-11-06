/**
 * WCM createPageHTML5 静态分页族（长沙市教育局等「xxgk」政务公开站点）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「教师招聘」栏目 /zfxxgk/fdzdgk/jszp/index.html 服务端渲染：
 *   `div.xxgk-item ul li > a[href] > a[title] + span(YYYY-MM-DD)`，
 *   首屏 15 条；列表条目为嵌套 <a>（外层仅 href，内层带 title），
 *   通用静态锚点解析按内层 title 取标题即可；
 * - 分页由官方脚本声明：
 *   `wcmUtil.createPageHTML5("8", "0", "index", "html")`，即总页数 8、
 *   当前页索引 0、前缀 index、后缀 html，后续页为 index_1.html … index_7.html
 *   （index_1.html 为第 2 页）。既有 `staticListPages` 只认 6 参数
 *   `createPageHTML(page_div, total, current, 'nav_list', 'shtml', n)`，
 *   不覆盖本族，故单独派生；
 * - 栏目首页含置顶条目：第 2 页首条与首屏第 2 条重复（同一招聘公告置顶），
 *   发现服务按 URL 去重，测试需按"去重后无重复"而非"完全无交集"断言；
 * - 第 2 页混入 1 条市人社局跨站公告（rsj.changsha.gov.cn「事业单位招考」，
 *   雅礼中学引进竞赛教练）：不在本来源 allowedHosts 内，按同源规则过滤，
 *   该官方栏目在来源账本登记为后续候选，不在此来源内隐式扩域。
 *
 * 本模块只读快照：产出后续页 URL，不自行联网、不写库。
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
export const WCM5_PAGE_WINDOWS: Record<string, number> = {
  'jyj.changsha.gov.cn': 8,
};
export const WCM5_DEFAULT_MAX_PAGES = 20;

export function wcm5PageWindow(url: string): number {
  try {
    return WCM5_PAGE_WINDOWS[new URL(url).hostname] ?? WCM5_DEFAULT_MAX_PAGES;
  } catch {
    return WCM5_DEFAULT_MAX_PAGES;
  }
}

/** 详情地址形态：./<YYYYMM>/t<YYYYMMDD>_<id>.html（TRS WCM 静态发布命名） */
const WCM5_DETAIL_PATTERN = /t\d{8}_\d+\.html(?:[?#]|$)/;

/**
 * 长沙「教师招聘」栏目列表（首屏或 index_N.html 分页页，同结构）→ 已发现文档。
 *
 * 官方条目为嵌套 `<a href><a href title>标题</a></a>`：HTML 解析器会按规范
 * 把嵌套锚点扁平化为兄弟节点，外层锚点因此没有文本/标题，不能直接取
 * `find('a[href]').first()`（会得到空标题）。此处显式优先取带 title 的锚点，
 * 其次取第一个有文本的锚点；日期取条目内 span。
 * 空列表、缺标题或缺日期均抛 DOM_MISMATCH，绝不静默返回 0 条。
 * 跨站官方条目（市人社局）按同源过滤：详情抓取受 allowedHosts 约束，
 * 不在本来源内隐式扩大抓取范围。
 */
export function discoverWcm5Records(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const $ = load(content);
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    throw new AdapterParseError('DOM_MISMATCH', 'WCM5 列表 URL 无效');
  }
  const rows = $('div.xxgk-item li').has('a[href]');
  if (!rows.length) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'WCM5 列表未找到 div.xxgk-item li > a[href] 结构',
    );
  }
  const items: DiscoveredDocument[] = [];
  const seen = new Set<string>();
  rows.each((_i, e) => {
    const links = $(e).find('a[href]');
    const titled = links
      .filter((_j, node) => ($(node).attr('title') ?? '').trim().length > 0)
      .first();
    const link = titled.length
      ? titled
      : links.filter((_j, node) => $(node).text().trim().length > 0).first();
    if (!link.length) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        'WCM5 列表条目缺少带标题的链接',
      );
    }
    const href = link.attr('href') ?? '';
    if (!WCM5_DETAIL_PATTERN.test(href)) return;
    const title = (link.attr('title') ?? link.text())
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      throw new AdapterParseError('DOM_MISMATCH', 'WCM5 列表条目缺少文章标题');
    }
    const dateText = $(e).find('span').first().text();
    const date = extractDate(dateText, `WCM5 列表日期（YYYY-MM-DD）: ${title}`);
    const url = normalizeUrl(resolveUrl(baseUrl, href));
    if (new URL(url).hostname !== baseHost) return;
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
      'WCM5 列表无任何条目（静默 0 条视为故障）',
    );
  }
  return items;
}

/**
 * 从栏目首页的 `wcmUtil.createPageHTML5(total, current, prefix, ext)` 派生
 * 后续页 URL。
 * - 已是 index_<n>.html 分页页时不重复派生（返回 []）；
 * - 页面无 createPageHTML5 声明时返回 []（非本族页面不误报）；
 * - 总页数非法抛 DOM_MISMATCH；未登记 host 且超默认预算显式失败，
 *   已登记 host 按窗口封顶（与烟台/潍坊/福州/广州/武汉口径一致）。
 */
export function wcm5Pages(
  baseUrl: string,
  content: string,
  maxPages = wcm5PageWindow(baseUrl),
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  // 分页页（index_<n>.html）不再派生，避免把第 N 页当成新一轮首屏
  if (/\/index_\d+\.html$/.test(base.pathname)) return [];

  const $ = load(content);
  const call = $('script')
    .map((_i, e) => $(e).text())
    .get()
    .map((text) =>
      text.match(
        /createPageHTML5\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/,
      ),
    )
    .find(Boolean);
  if (!call) return [];

  const total = Number(call[1]);
  const current = Number(call[2]);
  const prefix = call[3];
  const ext = call[4];
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new AdapterParseError('DOM_MISMATCH', 'WCM5 分页总页数无效');
  }
  if (prefix !== 'index' || !/^(html|shtml)$/.test(ext)) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `WCM5 分页参数未登记形态（prefix=${prefix}, ext=${ext}），需核验后接入`,
    );
  }

  const sourceWindow = WCM5_PAGE_WINDOWS[base.hostname];
  if (total > maxPages && sourceWindow === undefined) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `WCM5 分页超出窗口预算（${total} > ${maxPages}），需在账本登记窗口后接入`,
    );
  }
  const lastPage = Math.min(total, sourceWindow ?? maxPages);

  // 目录形态：/jszp/ 或 /jszp/index.html 均归一到 /jszp/
  let dirPath = base.pathname;
  if (dirPath.endsWith('index.html')) {
    dirPath = dirPath.slice(0, -'index.html'.length);
  }
  if (!dirPath.endsWith('/')) dirPath += '/';

  const from = Number.isSafeInteger(current) && current >= 0 ? current : 0;
  const urls: string[] = [];
  for (let page = from + 1; page < lastPage; page += 1) {
    const pageUrl = new URL(base.href);
    pageUrl.pathname = `${dirPath}${prefix}_${page}.${ext}`;
    urls.push(pageUrl.toString());
  }
  return urls;
}
