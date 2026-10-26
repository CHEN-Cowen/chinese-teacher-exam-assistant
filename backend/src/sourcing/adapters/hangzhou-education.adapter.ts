/**
 * 杭州来源官方站点 Adapter（v7.2 工作包 3 / S5）。
 *
 * 定位：杭州市教育局「教师招聘」栏目（/col/col1228921906/index.html）。
 *
 * 两套站点形态（都必须支持，结构不符一律显式失败）：
 * 1. **真实官网（2026-10-26 核验）**：栏目外壳页声明 jpaas 公开动态列表接口，
 *    接口返回 `.page-content li > a[title]` + 同级 `<span>YYYY-MM-DD</span>`
 *    （`span.suffixContent[origintime]` 毫秒时间戳为备用日期来源）；
 *    正文页使用官方 meta（ArticleTitle/PubDate）+ `.art_con` 容器，
 *    附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 * 2. **S4 合成骨架（保留用于离线回归）**：`ul.news-list > li > a + span.date`，
 *    正文 `h1.article-title` + `span.pub-date` + `div.article-content`。
 *
 * 约定：只消费 SafeFetcher 产出的不可变快照，**不联网、不写库、不抽取用户资格结论**；
 * DOM 骨架失配抛 `AdapterParseError('DOM_MISMATCH')`，**绝不静默返回 0 条**。
 *
 * 关联真实样本：tests/fixtures/golden-sources/hangzhou/
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
    // 真实官网返回的是公开动态接口 JSON（外壳页会被 source-discover 换成接口 URL）
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'hangzhou');
    }
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
        publishedAt: extractDate(
          stripTags(dateNode.html() ?? ''),
          '列表条目 .date',
        ),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch(
        '杭州列表页 ul.news-list 内没有任何条目（静默 0 条视为故障）',
      );
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    // 真实官网正文使用官方 meta 协议；合成骨架没有 meta，按标记分流。
    if (/<meta\s+name="ArticleTitle"/i.test(input.content)) {
      try {
        return locateOfficialArticle(input.url, input.content);
      } catch (error) {
        if (error instanceof AdapterParseError) throw error;
        throw mismatch('杭州正文页解析失败，页面结构可能已改版');
      }
    }
    const $ = load(input.content);
    const titleNode = $('h1.article-title').first();
    const dateNode = $('span.pub-date').first();
    const bodyNode = $('div.article-content').first();
    if (
      titleNode.length === 0 ||
      dateNode.length === 0 ||
      bodyNode.length === 0
    ) {
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
      publishedAt: extractDate(
        stripTags(dateNode.html() ?? ''),
        '正文页 .pub-date',
      ),
      bodyText: stripTags(bodyNode.html() ?? ''),
      attachments,
    };
  }
}
