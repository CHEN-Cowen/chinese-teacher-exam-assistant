/**
 * 一次性只读探测/采集脚本（不进入提交）：采集安徽蚌埠市教育局「教师招聘」
 * 栏目的服务端渲染列表（含后续页）与正文页，写入 outDir 并生成统一 manifest。
 *
 * 用法：node scripts/capture-static-column.mjs <outDir> <columnUrl> <columnId> <detailUrl> [maxPages]
 *
 * 与 capture-jpaas-source.mjs 的区别：本脚本面向**服务端渲染**的静态列表
 * （jpaas 外壳页不含列表数据，本脚本不适用）。分页 URL 形如
 * /content/column/<columnId>?pageIndex=N，总数在官方 Ls.pagination 的
 * total/pageCount 配置里。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const UA = 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return { status: res.status, url: res.url, text };
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const [outDir, columnUrl, columnId, detailUrl, maxPageArg] = process.argv.slice(2);
if (!outDir || !columnUrl || !columnId || !detailUrl) {
  console.error(
    '用法: node scripts/capture-static-column.mjs <outDir> <columnUrl> <columnId> <detailUrl> [maxPages]',
  );
  process.exit(1);
}
// 样本只用于离线回放核验，不追求抓完整个栏目：
// 默认只保留首屏与第 2 页，避免把整站列表当成"已核验"证据。
const maxPages = Number(maxPageArg ?? 2);
mkdirSync(outDir, { recursive: true });

const capturedAt = new Date().toISOString();
const files = [];
const detailFiles = [];

async function save(name, url, text, bucket) {
  writeFileSync(path.join(outDir, name), text, 'utf8');
  bucket.push({ name, url, sha256: sha256(text) });
  console.log(`  抓取 ${name} (${text.length}B) ${url}`);
}

const first = await get(columnUrl);
await save('public-shell.html', first.url, first.text, files);

// 官方分页配置来自内联 Ls.pagination({...})：pageCount / total。
const paging = first.text.match(
  /Ls\.pagination\(\s*['"]#[^'"]*['"]\s*,[\s\S]{0,400}?pageCount\s*:\s*(\d+)[\s\S]{0,200}?total\s*:\s*(\d+)/,
);
let pageCount = paging ? Number(paging[1]) : null;
let total = paging ? Number(paging[2]) : null;
if (pageCount === null) {
  const alt = first.text.match(/pageCount\s*:\s*(\d+)/);
  pageCount = alt ? Number(alt[1]) : 1;
}
if (total === null) {
  const alt = first.text.match(/total\s*:\s*(\d+)/);
  total = alt ? Number(alt[1]) : null;
}
console.log(`  分页 pageCount=${pageCount} total=${total}`);

const cap = Math.min(pageCount, maxPages);
for (let next = 2; next <= cap; next += 1) {
  const page = await get(
    `https://jyj.bengbu.gov.cn/content/column/${columnId}?pageIndex=${next}`,
  );
  await save(`public-page${next}.html`, page.url, page.text, files);
}

const detail = await get(detailUrl);
await save('public-detail.html', detail.url, detail.text, detailFiles);

writeFileSync(
  path.join(outDir, 'public-manifest.json'),
  `${JSON.stringify(
    {
      capturedAt,
      sourceKind: 'official-live-snapshot',
      scope: 'first-page-discovery-only',
      stableMonitoringVerified: false,
      files,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
writeFileSync(
  path.join(outDir, 'public-detail-manifest.json'),
  `${JSON.stringify(
    {
      capturedAt,
      sourceKind: 'official-live-snapshot',
      scope: 'article-and-attachment-links-only',
      stableMonitoringVerified: false,
      files: detailFiles,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log('完成');
