/**
 * 武汉市教育局官方站点 Adapter（N3 跨省扩源，湖北省首个来源；navbox 静态锚点分页族）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「通知公告」栏目 /zwdt/tsgg/ 目录形态 URL、服务端渲染列表：
 *   `li.box-sizing > a.item-li-a[title]`（href `./YYYYMM/tYYYYMMDD_<id>.shtml`）
 *   + `h2.text-ellipsis` 标题 + `div.other`（时间：YYYY-MM-DD），首屏 10 条；
 *   栏目为混合栏目（招聘/资格认定/职称评审/收费公示等），教师招聘相关条目
 *   按标题判定；
 * - 分页为 `div#navbox` 静态锚点 index_N.shtml（pagenav_tail 尾页给出官方
 *   50 页 / 每页 10 条），由 `whsnavPages` 派生，GET 即可、无 Referer 要求；
 * - 详情页 GET HTML：标题/日期/来源在官方 meta（ArticleTitle / PubDate
 *   YYYY-MM-DD HH:mm:ss / ContentSource），正文在 `div#article-box`
 *   （内层 TRS_UEDITOR），附件为正文内 `./P0<数字>.pdf|docx|xlsx|zip`
 *   相对路径（TRS WCM 命名，锚点文本即附件名），也存在零附件条目。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/wuhan-education/
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
import { discoverWhsnavRecords, whsnavPages } from '../whsnav-list.js';

export const WUHAN_ADAPTER_KEY = 'wuhan-education';

/** 附件锚点：TRS WCM `/…/P0<数字>.<ext>` 绝对化后的路径，扩展名白名单 */
const WUHAN_ATTACHMENT_PATTERN =
  /\/P\d{10,}\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class WuhanEducationAdapter implements OfficialSiteAdapter {
  readonly key = WUHAN_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    return discoverWhsnavRecords(input.url, input.content);
  }

  pages(input: ListPageSnapshot): string[] {
    return whsnavPages(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const title = metaContent($, 'ArticleTitle');
    const date = metaContent($, 'PubDate');
    const content = $('div#article-box').first();
    if (!title || !date || content.length === 0) {
      throw mismatch(
        `武汉正文缺少 ArticleTitle/PubDate meta 或 div#article-box 正文容器: url=${input.url}`,
      );
    }
    const bodyHtml = content.html() ?? '';
    if (!stripTags(bodyHtml)) {
      throw mismatch('武汉正文 div#article-box 容器为空');
    }
    // 附件为正文内 ./P0<数字>.pdf 等相对路径，锚点文本即附件名
    const attachments = new Map<string, LocatedAttachment>();
    content.find('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = new URL(href, input.url).toString();
      if (!WUHAN_ATTACHMENT_PATTERN.test(target)) return;
      const name = $(e).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) throw mismatch('武汉正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '武汉正文 PubDate'),
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
