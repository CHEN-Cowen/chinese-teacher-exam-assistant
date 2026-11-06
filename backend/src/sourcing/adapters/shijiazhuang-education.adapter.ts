/**
 * 石家庄市教育局官方站点 Adapter（N3 跨省扩源，河北省首个来源；PageFront 表单分页族）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「通知公告」栏目 /a/zwgk/tzgg/index.html 服务端渲染列表：
 *   `li.clearF > div.ul_zi > a[栏目] + a[文章绝对地址]` + `div.ul_ziriqi`
 *   （YYYY-MM-DD），首屏 20 条；栏目为混合栏目（教师招聘/招募、公示、
 *   招生入学等），教师招聘相关条目按标题判定；
 * - 分页为 `form[name=pageForm]` POST /dynamic/PageFront.jsp（parseId/
 *   categoryId/keyword/pageNo），官方 6 页 / 每页 20 条，无 Referer 要求；
 *   分页请求由 `pagefrontRequest` 从 URL query 确定性派生；
 * - 详情页 GET HTML（/a/YYYY/MM/DD/<id>.html）：标题/日期在官方 meta
 *   （ArticleTitle 可能内嵌 <br> 与 \r\n，需剥标签合并空白；PubDate 为
 *   YYYY-MM-DD HH:mm:ss），正文在 `div.content_fenye2`，附件为正文内
 *   `/resources/<siteId>/<id>.zip|docx|pdf` 相对路径（锚点文本即附件名，
 *   可能带 &nbsp; 前缀），也存在零附件条目。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/shijiazhuang-education/
 */
import { load } from 'cheerio';
import {
  AdapterParseError,
  normalizeUrl,
  stripTags,
  extractDate,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type LocatedAttachment,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';
import { discoverPagefrontRecords, pagefrontPages } from '../pagefront-list.js';

export const SHIJIAZHUANG_ADAPTER_KEY = 'shijiazhuang-education';

/** 附件锚点：/resources/<siteId>/<id>.<ext> 相对路径，扩展名白名单 */
const SHIJIAZHUANG_ATTACHMENT_PATTERN =
  /\/resources\/\d+\/\d+\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class ShijiazhuangEducationAdapter implements OfficialSiteAdapter {
  readonly key = SHIJIAZHUANG_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    return discoverPagefrontRecords(input.url, input.content);
  }

  pages(input: ListPageSnapshot): string[] {
    return pagefrontPages(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const rawTitle = metaContent($, 'ArticleTitle');
    // ArticleTitle 可能内嵌 <br> 与 \r\n（如招募公告两行标题），剥标签合并空白
    const title = rawTitle ? stripTags(rawTitle) : undefined;
    const date = metaContent($, 'PubDate');
    const content = $('div.content_fenye2').first();
    if (!title || !date || content.length === 0) {
      throw mismatch(
        `石家庄正文缺少 ArticleTitle/PubDate meta 或 div.content_fenye2 正文容器: url=${input.url}`,
      );
    }
    const bodyHtml = content.html() ?? '';
    if (!stripTags(bodyHtml)) {
      throw mismatch('石家庄正文 div.content_fenye2 容器为空');
    }
    // 附件为正文内 /resources/<siteId>/<id>.zip|docx 相对路径，锚点文本即附件名
    const attachments = new Map<string, LocatedAttachment>();
    content.find('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = new URL(href, input.url).toString();
      if (!SHIJIAZHUANG_ATTACHMENT_PATTERN.test(target)) return;
      const name = $(e).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) throw mismatch('石家庄正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '石家庄正文 PubDate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}

/** 取第一个非空 meta；页尾模板 meta 为空字符串，跳过 */
function metaContent(
  $: ReturnType<typeof load>,
  name: string,
): string | undefined {
  const metas = $('meta').filter(
    (_i, e) => ($(e).attr('name') ?? '').toLowerCase() === name.toLowerCase(),
  );
  let value: string | undefined;
  metas.each((_i, e) => {
    if (value) return;
    const candidate = $(e).attr('content')?.trim();
    if (candidate) value = candidate;
  });
  return value;
}
