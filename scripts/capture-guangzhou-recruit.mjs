// 补采广州教师招聘详情样本（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OUT = 'tests/fixtures/golden-sources/guangzhou-education';

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
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
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

const list = [
  readFileSync(path.join(OUT, 'wsgs-index.html'), 'utf8'),
  readFileSync(path.join(OUT, 'wsgs-index-2.html'), 'utf8'),
].join('\n');
const posts = [...list.matchAll(/<a[^>]+href=["']([^"']*\/content\/post_\d+\.html)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)]
  .map((m) => ({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }))
  .filter((p) => /公开招聘|优才计划|拟聘用/.test(p.title));
const uniq = [...new Map(posts.map((p) => [p.url, p])).values()];
console.log('候选:', uniq.length);
uniq.slice(0, 8).forEach((p) => console.log(' -', p.title.slice(0, 70), p.url));

mkdirSync(OUT, { recursive: true });
const picked = uniq.slice(0, 2);
for (const p of picked) {
  const id = p.url.match(/post_(\d+)/)[1];
  const r = await get(p.url);
  console.log('\n=====', p.title.slice(0, 70), r.status, r.text.length);
  writeFileSync(path.join(OUT, 'detail-post_' + id + '.html'), r.text, 'utf8');
  const zoom = r.text.match(/<div[^>]+class=["'][^"']*zoomcon[^"']*["'][\s\S]{0,200}?>/i);
  console.log('zoomcon:', zoom ? zoom[0].replace(/\s+/g, ' ').slice(0, 120) : '(none)');
  const files = [...new Set([...r.text.matchAll(/(?:href|src)=["']([^"']+\.(?:pdf|xlsx?|docx?|zip|rar|wps|et)(?:[?#][^"']*)?)["']/gi)].map((m) => m[1]))];
  console.log('attachments:', files);
  const anchors = [...r.text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)]
    .map((m) => [m[1], m[2].replace(/<[^>]+>/g, '').trim()])
    .filter(([u]) => /attachment|download|\.pdf|\.xls|\.zip/i.test(u));
  console.log('attach anchors:', anchors.slice(0, 8));
}
