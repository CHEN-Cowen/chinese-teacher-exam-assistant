// 采集石家庄教育局真实样本到 tests/fixtures/golden-sources/shijiazhuang-education/（一次性，不提交本脚本）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OUT = path.join('tests', 'fixtures', 'golden-sources', 'shijiazhuang-education');
const LIST_URL = 'http://sjzjyj.sjz.gov.cn/a/zwgk/tzgg/index.html';
const PARSE_ID = '745b8ad5a0b647b8859292efe60a4378';
const CATEGORY_ID = 'a67a560e4cc8455999902184be54edb5';

async function req(urlStr, { method = 'GET', body = null } = {}, depth = 5) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  const [ip] = await dns.promises.resolve4(url.hostname);
  const headers = { Host: url.hostname, 'User-Agent': UA, Accept: 'text/html,*/*' };
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const r = mod.request(
      { method, host: ip, servername: url.hostname, headers, path: url.pathname + url.search, timeout: 30000, rejectUnauthorized: false },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
          req(new URL(res.headers.location, urlStr).href, { method: 'GET' }, depth - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

mkdirSync(OUT, { recursive: true });
const listFiles = [];
const detailFiles = [];

async function capture(name, url, opts, note, bucket) {
  const r = await req(url, opts);
  if (r.status !== 200) throw new Error(`${name} status ${r.status}`);
  writeFileSync(path.join(OUT, name), r.text, 'utf8');
  const entry = { name, url, sha256: sha256(r.text), method: opts?.body ? 'POST' : 'GET', note };
  bucket.push(entry);
  console.log('captured', name, 'len', r.text.length, 'sha', entry.sha256.slice(0, 12));
  return r.text;
}

// 1) 列表首屏
const indexText = await capture(
  'tzgg-index.html',
  LIST_URL,
  {},
  '通知公告首屏 20 条（li.clearF > div.ul_zi > a 文章绝对地址 + div.ul_ziriqi YYYY-MM-DD）；pageForm POST /dynamic/PageFront.jsp 分页（parseId/categoryId/keyword/pageNo），官方 6 页',
  listFiles,
);

// 2) POST 第 2 页
const page2Url = `http://sjzjyj.sjz.gov.cn/dynamic/PageFront.jsp?parseId=${PARSE_ID}&categoryId=${CATEGORY_ID}&keyword=&pageNo=2`;
await capture(
  'pagefront-page2.html',
  'http://sjzjyj.sjz.gov.cn/dynamic/PageFront.jsp',
  { method: 'POST', body: `parseId=${PARSE_ID}&categoryId=${CATEGORY_ID}&keyword=&pageNo=2` },
  'POST 表单分页第 2 页（无 Referer 要求）；与首屏无重叠',
  listFiles,
);
// manifest 记录的 URL 用可派生形态（query 携带全部参数）
listFiles[1].url = page2Url;

// 3) 详情页 ×3
await capture(
  'detail-1792137061472.html',
  'http://sjzjyj.sjz.gov.cn/a/2026/10/16/1792137061472.html',
  {},
  '校徽样式公告：meta ArticleTitle/PubDate + div.content_fenye2 正文 + 3 个 /resources/43/*.zip 附件（锚点文本即附件名）',
  detailFiles,
);
await capture(
  'detail-1791533151163.html',
  'http://sjzjyj.sjz.gov.cn/a/2026/10/09/1791533151163.html',
  {},
  '银龄讲学计划招募讲学教师公告（教师招聘相关，ContentSource=人事科）：ArticleTitle 含 <br> 换行需清洗；2 个 /resources/43/*.docx 附件（需求表/报名表）',
  detailFiles,
);
await capture(
  'detail-1786673899011.html',
  'http://sjzjyj.sjz.gov.cn/a/2026/08/14/1786673899011.html',
  {},
  '励耕计划拟资助名单公示：混合栏目普通条目回放',
  detailFiles,
);

// 4) manifest
const listManifest = {
  source: 'shijiazhuang-education',
  capturedAt: '2026-11-06T00:00:00Z',
  scope: 'public-list',
  site: 'http://sjzjyj.sjz.gov.cn/',
  column: '通知公告（/a/zwgk/tzgg/，混合栏目，含教师招聘/招募、公示、招生入学等）',
  files: listFiles,
};
const detailManifest = {
  source: 'shijiazhuang-education',
  capturedAt: '2026-11-06T00:00:00Z',
  scope: 'public-detail',
  site: 'http://sjzjyj.sjz.gov.cn/',
  files: detailFiles,
};
writeFileSync(path.join(OUT, 'public-manifest.json'), JSON.stringify(listManifest, null, 2) + '\n', 'utf8');
writeFileSync(path.join(OUT, 'public-detail-manifest.json'), JSON.stringify(detailManifest, null, 2) + '\n', 'utf8');
console.log('manifests written');
