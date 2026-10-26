import { load, type CheerioAPI } from 'cheerio';
import {
  AdapterParseError,
  type DiscoveredDocument,
  type LocatedArticle,
  classifyDocumentKind,
  extractDate,
  resolveUrl,
  normalizeUrl,
  stripTags,
} from './official-site-adapter.js';

/**
 * 列表短日期（实测 10/15）需补年份：年份只取自官方文章路径 /art/YYYY/，
 * 路径缺年份即失败，绝不按当前年份或标题年份猜测。
 */
export function extractArticlePathDate(text: string, url: string): string {
  const short = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (short) {
    const year = url.match(/\/art\/(\d{4})\//)?.[1];
    if (!year) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        '列表短日期缺少官方文章路径年份，无法确定完整日期',
      );
    }
    const month = short[1].padStart(2, '0');
    const day = short[2].padStart(2, '0');
    if (
      Number(month) < 1 ||
      Number(month) > 12 ||
      Number(day) < 1 ||
      Number(day) > 31
    ) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        `列表短日期无效: ${text.trim()}`,
      );
    }
    return `${year}-${month}-${day}`;
  }
  return extractDate(text, '公开栏目日期');
}

/**
 * 公开动态栏目列表形态：
 * - ningbo：table，日期在 td.car_time；
 * - yinzhou：li，日期在 span；
 * - shaoxing：li，日期在 span.bt-data-time（带方括号）；
 * - jiaxing：li，日期在 div.time（短格式，年份取自官方文章路径）；
 * - hangzhou：li，日期在 span.suffixContent[origintime]（毫秒时间戳）；
 * - lishui：li，日期在同级 span（方括号包裹的 YYYY-MM-DD）。
 */
export type PublicColumnKind =
  'ningbo' | 'yinzhou' | 'shaoxing' | 'jiaxing' | 'hangzhou' | 'lishui';

