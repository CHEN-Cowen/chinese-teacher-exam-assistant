// 采集广州教育局真实样本（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
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

mkdirSync(OUT, { recursive: true });
const saved = [];
async function save(name, url) {
  const r = await get(url);
  if (r.status !== 200) throw new Error(name + ' HTTP ' + r.status);
  writeFileSync(path.join(OUT, name), r.text, 'utf8');
  saved.push({ name, url, len: r.text.length });
  console.log('saved', name, '<-', url, '(len', r.text.length + ')');
  return r.text;
}

const wsgs1 = await save('wsgs-index.html', 'https://jyj.gz.gov.cn/yw/wsgs/index.html');
await save('wsgs-index-2.html', 'https://jyj.gz.gov.cn/yw/wsgs/index_2.html');

// 从首屏挑选招聘相关详情
const posts = [...wsgs1.matchAll(/<a[^>]+href=["']([^"']*\/content\/post_\d+\.html)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)]
  .map((m) => ({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }));
const picks = posts.filter((p) => /招聘|优才|拟聘用|公示/.test(p.title)).slice(0, 3);
console.log('\n详情候选:');
picks.forEach((p) => console.log(' -', p.title.slice(0, 60), p.url));

for (const p of picks) {
  const id = p.url.match(/post_(\d+)/)[1];
  const name = 'detail-post_' + id + '.html';
  const html = await save(name, p.url);
  const meta = [...html.matchAll(/<meta[^>]+>/gi)]
    .map((m) => m[0])
    .filter((m) => /ArticleTitle|PubDate|ContentSource|Keywords|Description|author/i.test(m));
  console.log('  metas:', meta.map((m) => m.replace(/\s+/g, ' ').slice(0, 140)));
  const divs = [...new Set([...html.matchAll(/<div[^>]+(?:id|class)=["']([^"']{1,60})["']/gi)].map((m) => m[1]))];
  console.log('  div id/class sample:', divs.filter((d) => /content|article|zoom|detail|main|body|txt/i.test(d)).slice(0, 15));
  const files = [...new Set([...html.matchAll(/(?:href|src)=["']([^"']+\.(?:pdf|xlsx?|docx?|zip|rar|wps|et))["']/gi)].map((m) => m[1]))];
  console.log('  attachments:', files.slice(0, 10));
  console.log('');
}

writeFileSync(path.join(OUT, '_capture-manifest.json'), JSON.stringify(saved, null, 2), 'utf8');
console.log('manifest written');
