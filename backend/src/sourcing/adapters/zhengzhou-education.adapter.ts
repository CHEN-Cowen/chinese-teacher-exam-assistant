/**
 * 郑州市教育局「通知公告」混合栏目 Adapter（N3 跨省扩源，河南省首个来源；同时引入 .jhtml 新族）。
 *
 * 定位：郑州市教育局「通知公告」混合栏目
 * （http://news.zzedu.net.cn/tz/）。
 *
 * 真实官网形态（2026-11-06 核验）：
 * - 混合栏目：既含学校活动通知、普通话水平测试，也含教师招聘/事业单位拟聘用公示。
 * - **两种详情域名并存**：
 *   1. 老站静态页 .shtml：`http://news.zzedu.net.cn/tz/<月>/<ID>.shtml`
 *      正文容器 `div#article`，meta 用 `SourceTitle`（非 ArticleTitle）。
 *   2. 新政务域名 .jhtml：`https://zzjy.zhengzhou.gov.cn/tzgg/<ID>.jhtml`
 *      标准河南省教育厅模板：meta 含 ArticleTitle/PubDate/ContentSource，
 *      正文容器 `div.news_content_content`（locateOfficialArticle 的选择器不覆盖）。
 * - 列表 DOM：`ul#pageCont > li > div.sx_mainL_zi > div.bt.font_yahei >
 *   a.new_link[title] + p > span`（span 内日期 `M月D日`，补当年年份）。
 * - 分页：`pageTotal=7`，但分页为 JS 按钮"加载更多"（bfreeTools.js），
 *   不走静态文件 URL；适配器首版**只抓首屏 20 条**，分页后续加 helper。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/zhengzhou-education/
 */
import { load } from 'cheerio';
import {
  classifyDocumentKind,
  extractDate,
  normalizeUrl,
  resolveUrl,
  stripTags,
} from '../official-site-adapter.js';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

export const ZHENGZHOU_ADAPTER_KEY = 'zhengzhou-education';