/** 只读取官网声明的同源公开列表接口，不执行脚本，不接受任意跨域地址。 */
export function publicColumnRequest(
  baseUrl: string,
  content: string,
): string | null {
  const $ = load(content);
  const script = $('script[querydata][url]')
    .filter((_i, e) =>
      ($(e).attr('src') ?? '').includes('/AuthorizedRead/unitbuild.js'),
    )
    .first();
  if (!script.length) return null;
  const base = new URL(baseUrl);
  const endpoint = new URL(script.attr('url')!, base);
  if (
    endpoint.origin !== base.origin ||
    endpoint.pathname !==
      '/api-gateway/jpaas-publish-server/front/page/build/unit'
  ) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '公开栏目接口必须同源且使用已支持的路径',
    );
  }
  let query: Record<string, unknown>;
  try {
    query = JSON.parse(script.attr('querydata')!.replace(/'/g, '"')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new AdapterParseError('DOM_MISMATCH', '公开栏目 queryData 格式变化');
  }
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new AdapterParseError('DOM_MISMATCH', '公开栏目参数无效');
  const keys = [
    'parseType',
    'webId',
    'tplSetId',
    'pageType',
    'tagId',
    'editType',
    'pageId',
  ];
  for (const key of keys) {
    if (typeof query[key] !== 'string' || !(query[key] as string).trim())
      throw new AdapterParseError('DOM_MISMATCH', `公开栏目缺少 ${key}`);
    endpoint.searchParams.set(key, query[key] as string);
  }
  return endpoint.href;
}

/**
 * 读取官方分页配置。
 *
 * 两种官方形态：
 * 1. DOM 属性（宁波/绍兴/杭州）：分页容器带 count/rows/pageno 属性；
 * 2. 内联 JS（丽水）：`initJpage({ rows: "10", count: "130", pageNo: "1", ... })`。
 *
 * 两者都取不到时返回 null，交给调用方按“该来源无分页”处理。
 */
function readPublicColumnPaging(
  $: CheerioAPI,
): { count: number; size: number; page: number } | null {
  const node = $('table.pagination, div.pagination').first();
  if (node.length) {
    const attr = (...names: string[]) => {
      for (const name of names) {
        const value = node.attr(name);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    const count = Number(attr('count'));
    const size = Number(attr('rows'));
    const page = Number(attr('pageno', 'pageNo'));
    if (
      Number.isSafeInteger(count) &&
      count >= 0 &&
      Number.isSafeInteger(size) &&
      size >= 1 &&
      Number.isSafeInteger(page) &&
      page >= 1
    ) {
      return { count, size, page };
    }
    // 丽水形态：容器存在但不带属性，真实分页参数在官方内联脚本里。
  }
  // 丽水形态：分页配置写在官方内联脚本 initJpage({...}) 中。
  const inline = $('script')
    .map((_i, e) => $(e).text())
    .get()
    .map((text) => text.match(/initJpage\(\s*\{([\s\S]*?)\}\s*\);/))
    .find(Boolean);
  if (!inline) {
    if (node.length)
      throw new AdapterParseError('DOM_MISMATCH', '公开栏目分页参数无效');
    return null;
  }
  const body = inline[1];
  const read = (key: string) =>
    body.match(new RegExp(`${key}\\s*:\\s*["']?(\\d+)`))?.[1];
  const count = Number(read('count'));
  const size = Number(read('rows'));
  const page = Number(read('pageNo'));
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    throw new AdapterParseError('DOM_MISMATCH', '公开栏目分页参数无效');
  }
  return { count, size, page };
}

/** 按官网 pageNew.js 的 paramJson 协议安排后续页，超过预算显式失败。 */
export function publicColumnPages(
  baseUrl: string,
  content: string,
  maxPages = 20,
): string[] {
  if (!content.trimStart().startsWith('{')) return [];
  const $ = load(publicColumnHtml(content));
  const paging = readPublicColumnPaging($);
  if (!paging) return [];
  const { count, size, page } = paging;
  const total = Math.ceil(count / size);
  if (total > maxPages)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '公开栏目分页超出预算，需调整检查范围',
    );
  const requested = new URL(baseUrl).searchParams.get('paramJson');
  if (requested) {
    let requestedPage: unknown;
    try {
      requestedPage = (JSON.parse(requested) as { pageNo?: unknown }).pageNo;
    } catch {
      throw new AdapterParseError('DOM_MISMATCH', '公开栏目请求页码无效');
    }
    if (requestedPage !== page)
      throw new AdapterParseError(
        'DOM_MISMATCH',
        '公开栏目返回页码与请求不一致',
      );
    return [];
  }
  if (page !== 1)
    throw new AdapterParseError('DOM_MISMATCH', '公开栏目初始页码不是第一页');
  const urls: string[] = [];
  for (let next = 2; next <= total; next += 1) {
    const url = new URL(baseUrl);
    url.searchParams.set(
      'paramJson',
      JSON.stringify({ pageNo: next, pageSize: String(size) }),
    );
    urls.push(url.href);
  }
  return urls;
}

export function publicColumnHtml(content: string): string {
  try {
    const data = JSON.parse(content) as {
      success?: boolean;
      data?: { html?: string };
    };
    if (
      data.success !== true ||
      typeof data.data?.html !== 'string' ||
      !data.data.html.trim()
    )
      throw new Error();
    return data.data.html;
  } catch {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '公开栏目接口未返回有效 data.html',
    );
  }
}

