/**
 * S5 批量探测脚本（只读，不写库、不改状态）。
 *
 * 目标：找出「官方发布机构 + 具体招聘栏目」的真实入口。
 * 流程：抓首页 → 收集站内候选栏目链接 → 逐个抓栏目页 →
 *       用标题关键词判断是否含真实教师招聘公告 → 输出报告。
 *
 * 判定口径（与 S0 规范一致）：
 * - 必须是具体栏目页，不能是站点首页；
 * - 栏目页内必须出现带日期的公告条目，标题命中教师招聘语义；
 * - 混合栏目（招聘/采购/任免混排）只作候选，不作稳定来源。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const UA = 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';

const KEYWORDS = /教师|教师招|教师选聘|教师招聘|优才|kaoshi|师资|招聘|选聘|招录|人才引进/;
const STRONG = /教师|优才|选聘|招录|人才引进/;

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  return { status: res.status, url: res.url, text };
}

/** 从首页收集站内栏目候选链接 */
function candidateColumns(html, base) {
  const $ = load(html);
  const out = new Map();
  $('a[href]').each((_i, e) => {
    const title = ($(e).attr('title') || $(e).text() || '')
      .replace(/\s+/g, ' ')
      .trim();
    const href = $(e).attr('href') || '';
    if (!title || !href) return;
    if (href.startsWith('#') || href.startsWith('javascript:')) return;
    if (!/教师|招聘|选聘|招录|人才|人事|师资|招考|公示|公告/.test(title))
      return;
    if (title.length > 20) return;
    let abs;
    try {
      abs = new URL(href, base).href;
    } catch {
      return;
    }
    if (new URL(abs).origin !== new URL(base).origin) return;
    out.set(abs, title);
  });
  return out;
}

/** 判断栏目页是否含真实招聘公告条目 */
function inspectColumn(html, url) {
  const $ = load(html);
  const rows = [];
  $('a[title]').each((_i, e) => {
    const title = ($(e).attr('title') || '').trim();
    if (!title) return;
    let node = $(e).closest('li, tr');
    if (!node.length) node = $(e).parent();
    const text = node.text().replace(/\s+/g, ' ').trim();
    const date =
      text.match(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/)?.[0] ??
      text.match(/\d{1,2}\/\d{1,2}/)?.[0] ??
      '';
    rows.push({ title, date, href: $(e).attr('href') });
  });
  if (!rows.length) {
    $('a').each((_i, e) => {
      const title = $(e).text().replace(/\s+/g, ' ').trim();
      if (title.length < 8) return;
      if (!KEYWORDS.test(title)) return;
      let node = $(e).closest('li, tr');
      if (!node.length) node = $(e).parent();
      const text = node.text().replace(/\s+/g, ' ').trim();
      const date =
        text.match(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/)?.[0] ?? '';
      rows.push({ title, date, href: $(e).attr('href') });
    });
  }
  const strong = rows.filter((r) => STRONG.test(r.title));
  return { total: rows.length, strong: strong.length, sample: strong.slice(0, 3) };
}

const targets = process.argv.slice(2);
for (const home of targets) {
  console.log(`\n===== ${home} =====`);
  let page;
  try {
    page = await get(home);
  } catch (error) {
    console.log(`  首页失败：${error.message}`);
    continue;
  }
  console.log(`  首页 ${page.status} ${page.url} (${page.text.length}B)`);
  const cols = candidateColumns(page.text, page.url);
  console.log(`  候选栏目 ${cols.size} 个`);
  for (const [url, title] of cols) {
    let col;
    try {
      col = await get(url);
    } catch (error) {
      console.log(`  - [FAIL] ${title} ${url} :: ${error.message}`);
      continue;
    }
    if (col.status !== 200) {
      console.log(`  - [${col.status}] ${title} ${url}`);
      continue;
    }
    const info = inspectColumn(col.text, url);
    if (info.strong === 0) continue;
    console.log(
      `  - [HIT ${info.strong}/${info.total}] ${title}\n      ${url}\n      ${info.sample
        .map((s) => `${s.date || '(无日期)'} ${s.title.slice(0, 44)}`)
        .join('\n      ')}`,
    );
  }
}
