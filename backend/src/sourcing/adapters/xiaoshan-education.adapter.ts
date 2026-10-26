/**
 * 杭州市萧山区教育局官方站点 Adapter（S5 遗留任务 1 补源）。
 *
 * 定位：杭州市萧山区人民政府「教师招考」专栏
 * （/col/col1228964830/index.html，栏目 ID 1228964830）。
 *
 * 真实官网形态（2026-10-26 核验）：
 * - 栏目外壳页声明 jpaas 公开动态列表接口
 *   （/api-gateway/jpaas-publish-server/front/page/build/unit），
 *   queryData 含 parseType/webId/tplSetId/pageType/tagId/editType/pageId；
 * - 列表单元为 li > a[title].info-title + 同级 span.info-time（YYYY-MM-DD）；
 * - 分页参数在官方 DOM 属性上（rows=15 count=173 pageno=1），
 *   后续页沿用同一接口并带 paramJson={"pageNo":N,"pageSize":"15"}；
 * - 正文页使用官方 meta（ArticleTitle/PubDate）+ #zoom 容器，
 *   附件走 /api-gateway/jpaas-web-server/front/document/download?fileUrl=...
 *
 * 覆盖价值（S0 规范 6.2）：这是首批**区县级**教师招聘来源，
 * 实测 173 条公告，独立于杭州市级来源，可验证「省级/市级来源
 * 不能替代区县覆盖」这一事实。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/xiaoshan/
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
export const XIAOSHAN_ADAPTER_KEY = 'xiaoshan-education';

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class XiaoshanEducationAdapter implements OfficialSiteAdapter {
  readonly key = XIAOSHAN_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    // 真实官网返回的是公开动态接口 JSON（外壳页会被 source-discover 换成接口 URL）
    if (input.content.trimStart().startsWith('{')) {
      return discoverPublicColumn(input.url, input.content, 'xiaoshan');
    }
    // 栏目外壳页只声明接口地址，本身不含列表数据。
    // source-discover 会先把它转换成公开接口 URL 再抓取，因此这里直接显式失败，
    // 避免把外壳页误当成“空列表”。
    throw mismatch(
      '萧山栏目外壳页不含列表数据，公开接口地址应由发现流程解析后重新抓取',
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    try {
      return locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('萧山正文页解析失败，页面结构可能已改版');
    }
  }

  /** 萧山公开接口的后续页：同接口 + paramJson 页码协议。 */
  pages(input: ListPageSnapshot): string[] {
    return publicColumnPages(input.url, input.content);
  }
}