/** 实测宁波/鄞州正文共用 #zoom 与官方元数据，缺项不回退全页抓取。 */
export function locatePublicArticle(
  url: string,
  content: string,
): LocatedArticle | null {
  const $ = load(content);
  const body = $('#zoom').first();
  if (!body.length) return null;
  const title = $('meta[name="ArticleTitle"]').attr('content')?.trim();
  const date = $('meta[name="PubDate"]').attr('content');
  if (!title || !date || !body.text().trim())
    throw new AdapterParseError('DOM_MISMATCH', '公开正文缺少标题、日期或正文');
  const attachments = new Map<string, { name: string; url: string }>();
  body.find('a[href]').each((_i, e) => {
    const href = $(e).attr('href')!;
    const target = resolveUrl(url, href);
    if (
      !/\/front\/document\/download\?|\.(pdf|xlsx?|docx?|zip)(?:[?#]|$)/i.test(
        target,
      )
    )
      return;
    const name = $(e).text().trim();
    if (!name)
      throw new AdapterParseError('DOM_MISMATCH', '公开正文附件缺少名称');
    attachments.set(target, { name, url: target });
  });
  return {
    canonicalUrl: normalizeUrl(url),
    title,
    publishedAt: extractDate(date, '公开正文 PubDate'),
    bodyText: stripTags(body.html() ?? ''),
    attachments: [...attachments.values()],
  };
}

/** 正文容器候选顺序：#zoom 为主，实测嘉兴/绍兴亦同，苏州为 .article-content，常州为 .NewsText。 */
const ARTICLE_BODY_SELECTORS = [
  '#zoom',
  '.article-content',
  '.NewsText',
  '.bt_content',
  '.art_con',
] as const;

/**
 * 定位公开正文：复 #zoom 元数据协议，正文容器缺 #zoom 时按官方容器回退。
 * 官方元数据（ArticleTitle/PubDate/ContentSource）缺失即失败，不退回整页抓取。
 */
export function locateOfficialArticle(
  url: string,
  content: string,
): LocatedArticle {
  const $ = load(content);
  let body = $();
  for (const selector of ARTICLE_BODY_SELECTORS) {
    const node = $(selector).first();
    if (node.length) {
      body = node;
      break;
    }
  }
  const title = $('meta[name="ArticleTitle"]').attr('content')?.trim();
  const date = $('meta[name="PubDate"]').attr('content');
  if (!body.length)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '公开正文未找到容器（#zoom/.article-content/.NewsText/.bt_content/.art_con）',
    );
  if (!title || !date || !body.text().trim())
    throw new AdapterParseError('DOM_MISMATCH', '公开正文缺少标题、日期或正文');
  const attachments = new Map<string, { name: string; url: string }>();
  body.find('a[href]').each((_i, e) => {
    const href = $(e).attr('href')!;
    const target = resolveUrl(url, href);
    if (
      !/\/front\/document\/download\?|\.(pdf|xlsx?|docx?|zip)(?:[?#]|$)/i.test(
        target,
      )
    )
      return;
    const name = $(e).text().trim();
    if (!name)
      throw new AdapterParseError('DOM_MISMATCH', '公开正文附件缺少名称');
    attachments.set(target, { name, url: target });
  });
  return {
    canonicalUrl: normalizeUrl(url),
    title,
    publishedAt: extractDate(date, '公开正文 PubDate'),
    bodyText: stripTags(body.html() ?? ''),
    attachments: [...attachments.values()],
  };
}

/**
 * 杭州列表用 <span class="suffixContent" origintime="1779902244615"> 表示发布时间。
 * 优先取同条目的可读日期文本；缺失时才用毫秒时间戳换算。
 * 两者都没有即失败，绝不按当前时间兜底。
 */
export function extractOrigintimeDate(
  raw: string | undefined,
  readable?: string,
): string {
  const text = (readable ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!raw || !/^\d{10,13}$/.test(raw.trim())) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '列表缺少官方日期文本与 origintime 时间戳，无法确定完整日期',
    );
  }
  const ms = Number(raw.trim());
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new AdapterParseError(
      'DOM_MISMATCH',
      `origintime 时间戳无效: ${raw}`,
    );
  }
  return date.toISOString().slice(0, 10);
}

/**
 * 杭州列表条目的可读日期：li 同级 <span>YYYY-MM-DD</span>。
 * 排除 span.suffixContent（内含 origintime 时间戳与图标，不是日期文本）。
 * 同级没有日期 span 时，条目自身文本里也可能带 YYYY-MM-DD。
 */
function readableListDate($: CheerioAPI, element: unknown): string {
  const node = $(element as never);
  const own = node
    .children('span')
    .filter((_j, s) => !($(s).attr('class') ?? '').includes('suffixContent'))
    .first()
    .text()
    .trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(own)) return own;
  const text = node.text().trim();
  const matched = text.match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : own;
}

