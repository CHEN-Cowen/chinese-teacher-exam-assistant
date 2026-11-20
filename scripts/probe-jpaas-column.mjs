/**
 * S5 jpaas 公开栏目探测（只读）。
 *
 * 从栏目外壳页提取官方 script[querydata] 配置，构造同源公开 GET 请求，
 * 输出返回的列表条目，便于判断该来源是否含真实教师招聘公告。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const UA = 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';

function parseQueryData(raw) {
  // 单引号 JSON 风格：{'k':'v',...}
  const out = {};
  const re = /'([^']+)'\s*:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(raw))) out[m[1]] = m[2];
  return out;
}

function shellRequest(baseUrl, html) {
  const $ = load(html);
  const script = $('script[querydata]').first();
  if (!script.length) return null;
  const url = script.attr('url');
  const raw = script.attr('querydata');
  if (!url || !raw) return null;
  const parsed = new URL(url, baseUrl);
  for (const [k, v] of Object.entries(parseQueryData(raw))) {
    parsed.searchParams.set(k, v);
  }
  return parsed.href;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, url: res.url, text: await res.text() };
}

const KEYWORDS = /教师|优才|选聘|招录|人才引进|公开招聘/;

for (const columnUrl of process.argv.slice(2)) {
  console.log(`\n===== ${columnUrl} =====`);
  let shell;
  try {
    shell = await get(columnUrl);
  } catch (error) {
    console.log(`  外壳失败：${error.message}`);
    continue;
  }
  console.log(`  外壳 ${shell.status} (${shell.text.length}B)`);
  const requestUrl = shellRequest(shell.url, shell.text);
  if (!requestUrl) {
    console.log('  未找到 script[querydata] 公开接口配置');
    continue;
  }
  console.log(`  接口 ${requestUrl.slice(0, 160)}`);
  let list;
  try {
    list = await get(requestUrl);
  } catch (error) {
    console.log(`  接口失败：${error.message}`);
    continue;
  }
  console.log(`  接口 ${list.status} (${list.text.length}B)`);
  let payload;
  try {
    payload = JSON.parse(list.text);
  } catch {
    console.log('  接口返回非 JSON');
    continue;
  }
  if (!payload.success) {
    console.log(`  接口 success=${payload.success} message=${payload.message}`);
    continue;
  }
  const html = payload.data?.html ?? '';
  const $ = load(html);
  const lis = $('.page-content li');
  const rows = $('a[title]');
  console.log(`  列表：li=${lis.length} a[title]=${rows.length}`);
  const out = [];
  lis.each((_i, li) => {
    const a = $(li).find('a[title]').first();
    const date = $(li).find('span').first().text().trim();
    out.push({
      date,
      title: a.text().replace(/\s+/g, ' ').trim(),
      href: a.attr('href'),
    });
  });
  const hits = out.filter((r) => KEYWORDS.test(r.title));
  console.log(`  命中招聘关键词 ${hits.length}/${out.length}`);
  for (const row of out.slice(0, 12)) {
    console.log(`    ${row.date || '(无日期)'} | ${row.title.slice(0, 52)} | ${row.href}`);
  }
}
