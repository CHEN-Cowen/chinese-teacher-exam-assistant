/**
 * 潍坊市教育局官方站点 Adapter（N2 els-service JSON POST 列表族）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「公告公示」栏目列表页为 JS 壳（/jyjlist/?cataId=trs1308521），
 *   记录由 POST /els-service/article/{page}/{size} JSON 接口返回；
 * - 栏目为混合栏目：公开招聘、资格领取、决算、研学基地等，按标题判定形态；
 * - 详情页为 GET HTML：标题/日期在官方 meta（ArticleTitle/PubDate，注意首个
 *   非空 meta 有效，页尾模板 meta 为空），正文在 td#Content；
 * - 附件走 /upload-service/162/55332/WY….xls|docx|xlsx（同域，无需 Referer）。
 *
 * 关联真实样本：tests/fixtures/golden-sources/weifang/
 */
import { load } from 'cheerio';
import {
  AdapterParseError,
  normalizeUrl,
  stripTags,
  extractDate,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type LocatedAttachment,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';
import { discoverElsRecords, elsArticlePages } from '../els-list.js';

export const WEIFANG_ADAPTER_KEY = 'weifang-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class WeifangEducationAdapter implements OfficialSiteAdapter {
  readonly key = WEIFANG_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    return discoverElsRecords(input.url, input.content);
  }

  pages(input: ListPageSnapshot): string[] {
    return elsArticlePages(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const title = metaContent($, 'ArticleTitle');
    const date = metaContent($, 'PubDate');
    const content = $('#Content').first();
    if (!title || !date || content.length === 0) {
      throw mismatch('潍坊正文缺少 meta 标题/日期或 #Content 正文容器');
    }
    const bodyHtml = content.html() ?? '';
    if (!stripTags(bodyHtml)) {
      throw mismatch('潍坊正文 #Content 容器为空');
    }
    // 附件区在正文同表的 td.art > div.appendix（hide_s）内，定位到文章表格
    // 再收集锚点；正文 #Content 缺失时退化为全文检索。
    const articleTable = $('#Content').first().closest('table');
    const scope = articleTable.length ? articleTable : $.root();
    const attachments = new Map<string, LocatedAttachment>();
    scope.find('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = new URL(href, input.url).toString();
      if (
        !/\/upload-service\/|\.(pdf|xlsx?|docx?|zip|wps|et)(?:[?#]|$)/i.test(
          target,
        )
      )
        return;
      const name = $(e).text().trim();
      if (!name) throw mismatch('潍坊正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '潍坊正文 PubDate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}

/** 取第一个非空 meta；潍坊页尾模板 meta 为空字符串，跳过 */
function metaContent(
  $: ReturnType<typeof load>,
  name: string,
): string | undefined {
  const metas = $('meta').filter(
    (_i, e) =>
      ($(e).attr('name') ?? '').toLowerCase() === name.toLowerCase(),
  );
  let value: string | undefined;
  metas.each((_i, e) => {
    if (value) return;
    const candidate = $(e).attr('content')?.trim();
    if (candidate) value = candidate;
  });
  return value;
}
