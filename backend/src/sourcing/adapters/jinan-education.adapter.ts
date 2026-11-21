/**
 * 济南市教育局官方站点 Adapter（N2 公开接口族跨省扩源）。
 *
 * 定位：济南市教育局「教师招聘专栏」（/col/col19032/index.html）。
 *
 * 真实官网形态（2026-11-05 核验）：
 * - 栏目外壳页声明同源 jpaas 公开接口
 *   （/api-gateway/jpaas-publish-server/front/page/build/unit），
 *   queryData 含 parseType/webId/tplSetId/pageType/tagId/editType/pageId；
 * - 列表单元为 `.page-content tr`：a[title] + td.bt_time 内 span（YYYY-MM-DD）；
 * - 分页容器带 rows=15 / count=79 / pageNo=1 属性，共 6 页，
 *   后续页沿用同一接口并带 paramJson={"pageNo":N,"pageSize":"15"}；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 约定同其他来源：只吃快照、不联网、不写库；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/jinan/
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

export const JINAN_ADAPTER_KEY = 'jinan-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class JinanEducationAdapter implements OfficialSiteAdapter {
  readonly key = JINAN_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'jinan');
    }
    throw mismatch(
      '济南栏目外壳页不含列表数据，公开接口地址应由发现流程解析后重新抓取',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('济南正文页解析失败，页面结构可能已改版');
    }
  }

  pages(input: ListPageSnapshot): string[] {
    return publicColumnPages(input.url, input.content);
  }
}
