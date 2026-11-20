/**
 * 一次性只读探测脚本（不进入提交）：批量检查候选官方栏目可达性与教师招聘相关链接。
 * 用法：node scripts/probe-sources.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const targets = JSON.parse(process.argv[2] ?? '[]');

function curl(url) {
  try {
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
        'JiaozhaoYoujuBot/1.0 (+official-source-fetch)',
        '-w',
        '\n@@STATUS:%{http_code}@@URL:%{url_effective}',
        url,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    return `@@ERROR:${(error.stderr || error.message).toString().slice(0, 200)}`;
  }
}

for (const target of targets) {
  const raw = curl(target.url);
  const marker = raw.lastIndexOf('@@STATUS:');
  const body = marker > 0 ? raw.slice(0, marker) : raw;
  const status = marker > 0 ? raw.slice(marker + 9).trim() : 'ERROR';
  const title = (() => {
    try {
      return load(body)('title').text().trim();
    } catch {
      return '(解析失败)';
    }
  })();
  const hits = [];
  try {
    const $ = load(body);
    $('a[href]').each((_i, element) => {
      const text = ($(element).attr('title') || $(element).text() || '').trim();
      if (!text) return;
      if (/教师.*招聘|招聘.*教师|教师招聘|公开招聘|选聘|教师引进|特岗/.test(text)) {
        hits.push(`${text.slice(0, 46)} -> ${$(element).attr('href')}`);
      }
    });
  } catch {
    /* 忽略 */
  }
  console.log(`\n=== ${target.name} ${target.url}`);
  console.log(`status=${status} title=${title}`);
  console.log(`recruitLinks=${hits.length}`);
  for (const hit of hits.slice(0, 12)) console.log('  -', hit);
}
