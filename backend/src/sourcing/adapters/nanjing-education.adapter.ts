/**
 * 南京教育局教师招聘栏目 Adapter（v7.2 自动抓取新增来源）。
 *
 * 定位：南京市教育局「教师招聘」栏目（办事服务 → 招聘招考）。
 *   - 列表页：https://edu.nanjing.gov.cn/bsfw/zpzk/（含分页 index.html / index_1.html …）
 *   - 详情页：/bsfw/zpzk/{YYYYMM}/t{YYYYMMDD}_{id}.html
 *   - 岗位表附件：PDF（文本型，pdfjs-dist 可提取），URL 形如 ./P020260109XXXX.pdf
 *
 * 约定（与官方适配器契约一致）：
 * - 只消费 SafeFetcher 产出的不可变快照，不联网、不写库、不抽取用户资格结论；
 * - 输出规范化绝对 URL 与最小元数据（标题/发布时间/正文/附件）；
 * - DOM 骨架失配抛 `AdapterParseError('DOM_MISMATCH')`，绝不静默返回 0 条。
 *
 * 关联黄金样本：tests/fixtures/golden-sources/nanjing/{list,detail}.html
 *（真实抓取自南京市教育局官网，2026-10-21）。
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

/** 来源标识：与抓取白名单/来源登记保持一致 */
export const NANJING_ADAPTER_KEY = 'nanjing-education';

/** 列表项缺失 href/span、容器缺失等，统一抛出此错误（不静默降级） */
function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

export class NanjingEducationAdapter implements OfficialSiteAdapter {
  readonly key = NANJING_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    const $ = load(input.content);
    // 南京列表容器：div.list-right-con > ul > li（li 内含 a[href][title] + span 日期）
    const container = $('div.list-right-con ul');
    if (container.length === 0) {
      throw mismatch('南京列表页未找到 div.list-right-con ul 容器，页面结构可能已改版');
    }
    const items: DiscoveredDocument[] = [];
    container.find('li').each((_index, element) => {
      const link = $(element).find('a[href]').first();
      const dateNode = $(element).find('span').first();
      const href = link.attr('href');
      if (link.length === 0 || !href) {
        throw mismatch('南京列表条目缺少 href 链接，页面结构可能已改版');
      }
      if (dateNode.length === 0) {
        throw mismatch('南京列表条目缺少日期节点，页面结构可能已改版');
      }
      // 标题优先取 title 属性（完整），其次取链接文本
      const title = stripTags(link.attr('title') ?? link.html() ?? '');
      items.push({
        title,
        publishedAt: extractDate(stripTags(dateNode.html() ?? ''), '列表条目日期'),
        url: resolveUrl(input.url, href),
        kind: classifyDocumentKind(title),
      });
    });
    if (items.length === 0) {
      throw mismatch('南京列表页 div.list-right-con ul 内没有任何条目（静默 0 条视为故障）');
    }
    return items;
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    const $ = load(input.content);
    const titleNode = $('div.doctitle').first();
    const bodyNode = $('div.doccontent').first();
    if (titleNode.length === 0 || bodyNode.length === 0) {
      throw mismatch('南京正文页缺少 .doctitle/.doccontent，页面结构可能已改版');
    }

    // 发布时间：优先 meta[name=PubDate]（content 形如 2026-01-09 15:29:00），
    // 否则从 .field_con1 的「发布时间：…」提取。
    const pubDateMeta = $('meta[name="PubDate"]').first().attr('content');
    let publishedAt: string;
    if (pubDateMeta) {
      publishedAt = extractDate(pubDateMeta, '正文页 meta[PubDate]');
    } else {
      const fieldText = stripTags($('div.field_con1').first().html() ?? '');
      publishedAt = extractDate(fieldText, '正文页 .field_con1');
    }

    // 附件：南京官网（TRS/ZCMS）把附件链接放在 document.write('<a href=...>...') 的
    // script 字符串里，cheerio 不会把其解析为 DOM 元素，需从原始 HTML 用正则提取。
    // 提取形如 href="...pdf" 与紧跟的文本（文件名），排除导航/详情页 .html 链接。
    const attachments: LocatedAttachment[] = [];
    const seen = new Set<string>();
    const attachPattern =
      /href="([^"]*(?:\.pdf|\.xlsx?|\.docx?|\.zip|\.rar))"[^>]*>([^<]*)</gi;
    let match: RegExpExecArray | null;
    while ((match = attachPattern.exec(input.content)) !== null) {
      const href = match[1];
      const rawName = match[2];
      const url = resolveUrl(input.url, href);
      if (seen.has(url)) continue;
      seen.add(url);
      const name = stripTags(rawName).replace(/^\d+\.\s*/, '').trim();
      if (!name) continue;
      attachments.push({ name, url });
    }

    return {
      canonicalUrl: normalizeUrl(resolveUrl(input.url, input.url)),
      title: stripTags(titleNode.html() ?? ''),
      publishedAt,
      bodyText: stripTags(bodyNode.html() ?? ''),
      attachments,
    };
  }
}
