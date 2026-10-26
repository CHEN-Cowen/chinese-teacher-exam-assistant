/**
 * 蚌埠市教育局官方站点 Adapter（S5 遗留任务 1 补源）。
 *
 * 定位：蚌埠市教育局「教师招聘」专栏（/xwdt/kszp/），栏目 ID 6820881。
 *
 * 真实官网形态（2026-10-26 核验）：
 * - 列表为**服务端渲染**的静态 HTML：li 内 a[title]（标题在 title 属性）
 *   + 同级 span.right.date（YYYY-MM-DD）；
 * - 分页总数写在官方内联 `Ls.pagination(...)` 的 pageCount 里
 *   （实测 18 页 / 267 条），后续页为 /content/column/6820881?pageIndex=N；
 * - 正文页使用官方 meta（ArticleTitle/PubDate/ContentSource）
 *   + `.j-fontContent` 容器；
 * - 附件走官方 /group4/... 对象存储链接（pdf/doc/xls）。
 *
 * 技术样本价值：服务端渲染 + pageCount 分页 + pageIndex 协议，
 * 与已登记的 jpaas 动态接口（杭州/绍兴/嘉兴/丽水）、DOM 属性分页
 * （宁波/鄞州）、initJpage 内联分页（丽水）、FX_PageDiv 路径追加分页
 * （常州）都不同，覆盖新的页面形态。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/bengbu/
 */
import {
  discoverServerRenderedList,
  locateOfficialArticle,
  serverRenderedListPages,
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
export const BENGBU_ADAPTER_KEY = 'bengbu-education';

/** 栏目 ID 与栏目路径：仅用于拼装官方后续分页 URL。 */
export const BENGBU_COLUMN_ID = '6820881';
export const BENGBU_COLUMN_PATH = '/xwdt/kszp/';

/** 详情页形如 /xwdt/kszp/<9 位数字>.html（官方栏目路径 + 条目 ID）。 */
const BENGBU_DETAIL_PATTERN = /\/xwdt\/kszp\/\d+\.html$/;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class BengbuEducationAdapter implements OfficialSiteAdapter {
  readonly key = BENGBU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('蚌埠栏目为服务端渲染静态列表，不应返回公开接口 JSON');
    }
    return discoverServerRenderedList(
      input.url,
      input.content,
      BENGBU_DETAIL_PATTERN,
    );
  }

  /** 官方 pageCount 声明的后续栏目页（/content/column/<id>?pageIndex=N）。 */
  paginationListings(baseUrl: string, content: string): string[] {
    return serverRenderedListPages(
      baseUrl,
      content,
      BENGBU_COLUMN_ID,
      new URL(baseUrl).origin,
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('蚌埠正文页解析失败，页面结构可能已改版');
    }
  }
}
