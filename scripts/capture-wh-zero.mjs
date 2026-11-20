// 补抓武汉零附件详情候选（一次性只读，不提交）
import dns from 'node:dns';
import https from 'node:https';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OUT = 'tests/fixtures/golden-sources/wuhan-education';

async function get(urlStr, depth = 5) {
  const url = new URL(urlStr);
  const [ip] = await dns.promises.resolve4(url.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET', host: ip, servername: url.hostname,
        headers: { Host: url.hostname, 'User-Agent': UA, Accept: 'text/html,*/*' },
        path: url.pathname + url.search, timeout: 30000, rejectUnauthorized: false,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
          get(new URL(res.headers.location, urlStr).href, depth - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

const CANDIDATES = [
  ['detail-2860654.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202610/t20261013_2860654.shtml'],
  ['detail-2851076.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202609/t20260920_2851076.shtml'],
  ['detail-2845315.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202609/t20260909_2845315.shtml'],
];

for (const [name, url] of CANDIDATES) {
  const r = await get(url);
  if (r.status !== 200) { console.log(name, '->', r.status); continue; }
  const sha = crypto.createHash('sha256').update(r.text, 'utf8').digest('hex');
  const title = r.text.match(/<meta[^>]+name=["']ArticleTitle["'][^>]*content=["']([^"']{0,60})/i)?.[1] ?? '';
  const attach = [...r.text.matchAll(/href=["']([^"']+\.(?:docx?|xlsx?|pdf|zip))["']/gi)].map((m) => m[1]);
  console.log(name, '| sha256', sha, '| title:', title, '| attachments:', attach.length);
  if (attach.length === 0) {
    writeFileSync(path.join(OUT, name), r.text, 'utf8');
    console.log('   SAVED (zero-attachment) ->', name);
    break;
  }
}
