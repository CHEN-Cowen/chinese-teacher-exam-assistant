/**
 * jpage 数据列表族（泰安等官网）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目首屏 HTML 内嵌 <script type="text/xml"><datastore>，通常含前 3 页（约 45 条）
 *   与 <totalrecord>/<totalpage>，并给出 dataproxy.jsp 基础地址；
 * - 后续页必须 POST application/x-www-form-urlencoded 到 dataproxy.jsp，
 *   参数含 startrecord/endrecord/perpage 与 col/webid/path/columnid/unitid/webname 等；
 *   GET 返回空响应，不能退化为 GET；
 * - 响应为 <datastore><record><![CDATA[<li>…</li>]]></record>。
 *
 * 本模块只读快照：产出后续页 URL 与 POST 请求体，不自行联网、不写库；
 * 首屏记录与后续页记录由适配器统一解析。
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

export const JPAGE_DATA_PATH = '/module/web/jpage/dataproxy.jsp';

export function isJpageDataUrl(url: string): boolean {
  try {
    return new URL(url).pathname === JPAGE_DATA_PATH;
  } catch {
    return false;
  }
}

function decodeParamValue(value: string): string {
  // 官网 nextgroup 里的 webname 是二次编码（%25E6…）；POST body 需要单次编码的原文。
  if (/^%[0-9a-f]{2}/i.test(value)) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * 由 dataproxy 分页 URL 派生 POST 表单体。
 * 官网脚本固定附带 col=1 / sourceContentType=1；范围参数只放在 query，
 * 与真实浏览器请求保持一致。
 */
export function jpagePostRequest(url: string): RequestOptions {
  const parsed = new URL(url);
  const body = new URLSearchParams();
  body.set('col', '1');
  body.set('sourceContentType', '1');
  parsed.searchParams.forEach((value, key) => {
    if (['startrecord', 'endrecord', 'perpage', 'page'].includes(key)) return;
    body.set(key, decodeParamValue(value));
  });
  return {
    method: 'POST',
    body: body.toString(),
    contentType: 'application/x-www-form-urlencoded',
  };
}

/** 首屏内嵌 datastore（CDATA）解析；后续 dataproxy 响应同样适用。 */
export function discoverJpageRecords(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const store = content.match(/<datastore>([\s\S]*?)<\/datastore>/);
  if (!store) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'jpage 列表未找到 <datastore> 结构',
    );
  }
  const records = [
    ...store[1].matchAll(/<record>([\s\S]*?)<\/record>/g),
  ].map((match) => match[1]);
  if (!records.length) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'jpage 列表无任何 record（静默 0 条视为故障）',
    );
  }
  const items: DiscoveredDocument[] = [];
  for (const fragment of records) {
    const html = fragment
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .trim();
    const $ = load(`<ul>${html}</ul>`);
    const link = $('a[href]').first();
    const href = link.attr('href');
    if (!href) {
      throw new AdapterParseError('DOM_MISMATCH', 'jpage 记录缺少详情链接');
    }
    const title = (link.attr('title') ?? link.text()).trim();
    if (!title) {
      throw new AdapterParseError('DOM_MISMATCH', 'jpage 记录缺少标题');
    }
    items.push({
      title,
      publishedAt: extractDate(
        $('span.bt-right').first().text(),
        'jpage 列表日期',
      ),
      url: resolveUrl(baseUrl, href),
      kind: classifyDocumentKind(title),
    });
  }
  return items;
}

/**
 * 首屏已含前 N 条记录；后续按官方总量/总页数补 startrecord 页 URL。
 * 只在含 <nextgroup> 的首屏上生成，dataproxy 响应不会递归生成。
 * 官方总页数超过预算时显式失败，不静默截断。
 */
export function jpageDataproxyPages(
  baseUrl: string,
  content: string,
  maxPages = 20,
): string[] {
  const nextgroup = content.match(
    /<nextgroup>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/nextgroup>/,
  );
  if (!nextgroup) return [];
  // 官网 jpage 配置：totalRecord:227 / perPage:15 / groupSize:3；
  // 部分站点把总量放在 <totalrecord> 里，这里两种形态都兼容。
  const totalRecord = Number(
    content.match(/totalRecord\s*:\s*(\d+)/i)?.[1] ??
      content.match(/<totalrecord>(\d+)<\/totalrecord>/)?.[1],
  );
  const perPage = Number(
    content.match(/perPage\s*:\s*(\d+)/i)?.[1] ??
      content.match(/<perpage>(\d+)<\/perpage>/)?.[1],
  );
  const embedded = (content.match(/<record>/g) ?? []).length;
  if (!Number.isSafeInteger(totalRecord) || totalRecord <= 0) {
    throw new AdapterParseError('DOM_MISMATCH', 'jpage 列表缺少有效总量');
  }
  if (!Number.isSafeInteger(perPage) || perPage <= 0) {
    throw new AdapterParseError('DOM_MISMATCH', 'jpage 列表缺少有效每页条数');
  }
  const totalPage = Math.ceil(totalRecord / perPage);
  if (totalPage > maxPages) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `jpage 分页超出预算（${totalPage} > ${maxPages}），需调整检查范围`,
    );
  }
  const href = nextgroup[1].match(/href="([^"]*dataproxy\.jsp[^"]*)"/)?.[1];
  if (!href) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      'jpage 首屏未找到 dataproxy 基础地址',
    );
  }
  const base = resolveUrl(
    baseUrl,
    href.replace(/&amp;/g, '&'),
  );
  // 官网每页条数来自 jpage 配置（泰安 227/15 → 16 页），首屏已含前 45 条（3 页）。
  const urls: string[] = [];
  for (
    let start = embedded + 1;
    start <= totalRecord && urls.length < maxPages;
    start += perPage
  ) {
    const pageUrl = new URL(base);
    pageUrl.searchParams.delete('page');
    pageUrl.searchParams.set('startrecord', String(start));
    pageUrl.searchParams.set(
      'endrecord',
      String(Math.min(start + perPage - 1, totalRecord)),
    );
    pageUrl.searchParams.set('perpage', String(perPage));
    urls.push(pageUrl.href);
  }
  return urls;
}
