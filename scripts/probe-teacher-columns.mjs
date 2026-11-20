/**
 * 一次性只读探测脚本（不进入提交）：在官方站点导航中定位“教师招聘”专栏入口。
 * 用法：node scripts/probe-teacher-columns.mjs <站点首页url> [maxPages]
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const UA = 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';

function curl(url) {
  try {
    return execFileSync(
      'curl',
      ['-sS','-k','--ssl-revoke-best-effort','--connect-timeout','10','--max-time','20','-L','-A',UA,
       '-w','\n@@STATUS:%{http_code}@@',url],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (e) {
    return `@@ERROR:${(e.stderr || e.message).toString().slice(0, 120)}`;
  }
}

const seed = process.argv[2];
const maxPages = Number(process.argv[3] ?? 40);
if (!seed) { console.error('用法: node scripts/probe-teacher-columns.mjs <站点首页url> [maxPages]'); process.exit(1); }

// 栏目候选：标题含“教师/师资/教工/教职工”且含“招聘/选聘/引进/招考/甄选/选调”
const COLUMN_RE = /(教师|师资|教工|教职工|教育系统).{0,10}(招聘|选聘|引进|招考|甄选|选调|遴选)/;
// 严格命中：标题同时含“教师”和“招聘”
const STRICT_RE = /教师.{0,6}招聘|招聘.{0,6}教师/;

const seen = new Set();
const queue = [seed];
const hits = [];
const colLinks = [];

while (queue.length && seen.size < maxPages) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  const raw = curl(url);
  const i = raw.lastIndexOf('@@STATUS:');
  if (i <= 0) continue;
  const body = raw.slice(0, i);
  let $;
  try { $ = load(body); } catch { continue; }
  $('a[href]').each((_i, e) => {
    const t = ($(e).attr('title') || $(e).text() || '').trim();
    const h = $(e).attr('href');
    if (!t || !h || t.length > 30) return;
    let abs;
    try { abs = new URL(h, url).href; } catch { return; }
    if (/^(javascript|mailto|tel):/i.test(h)) return;
    if (STRICT_RE.test(t)) hits.push({ t, abs, from: url });
    else if (COLUMN_RE.test(t)) colLinks.push({ t, abs, from: url });
    // 顺着栏目/政务公开/通知公告/人事信息入口继续找
    if (/^\/(col|zfxxgk|xxgk|module|zwgk|Content\/showList|OpennessContent\/showList|XxgkContent\/showList)\//i.test(h) && seen.size + queue.length < maxPages) {
      queue.push(abs);
    }
    if (/(index(_?\d+)?\.s?html?)$/i.test(h) && /\/col\/col\d+/i.test(abs) && seen.size + queue.length < maxPages) {
      queue.push(abs);
    }
  });
}

console.log(`\n### ${seed}  访问 ${seen.size} 页`);
console.log('-- 严格命中（教师+招聘）--');
const uniq = new Map();
for (const x of hits) { if (!uniq.has(x.abs)) uniq.set(x.abs, x); }
for (const x of uniq.values()) console.log(`  [${x.t}] -> ${x.abs}\n      (来自 ${x.from})`);
console.log(`  合计 ${uniq.size}`);
console.log('-- 栏目候选 --');
const uniq2 = new Map();
for (const x of colLinks) { if (!uniq2.has(x.abs)) uniq2.set(x.abs, x); }
for (const x of uniq2.values()) console.log(`  [${x.t}] -> ${x.abs}`);
console.log(`  合计 ${uniq2.size}`);
