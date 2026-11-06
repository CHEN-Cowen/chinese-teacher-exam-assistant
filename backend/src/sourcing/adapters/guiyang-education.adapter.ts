/**
 * 贵阳市教育局「教师工作」栏目 Adapter（N3 跨省扩源，贵州省首个来源）。
 *
 * 真实官网形态（2026-11-06 实测）：
 * - 栏目 /newsite/zwgk/zdlyxxgk/jsgz/（政务公开 > 重点领域信息公开 > 教师工作），
 *   服务端渲染 `ul.right-cont_list li > a[href][title][target=_blank]`，
 *   锚点内 `<p>` 标题 + `<span>` 日期 YYYY-MM-DD，首屏 15 条；
 *   栏目为教师招聘密集栏目（公费师范生招聘/试教成绩、人才引进拟聘用、
 *   教师公开招聘拟聘用），仍按标题判定文档类型；
 * - 分页由官方脚本 `createPage(19, 0, "index", "html")` 声明（WCM 4 参数裸调用，
 *   总 19 页 / 277 条），由 `wcm5Pages` 派生 index_1.html…index_18.html，
 *   全量监测 19 页，无窗口截断；第 2 页与首屏 0 重叠；
 * - 详情页 /newsite/zwgk/zdlyxxgk/jsgz/<YYYYMM>/t<YYYYMMDD>_<id>.html：
 *   meta 标准名无空格（ArticleTitle / PubDate 值带时分 YYYY-MM-DD HH:mm /
 *   ContentSource）；正文容器 `div.TRS_UEDITOR`（多 class：
 *   trs_editor_view TRS_UEDITOR trs_paper_default trs_word）；
 *   附件为正文内 `./P0<数字>.pdf|xls|xlsx|doc|docx`（TRS WCM 命名，
 *   锚点文本即附件名，附 title/download 属性），同时存在零附件条目
 *   （名单直接写在正文表格内）。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/guiyang-education/
 */
import { load } from 'cheerio';
import {
  AdapterParseError,
  classifyDocumentKind,
  extractDate,
  normalizeUrl,
  resolveUrl,
  stripTags,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type LocatedAttachment,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

export const GUIYANG_ADAPTER_KEY = 'guiyang-education';

/** 详情地址形态：./<YYYYMM>/t<YYYYMMDD>_<id>.html（TRS WCM 静态发布命名） */
const GUIYANG_DETAIL_PATTERN = /t\d{8}_\d+\.html(?:[?#]|$)/;

/** 正文内附件：TRS WCM 发布的 ./P0<数字>.<ext> 相对路径 */
const GUIYANG_ATTACHMENT_PATTERN =
  /\/P\d{10,}\.(pdf|xlsx?|docx?|zip|rar)(?:[?#]|$)/i;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

/** 官方 meta 为标准名（无空格），按名称大小写不敏感取值并 trim */
function metaContent(
  $: ReturnType<typeof load>,
  names: readonly string[],
): string | undefined {
  let value: string | undefined;
  $('meta').each((_i, e) => {
    if (value) return;
    const name = ($(e).attr('name') ?? '').trim().toLowerCase();
    if (!names.some((target) => target.toLowerCase() === name)) return;
    const candidate = $(e).attr('content')?.trim();
    if (candidate) value = candidate;
  });
  return value;
}

export class GuiyangEducationAdapter implements OfficialSiteAdapter {
  readonly key = GUIYANG_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('贵阳教师工作栏目为静态列表，不应返回公开接口 JSON');
    }
    let baseHost: string;
    try {
      baseHost = new URL(input.url).hostname;
    } catch {
      throw mismatch('贵阳教师工作列表 URL 无效');
    }
    const $ = load(input.content);
    const rows = $('ul.right-cont_list li').has('a[href]');
    if (!rows.length) {
      throw mismatch('贵阳列表未找到 ul.right-cont_list li > a[href] 结构');
    }
    const items: DiscoveredDocument[] = [];
    const seen = new Set<string>();
    rows.each((_i, e) => {
      const link = $(e).find('a[href]').first();
      const href = link.attr('href') ?? '';
      if (!GUIYANG_DETAIL_PATTERN.test(href)) return;
      const title = (link.attr('title') ?? link.find('p').first().text())
        .replace(/\s+/g, ' ')
        .trim();
      if (!title) throw mismatch('贵阳列表条目缺少文章标题');
      const date = extractDate(
        link.find('span').first().text(),
        `贵阳列表日期（YYYY-MM-DD）: ${title}`,
      );
      const url = normalizeUrl(resolveUrl(input.url, href));
      if (new URL(url).hostname !== baseHost) return;
      if (seen.has(url)) return;
      seen.add(url);
      items.push({
        title,
        publishedAt: date,
        url,
        kind: classifyDocumentKind(title),
      });
    });
    if (!items.length) {
      throw mismatch('贵阳列表无任何条目（静默 0 条视为故障）');
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const title = metaContent($, ['ArticleTitle']);
    const date = metaContent($, ['PubDate', 'Pubdate']);
    const body = $('div.TRS_UEDITOR').first();
    if (!title || !date || body.length === 0) {
      throw mismatch(
        `贵阳正文缺少 ArticleTitle/PubDate meta 或 div.TRS_UEDITOR 正文容器: url=${input.url}`,
      );
    }
    const bodyHtml = body.html() ?? '';
    if (!stripTags(bodyHtml)) throw mismatch('贵阳正文 div.TRS_UEDITOR 容器为空');
    const attachments = new Map<string, LocatedAttachment>();
    body.find('a[href]').each((_i, e) => {
      const href = $(e).attr('href');
      if (!href) return;
      const target = resolveUrl(input.url, href);
      if (!GUIYANG_ATTACHMENT_PATTERN.test(target)) return;
      const name = $(e).text().replace(/\s+/g, ' ').trim();
      if (!name) throw mismatch('贵阳正文附件缺少名称');
      attachments.set(target, { name, url: target });
    });
    return {
      canonicalUrl: normalizeUrl(input.url),
      title,
      publishedAt: extractDate(date, '贵阳正文 PubDate'),
      bodyText: stripTags(bodyHtml),
      attachments: [...attachments.values()],
    };
  }
}
