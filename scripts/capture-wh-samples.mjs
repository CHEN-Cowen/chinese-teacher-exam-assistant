// 采集武汉市教育局「通知公告」真实样本（一次性只读 GET，不提交脚本）
import dns from 'node:dns';
import https from 'node:https';
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
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

const TARGETS = [
  ['list-page1.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/'],
  ['list-page2.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_1.shtml'],
  // 拟聘用公示（招聘相关，正文内 1 个 pdf 附件）
  ['detail-2874543.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202611/t20261105_2874543.shtml'],
  // 教师资格认定公告（4 个 pdf 附件）
  ['detail-2862600.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202610/t20261016_2862600.shtml'],
  // 公费师范生专项招聘面试成绩公告（招聘相关，1 个 pdf 附件）
  ['detail-2815618.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202607/t20260701_2815618.shtml'],
  // 候选零附件条目：艺术展演结果公示
  ['detail-2873448.html', 'https://jyj.wuhan.gov.cn/zwdt/tsgg/202611/t20261103_2873448.shtml'],
];

mkdirSync(OUT, { recursive: true });
for (const [name, url] of TARGETS) {
  const r = await get(url);
  if (r.status !== 200) throw new Error(`${url} -> ${r.status}`);
  const file = path.join(OUT, name);
  writeFileSync(file, r.text, 'utf8');
  const sha = crypto.createHash('sha256').update(r.text, 'utf8').digest('hex');
  const title = r.text.match(/<meta[^>]+name=["']ArticleTitle["'][^>]*content=["']([^"']{0,60})/i)?.[1] ?? '';
  const attach = [...r.text.matchAll(/href=["']([^"']+\.(?:docx?|xlsx?|pdf|zip))["']/gi)].map((m) => m[1]);
  console.log(name, '|', r.text.length, 'bytes | sha256', sha);
  if (title) console.log('   title:', title);
  console.log('   attachments:', attach.length, attach.slice(0, 6));
}
console.log('done ->', OUT);
