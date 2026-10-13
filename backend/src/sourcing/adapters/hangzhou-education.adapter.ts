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
import {
  AdapterParseError,
  extractDate,
  resolveUrl,
  stripTags,
  type DownloadedSnapshot,
  type OfficialSiteAdapter,
  type ParsedAttachment,
  type ParsedDetail,
  type ParsedListItem,
} from '../official-site-adapter.js';

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const HANGZHOU_SOURCE_ID = 'hangzhou-education';

const LIST_CONTAINER = /<ul[^>]*class="[^"]*\bnews-list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i;
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const LIST_LINK = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const LIST_DATE = /<span[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

const DETAIL_TITLE = /<h1[^>]*class="[^"]*\barticle-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i;
const DETAIL_DATE = /<span[^>]*class="[^"]*\bpub-date\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
const DETAIL_BODY = /<div[^>]*class="[^"]*\barticle-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const DETAIL_ATTACH_BLOCK =
  /<div[^>]*class="[^"]*\barticle-attachments\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const ATTACH_LINK = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

export class HangzhouEducationAdapter implements OfficialSiteAdapter {
  readonly sourceId = HANGZHOU_SOURCE_ID;

  listItems(snapshot: DownloadedSnapshot): ParsedListItem[] {
    const containerMatch = snapshot.content.match(LIST_CONTAINER);
    if (!containerMatch) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        '杭州列表页未找到 .news-list 容器，页面结构可能已改版',
      );
    }
    const items: ParsedListItem[] = [];
    for (const itemMatch of containerMatch[1].matchAll(LIST_ITEM)) {
      const block = itemMatch[1];
      const link = block.match(LIST_LINK);
      const date = block.match(LIST_DATE);
      if (!link || !date) {
        throw new AdapterParseError(
          'DOM_MISMATCH',
          '杭州列表条目缺少 href 或 .date 节点，页面结构可能已改版',
        );
      }
      items.push({
        title: stripTags(link[2]),
        publishedAt: extractDate(stripTags(date[1]), '列表条目 .date'),
        detailUrl: resolveUrl(snapshot.url, link[1]),
      });
    }
    if (items.length === 0) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        '杭州列表页 .news-list 内没有任何条目（静默 0 条视为故障）',
      );
    }
    return items;
  }

  parseDetail(snapshot: DownloadedSnapshot): ParsedDetail {
    const title = snapshot.content.match(DETAIL_TITLE);
    const date = snapshot.content.match(DETAIL_DATE);
    const body = snapshot.content.match(DETAIL_BODY);
    if (!title || !date || !body) {
      throw new AdapterParseError(
        'DOM_MISMATCH',
        '杭州正文页缺少 .article-title/.pub-date/.article-content，页面结构可能已改版',
      );
    }
    const attachments: ParsedAttachment[] = [];
    const attachBlock = snapshot.content.match(DETAIL_ATTACH_BLOCK);
    if (attachBlock) {
      for (const link of attachBlock[1].matchAll(ATTACH_LINK)) {
        const name = stripTags(link[2]);
        if (!name) continue;
        attachments.push({
          name,
          url: resolveUrl(snapshot.url, link[1]),
        });
      }
    }
    return {
      canonicalUrl: resolveUrl(snapshot.url, snapshot.url),
      title: stripTags(title[1]),
      publishedAt: extractDate(stripTags(date[1]), '正文页 .pub-date'),
      bodyText: stripTags(body[1]),
      attachments,
    };
  }
}
