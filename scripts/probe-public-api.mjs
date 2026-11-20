/**
 * 一次性只读探测脚本（不进入提交）：验证 jpaas 公开动态栏目接口的实际返回。
 * 用法：node scripts/probe-public-api.mjs <列表页url> [...]
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

for (const listUrl of process.argv.slice(2)) {
  console.log(`\n===== ${listUrl}`);
  const shell = load(curl(listUrl));
  const script = shell('script[querydata][url]').first();
  if (!script.length) {
    console.log('  无公开动态接口');
    continue;
  }
  const queryData = script.attr('querydata');
  const endpoint = new URL(script.attr('url'), listUrl);
  const query = JSON.parse(queryData.replace(/'/g, '"'));
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') endpoint.searchParams.set(key, value);
  }
  console.log('  接口:', endpoint.href);
  try {
    const body = curl(endpoint.href);
    const data = JSON.parse(body);
    console.log('  success:', data.success, 'html 长度:', String(data.data?.html ?? '').length);
    const html = String(data.data?.html ?? '');
    const $ = load(html);
    const rows = $('.page-content tr');
    const listItems = $('.page-content li');
    console.log('  page-content tr:', rows.length, ' li:', listItems.length);
    if (rows.length) {
      console.log('  行样本:', rows.first().prop('outerHTML')?.replace(/\s+/g, ' ').slice(0, 400));
    } else if (listItems.length) {
      console.log('  行样本:', listItems.first().prop('outerHTML')?.replace(/\s+/g, ' ').slice(0, 400));
    }
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
    const titles = [];
    $('a[title]').each((_i, element) => {
      const text = ($(element).attr('title') || '').trim();
      if (text && titles.length < 8) titles.push(text);
    });
    console.log('  公告标题:');
    for (const title of titles) console.log('   -', title.slice(0, 60));
  } catch (error) {
    console.log('  接口读取失败:', error.message.slice(0, 300));
  }
}
