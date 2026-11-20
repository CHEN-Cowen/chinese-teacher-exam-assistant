// 探测广州教育局 NFCMS 列表页结构与分页（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function get(urlStr, depth = 5) {
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
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
          const next = new URL(res.headers.location, urlStr).href;
          get(next, depth - 1).then(resolve, reject);
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
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function dump(label, text) {
  mkdirSync('.tmp-gz', { recursive: true });
  const file = path.join('.tmp-gz', label + '.html');
  writeFileSync(file, text, 'utf8');
  return file;
}

function analyze(label, r) {
  console.log('\n===== ', label, 'status:', r.status, 'mime:', r.mime, 'len:', r.text.length);
  const file = dump(label, r.text);
  console.log('saved ->', file);
  const clues = r.text.match(
    /createPageHTML|index_\d+\.html|pageTotal|pageCount|totalpage|totalRecord|pageIndex|_page|pageNum|pageNo|pagination/i,
  );
  console.log('page clues sample:', r.text.match(/[^\s"'<>]{0,40}(?:pageTotal|pageCount|totalpage|totalRecord|pageIndex|createPageHTML)[^\s"'<>]{0,60}/gi)?.slice(0, 10));
  const anchors = [...r.text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,140}?)<\/a>/gi)];
  const posts = anchors.filter((m) => /\/content\/post_\d+\.html/.test(m[1]));
  console.log('post anchors:', posts.length);
  for (const m of posts.slice(0, 10)) {
    console.log('  ', m[1], '|', m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70));
  }
  // li 结构
  const lis = [...r.text.matchAll(/<li[^>]*>([\s\S]{0,600}?)<\/li>/gi)];
  const goodLis = lis.filter((m) => /post_\d+\.html/.test(m[1]));
  console.log('li with post link:', goodLis.length);
  for (const m of goodLis.slice(0, 5)) {
    console.log('  LI:', m[1].replace(/\s+/g, ' ').slice(0, 350));
  }
  // 招聘相关
  const recruit = posts.filter((m) => /招聘|招考|遴选|选调/.test(m[2]));
  console.log('recruit-titled posts:', recruit.length, recruit.slice(0, 8).map((m) => m[2].replace(/<[^>]+>/g, '').trim().slice(0, 50)));
  return r.text;
}

let text = analyze('tzgg-index', await get('https://jyj.gz.gov.cn/yw/tzgg/index.html'));

// 试探常见分页形态
for (const p of [
  'https://jyj.gz.gov.cn/yw/tzgg/index_2.html',
  'https://jyj.gz.gov.cn/yw/tzgg/index_2.shtml',
  'https://jyj.gz.gov.cn/yw/tzgg/list_2.html',
  'https://jyj.gz.gov.cn/yw/tzgg/index.html?page=2',
  'https://jyj.gz.gov.cn/yw/tzgg/index_1.html',
]) {
  try {
    const r = await get(p, 2);
    const posts = (r.text.match(/\/content\/post_\d+\.html/g) || []).length;
    console.log('\nPAGE PROBE', p, '->', r.status, 'len', r.text.length, 'posts', posts);
    if (posts > 0) {
      const titles = [...r.text.matchAll(/<a[^>]+href=["']([^"']*\/content\/post_\d+\.html)["'][^>]*>([\s\S]{0,140}?)<\/a>/gi)];
      console.log('  first:', titles.slice(0, 3).map((m) => m[1] + ' | ' + m[2].replace(/<[^>]+>/g, '').trim().slice(0, 50)));
    }
  } catch (e) {
    console.log('\nPAGE PROBE', p, 'ERROR', e.message);
  }
}

// 分页控件所在片段
const pagIdx = text.search(/分页|pagination|page-bar|pages/i);
console.log('\n--- pagination region (idx', pagIdx, ') ---');
if (pagIdx >= 0) {
  console.log(text.slice(Math.max(0, pagIdx - 300), pagIdx + 1200).replace(/\s+/g, ' '));
}
