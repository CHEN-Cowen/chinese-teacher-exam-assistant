import { readFileSync } from 'node:fs';

const t = readFileSync('.tmp-gz/jyj-home-jyj.gz.gov.cn_.html', 'utf8');
const anchors = [...t.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
const seen = new Map();
for (const m of anchors) {
  const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const key = m[1].trim();
  if (!key) continue;
  seen.set(key, text);
}
console.log('--- 栏目/招聘相关链接 ---');
for (const [url, text] of seen) {
  if (/tzgg|通知|公告|招聘|招考|公示|教师|师资|人事|政策|发布/i.test(url + ' ' + text)) {
    console.log(url + ' | ' + text.slice(0, 60));
  }
}
console.log('\n--- 所有栏目根路径（/xx/ 形式）---');
const rootCols = new Set();
for (const [url] of seen) {
  const mm = url.match(/^(?:https?:\/\/jyj\.gz\.gov\.cn)?(\/(?:[a-z0-9]+|yw2)\/)(?:index\.html)?$/i);
  if (mm) rootCols.add(mm[1]);
}
console.log([...rootCols]);
