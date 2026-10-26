/**
 * S5 真实来源样本采集（只读，仅用于人工核验取证）。
 *
 * 用法：node scripts/capture-jpaas-source.mjs <outDir> <columnUrl> <detailUrl>
 * 采集官方外壳页、公开列表接口（含后续页）与正文页，写入 outDir 并生成统一 manifest。
 * 不参与生产链路，不写库。
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

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

/** 官方 querydata 为单引号 JSON 风格，仅解析不执行。 */
function parseQueryData(raw) {
  const out = {};
  const re = /'([^']+)'\s*:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(raw))) out[m[1]] = m[2];
  return out;
}

function shellRequest(baseUrl, html) {
  const $ = load(html);
  const script = $('script[querydata][url]')
    .filter((_i, e) =>
      ($(e).attr('src') ?? '').includes('/AuthorizedRead/unitbuild.js'),
    )
    .first();
  if (!script.length) return null;
  const url = script.attr('url');
  const raw = script.attr('querydata');
  if (!url || !raw) return null;
  const parsed = new URL(url, baseUrl);
  for (const [k, v] of Object.entries(parseQueryData(raw)))
    parsed.searchParams.set(k, v);
  return parsed.href;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const [outDir, columnUrl, detailUrl, maxPageArg] = process.argv.slice(2);
if (!outDir || !columnUrl || !detailUrl) {
  console.error(
    '用法: node scripts/capture-jpaas-source.mjs <outDir> <columnUrl> <detailUrl> [maxPages]',
  );
  process.exit(1);
}
// 样本只用于离线回放核验，不追求抓完整个栏目；
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

const shell = await get(columnUrl);
await save('public-shell.html', shell.url, shell.text, files);

const requestUrl = shellRequest(shell.url, shell.text);
if (!requestUrl) throw new Error('未找到 script[querydata] 公开接口配置');
console.log(`  接口 ${requestUrl}`);
const list = await get(requestUrl);
await save('public-list.json', list.url, list.text, files);

const payload = JSON.parse(list.text);
const html = payload?.data?.html ?? '';
const $ = load(html);
const node = $('table.pagination, div.pagination').first();
let paging = null;
const readInlinePaging = () => {
  // 丽水形态：分页配置在官方内联脚本 initJpage({...}) 中，不在 DOM 属性上。
  const inline = $('script')
    .map((_i, e) => $(e).text())
    .get()
    .map((text) => text.match(/initJpage\(\s*\{([\s\S]*?)\}\s*\);/))
    .find(Boolean);
  if (!inline) return null;
  const body = inline[1];
  const read = (key) => body.match(new RegExp(`${key}\\s*:\\s*["']?(\\d+)`))?.[1];
  return {
    count: Number(read('count')),
    rows: Number(read('rows')),
    pageNo: Number(read('pageNo')),
  };
};
if (node.length) {
  // 官方分页属性名大小写不统一（pageno / pageNo），逐个尝试只读取值，
  // 不能用 attr(name, value) 两参形式（那是 setter，会污染 DOM）。
  const attr = (...names) => {
    for (const name of names) {
      const value = node.attr(name);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const candidate = {
    count: Number(attr('count')),
    rows: Number(attr('rows')),
    pageNo: Number(attr('pageno', 'pageNo')),
  };
  if (
    Number.isSafeInteger(candidate.count) &&
    candidate.count >= 0 &&
    Number.isSafeInteger(candidate.rows) &&
    candidate.rows >= 1 &&
    Number.isSafeInteger(candidate.pageNo) &&
    candidate.pageNo >= 1
  ) {
    paging = candidate;
  }
}
if (!paging) paging = readInlinePaging();
if (paging) {
  const { count, rows, pageNo } = paging;
  console.log(`  分页 count=${count} rows=${rows} pageNo=${pageNo}`);
  const total = Math.ceil(count / rows);
  for (let next = 2; next <= Math.min(total, maxPages); next += 1) {
    const u = new URL(requestUrl);
    u.searchParams.set(
      'paramJson',
      JSON.stringify({ pageNo: next, pageSize: String(rows) }),
    );
    const page = await get(u.href);
    await save(`public-page${next}.json`, page.url, page.text, files);
  }
} else {
  console.log('  未发现分页节点');
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
