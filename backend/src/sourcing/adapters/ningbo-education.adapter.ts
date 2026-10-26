/**
 * 宁波来源官方站点 Adapter（v7.2 工作包 3）。
 *
 * 定位：宁波市教育局通知公告栏目（列表页 → 公告正文页）。
 * 宁波站列表为 table 结构，与杭州 ul 结构不同，选择器不可复用。
 * 约定同杭州：只读快照、不联网、不写库、不抽取资格结论，
 * DOM 骨架失配抛 `AdapterParseError('DOM_MISMATCH')`，绝不静默返回 0 条。
 *
 * 关联黄金样本：tests/fixtures/golden-sources/ningbo/{list,detail}.html
 */
import { load } from 'cheerio';
import { discoverPublicColumn, locatePublicArticle } from '../public-column.js';
import {
  AdapterParseError,
  classifyDocumentKind,
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

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const NINGBO_ADAPTER_KEY = 'ningbo-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class NingboEducationAdapter implements OfficialSiteAdapter {
  readonly key = NINGBO_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{'))
      return discoverPublicColumn(input.url, input.content, 'ningbo');
    const $ = load(input.content);
    const container = $('table.news-table');
    if (container.length === 0) {
      throw mismatch(
        '宁波列表页未找到 table.news-table 容器，页面结构可能已改版',
      );
    }
    const items: DiscoveredDocument[] = [];
    container.find('tr.news-row').each((_index, row) => {
      const titleCell = $(row).find('td.news-title').first();
      const link = titleCell.find('a[href]').first();
      const dateCell = $(row).find('td.news-date').first();
      const href = link.attr('href');
      if (titleCell.length === 0 || link.length === 0 || !href) {
        throw mismatch(
          '宁波列表行缺少 td.news-title > a[href] 链接，页面结构可能已改版',
        );
      }
      if (dateCell.length === 0) {
        throw mismatch('宁波列表行缺少 td.news-date 节点，页面结构可能已改版');
      }
      const title = stripTags(link.html() ?? '');
      items.push({
        title,
        publishedAt: extractDate(
          stripTags(dateCell.html() ?? ''),
          '列表行 td.news-date',
        ),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch(
        '宁波列表页 table.news-table 内没有任何行（静默 0 条视为故障）',
      );
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const article = locatePublicArticle(input.url, input.content);
    if (article) return article;
    const $ = load(input.content);
    const titleNode = $('h2.xl_title').first();
    const infoNode = $('div.xl_info').first();
    const bodyNode = $('div.xl_con').first();
    if (
      titleNode.length === 0 ||
      infoNode.length === 0 ||
      bodyNode.length === 0
    ) {
      throw mismatch(
        '宁波正文页缺少 .xl_title/.xl_info/.xl_con，页面结构可能已改版',
      );
    }
    const attachments: LocatedAttachment[] = [];
    const attachContainer = $('div.xl_fj');
    if (attachContainer.length > 0) {
      attachContainer.find('a[href]').each((_index, element) => {
        const name = stripTags($(element).html() ?? '');
        const href = $(element).attr('href');
        if (name && href) {
          attachments.push({ name, url: resolveUrl(input.url, href) });
        }
      });
    }
    return {
      canonicalUrl: normalizeUrl(resolveUrl(input.url, input.url)),
      title: stripTags(titleNode.html() ?? ''),
      publishedAt: extractDate(
        stripTags(infoNode.html() ?? ''),
        '正文页 .xl_info',
      ),
      bodyText: stripTags(bodyNode.html() ?? ''),
      attachments,
    };
  }
}
