/**
 * 一次性只读探测脚本（不进入提交）：打印页面导航链接文本，便于人工确认官方栏目。
 * 用法：node scripts/dump-links.mjs <url> [关键词正则]
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const url = process.argv[2];
const pattern = process.argv[3] ? new RegExp(process.argv[3]) : null;
const maxLength = Number(process.argv[4] ?? 30);

const raw = execFileSync(
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
    'JiaozhaoYoujuBot/1.0 (+official-source-fetch)',
    '-w',
    '\n@@STATUS:%{http_code}',
    url,
  ],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
const marker = raw.lastIndexOf('@@STATUS:');
const body = marker > 0 ? raw.slice(0, marker) : raw;
const status = marker > 0 ? raw.slice(marker + 9).trim() : 'ERROR';
const $ = load(body);
console.log(`status=${status} title=${$('title').text().trim()}`);
const seen = new Set();
$('a[href]').each((_i, element) => {
  const text = ($(element).attr('title') || $(element).text() || '').trim();
  if (!text || text.length > maxLength) return;
  if (pattern && !pattern.test(text)) return;
  if (seen.has(text)) return;
  seen.add(text);
  console.log(`${text} -> ${$(element).attr('href')}`);
});
