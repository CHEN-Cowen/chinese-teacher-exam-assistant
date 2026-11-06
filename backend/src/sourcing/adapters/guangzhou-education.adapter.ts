/**
 * 广州市教育局官方站点 Adapter（N3 跨省扩源，广东省首个来源；NFCMS 集约化平台族）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「网上公示」/yw/wsgs/ 与「通知公告」/yw/tzgg/ 均为服务端渲染列表：
 *   `div.news_list ul li > a[href][title]` + 同级 `<span> [YYYY-MM-DD]</span>`；
 *   网上公示招聘密度高（首屏 7/20、第 2 页 14/20，均为公开招聘教师/优才计划
 *   拟聘用人员公示），通知公告为宽口径混合栏目；
 * - 分页为静态锚点 `index_<n>.html`（网上公示 20 页、每页 20 条），页面内
 *   `createPageHTML('page_div',3,1,'list','shtml',60)` 声明已失效（`list_2.shtml`
 *   实测 404），因此分页改由 `nfcmsIndexPages` 从 `a.last` / 数字页码锚点派生；
 * - 详情页 GET HTML（/yw/wsgs/content/post_<id>.html）：标题/日期在官方 meta
 *   （ArticleTitle/PubDate），正文在 `div#zoomcon`（class=content_article，内嵌
 *   嵌套 html 片段），附件在 `/attachment/<…>/<id>.xlsx|pdf`（同域绝对路径，
 *   锚点文本即附件名）。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/guangzhou-education/
 */
import { load } from 'cheerio';
import {
  AdapterParseError,
  normalizeUrl,
  stripTags,
  extractDate,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type LocatedArticle,
  type LocatedAttachment,
  type ListPageSnapshot,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';
import { discoverStaticAnchorList } from '../public-column.js';
import { nfcmsIndexPages } from '../nfcms-list.js';

export const GUANGZHOU_ADAPTER_KEY = 'guangzhou-education';

/** 详情路径：/yw/<栏目>/content/post_<id>.html */
const GUANGZHOU_DETAIL_PATTERN = /\/content\/post_\d+\.html$/;

const GUANGZHOU_ATTACHMENT_PATTERN =
  /\/attachment\/|\.(pdf|xlsx?|docx?|zip|rar|wps|et)(?:[?#]|$)/i;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class GuangzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = GUANGZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    return discoverStaticAnchorList(
      input.url,
      input.content,
      GUANGZHOU_DETAIL_PATTERN,
      'div.news_list li',
    );
  }

  pages(input: ListPageSnapshot): string[] {
    return nfcmsIndexPages(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const title =
      metaContent($, 'ArticleTitle') ||
      $('h1.content_title').first().text().trim();
    const date =
      metaContent($, 'PubDate') ||
      $('li.date').first().text().replace(/^.*发布时间[:：]\s*/, '').trim();
    const content = $('div#zoomcon, div.content_article').first();
    if (!title || !date || content.length === 0) {
      throw mismatch(
        `广州正文缺少 ArticleTitle/PubDate 或 div#zoomcon 正文容器: url=${input.url}`,
      );
    }
    const bodyHtml = content.html() ?? '';
    if (!stripTags(bodyHtml)) {
      throw mismatch('广州正文 div#zoomcon 容器为空');
    }
    // 附件为同域 /attachment/<…>/<id>.xlsx|pdf，锚点文本即附件名（可能带「附件：」前缀）
    const attachments = new Map<string, LocatedAttachment>();
    content.find('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = new URL(href, input.url).toString();
      if (!GUANGZHOU_ATTACHMENT_PATTERN.test(target)) return;
      const name = $(e).text().trim();
      if (!name) throw mismatch('广州正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '广州正文 PubDate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}

/** 取第一个非空 meta；页尾模板 meta 为空字符串，跳过 */
function metaContent(
  $: ReturnType<typeof load>,
  name: string,
): string | undefined {
  const metas = $('meta').filter(
    (_i, e) => ($(e).attr('name') ?? '').toLowerCase() === name.toLowerCase(),
  );
  let value: string | undefined;
  metas.each((_i, e) => {
    if (value) return;
    const candidate = $(e).attr('content')?.trim();
    if (candidate) value = candidate;
  });
  return value;
}
