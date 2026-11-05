/**
 * W5 首批扩源：安徽省教育厅「通知公告」。
 *
 * 这是省级教育政策/通知来源，不是市县教师招聘专栏：
 * - 只用于政策检索与省级政策材料；
 * - 不能代表安徽省内各市县的教师招聘覆盖；
 * - 列表首屏为服务端渲染（a[title] + span.right.date），正文使用
 *   meta[ArticleTitle]/meta[PubDate] + .j-fontContent，复用公共解析器。
 */
import {
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';
import {
  discoverServerRenderedList,
  locateOfficialArticle,
} from '../public-column.js';

export class AnhuiEducationPolicyAdapter implements OfficialSiteAdapter {
  readonly key = 'anhui-education-policy';

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    // 只取首屏最新通知；来源为政策栏目，不做历史全量回放。
    return discoverServerRenderedList(
      input.url,
      input.content,
      /\/xwzx\/tzgg\/\d+\.html(?:[?#]|$)/,
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    return locateOfficialArticle(input.url, input.content);
  }
}