/** 详情 URL：老站 shtml（news.zzedu.net.cn）或新政务 jhtml（zzjy.zhengzhou.gov.cn）。 */
const ZHENGZHOU_DETAIL_PATTERN =
  /news\.zzedu\.net\.cn\/tz\/\d{1,2}\/\d+\.shtml(?:[?#]|$)|zzjy\.zhengzhou\.gov\.cn\/tzgg\/\d+\.jhtml(?:[?#]|$)/i;

const ZHENGZHOU_JHTML_HOST = 'zzjy.zhengzhou.gov.cn';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

/**
 * 郑州通知公告列表：ul#pageCont > li > div.sx_mainL_zi > a.new_link 是真实公告条目。
 * 日期在 p 内、紧跟 span.listPage_shareButton，格式 `M月D日`（如 "10月29日"），补当年年份。
 * 选择器必须用 .new_link 锚定，因为 li 内有两个 a（缩略图 a + 标题 a），
 * 缩略图 a 没有 title 属性且 href 指向同详情但标题 a 才是规范入口。
 */
function discoverZhengzhouList(
  baseUrl: string,
  content: string,
): DiscoveredDocument[] {
  const $ = load(content);
  // 直接选 .new_link，避免被 li 内其他 a（缩略图）或非公告 li 干扰
  const links = $('ul#pageCont a.new_link[href]');
  if (!links.length)
    throw mismatch('郑州通知公告未找到 ul#pageCont a.new_link 结构');
  const items: DiscoveredDocument[] = [];
  const seen = new Set<string>();
  const currentYear = new Date().getFullYear();
  links.each((_i, e) => {
    const link = $(e);
    const href = link.attr('href');
    const title = (link.attr('title') ?? link.text()).trim();
    if (!href || !title)
      throw mismatch('郑州列表条目缺少链接或标题');
    const url = normalizeUrl(resolveUrl(baseUrl, href));
    if (!ZHENGZHOU_DETAIL_PATTERN.test(url)) return;
    if (seen.has(url)) return;
    // 日期：从 .new_link 向上找 li，再找 p 的直接子文本（span 之后）
    const li = link.closest('li');
    const pText = li.find('.sx_mainL_zi > p').text();
    const md = pText.match(/(\d{1,2})月(\d{1,2})日/);
    if (!md)
      throw mismatch(`郑州列表条目日期不是 M月D日 格式: ${pText}`);
    const month = md[1].padStart(2, '0');
    const day = md[2].padStart(2, '0');
    const publishedAt = `${currentYear}-${month}-${day}`;
    seen.add(url);
    items.push({
      title,
      publishedAt,
      url,
      kind: classifyDocumentKind(title),
    });
  });
  if (!items.length)
    throw mismatch('郑州列表无任何条目（静默 0 条视为故障）');
  return items;
}

/**
 * jhtml 详情（zzjy.zhengzhou.gov.cn）：新政务域名模板。
 * meta 协议标准（ArticleTitle/PubDate/ContentSource），但正文容器是
 * div.news_content_content（locateOfficialArticle 的 ARTICLE_BODY_SELECTORS 不覆盖）。
 */
function locateJhtmlArticle(input: ArticlePageSnapshot): LocatedArticle {
  const $ = load(input.content);
  const body = $('div.news_content_content').first();
  if (!body.length)
    throw mismatch('郑州 jhtml 正文未找到 div.news_content_content 容器');
  const title = $('meta[name="ArticleTitle"]').attr('content')?.trim();
  const dateText = $('meta[name="PubDate"]').attr('content');
  if (!title || !dateText)
    throw mismatch(`郑州 jhtml 正文缺少 ArticleTitle 或 PubDate meta: url=${input.url}`);
  // 附件：正文容器内 a + 外部 .news_content_attachments a
  const attachments = new Map<string, { name: string; url: string }>();
  const anchors: any[] = body.find('a[href]').toArray();
  $('.news_content_attachments a[href]').each((_i, e) => {
    anchors.push(e as never);
  });
  for (const anchor of anchors) {
    const href = $(anchor).attr('href')!;
    const target = resolveUrl(input.url, href);
    if (!/\/download\?|\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i.test(target)) continue;
    const name = $(anchor).text().trim();
    if (!name) continue;
    attachments.set(target, { name, url: target });
  }
  return {
    canonicalUrl: normalizeUrl(input.url),
    title,
    publishedAt: extractDate(dateText, '郑州 jhtml PubDate'),
    bodyText: stripTags(body.html() ?? ''),
    attachments: [...attachments.values()],
  };
}

/**
 * shtml 详情（news.zzedu.net.cn）：正文容器 div#article + title/SourceTitle 取标题；
 * 无显式 PubDate meta，从正文容器里匹配 YYYY-MM-DD。
 */
function locateShtmlArticle(input: ArticlePageSnapshot): LocatedArticle {
  const $ = load(input.content);
  const body = $('#article');
  if (!body.length)
    throw mismatch('郑州 shtml 正文未找到 div#article 容器');
  const title =
    $('meta[name="SourceTitle"]').attr('content')?.trim() ||
    $('title').text().trim().replace(/\s*[-_|].*$/, '').trim();
  const dateText =
    body.text().match(/\d{4}-\d{2}-\d{2}/)?.[0] ||
    input.content.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!title || !dateText)
    throw mismatch(`郑州 shtml 正文缺少标题或发布日期: url=${input.url}`);
  // 附件
  const attachments = new Map<string, { name: string; url: string }>();
  body.find('a[href]').each((_i, e) => {
    const href = $(e).attr('href')!;
    const target = resolveUrl(input.url, href);
    if (
      !/\/download\?|\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i.test(target)
    )
      return;
    const name = $(e).text().trim();
    if (!name) return;
    attachments.set(target, { name, url: target });
  });
  return {
    canonicalUrl: normalizeUrl(input.url),
    title,
    publishedAt: extractDate(dateText, '郑州 shtml 正文日期'),
    bodyText: stripTags(body.html() ?? ''),
    attachments: [...attachments.values()],
  };
}

export class ZhengzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = ZHENGZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('郑州通知公告为静态列表，不应返回公开接口 JSON');
    }
    return discoverZhengzhouList(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const url = new URL(input.url);
    // 新政务域名 .jhtml：自定义 locateJhtmlArticle（news_content_content 容器，标准 meta）
    if (url.hostname === ZHENGZHOU_JHTML_HOST && /\.jhtml(?:[?#]|$)/i.test(input.url)) {
      return locateJhtmlArticle(input);
    }
    // 老站 .shtml：自定义解析（SourceTitle meta + div#article）
    if (url.hostname.includes('zzedu.net.cn') && /\.shtml(?:[?#]|$)/i.test(input.url)) {
      return locateShtmlArticle(input);
    }
    throw mismatch(`郑州适配器无法识别的详情 URL 形态: ${input.url}`);
  }
}
