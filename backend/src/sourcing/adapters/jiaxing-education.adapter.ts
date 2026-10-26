/**
 * 嘉兴市教育局官方站点 Adapter（v7.2 / S5）。
 *
 * 定位：嘉兴市教育局「人才招聘」专栏（/col/col1569769/）。
 * 实测结构：栏目外壳页声明 jpaas 公开动态列表接口，接口返回
 * `.page-content li.title > div.title > a[title]` + `div.time`（形如 10/15）。
 * 正文页使用官方 meta（ArticleTitle/PubDate）+ `#zoom` 容器，
 * 附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 约定同其他来源：只读快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/jiaxing/
 */
import { load } from 'cheerio';
import {
  discoverPublicColumn,
  locateOfficialArticle,
} from '../public-column.js';
import {
  AdapterParseError,
  classifyDocumentKind,
  extractDate,
  resolveUrl,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const JIAXING_ADAPTER_KEY = 'jiaxing-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class JiaxingEducationAdapter implements OfficialSiteAdapter {
  readonly key = JIAXING_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'jiaxing');
    }
    const $ = load(input.content);
    const rows = $('.page-content li').has('a[href]');
    if (!rows.length) {
      throw mismatch(
        '嘉兴列表页未找到 .page-content li>a[href] 容器，页面结构可能已改版',
      );
    }
    const items: DiscoveredDocument[] = [];
    rows.each((_index, element) => {
      const link = $(element).find('a[href]').first();
      const href = link.attr('href');
      if (!href)
        throw mismatch('嘉兴列表条目缺少 href 链接，页面结构可能已改版');
      const title = (link.attr('title') ?? link.text()).trim();
      if (!title) throw mismatch('嘉兴列表条目缺少标题');
      const date = $(element).find('div.time').text();
      items.push({
        title,
        publishedAt: extractDate(date, '嘉兴列表 div.time'),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch('嘉兴列表页内没有任何条目（静默 0 条视为故障）');
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('嘉兴正文页解析失败，页面结构可能已改版');
    }
  }
}
