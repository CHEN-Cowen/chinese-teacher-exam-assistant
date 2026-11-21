/**
 * 亳州市人民政府「教师管理」栏目 Adapter（N1 首批跨省扩源）。
 *
 * 定位：亳州市政府信息公开「教师管理」栏目
 * （/XxgkContent/showList/295/65767/page_1.html）。
 *
 * 真实官网形态（2026-11-05 核验）：
 * - 服务端渲染静态列表：section.m-tglist li > a[href][title] + 同级 span（YYYY-MM-DD）；
 * - 详情页形如 /OpennessContent/show/<id>.html；
 * - 分页标签为 `<pagination currentpage="1" pagesize="15" pagecount="13" total="191">`，
 *   后续页为同路径的 page_<n>.html；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件走 /upload_bz/download?siteId=1&id=...（.doc/.et 等）。
 *
 * 覆盖价值：这是安徽省**市级**教师招聘来源，独立于省级政策来源，
 * 实测首屏含新任教师公开招聘公告、递补公告与拟聘用公示。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/bozhou/
 */
import {
  discoverGovInfoList,
  govInfoListPages,
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

export const BOZHOU_ADAPTER_KEY = 'bozhou-education';

/** 详情页形如 /OpennessContent/show/<数字>.html。 */
const BOZHOU_DETAIL_PATTERN = /\/OpennessContent\/show\/\d+\.html(?:[?#]|$)/;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class BozhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = BOZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('亳州栏目为服务端渲染静态列表，不应返回公开接口 JSON');
    }
    return discoverGovInfoList(
      input.url,
      input.content,
      BOZHOU_DETAIL_PATTERN,
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('亳州正文页解析失败，页面结构可能已改版');
    }
  }

  /** 官方 pagination 声明的后续页（page_<n>.html）。 */
  paginationListings(baseUrl: string, content: string): string[] {
    return govInfoListPages(baseUrl, content);
  }
}
