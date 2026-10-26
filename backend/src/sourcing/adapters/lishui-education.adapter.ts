/**
 * 丽水来源官方站点 Adapter（S5）。
 *
 * 定位：丽水市教育局「人事招聘」栏目（/col/col1229223905/index.html）。
 *
 * 真实官网形态（2026-10-26 核验）：
 * - 栏目外壳页声明 jpaas 公开动态列表接口
 *   （/api-gateway/jpaas-publish-server/front/page/build/unit），
 *   外壳页 queryData 参数需完整透传（含 pageId / tagId）；
 * - 列表单元有两种官方形态：
 *   1. `文字列表页app`：`tbody.page-content > tr > td > a[title]` + 日期单元格
 *      （`[2026-09-23]` 方括号格式）；
 *   2. `当前栏目的ajax分页`：`div.page-content > li > a` + 同级 `<span>[日期]</span>`。
 * - 分页参数不在 DOM 属性上，而是官方内联脚本 `initJpage({...})`，
 *   后续页沿用同一接口并带 `paramJson={"pageNo":N,"pageSize":"10"}`；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ `#zoom` 容器，
 *   附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 约定：只消费 SafeFetcher 产出的不可变快照，**不联网、不写库、不抽取用户资格结论**；
 * DOM 骨架失配抛 `AdapterParseError('DOM_MISMATCH')`，**绝不静默返回 0 条**。
 *
 * 关联真实样本：tests/fixtures/golden-sources/lishui/
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

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const LISHIU_ADAPTER_KEY = 'lishui-education';

/** 列表项缺失 href/日期、容器缺失等，统一抛出此错误（不静默降级） */
function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class LishuiEducationAdapter implements OfficialSiteAdapter {
  readonly key = LISHIU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    // 真实官网返回的是公开动态接口 JSON（外壳页会被 source-discover 换成接口 URL）
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'lishui');
    }
    // 栏目外壳页只声明接口地址，本身不含列表数据。
    // source-discover 会先把它转换成公开接口 URL 再抓取，因此这里直接显式失败，
    // 避免把外壳页误当成“空列表”。
    throw mismatch(
      '丽水栏目外壳页不含列表数据，公开接口地址应由发现流程解析后重新抓取',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('丽水正文页解析失败，页面结构可能已改版');
    }
  }

  /** 丽水公开接口的后续页：同接口 + paramJson 页码协议。 */
  pages(input: ListPageSnapshot): string[] {
    return publicColumnPages(input.url, input.content);
  }
}
