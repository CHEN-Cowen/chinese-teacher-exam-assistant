/**
 * 一次性只读探测脚本（不进入提交）：检查列表页的公开动态栏目协议与列表结构。
 * 用法：node scripts/probe-list-shape.mjs <url> [url2 ...]
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

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
      'JiaozhaoYoujuBot/1.0 (+official-source-fetch)',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

for (const url of process.argv.slice(2)) {
  console.log(`\n===== ${url}`);
  let $;
  try {
    $ = load(curl(url));
  } catch (error) {
    console.log('  读取失败:', error.message);
    continue;
  }
  console.log('  title:', $('title').text().trim());
  const scripts = $('script[querydata][url]');
  console.log('  unitbuild scripts:', scripts.length);
  scripts.each((_i, element) => {
    console.log('    url=', $(element).attr('url'));
    console.log('    queryData=', String($(element).attr('querydata')).slice(0, 300));
  });
  const pagination = $('table.pagination');
  console.log(
    '  pagination:',
    pagination.length,
    'count=',
    pagination.first().attr('count'),
    'rows=',
    pagination.first().attr('rows'),
    'pageNo=',
    pagination.first().attr('pageno') ?? pagination.first().attr('pageNo'),
  );
  const listCandidates = [
    ['li a[href]', $('li a[href]')],
    ['table a[href]', $('table a[href]')],
    ['.list a[href]', $('.list a[href]')],
    ['.news-list a[href]', $('.news-list a[href]')],
    ['.article a[href]', $('.article a[href]')],
  ];
  for (const [name, nodes] of listCandidates) {
    if (nodes.length) {
      const first = nodes.first();
      const row = first.closest('li,tr');
      console.log(`  ${name}: ${nodes.length} 个, 首个 href=${first.attr('href')}`);
      console.log(`    行结构: ${row.prop('outerHTML')?.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  const dateNodes = $('.time, .date, span, td');
  let sample = '';
  dateNodes.each((_i, element) => {
    const text = ($(element).text() || '').trim();
    if (!sample && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      sample = $(element).parent().prop('outerHTML')?.replace(/\s+/g, ' ').slice(0, 300) ?? '';
    }
  });
  console.log('  日期行样本:', sample || '(未找到 yyyy-mm-dd)');
}
