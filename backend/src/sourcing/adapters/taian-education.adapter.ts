/**
 * 泰安市教育局官方站点 Adapter（N2 jpage POST 分页族）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「公示公告」栏目 https://jyj.taian.gov.cn/col/col45480/index.html；
 * - 首屏 HTML 内嵌 <datastore>（45 条，含总量 227 / 总页 16）与 dataproxy 基础地址；
 * - 后续页必须 POST startrecord/endrecord/perpage 到
 *   /module/web/jpage/dataproxy.jsp，响应为 <datastore><record><![CDATA[<li>…]]>；
 * - 条目结构 li > a[href][title] + span.bt-right（YYYY-MM-DD）；
 * - 正文页无 #zoom：标题/日期在官方 meta（ArticleTitle/pubdate，注意 pubdate 小写），
 *   正文在 ZJEG_RSS ContentStart/ContentEnd 标记之间；
 * - 附件走 /module/download/downfile.jsp?classid=0&filename=…；
 * - 栏目含教师招聘、资格认定、普通话等混合公告，按标题判定形态。
 *
 * 关联真实样本：tests/fixtures/golden-sources/taian/
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
import { discoverJpageRecords, jpageDataproxyPages } from '../jpage-list.js';

export const TAIAN_ADAPTER_KEY = 'taian-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

function metaContent(content: string, name: string): string | undefined {
  const $ = load(content);
  const metas = $('meta').filter(
    (_i, e) =>
      ($(e).attr('name') ?? '').toLowerCase() === name.toLowerCase(),
  );
  const value = metas.first().attr('content')?.trim();
  return value || undefined;
}

export class TaianEducationAdapter implements OfficialSiteAdapter {
  readonly key = TAIAN_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    return discoverJpageRecords(input.url, input.content);
  }

  pages(input: ListPageSnapshot): string[] {
    return jpageDataproxyPages(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const title = metaContent(input.content, 'ArticleTitle');
    const date = metaContent(input.content, 'pubdate');
    const start = input.content.search(
      /<meta[^>]+name=["']ContentStart["']/i,
    );
    const end = input.content.search(/<meta[^>]+name=["']ContentEnd["']/i);
    if (!title || !date || start < 0 || end <= start) {
      throw mismatch('泰安正文缺少标题、日期或 ContentStart/ContentEnd 正文范围');
    }
    const startTagEnd = input.content.indexOf('>', start) + 1;
    const bodyHtml = input.content.slice(startTagEnd, end);
    if (!stripTags(bodyHtml)) {
      throw mismatch('泰安正文 ContentStart/ContentEnd 之间为空');
    }
    const $ = load(`<div id="body">${bodyHtml}</div>`);
    const attachments = new Map<string, LocatedAttachment>();
    $('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = new URL(href, input.url).toString();
      if (
        !/\/module\/download\/downfile\.jsp\?|\/download\?|\.(pdf|xlsx?|docx?|zip|wps|et)(?:[?#]|$)/i.test(
          target,
        )
      )
        return;
      const name = $(e).text().trim();
      if (!name) throw mismatch('泰安正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '泰安正文 pubdate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}
