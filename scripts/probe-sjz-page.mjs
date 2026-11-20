// 实测石家庄 PageFront.jsp POST 分页响应 + 详情页结构（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function req(urlStr, { method = 'GET', body = null, referer = null } = {}, depth = 5) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  const [ip] = await dns.promises.resolve4(url.hostname);
  const headers = {
    Host: url.hostname,
    'User-Agent': UA,
    Accept: 'text/html,*/*',
  };
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  if (referer) headers.Referer = referer;
  return new Promise((resolve, reject) => {
    const r = mod.request(
      {
        method,
        host: ip,
        servername: url.hostname,
        headers,
        path: url.pathname + url.search,
        timeout: 30000,
        rejectUnauthorized: false,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
          const next = new URL(res.headers.location, urlStr).href;
          req(next, { method: 'GET' }, depth - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            finalUrl: urlStr,
            mime: res.headers['content-type'] || '',
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    r.on('error', reject);
    r.on('timeout', () => {
      r.destroy();
      reject(new Error('timeout'));
    });
    if (body) r.write(body);
    r.end();
  });
}

function dump(label, text) {
  mkdirSync('.tmp-sjz', { recursive: true });
  const file = path.join('.tmp-sjz', label + '.html');
  writeFileSync(file, text, 'utf8');
  return file;
}

const LIST_URL = 'http://sjzjyj.sjz.gov.cn/a/zwgk/tzgg/index.html';
const PARSE_ID = '745b8ad5a0b647b8859292efe60a4378';
const CATEGORY_ID = 'a67a560e4cc8455999902184be54edb5';

// 1) POST 第 2 页
const body2 = `parseId=${PARSE_ID}&categoryId=${CATEGORY_ID}&keyword=&pageNo=2`;
const p2 = await req('http://sjzjyj.sjz.gov.cn/dynamic/PageFront.jsp', {
  method: 'POST',
  body: body2,
  referer: LIST_URL,
});
console.log('POST page2 status:', p2.status, 'mime:', p2.mime, 'len:', p2.text.length, 'final:', p2.finalUrl);
dump('tzgg-page2-post', p2.text);
const arts2 = [...p2.text.matchAll(/href=["']([^"']*\/a\/\d{4}\/\d{2}\/\d{2}\/\d+\.html)["'][^>]*>([\s\S]{0,140}?)<\/a>/gi)];
console.log('page2 article anchors:', arts2.length);
const seen2 = new Set();
for (const m of arts2) {
  if (seen2.has(m[1])) continue;
  seen2.add(m[1]);
  if (seen2.size <= 8) console.log('  ', m[1], '|', m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60));
}
// 是否含 ul_zi 结构 / pageForm
console.log('page2 has ul_zi:', p2.text.includes('ul_zi'), '| has pageForm:', p2.text.includes('pageForm'));
// 分页控件里总页数
const lastM = p2.text.match(/末页[\s\S]{0,80}/);
console.log('page2 last-page clue:', lastM ? lastM[0].replace(/\s+/g, ' ').slice(0, 120) : 'NONE');

// 2) GET 带 query 试探（是否支持 GET）
try {
  const g2 = await req(
    `http://sjzjyj.sjz.gov.cn/dynamic/PageFront.jsp?parseId=${PARSE_ID}&categoryId=${CATEGORY_ID}&keyword=&pageNo=3`,
  );
  console.log('\nGET page3 status:', g2.status, 'len:', g2.text.length);
  const arts3 = (g2.text.match(/\/a\/\d{4}\/\d{2}\/\d{2}\/\d+\.html/g) || []).length;
  console.log('GET page3 article count:', arts3, '| has ul_zi:', g2.text.includes('ul_zi'));
} catch (e) {
  console.log('\nGET page3 ERROR', e.message);
}

// 3) 详情页结构（取第 1 条 + 招募公告）
for (const [label, url] of [
  ['detail-first', 'http://sjzjyj.sjz.gov.cn/a/2026/10/16/1792137061472.html'],
  ['detail-recruit', 'http://sjzjyj.sjz.gov.cn/a/2026/10/09/1791533151163.html'],
]) {
  const d = await req(url);
  console.log('\n=====', label, 'status:', d.status, 'len:', d.text.length);
  dump(label, d.text);
  // meta
  const metas = [...d.text.matchAll(/<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']{0,120})["']/gi)];
  console.log('metas:', metas.slice(0, 12).map((m) => m[1] + '=' + m[2].slice(0, 50)));
  // 正文容器候选
  for (const pat of ['id="zoom"', 'class="article', 'id="article', 'class="content', 'id="content', 'class="detail', 'TRS_Editor', 'id="vsb_content']) {
    if (d.text.includes(pat)) console.log('container clue:', pat);
  }
  // 附件
  const attach = [...d.text.matchAll(/<a[^>]+href=["']([^"']+\.(?:pdf|docx?|xlsx?|zip|rar))["'][^>]*>([\s\S]{0,100}?)<\/a>/gi)];
  console.log('attachments:', attach.length, attach.slice(0, 6).map((m) => m[1] + ' | ' + m[2].replace(/<[^>]+>/g, '').trim().slice(0, 40)));
  // 标题/日期区域
  const h1 = d.text.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i);
  console.log('h1:', h1 ? h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) : 'NONE');
}