/** 官网真实动态列表有独立选择器，构造测试样本仍走原适配器。 */
export function discoverPublicColumn(
  baseUrl: string,
  content: string,
  kind: PublicColumnKind,
): DiscoveredDocument[] {
  const $ = load(publicColumnHtml(content));
  // 丽水有两种官方单元：
  // - 文字列表页app：tbody.page-content > tr > td > a[title] + 日期 td；
  // - 当前栏目的ajax分页：div.page-content > li > a + span（日期带方括号）。
  const rows =
    kind === 'ningbo'
      ? $('.page-content tr').has('td.car_tl a[href]')
      : kind === 'lishui'
        ? $('.page-content tr').has('a[href]')
        : $('.page-content li').has('a[href]');
  const items: DiscoveredDocument[] = [];
  rows.each((_i, e) => {
    const link = $(e).find('a[href]').first();
    const title = (link.attr('title') ?? link.text()).trim();
    if (!title) throw new AdapterParseError('DOM_MISMATCH', '公开栏目缺少标题');
    const href = link.attr('href');
    if (!href) throw new AdapterParseError('DOM_MISMATCH', '公开栏目缺少链接');
    const url = resolveUrl(baseUrl, href);
    let publishedAt: string;
    if (kind === 'hangzhou') {
      // 杭州条目日期是 li 的同级 <span>YYYY-MM-DD</span>；
      // span.suffixContent[origintime]（毫秒时间戳）作为备用日期来源。
      publishedAt = extractOrigintimeDate(
        $(e).find('span.suffixContent').first().attr('origintime'),
        readableListDate($, e),
      );
    } else if (kind === 'lishui') {
      // 丽水两种单元的日期都在同级的 span / 独立日期单元格内，
      // 方括号包裹（如 [2026-09-23]）由 extractDate 提取 YYYY-MM-DD。
      publishedAt = extractDate(lishuiRowDate($, e), '丽水公开栏目日期');
    } else {
      const date =
        kind === 'ningbo'
          ? $(e).find('td.car_time').text()
          : kind === 'shaoxing'
            ? // 绍兴日期在 span.bt-data-time 内且带方括号
              $(e).find('span.bt-data-time').text()
            : kind === 'jiaxing'
              ? // 嘉兴日期在 div.time 内，形如 10/15，年份取自官方文章路径
                $(e).find('div.time').text()
              : $(e).find('span').text();
      publishedAt = extractArticlePathDate(date, url);
    }
    items.push({
      title,
      publishedAt,
      url,
      kind: classifyDocumentKind(title),
    });
  });
  if (!items.length)
    throw new AdapterParseError('DOM_MISMATCH', '公开栏目返回空列表或结构变化');
  return items;
}

/**
 * 丽水条目日期：
 * - 表格单元：独立日期单元格（如 <td class="list-Con3">[2026-09-23]</td>）；
 * - ajax 分页单元：同级 <span>[2026-09-23]</span>。
 */
function lishuiRowDate($: CheerioAPI, element: unknown): string {
  const node = $(element as never);
  const cell = node
    .find('td')
    .map((_j, td) => $(td).text().trim())
    .get()
    .find((text) => /\d{4}-\d{2}-\d{2}/.test(text));
  if (cell) return cell;
  const span = node
    .find('span')
    .map((_j, s) => $(s).text().trim())
    .get()
    .find((text) => /\d{4}-\d{2}-\d{2}/.test(text));
  if (span) return span;
  return node.text().trim();
}

/** 苏州等静态列表页：li h4>a[title]+span.time，分页为 <prefix>_<n>.shtml。 */
export function discoverStaticList(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const $ = load(content);
  const rows = $('.listContent li').has('h4 a[href]');
  if (!rows.length)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '静态列表页未找到 .listContent li>h4>a[href] 结构',
    );
  const items: DiscoveredDocument[] = [];
  rows.each((_i, e) => {
    const link = $(e).find('h4 a[href]').first();
    const title = (link.attr('title') ?? link.text()).trim();
    const date = $(e).find('span.time').text().trim();
    if (!title)
      throw new AdapterParseError('DOM_MISMATCH', '静态列表条目缺少标题');
    items.push({
      title,
      publishedAt: extractDate(date, '静态列表日期'),
      url: resolveUrl(baseUrl, link.attr('href')!),
      kind: classifyDocumentKind(title),
    });
  });
  if (!items.length)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '静态列表页无任何条目（静默 0 条视为故障）',
    );
  return items;
}

