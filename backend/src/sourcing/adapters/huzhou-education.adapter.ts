/**
 * 湖州市教育局官方站点 Adapter（N1 首批跨省扩源）。
 *
 * 定位：湖州市教育局「公示公告」栏目（/col/col1229210603/index.html）。
 *
 * 真实官网形态（2026-11-05 核验）：
 * - 栏目外壳页声明同源 jpaas 公开接口
 *   （/api-gateway/jpaas-publish-server/front/page/build/unit），
 *   queryData 含 parseType/webId/tplSetId/pageType/tagId/editType/pageId；
 * - 列表单元为 `.page-content tr`：a[title] + 独立日期单元格 td.yd_no（[YYYY-MM-DD]）；
 * - 分页参数在官方内联 `initJpage({...})`（rows=15 / count=41 / pageNo=1），
 *   后续页沿用同一接口并带 paramJson={"pageNo":N,"pageSize":"15"}；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 注意：该栏目是「公示公告」混合栏目，条目需按标题人工/下游判定是否为教师招聘；
 * Adapter 只描述页面结构与形态，不抽取资格结论。
 *
 * 约定同其他来源：只吃快照、不联网、不写库；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/huzhou/
 */
import {
  discoverPublicColumn,
  locateOfficialArticle,
  publicColumnPages,
} from '../public-column.js';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

export const HUZHOU_ADAPTER_KEY = 'huzhou-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class HuzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = HUZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'huzhou');
    }
    throw mismatch(
      '湖州栏目外壳页不含列表数据，公开接口地址应由发现流程解析后重新抓取',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('湖州正文页解析失败，页面结构可能已改版');
    }
  }

  pages(input: ListPageSnapshot): string[] {
    return publicColumnPages(input.url, input.content);
  }
}
