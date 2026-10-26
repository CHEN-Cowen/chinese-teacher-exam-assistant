/**
 * 苏州市教育局官方站点 Adapter（v7.2 / S5）。
 *
 * 定位：苏州市教育局「人事信息」栏目（/szjyj/rsxx/xxgk_list.shtml）。
 * 实测结构：静态 .shtml 列表，条目为 `.listContent li > h4 > a[title]` + `span.time`；
 * 分页由官方 createPageHTML 脚本声明，页名为 <prefix>_<n>.shtml。
 * 正文页使用官方 meta（ArticleTitle/PubDate）+ `.article-content` 容器。
 *
 * 重要边界：该栏目公开的教师招聘公告最新为 2025 年，更新频率低；
 * 登记为可用历史来源，不得按“活跃招聘源”对外展示。
 *
 * 约定同其他来源：只读快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/suzhou/
 */
import { discoverStaticList, locateOfficialArticle } from '../public-column.js';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const SUZHOU_ADAPTER_KEY = 'suzhou-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class SuzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = SUZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('苏州栏目为静态列表，不应返回公开接口 JSON');
    }
    return discoverStaticList(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('苏州正文页解析失败，页面结构可能已改版');
    }
  }
}
