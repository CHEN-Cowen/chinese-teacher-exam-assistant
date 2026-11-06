/**
 * 太原市教育局「通知公告」栏目 Adapter（N3 跨省扩源，山西省首个来源）。
 *
 * 定位：太原市教育局「通知公告」
 * （https://jyj.taiyuan.gov.cn/tzgg.html）。
 *
 * 真实官网形态（2026-11-06 核验）：
 * - 服务端渲染静态列表：ul.List_list li > span.fr（YYYY-MM-DD）+ a[href][title]；
 * - 分页为 JS 跳转式：页码锚点 href="#" +
 *   onclick="location.href='tzgg_<n>.html'"，
 *   官方共 93 条 / 5 页 / 每页 20 条（由 jsPaginationPages 解析，发现服务调度）；
 * - 详情页形如 /tzgg/<YYYYMMDD>/<数字>.html；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件为 /u/cms/site28/ 下的 xlsx 等文件（列表内链接为跨栏目路径时按详情路径放行）。
 *
 * 覆盖价值：这是山西省**市级**来源，且是首个 JS 跳转式静态分页来源；
 * 该栏目为混合栏目（公开招聘、职称评审、教师资格等），
 * 教师招聘相关条目需按标题判定；实测首屏含博士研究生公开招聘拟聘用公示。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/taiyuan/
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

export const TAIYUAN_ADAPTER_KEY = 'taiyuan-education';

/** 详情页形如 /tzgg/<YYYYMMDD>/<数字>.html。 */
const TAIYUAN_DETAIL_PATTERN = /\/tzgg\/\d{8}\/\d+\.html(?:[?#]|$)/;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class TaiyuanEducationAdapter implements OfficialSiteAdapter {
  readonly key = TAIYUAN_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('太原栏目为静态列表，不应返回公开接口 JSON');
    }
    return discoverStaticAnchorList(
      input.url,
      input.content,
      TAIYUAN_DETAIL_PATTERN,
      'ul.List_list li',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('太原正文页解析失败，页面结构可能已改版');
    }
  }
}
