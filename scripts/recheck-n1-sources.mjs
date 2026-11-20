/**
 * 一次性只读复核脚本（不进入提交）：重新抓取三个 N1 来源的列表页，
 * 与已保存的黄金样本比对条目（标题/日期/链接），并输出指纹。
 * 用法：node scripts/recheck-n1-sources.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
      '30',
      '-L',
      '-A',
      UA,
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

function fingerprint(items) {
  const lines = items
    .map((item) => `${item.title}\t${item.publishedAt}\t${item.url}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(lines).digest('hex');
}

const outRoot = path.resolve(process.cwd(), 'tests/fixtures/golden-sources');

function parseHuzhou(content, baseUrl) {
  const $ = load(JSON.parse(content).data.html);
  const items = [];
  $('.page-content tr').has('a[href]').each((_i, e) => {
    const link = $(e).find('a[href]').first();
    items.push({
      title: (link.attr('title') ?? link.text()).trim(),
      publishedAt: ($(e).find('td.yd_no').text().match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
      url: new URL(link.attr('href'), baseUrl).toString(),
    });
  });
  return items;
}

function parseTaizhou(content, baseUrl) {
  const $ = load(JSON.parse(content).data.html);
  const items = [];
  $('.page-content li').has('a[href]').each((_i, e) => {
    const link = $(e).find('a[href]').first();
    const rawTitle = link.attr('title');
    const title = !rawTitle || /\{\s*[\w.]+\s*\}/.test(rawTitle)
      ? link.text().trim()
      : rawTitle.trim();
    items.push({
      title,
      publishedAt: ($(e).find('span').first().text().match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
      url: new URL(link.attr('href'), baseUrl).toString(),
    });
  });
  return items;
}

function parseBozhou(content, baseUrl) {
  const $ = load(content);
  const items = [];
  $('section.m-tglist li').has('a[href]').each((_i, e) => {
    const link = $(e).find('a[href]').first();
    const url = new URL(link.attr('href'), baseUrl).toString();
    if (!/\/OpennessContent\/show\/\d+\.html/.test(url)) return;
    items.push({
      title: (link.attr('title') ?? link.text()).trim(),
      publishedAt: ($(e).find('span').first().text().match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
      url,
    });
  });
  return items;
}

function parseFuyang(content, baseUrl) {
  const $ = load(content);
  const items = [];
  $('div.m-cglist.m-liststyle1 li').has('a[href]').each((_i, e) => {
    const link = $(e).find('a[href]').first();
    const url = new URL(link.attr('href'), baseUrl).toString();
    if (!/\/Content\/show\/\d+\.html/.test(url)) return;
    items.push({
      title: (link.attr('title') ?? link.text()).trim(),
      publishedAt: ($(e).find('span').first().text().match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
      url,
    });
  });
  return items;
}

function parseJinan(content, baseUrl) {
  const $ = load(JSON.parse(content).data.html);
  const items = [];
  $('.page-content tr').has('a[href]').each((_i, e) => {
    const link = $(e).find('a[href]').first();
    items.push({
      title: (link.attr('title') ?? link.text()).trim(),
      publishedAt: ($(e).find('td.bt_time').text().match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0],
      url: new URL(link.attr('href'), baseUrl).toString(),
    });
  });
  return items;
}

const targets = [
  {
    key: 'huzhou',
    fixture: 'public-list.json',
    url: JSON.parse(readFileSync(path.join(outRoot, 'huzhou', 'public-manifest.json'), 'utf8')).files.find((f) => f.name === 'public-list.json').url,
    parse: parseHuzhou,
  },
  {
    key: 'taizhou',
    fixture: 'public-list.json',
    url: JSON.parse(readFileSync(path.join(outRoot, 'taizhou', 'public-manifest.json'), 'utf8')).files.find((f) => f.name === 'public-list.json').url,
    parse: parseTaizhou,
  },
  {
    key: 'bozhou',
    fixture: 'public-shell.html',
    url: JSON.parse(readFileSync(path.join(outRoot, 'bozhou', 'public-manifest.json'), 'utf8')).files.find((f) => f.name === 'public-shell.html').url,
    parse: parseBozhou,
  },
  {
    key: 'fuyang',
    fixture: 'public-shell.html',
    url: JSON.parse(readFileSync(path.join(outRoot, 'fuyang', 'public-manifest.json'), 'utf8')).files.find((f) => f.name === 'public-shell.html').url,
    parse: parseFuyang,
  },
  {
    key: 'jinan',
    fixture: 'public-list.json',
    url: JSON.parse(readFileSync(path.join(outRoot, 'jinan', 'public-manifest.json'), 'utf8')).files.find((f) => f.name === 'public-list.json').url,
    parse: parseJinan,
  },
];

for (const target of targets) {
  const fresh = curl(target.url);
  const items = target.parse(fresh, target.url);
  const saved = target.parse(
    readFileSync(path.join(outRoot, target.key, target.fixture), 'utf8'),
    target.url,
  );
  const same =
    items.length === saved.length &&
    JSON.stringify(
      [...items].sort((a, b) => a.url.localeCompare(b.url)),
    ) ===
      JSON.stringify([...saved].sort((a, b) => a.url.localeCompare(b.url)));
  console.log(
    `${target.key} checkedAt=${new Date().toISOString()} status=200 items=${items.length} saved=${saved.length} unchanged=${same} hash=${fingerprint(items)}`,
  );
}
