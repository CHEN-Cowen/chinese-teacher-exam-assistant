/**
 * 重庆市人力资源和社会保障局「事业单位公开招聘」栏目 Adapter
 * （N4 全国扩源，重庆市首个来源）。
 *
 * 定位：重庆市人社局 > 政务公开 > 事业单位公开招聘
 * （https://rlsbj.cq.gov.cn/zwxx_182/sydw/，年度子目录 sydwgkzp<YYYY>/）。
 *
 * 真实官网形态（2026-11-20 核验）：
 * - 服务端渲染静态列表：ul li > a[href][title] + span（YYYY-MM-DD）；
 * - 分页由 createPage(N, 0, "index", "html") 生成同目录 index_N.html；
 * - 详情页形如 /zwxx_182/sydw/sydwgkzp<YYYY>/<YYYYMM>/t<YYYYMMDD>_<id>.html；
 * - 正文容器为 div.xl-article；附件不在正文 DOM 中，而是脚本变量
 *   var hasFJ='<a href="./P0....xlsx">附件1：...</a><BR/>...'，
 *   若不解析该变量会完整漏掉岗位表（与黄石缺失岗位表同类风险）。
 *
 * 覆盖价值：省级综合事业单位公开招聘栏目，含万州、开州等区县教育事业单位
 * 教师/公费师范生岗位，也混有卫健、综合管理等非教师公告；按标题只保留
 * 教育、教师、学校相关条目。市级/省级综合栏目不能替代各区县独立渠道。
 *
 * 约定同其他来源：只吃快照、不联网、不写库、不抽取资格结论；
 * DOM 骨架失配抛 AdapterParseError('DOM_MISMATCH')，绝不静默返回 0 条。
 *
 * 关联真实样本：tests/fixtures/golden-sources/chongqing-rsj/
 */
import {
  discoverStaticAnchorList,
  locateOfficialArticle,
} from '../public-column.js';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type DiscoveredDocument,
  type ListPageSnapshot,
  type LocatedArticle,
  type LocatedAttachment,
  type OfficialSiteAdapter,
} from '../official-site-adapter.js';

export const CHONGQING_RSJ_ADAPTER_KEY = 'chongqing-rsj-recruitment';

/** 详情页形如 /zwxx_182/sydw/sydwgkzp<YYYY>/<YYYYMM>/t<YYYYMMDD>_<id>.html。 */
const CHONGQING_DETAIL_PATTERN =
  /\/zwxx_182\/sydw\/sydwgkzp\d{4}\/\d{6}\/t\d{8}_\d+\.html(?:[?#]|$)/;

/** 综合事业单位栏目中的教师相关标题过滤。 */
const TEACHER_TITLE_PATTERN =
  /(教育|教师|学校|幼儿园|附中|附小|大学|学院|教委|公费师范)/;

/** 综合栏目中的非教师系统标题。 */
const NON_TEACHER_TITLE_PATTERN = /(医院|卫生健康|卫生计生|科学院)/;

const HAS_FJ_PATTERN = /var\s+hasFJ\s*=\s*'([\s\S]*?)';/;
const ANCHOR_PATTERN = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

function mismatch(message: string): AdapterParseError {
  return new AdapterParseError('DOM_MISMATCH', message);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * 解析正文之外的 hasFJ 附件脚本变量。
 * 该站附件是 document.write 动态生成，静态 DOM 中没有 <a>，必须读脚本变量。
 */
function parseHasFjAttachments(
  pageUrl: string,
  html: string,
): LocatedAttachment[] {
  const match = HAS_FJ_PATTERN.exec(html);
  if (!match?.[1]) return [];
  const raw = match[1];
  const attachments: LocatedAttachment[] = [];
  for (const anchor of raw.matchAll(ANCHOR_PATTERN)) {
    const href = anchor[1]?.trim();
    const name = stripTags(anchor[2] ?? '');
    if (!href || !name) continue;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    attachments.push({ name, url });
  }
  return attachments;
}

export class ChongqingRsjRecruitmentAdapter implements OfficialSiteAdapter {
  readonly key = CHONGQING_RSJ_ADAPTER_KEY;

  discover(input: ListPageSnapshot): DiscoveredDocument[] {
    if (input.content.trimStart().startsWith('{')) {
      throw mismatch('重庆人社局栏目为静态列表，不应返回公开接口 JSON');
    }
    const items = discoverStaticAnchorList(
      input.url,
      input.content,
      CHONGQING_DETAIL_PATTERN,
      'ul li',
    );
    return items.filter(
      (item) =>
        TEACHER_TITLE_PATTERN.test(item.title) &&
        !NON_TEACHER_TITLE_PATTERN.test(item.title),
    );
  }

  locateArticle(input: ArticlePageSnapshot): LocatedArticle {
    let article: LocatedArticle;
    try {
      article = locateOfficialArticle(input.url, input.content);
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw mismatch('重庆人社局正文页解析失败，页面结构可能已改版');
    }
    // 附件在正文外，必须额外解析 hasFJ，避免完整漏掉岗位一览表。
    const extra = parseHasFjAttachments(input.url, input.content);
    if (extra.length > 0) {
      const seen = new Set(article.attachments.map((item) => item.url));
      for (const attachment of extra) {
        if (seen.has(attachment.url)) continue;
        article.attachments.push(attachment);
        seen.add(attachment.url);
      }
    }
    return article;
  }
}
