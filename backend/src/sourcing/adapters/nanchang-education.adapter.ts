/**
 * 南昌市教育局「教师科」栏目 Adapter（N3 跨省扩源，江西省首个来源）。
 *
 * 定位：南昌市教育局「教师科发文」栏目
 * （https://edu.nc.gov.cn/ncjyj/jskfw/nav_list.shtml）。
 *
 * 真实官网形态（2026-11-06 核验）：
 * - 服务端渲染静态列表：ul.item li > a[href][title] + 同级 <span>YYYY-MM-DD</span>；
 * - 分页由官方 createPageHTML('page_div',2,1,'nav_list','shtml',34) 声明，
 *   后续页为 nav_list_<n>.shtml（复用 staticListPages，由发现服务通用调度）；
 * - 详情页形如 /ncjyj/<栏目>/<YYYYMM>/<32位hex>.shtml，
 *   列表偶尔跨栏目链接（如 /ncjyj/jszgrd/ 教师资格专栏），按详情路径放行；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件为相对路径 <文章ID>/files/ 下的 xlsx/pdf/doc。
 *
 * 覆盖价值：这是江西省**市级**教师招聘来源；该栏目为混合栏目
 * （教师招聘、教师资格认定、职称评审），教师招聘相关条目需按标题判定；
 * 实测首屏含 2026 年中小学教师招聘面试公告、资格审查公告与急需紧缺人才引进公告。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/nanchang/
 */
import {
  discoverStaticAnchorList,
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

export const NANCHANG_ADAPTER_KEY = 'nanchang-education';

/** 详情页形如 /ncjyj/<栏目>/<YYYYMM>/<32位hex>.shtml（含跨栏目链接）。 */
const NANCHANG_DETAIL_PATTERN =
  /\/ncjyj\/[a-z]+\/\d{6}\/[a-f0-9]{32}\.shtml(?:[?#]|$)/;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class NanchangEducationAdapter implements OfficialSiteAdapter {
  readonly key = NANCHANG_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('南昌栏目为静态列表，不应返回公开接口 JSON');
    }
    return discoverStaticAnchorList(
      input.url,
      input.content,
      NANCHANG_DETAIL_PATTERN,
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('南昌正文页解析失败，页面结构可能已改版');
    }
  }
}