/**
 * 常州市教育局「教师招考」栏目：服务端渲染的静态表格列表。
 * 实测结构：table.border > tr > td（a[title]）+ 相邻 td（日期 YYYY-MM-DD）。
 * 同一 table 内没有日期单元格的行视为结构变化，绝不静默丢弃。
 */
export function discoverColumnTable(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const $ = load(content);
  const rows = $('table.border tr').has('a[href]');
  if (!rows.length)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '栏目表格列表未找到 table.border tr > a[href] 结构',
    );
  const items: DiscoveredDocument[] = [];
  rows.each((_i, e) => {
    const link = $(e).find('a[href]').first();
    const title = (link.attr('title') ?? link.text()).trim();
    if (!title)
      throw new AdapterParseError('DOM_MISMATCH', '栏目表格条目缺少标题');
    const cells = $(e).find('td');
    const date = cells
      .map((_j, td) => $(td).text().trim())
      .get()
      .find((text) => /^\d{4}-\d{2}-\d{2}$/.test(text));
    if (!date)
      throw new AdapterParseError('DOM_MISMATCH', '栏目表格条目缺少发布日期');
    items.push({
      title,
      publishedAt: extractDate(date, '栏目表格日期'),
      url: resolveUrl(baseUrl, link.attr('href')!),
      kind: classifyDocumentKind(title),
    });
  });
  if (!items.length)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '栏目表格列表无任何条目（静默 0 条视为故障）',
    );
  return items;
}

/**
 * 常州官方 FX_PageDiv 分页：总数/总页数在服务端渲染的 class 里，
 * 后续页为 <栏目路径>/<页码>（如 /class/QFJEPCBL/2）。
 */
export function columnTablePages(
  baseUrl: string,
  content: string,
  maxPages = 20,
): string[] {
  const $ = load(content);
  // 官方 FX_PageDiv 分页：总页数在 <span class="Fx_PageDiv2_1_3">N</span> 页
  const totalText = $('span[class*="ageDiv2_1_3"]').first().text().trim();
  if (!totalText) return [];
  const total = Number(totalText);
  if (!Number.isSafeInteger(total) || total < 1)
    throw new AdapterParseError('DOM_MISMATCH', '栏目表格分页参数无效');
  if (total > maxPages)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '栏目表格分页超出预算，需调整检查范围',
    );
  const urls: string[] = [];
  // 官方后续页形如 <栏目路径>/<页码>（/class/QFJEPCBL/2），页码直接追加到路径末尾。
  for (let next = 2; next <= total; next += 1) {
    urls.push(`${baseUrl.replace(/\/+$/, '')}/${next}`);
  }
  return urls;
}

/** 静态列表分页 URL：保持域与路径，替换 _<n> 序号；其余不变。 */
export function staticListPages(
  baseUrl: string,
  content: string,
  maxPages = 20,
): string[] {
  const $ = load(content);
  const calls = $('script')
    .map((_i, e) => $(e).text())
    .get()
    .map((text) =>
      text.match(/createPageHTML\(\s*['"][^'"]+['"]\s*,\s*(\d+)\s*,\s*(\d+)/),
    )
    .find(Boolean);
  if (!calls) return [];
  const total = Number(calls[1]);
  if (!Number.isSafeInteger(total) || total < 1)
    throw new AdapterParseError('DOM_MISMATCH', '静态列表分页参数无效');
  if (total > maxPages)
    throw new AdapterParseError(
      'DOM_MISMATCH',
      '静态列表分页超出预算，需调整检查范围',
    );
  const url = new URL(baseUrl);
  const urls: string[] = [];
  for (let next = 2; next <= total; next += 1) {
    const page = new URL(url.href);
    page.pathname = url.pathname.replace(/(\.shtml)?$/, `_${next}.shtml`);
    urls.push(page.href);
  }
  return urls;
}
