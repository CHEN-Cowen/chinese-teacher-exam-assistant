/**
 * 常州市教育局官方站点 Adapter（v7.2 / S5）。
 *
 * 定位：常州市教育局「教师招考」专栏（/class/QFJEPCBL）。
 * 实测结构：服务端渲染静态表格列表，条目为 table.border > tr > td（a[title]）
 * + 相邻 td（发布日期 YYYY-MM-DD）；分页由官方 FX_PageDiv 声明总页数，
 * 后续页为 <栏目路径>/<页码>（如 /class/QFJEPCBL/2）。
 * 正文页使用官方 meta（ArticleTitle/PubDate）+ `.NewsText` 容器，
 * 附件为站点内 /uploadfile/... 链接。
 *
 * 约定同其他来源：只读快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/changzhou/
 */
import {
  columnTablePages,
  discoverColumnTable,
  locateOfficialArticle,
} from '../public-column.js';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const CHANGZHOU_ADAPTER_KEY = 'changzhou-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class ChangzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = CHANGZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('常州栏目为静态表格列表，不应返回公开接口 JSON');
    }
    return discoverColumnTable(input.url, input.content);
  }

  /** 官方 FX_PageDiv 声明的后续栏目页。 */
  paginationListings(baseUrl: string, content: string): string[] {
    return columnTablePages(baseUrl, content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('常州正文页解析失败，页面结构可能已改版');
    }
  }
}
