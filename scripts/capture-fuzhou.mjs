// 一次性采集：福州市教育局「通知公告」真实样本 → tests/fixtures/golden-sources/fuzhou-education
// 只读官方站点；输出用于离线回放核验，不提交二进制附件。
import dns from 'node:dns';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

dns.setServers(['223.5.5.5', '114.114.114.114']);
const OUT = 'tests/fixtures/golden-sources/fuzhou-education';
mkdirSync(OUT, { recursive: true });

function fetchRaw(urlStr, { method = 'GET', body = null, extraHeaders = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    dns.promises.resolve4(url.hostname).then(([ip]) => {
      const headers = { Host: url.hostname, 'User-Agent': 'JiaozhaoYoujuBot/1.0', Accept: '*/*', ...extraHeaders };
      if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const req = https.request({
        host: ip, method, headers,
        path: url.pathname + url.search, timeout: 30000, rejectUnauthorized: false,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      if (body) req.write(body);
      req.end();
    });
  });
}

function save(name, text) {
  writeFileSync(path.join(OUT, name), text, 'utf8');
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  console.log(`saved ${name} (${text.length}B) sha256=${sha.slice(0, 16)}…`);
}

const LIST_API = 'https://jyj.fuzhou.gov.cn/fjdzapp/search';
const listHeaders = {
  Referer: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/',
  Origin: 'https://jyj.fuzhou.gov.cn',
  'X-Requested-With': 'XMLHttpRequest',
};

function searchBody(page) {
  return 'channelid=229105&classsql=' + encodeURIComponent('chnlid=47610') +
    '&sortfield=' + encodeURIComponent('-docorderpri,-docreltime') +
    '&classcol=publishyear&classsort=0&prepage=15&page=' + page;
}

for (const page of [1, 2]) {
  const r = await fetchRaw(LIST_API, { method: 'POST', body: searchBody(page), extraHeaders: listHeaders });
  if (r.status !== 200) throw new Error(`list page${page} HTTP ${r.status}`);
  const j = JSON.parse(r.text);
  if (j.error) throw new Error(`list page${page} error: ${JSON.stringify(j)}`);
  save(`search-page${page}.json`, r.text);
  console.log(`  page${page}: recordCount=${j.recordCount} pageCount=${j.pageCount} items=${j.data.length}`);
}

const details = [
  ['detail-t20261105_5389939.htm.html', 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202611/t20261105_5389939.htm'],
  ['detail-t20260304_5291690.htm.html', 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202603/t20260304_5291690.htm'],
  ['detail-t20260928_5376361.htm.html', 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202609/t20260928_5376361.htm'],
];
for (const [name, url] of details) {
  const r = await fetchRaw(url);
  if (r.status !== 200) throw new Error(`detail ${url} HTTP ${r.status}`);
  save(name, r.text);
  const attachs = [...new Set(r.text.match(/href=["'][^"']*\/P0[^"']+\.(?:xlsx?|docx?|pdf|zip|rar)["']/gi) || [])];
  console.log(`  attachments: ${attachs.length ? attachs.join(' | ') : '(none)'}`);
}
console.log('完成');
