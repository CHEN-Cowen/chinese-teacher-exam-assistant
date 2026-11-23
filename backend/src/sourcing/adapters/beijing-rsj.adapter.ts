/**
 * 北京市人力资源和社会保障局「事业单位公开招聘」栏目 Adapter
 * （N4 全国扩源，北京市首个来源）。
 *
 * 定位：北京市人社局 > 政务公开 > 事业单位公开招聘
 * （https://rsj.beijing.gov.cn/xxgk/gkzp/）。
 *
 * 真实官网形态（2026-11-20 核验）：
 * - 服务端渲染静态列表：ul.list li > a[href][title] + span（YYYY-MM-DD）；
 * - 分页为同目录 index_N.html 静态锚点（index.html 为第 1 页）；
 * - 详情页形如 /xxgk/gkzp/<YYYYMM>/t<YYYYMMDD>_<id>.html；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ div.view 容器（TRS CMS），
 *   附件为同域 xlsx/doc/pdf 相对路径。
 *
 * 覆盖价值：该栏目为北京市级**综合事业单位**公开招聘专栏，包含教委所属
 * 学校、幼儿园、高校等教师岗位，也混有医院、广电、艺术院团等非教师岗位；
 * 因此按标题只保留教育/教师/学校相关条目，避免污染教师招聘库。
 * 这是北京市首个接入来源，市级综合栏目不能替代各区独立发布渠道。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/beijing-rsj/
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

export const BEIJING_RSJ_ADAPTER_KEY = 'beijing-rsj-recruitment';

/** 详情页形如 /xxgk/gkzp/<YYYYMM>/t<YYYYMMDD>_<id>.html。 */
const BEIJING_DETAIL_PATTERN = /\/xxgk\/gkzp\/\d{6}\/t\d{8}_\d+\.html(?:[?#]|$)/;

/**
 * 综合事业单位栏目中的教师相关标题过滤。
 * 只保留教育系统/学校/教师岗位，避免医院、广电、艺术院团等公告进入教师库。
 */
const TEACHER_TITLE_PATTERN =
  /(教育|教师|学校|幼儿园|附中|附小|大学|学院|教委)/;

/** 综合栏目中的非教师系统标题（医院/卫健/广电/文艺院团），即使含“大学/学院”也排除。 */
const NON_TEACHER_TITLE_PATTERN =
  /(医院|卫生健康|卫生计生|广播电视台|剧院|剧团|科学院)/;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class BeijingRsjRecruitmentAdapter implements OfficialSiteAdapter {
  readonly key = BEIJING_RSJ_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('北京人社局栏目为静态列表，不应返回公开接口 JSON');
    }
    // 先按官方列表骨架解析；若骨架失配这里会抛 DOM_MISMATCH。
    const items = discoverStaticAnchorList(
      input.url,
      input.content,
      BEIJING_DETAIL_PATTERN,
      'ul.list li',
    );
    // 综合栏目按标题过滤；过滤后为空是合法结果（本页没有教师岗位）。
    return items.filter(
      (item) =>
        TEACHER_TITLE_PATTERN.test(item.title) &&
        !NON_TEACHER_TITLE_PATTERN.test(item.title),
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('北京人社局正文页解析失败，页面结构可能已改版');
    }
  }
}
