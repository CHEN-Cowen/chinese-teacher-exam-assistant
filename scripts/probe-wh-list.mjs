// 探测武汉市教育局「通知公告」列表页结构与分页（一次性只读，不提交）
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
  mkdirSync('.tmp-wh', { recursive: true });
  const file = path.join('.tmp-wh', label + '.html');
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
  console.log('page clue present:', !!clues, clues?.[0]);
  console.log('page clues sample:', r.text.match(/[^\s"'<>]{0,40}(?:pageTotal|pageCount|totalpage|totalRecord|pageIndex|createPageHTML|pageNo)[^\s"'<>]{0,60}/gi)?.slice(0, 10));
  // 详情锚点：/zwdt/tsgg/YYYYMM/tYYYYMMDD_NNNNNNN.shtml
  const anchors = [...r.text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)];
  const posts = anchors.filter((m) => /t\d{8}_\d+\.shtml/.test(m[1]));
  console.log('detail anchors:', posts.length);
  for (const m of posts.slice(0, 12)) {
    console.log('  ', m[1], '|', m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70));
  }
  // li 结构
  const lis = [...r.text.matchAll(/<li[^>]*>([\s\S]{0,600}?)<\/li>/gi)];
  const goodLis = lis.filter((m) => /t\d{8}_\d+\.shtml/.test(m[1]));
  console.log('li with detail link:', goodLis.length);
  for (const m of goodLis.slice(0, 4)) {
    console.log('  LI:', m[1].replace(/\s+/g, ' ').slice(0, 350));
  }
  // 招聘相关
  const recruit = posts.filter((m) => /招聘|招考|遴选|选调|聘用/.test(m[2]));
  console.log('recruit-titled posts:', recruit.length, recruit.slice(0, 8).map((m) => m[2].replace(/<[^>]+>/g, '').trim().slice(0, 50)));
  return r.text;
}

const text = analyze('tsgg-index', await get('https://jyj.wuhan.gov.cn/zwdt/tsgg/'));

// 试探常见分页形态
for (const p of [
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_1.html',
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_2.html',
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_1.shtml',
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/list_2.html',
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/index.html?page=2',
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/?page=2',
]) {
  try {
    const r = await get(p, 2);
    const posts = (r.text.match(/t\d{8}_\d+\.shtml/g) || []).length;
    console.log('\nPAGE PROBE', p, '->', r.status, 'len', r.text.length, 'posts', posts);
    if (posts > 0) {
      const titles = [...r.text.matchAll(/<a[^>]+href=["']([^"']*t\d{8}_\d+\.shtml)["'][^>]*>([\s\S]{0,140}?)<\/a>/gi)];
      console.log('  first:', titles.slice(0, 3).map((m) => m[1] + ' | ' + m[2].replace(/<[^>]+>/g, '').trim().slice(0, 50)));
    }
  } catch (e) {
    console.log('\nPAGE PROBE', p, 'ERROR', e.message);
  }
}

// 分页控件所在片段
const pagIdx = text.search(/分页|pagination|page-bar|pages|createPageHTML/i);
console.log('\n--- pagination region (idx', pagIdx, ') ---');
if (pagIdx >= 0) {
  console.log(text.slice(Math.max(0, pagIdx - 400), pagIdx + 1500).replace(/\s+/g, ' '));
}
