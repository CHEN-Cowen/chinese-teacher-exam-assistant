/**
 * 鄞州来源官方站点 Adapter（v7.2 工作包 3）。
 *
 * 定位：鄞州区（县区级）政府信息公开栏目（列表页 → 公告正文页）。
 * 县区级来源使用 `#announcement-list` 列表与 `.title-box/.content-box` 正文结构，
 * 与其他来源选择器不同。约定同杭州/宁波：只读快照、不联网、不写库、不抽取资格结论，
 * DOM 骨架失配抛 `AdapterParseError('DOM_MISMATCH')`，绝不静默返回 0 条。
 *
 * 关联黄金样本：tests/fixtures/golden-sources/yinzhou/{list,detail}.html
 */
import { load } from 'cheerio';
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
export const YINZHOU_ADAPTER_KEY = 'yinzhou-government';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class YinzhouGovernmentAdapter implements OfficialSiteAdapter {
  readonly key = YINZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    const $ = load(input.content);
    const container = $('ul#announcement-list');
    if (container.length === 0) {
      throw mismatch('鄞州列表页未找到 ul#announcement-list 容器，页面结构可能已改版');
    }
    const items: DiscoveredDocument[] = [];
    container.find('li.item').each((_index, element) => {
      const dateNode = $(element).find('span.item-date').first();
      const link = $(element).find('a[href]').first();
      const href = link.attr('href');
      if (dateNode.length === 0) {
        throw mismatch('鄞州列表条目缺少 span.item-date 节点，页面结构可能已改版');
      }
      if (link.length === 0 || !href) {
        throw mismatch('鄞州列表条目缺少 href 链接，页面结构可能已改版');
      }
      const title = stripTags(link.html() ?? '');
      items.push({
        title,
        publishedAt: extractDate(stripTags(dateNode.html() ?? ''), '列表条目 .item-date'),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch('鄞州列表页 ul#announcement-list 内没有任何条目（静默 0 条视为故障）');
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const titleNode = $('div.title-box h1').first();
    const infoNode = $('div.title-box p.info span');
    const bodyNode = $('div.content-box').first();
    if (titleNode.length === 0 || infoNode.length === 0 || bodyNode.length === 0) {
      throw mismatch('鄞州正文页缺少 .title-box h1/.info span/.content-box，页面结构可能已改版');
    }
    const infoText = infoNode
      .map((_index, element) => stripTags($(element).html() ?? ''))
      .get()
      .join(' ');
    const attachments: LocatedAttachment[] = [];
    const attachContainer = $('div.attach-box');
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
      publishedAt: extractDate(infoText, '正文页 .info span'),
      bodyText: stripTags(bodyNode.html() ?? ''),
      attachments,
    };
  }
}
