/**
 * 一次性只读探测脚本（不进入提交）：搜索站点地图/导航中可能的教师招聘栏目。
 * 用法：node scripts/find-recruit-columns.mjs <站点首页url>
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const UA = 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';

function curl(url) {
  return execFileSync(
    'curl',
    [
      '-sS',
      '--ssl-revoke-best-effort',
      '--connect-timeout',
      '10',
      '--max-time',
      '25',
      '-L',
      '-A',
      UA,
      url,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

const seed = process.argv[2];
const pattern = /招聘|人才|选聘|人事|师资|教师|编制|招录|选调/;
const seen = new Set();
const queue = [seed];

while (queue.length) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  let body;
  try {
    body = curl(url);
  } catch {
    continue;
  }
  const $ = load(body);
  $('a[href]').each((_i, element) => {
    const text = ($(element).attr('title') || $(element).text() || '').trim();
    const href = $(element).attr('href');
    if (!text || !href || text.length > 24) return;
    if (pattern.test(text)) {
      const absolute = new URL(href, url).href;
      console.log(`[命中] ${text} -> ${absolute}`);
    }
    if (/^\/col\/col\d+\/index\.html$/.test(href) && seen.size < 60) {
      queue.push(new URL(href, url).href);
    }
    if (/sitemap|wzdt|map/i.test(href) && seen.size < 60) {
      queue.push(new URL(href, url).href);
    }
  });
  if (seen.size > 60) break;
}
console.log(`\n共访问 ${seen.size} 个页面`);
