/**
 * 福州市教育局官方站点 Adapter（N3 跨省扩源，福建省首个来源；TRS WCM .htm 详情族）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 「通知公告」栏目列表页 /zwgk/tzgg/ 为 JS 壳，静态分页 index_N.htm 404；
 *   记录由 POST /fjdzapp/search 表单接口返回，必须携带同源 Referer
 *   （缺 Referer 返回 {"error":true,"info":"获取站点配置失败"}）；
 * - 栏目为混合栏目：教师招聘全周期公告（公告→补充→资格审核→面试→选岗→
 *   拟聘公示→递补）、名师/资格认定、校培机构白名单等，按标题判定形态；
 * - 详情页为 GET HTML（/zwgk/tzgg/YYYYMM/tYYYYMMDD_id.htm）：标题/日期在官方
 *   meta（ArticleTitle/PubDate），正文在 div.article_content（内嵌嵌套 html
 *   片段），附件在 div.article_attachment 的 li>a[href="./P0YYYYMMDD….xlsx|pdf"]
 *   （相对路径，展开为详情同目录绝对 URL）。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/fuzhou-education/
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
import { discoverFjdzRecords, fjdzSearchPages } from '../fz-list.js';

export const FUZHOU_ADAPTER_KEY = 'fuzhou-education';

/** 附件锚点：相对路径 ./P0YYYYMMDD…（TRS 附件命名），扩展名白名单 */
const FUZHOU_ATTACHMENT_PATTERN =
  /\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i;
const FUZHOU_ATTACHMENT_FILE_PATTERN = /\/P0\d{8,}\./i;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class FuzhouEducationAdapter implements OfficialSiteAdapter {
  readonly key = FUZHOU_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    return discoverFjdzRecords(input.url, input.content);
  }

  pages(input: ListPageSnapshot): string[] {
    return fjdzSearchPages(input.url, input.content);
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const title = metaContent($, 'ArticleTitle');
    const date = metaContent($, 'PubDate');
    const content = $('div.article_content').first();
    if (!title || !date || content.length === 0) {
      throw mismatch(
        `福州正文缺少 ArticleTitle/PubDate meta 或 div.article_content 正文容器: url=${input.url}`,
      );
    }
    const bodyHtml = content.html() ?? '';
    if (!stripTags(bodyHtml)) {
      throw mismatch('福州正文 div.article_content 容器为空');
    }
    // 附件区在 div.article_attachment 内（li>a[href="./P0….xlsx|pdf"]，
    // 相对路径指向详情同目录）；正文容器缺失时退化为全文检索附件区。
    const scope = $('div.article_attachment').first();
    const anchors = scope.length
      ? scope.find('a[href]')
      : $.root().find('a[href]');
    const attachments = new Map<string, LocatedAttachment>();
    anchors.each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = new URL(href, input.url).toString();
      if (
        !FUZHOU_ATTACHMENT_PATTERN.test(target) ||
        !FUZHOU_ATTACHMENT_FILE_PATTERN.test(target)
      )
        return;
      const name = $(e).text().trim();
      if (!name) throw mismatch('福州正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '福州正文 PubDate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}

/** 取第一个非空 meta；福州页尾模板 meta 为空字符串，跳过 */
function metaContent(
  $: ReturnType<typeof load>,
  name: string,
): string | undefined {
  const metas = $('meta').filter(
    (_i, e) =>
      ($(e).attr('name') ?? '').toLowerCase() === name.toLowerCase(),
  );
  let value: string | undefined;
  metas.each((_i, e) => {
    if (value) return;
    const candidate = $(e).attr('content')?.trim();
    if (candidate) value = candidate;
  });
  return value;
}
