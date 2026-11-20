/** 一次性只读探测（不进入提交）：输出栏目列表条目与分页结构。 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const file = process.argv[2];
const columnPattern = new RegExp(process.argv[3] || '');
const $ = load(readFileSync(file, 'utf8'));

const items = [];
$('a[href]').each((_i, element) => {
  const href = $(element).attr('href') || '';
  if (!columnPattern.test(href)) return;
  const li = $(element).closest('li');
  items.push({
    title: ($(element).attr('title') || $(element).text() || '').trim(),
    href,
    liText: li.text().replace(/\s+/g, ' ').trim(),
    liHtml: li.html() ? li.html().replace(/\s+/g, ' ').trim().slice(0, 260) : '',
  });
});
console.log(`items: ${items.length}`);
console.log(items.slice(0, 4).map((i) => JSON.stringify(i)).join('\n'));

console.log('--- pagination ---');
for (const sel of [
  'a[href*="index_"]',
  '.pages a',
  '.page a',
  '.pagination a',
]) {
  const n = $(sel).length;
  if (n) console.log(sel, '->', n, $(sel).first().attr('href'));
}
const html = $.html();
const m = html.match(/[^"']*index[^"']*/g);
console.log('index urls:', (m || []).slice(0, 8).join('\n'));
