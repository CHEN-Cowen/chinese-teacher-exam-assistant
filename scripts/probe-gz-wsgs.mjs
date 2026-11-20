// 探测广州教育局「网上公示」与人事工作栏目（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function get(urlStr) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  const [ip] = await dns.promises.resolve4(url.hostname);
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        method: 'GET',
        host: ip,
        servername: url.hostname,
        headers: { Host: url.hostname, 'User-Agent': UA, Accept: 'text/html,*/*' },
        path: url.pathname + url.search,
        timeout: 30000,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, mime: res.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function report(label, r) {
  mkdirSync('.tmp-gz', { recursive: true });
  writeFileSync(path.join('.tmp-gz', label + '.html'), r.text, 'utf8');
  const posts = [...r.text.matchAll(/<a[^>]+href=["']([^"']*\/content\/post_\d+\.html)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)];
  const recruit = posts.filter((m) => /招聘|招考|遴选|选调|优才|教师/.test(m[2]));
  console.log('\n===== ' + label, 'status:', r.status, 'len:', r.text.length, 'posts:', posts.length, 'recruit:', recruit.length);
  for (const m of recruit.slice(0, 6)) console.log('  R:', m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70));
  const pager = r.text.match(/createPageHTML\s*\([\s\S]{0,120}?\)/);
  console.log('  pager:', pager && pager[0].replace(/\s+/g, ' '));
  const pages = [...r.text.matchAll(/href=["']([^"']*index_\d+\.html)["'][^>]*>(?:[\s\S]{0,20}?)<\/a>/gi)];
  console.log('  page anchors:', [...new Set(pages.map((m) => m[1]))].slice(0, 8));
  const api = [...new Set(r.text.match(/["'`](\/[^"'`]{0,120}(?:api|json|query|ajax|list)[^"'`]{0,60})["'`]/gi) || [])];
  console.log('  api hints:', api.slice(0, 8));
}

for (const [label, url] of [
  ['wsgs-index', 'https://jyj.gz.gov.cn/yw/wsgs/index.html'],
  ['wsgs-2', 'https://jyj.gz.gov.cn/yw/wsgs/index_2.html'],
]) {
  try {
    report(label, await get(url));
  } catch (e) {
    console.log(label, 'ERROR', e.message);
  }
}

// 招聘专栏试探：优才计划相关常见路径
for (const p of [
  'https://jyj.gz.gov.cn/yw/tzgg/index_20.html',
  'https://jyj.gz.gov.cn/yw2/rsc/index.html',
  'https://jyj.gz.gov.cn/gk/index.html',
]) {
  try {
    const r = await get(p);
    const posts = (r.text.match(/\/content\/post_\d+\.html/g) || []).length;
    console.log('\nPROBE', p, '->', r.status, 'posts', posts, 'len', r.text.length);
    if (p.includes('index_20')) {
      const t = [...r.text.matchAll(/<a[^>]+href=["']([^"']*\/content\/post_\d+\.html)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)];
      console.log('  first/last:', t[0]?.[2].replace(/<[^>]+>/g, '').trim().slice(0, 50), '/', t.at(-1)?.[2].replace(/<[^>]+>/g, '').trim().slice(0, 50));
    }
  } catch (e) {
    console.log('PROBE', p, 'ERROR', e.message);
  }
}
