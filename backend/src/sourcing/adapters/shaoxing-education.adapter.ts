/**
 * 绍兴市教育局官方站点 Adapter（v7.2 / S5）。
 *
 * 定位：绍兴市教育局「教师招聘」专栏（/col/col1489173/）。
 * 实测结构：栏目外壳页声明 jpaas 公开动态列表接口，接口返回
 * `.page-content li > a[title]` + `span.bt-data-time`（日期带方括号）。
 * 正文页使用官方 meta（ArticleTitle/PubDate）+ `#zoom` 容器，
 * 附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 约定同其他来源：只读快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/shaoxing/
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
export const SHAOXING_ADAPTER_KEY = 'shaoxing-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class ShaoxingEducationAdapter implements OfficialSiteAdapter {
  readonly key = SHAOXING_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    // 真实官网返回的是公开动态接口 JSON
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'shaoxing');
    }
    // 静态外壳页（无接口声明）按 li 列表兜底，结构不符即失败
    const $ = load(input.content);
    const rows = $('.page-content li').has('a[href]');
    if (!rows.length) {
      throw mismatch(
        '绍兴列表页未找到 .page-content li>a[href] 容器，页面结构可能已改版',
      );
    }
    const items: DiscoveredDocument[] = [];
    rows.each((_index, element) => {
      const link = $(element).find('a[href]').first();
      const href = link.attr('href');
      if (!href)
        throw mismatch('绍兴列表条目缺少 href 链接，页面结构可能已改版');
      const title = (link.attr('title') ?? link.text()).trim();
      if (!title) throw mismatch('绍兴列表条目缺少标题');
      const date =
        $(element).find('span.bt-data-time').text() ||
        $(element).find('span').text();
      items.push({
        title,
        publishedAt: extractDate(date, '绍兴列表 span.bt-data-time'),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch('绍兴列表页内没有任何条目（静默 0 条视为故障）');
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('绍兴正文页解析失败，页面结构可能已改版');
    }
  }
}
