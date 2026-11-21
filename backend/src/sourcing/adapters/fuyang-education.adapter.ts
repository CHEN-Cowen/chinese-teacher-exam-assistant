/**
 * 阜阳市教育局「师资建设」栏目 Adapter（N1 第二批扩源）。
 *
 * 定位：阜阳市教育局「师资建设」栏目（/Content/showList/843/page_1.html）。
 *
 * 真实官网形态（2026-11-05 核验）：
 * - 服务端渲染静态列表：div.m-cglist.m-liststyle1 ul li > span（YYYY-MM-DD）+ a[href][title]；
 * - 栏目混合发布教师资格、教师培训与**教师招聘/选聘**公告，首屏含
 *   「2026年阜阳市市直高中学校校区公开选聘教师资格复审公告」等；
 * - 分页标签 `<pagination currentpage="1" pagesize="15" pagecount="12" total="175">`，
 *   后续页为同路径 page_<n>.html；
 * - 详情页形如 /Content/show/<id>.html，使用官方 meta（ArticleTitle/PubDate）
 *   + #zoom（j-fontContent）容器；
 * - 附件走 /download?siteId=28&id=...（xlsx/docx），已纳入通用附件规则。
 *
 * 列表同时混有跨站转载（省教育厅/教育部），只接受本域 /Content/show/ 条目。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/fuyang/
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

export const FUYANG_ADAPTER_KEY = 'fuyang-education';

/** 详情页形如 /Content/show/<数字>.html（与亳州 /OpennessContent/show/ 不同）。 */
const FUYANG_DETAIL_PATTERN = /\/Content\/show\/\d+\.html(?:[?#]|$)/;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class FuyangEducationAdapter implements OfficialSiteAdapter {
  readonly key = FUYANG_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('阜阳栏目为服务端渲染静态列表，不应返回公开接口 JSON');
    }
    return discoverGovInfoList(
      input.url,
      input.content,
      FUYANG_DETAIL_PATTERN,
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('阜阳正文页解析失败，页面结构可能已改版');
    }
  }

  /** 官方 pagination 声明的后续页（page_<n>.html）。 */
  paginationListings(baseUrl: string, content: string): string[] {
    return govInfoListPages(baseUrl, content);
  }
}
