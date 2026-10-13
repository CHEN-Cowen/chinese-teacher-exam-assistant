/**
 * 杭州来源官方站点 Adapter（v7.2 工作包 3，唯一来源闭环样例）。
 *
 * 定位：杭州市教育局教师招聘栏目（列表页 → 公告正文页）。
 * 约定：
 * - 只消费 SafeFetcher 产出的不可变快照，**不联网、不写库、不抽取用户资格结论**；
 * - 输出规范化后的绝对 URL 与最小元数据（标题/发布时间/正文/附件）；
 * - DOM 骨架失配抛 `AdapterParseError('DOM_MISMATCH')`，**绝不静默返回 0 条**。
 *
 * 关联黄金样本：tests/fixtures/golden-sources/hangzhou/{list,detail}.html
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
export const HANGZHOU_ADAPTER_KEY = 'hangzhou-education';

/** 列表项缺失 href/.date、容器缺失等，统一抛出此错误（不静默降级） */
function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class HangzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = HANGZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    const $ = load(input.content);
    const container = $('ul.news-list');
    if (container.length === 0) {
      throw mismatch('杭州列表页未找到 ul.news-list 容器，页面结构可能已改版');
    }
    const items: DiscoveredDocument[] = [];
    container.find('li').each((_index, element) => {
      const link = $(element).find('a[href]').first();
      const dateNode = $(element).find('span.date').first();
      const href = link.attr('href');
      if (link.length === 0 || !href) {
        throw mismatch('杭州列表条目缺少 href 链接，页面结构可能已改版');
      }
      if (dateNode.length === 0) {
        throw mismatch('杭州列表条目缺少 .date 节点，页面结构可能已改版');
      }
      const title = stripTags(link.html() ?? '');
      items.push({
        title,
        publishedAt: extractDate(stripTags(dateNode.html() ?? ''), '列表条目 .date'),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch('杭州列表页 ul.news-list 内没有任何条目（静默 0 条视为故障）');
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const titleNode = $('h1.article-title').first();
    const dateNode = $('span.pub-date').first();
    const bodyNode = $('div.article-content').first();
    if (titleNode.length === 0 || dateNode.length === 0 || bodyNode.length === 0) {
      throw mismatch(
        '杭州正文页缺少 .article-title/.pub-date/.article-content，页面结构可能已改版',
      );
    }
    const attachments: LocatedAttachment[] = [];
    const attachContainer = $('div.article-attachments');
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
      publishedAt: extractDate(stripTags(dateNode.html() ?? ''), '正文页 .pub-date'),
      bodyText: stripTags(bodyNode.html() ?? ''),
      attachments,
    };
  }
}
