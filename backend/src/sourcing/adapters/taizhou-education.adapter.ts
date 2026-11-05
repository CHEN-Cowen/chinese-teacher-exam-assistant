/**
 * 泰州市教育局官方站点 Adapter（N1 首批跨省扩源）。
 *
 * 定位：泰州市教育局「最新文件」栏目（/zxwj/index.html）。
 *
 * 真实官网形态（2026-11-05 核验）：
 * - 栏目外壳页声明同源 jpaas 公开接口
 *   （/api-gateway/jpaas-publish-server/front/page/build/unit），
 *   queryData 的 webId/pageId 为 32 位哈希，必须完整透传；
 * - 列表单元为 `.page-content li`：a[href] + 同级 span（YYYY-MM-DD）；
 *   链接的 title 属性是模板占位符 `{item.title1}`，真实标题在链接文本；
 * - 分页参数在官方 DOM 属性（div.pagination rows=15 / count=30 / pageno=1），
 *   后续页沿用同一接口并带 paramJson={"pageNo":N,"pageSize":"15"}；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ `.content` 容器，
 *   附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 注意：该栏目是「最新文件」混合栏目，条目需按标题判定是否为教师招聘；
 * Adapter 只描述页面结构与形态，不抽取资格结论。
 *
 * 约定同其他来源：只吃快照、不联网、不写库；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/taizhou/
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

export const TAIZHOU_ADAPTER_KEY = 'taizhou-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class TaizhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = TAIZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'taizhou');
    }
    throw mismatch(
      '泰州栏目外壳页不含列表数据，公开接口地址应由发现流程解析后重新抓取',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('泰州正文页解析失败，页面结构可能已改版');
    }
  }

  pages(input: ListPageSnapshot): string[] {
    return publicColumnPages(input.url, input.content);
  }
}
