/**
 * 烟台市教育局官方站点 Adapter（N2 公开接口族跨省扩源）。
 *
 * 定位：烟台市教育局「通知公告」栏目（/col/col17078/index.html）。
 *
 * 真实官网形态（2026-11-05 核验）：
 * - 栏目外壳页声明同源 jpaas 公开接口
 *   （/api-gateway/jpaas-publish-server/front/page/build/unit），
 *   queryData 含 parseType/webId/tplSetId/pageType/tagId/editType/pageId；
 * - 列表单元为 `.page-content li.cf`：a[title] + 同级 span.fr（YYYY-MM-DD）；
 * - 列表混合：部分条目直接指向 PDF（年度报表、教辅目录），不是可解析正文，
 *   适配器只保留官方文章路径（/art/YYYY/），避免把 PDF 当正文抓取；
 * - 分页容器带 rows=15 / count=1365 / pageNo=1 属性，共 91 页；
 *   全量抓取会让单来源每轮入队上千条历史文档，因此按
 *   `PUBLIC_COLUMN_PAGE_WINDOWS` 显式登记只监测最新 6 页（90 条），
 *   窗口与原因同时写入来源目录 coverageNote 与全国来源账本；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 约定同其他来源：只吃快照、不联网、不写库；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/yantai/
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

export const YANTAI_ADAPTER_KEY = 'yantai-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class YantaiEducationAdapter implements OfficialSiteAdapter {
  readonly key = YANTAI_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'yantai');
    }
    throw mismatch(
      '烟台栏目外壳页不含列表数据，公开接口地址应由发现流程解析后重新抓取',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('烟台正文页解析失败，页面结构可能已改版');
    }
  }

  pages(input: ListPageSnapshot): string[] {
    return publicColumnPages(input.url, input.content);
  }
}
