/**
 * 长沙市教育局「教师招聘」栏目 Adapter（N3 跨省扩源，湖南省首个来源）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 独立「教师招聘」栏目 /zfxxgk/fdzdgk/jszp/index.html（政务公开 > 法定主动公开内容），
 *   服务端渲染 `div.xxgk-item ul li > a[href] > a[title] + span(YYYY-MM-DD)`，
 *   首屏 15 条；栏目为纯教师招聘栏目（招聘公告/拟聘用名单/体检通知等），
 *   仍按标题判定文档类型；
 * - 分页由官方 `wcmUtil.createPageHTML5("8", "0", "index", "html")` 声明
 *   （总 8 页 / 每页 15 条），由 `wcm5Pages` 派生 index_1.html…index_7.html；
 * - **官方整站仅 HTTP**：HTTPS 握手失败（SSL alert 40），HTTP 200，
 *   已在 `HTTP_ONLY_HOSTS` 显式登记；
 * - 详情页 /<栏目>/<YYYYMM>/t<YYYYMMDD>_<id>.html：meta 名带前后空格
 *   （`name=" ArticleTitle "`、`name=" Pubdate "`），取值前必须 trim；
 *   正文容器 `div.content-main`（内层 `.trs_editor_view`，无 #zoom）；
 *   附件为正文内 `./P0<数字>.xlsx|docx|pdf`（TRS WCM 命名，锚点文本含附件名），
 *   同时存在零附件条目。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/changsha-education/
 */
import { load } from 'cheerio';
import { discoverWcm5Records } from '../wcm5-list.js';
import {
  AdapterParseError,
  extractDate,
  normalizeUrl,
  resolveUrl,
  stripTags,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type LocatedAttachment,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

export const CHANGSHA_ADAPTER_KEY = 'changsha-education';

/** 正文内附件：TRS WCM 发布的 ./P0<数字>.<ext> 相对路径 */
const CHANGSHA_ATTACHMENT_PATTERN =
  /\/P\d{10,}\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

/** 官方 meta 名带前后空格，必须 trim 后按名称大小写不敏感匹配 */
function metaContent(
  $: ReturnType<typeof load>,
  names: readonly string[],
): string | undefined {
  let value: string | undefined;
  $('meta').each((_i, e) => {
    if (value) return;
    const name = ($(e).attr('name') ?? '').trim().toLowerCase();
    if (!names.some((target) => target.toLowerCase() === name)) return;
    const candidate = $(e).attr('content')?.trim();
    if (candidate) value = candidate;
  });
  return value;
}

export class ChangshaEducationAdapter implements OfficialSiteAdapter {
  readonly key = CHANGSHA_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('长沙教师招聘栏目为静态列表，不应返回公开接口 JSON');
    }
    // 栏目列表为 div.xxgk-item 内的 ul li，条目为嵌套 <a>（解析器扁平化后
    // 外层锚点无标题），族解析函数优先取带 title 的锚点
    return discoverWcm5Records(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const title = metaContent($, ['ArticleTitle']);
    const date = metaContent($, ['Pubdate', 'PubDate']);
    const body = $('div.content-main').first();
    if (!title || !date || body.length === 0) {
      throw mismatch(
        `长沙正文缺少 ArticleTitle/Pubdate meta 或 div.content-main 正文容器: url=${input.url}`,
      );
    }
    const bodyHtml = body.html() ?? '';
    if (!stripTags(bodyHtml)) throw mismatch('长沙正文 div.content-main 容器为空');
    const attachments = new Map<string, LocatedAttachment>();
    body.find('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = resolveUrl(input.url, href);
      if (!CHANGSHA_ATTACHMENT_PATTERN.test(target)) return;
      const name = $(e).text().replace(/\s+/g, ' ').trim();
      if (!name) throw mismatch('长沙正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '长沙正文 Pubdate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}
