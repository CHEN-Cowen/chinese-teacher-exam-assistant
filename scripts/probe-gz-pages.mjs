// 探测广州 NFCMS 实际分页路径与末页（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { writeFileSync } from 'node:fs';
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

for (const p of [
  'https://jyj.gz.gov.cn/yw/tzgg/index_2.html',
  'https://jyj.gz.gov.cn/yw/tzgg/index_3.html',
  'https://jyj.gz.gov.cn/yw/tzgg/index_4.html',
]) {
  const r = await get(p);
  const posts = [...r.text.matchAll(/<a[^>]+href=["']([^"']*\/content\/post_\d+\.html)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)];
  const pager = r.text.match(/createPageHTML\s*\([\s\S]{0,120}?\)/);
  console.log('\n', p, '->', r.status, 'posts:', posts.length, 'pager:', pager && pager[0].replace(/\s+/g, ' '));
  console.log('  first:', posts[0] ? posts[0][2].replace(/<[^>]+>/g, '').trim().slice(0, 60) : '-');
  console.log('  last :', posts.at(-1) ? posts.at(-1)[2].replace(/<[^>]+>/g, '').trim().slice(0, 60) : '-');
  if (p.endsWith('index_2.html')) {
    writeFileSync('.tmp-gz/tzgg-index-2.html', r.text, 'utf8');
    // 分页控件 HTML
    const bar = r.text.match(/<div[^>]+id=["']page_div["'][\s\S]{0,800}?<\/div>/i);
    console.log('\n[pager div]\n', bar ? bar[0].replace(/\s+/g, ' ') : '(no page_div)');
    const navs = [...r.text.matchAll(/<a[^>]+href=["']([^"']*index_\d+\.html[^"']*)["'][^>]*>([\s\S]{0,40}?)<\/a>/gi)];
    console.log('[pager anchors]', navs.map((m) => m[1] + ' | ' + m[2].trim()).slice(0, 10));
  }
}
