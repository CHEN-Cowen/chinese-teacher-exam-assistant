// 郑州适配器夹具批量抓取（单进程 + 公共 DNS）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

const UA = 'JiaozhaoYoujuBot/1.0';
const FIXTURE = path.join('tests', 'fixtures', 'golden-sources', 'zhengzhou-education');

async function get(urlStr, depth = 3) {
  const url = new URL(urlStr);
  const [ip] = await dns.promises.resolve4(url.hostname);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      method: 'GET',
      host: ip,
      headers: { 'Host': url.hostname, 'User-Agent': UA, 'Accept': '*/*' },
      path: url.pathname + url.search,
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
        const next = new URL(res.headers.location, urlStr).href;
        get(next, depth - 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, finalUrl: urlStr, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function fetchOne(url, filename, expectedMinLen = 5000) {
  console.log(`[fetch] ${filename} <- ${url}`);
  try {
    const r = await get(url);
    if (r.status !== 200 || r.text.length < expectedMinLen) {
      console.log(`  SKIP status=${r.status} len=${r.text.length}`);
      return null;
    }
    mkdirSync(FIXTURE, { recursive: true });
    writeFileSync(path.join(FIXTURE, filename), r.text, 'utf8');
    console.log(`  OK len=${r.text.length}`);
    return r.text;
  } catch (e) {
    console.log(`  ERR ${e.message || e} ${e.cause ? 'cause=' + e.cause.code : ''}`);
    return null;
  }
}

// === 1. 通知公告列表首页 ===
const list1 = await fetchOne('http://news.zzedu.net.cn/tz/', 'public-list-1.html', 30000);

// === 2. 抓列表里每条的详情 ===
const listText = list1 || '';
const shtmlLinks = [...new Set(listText.match(/href=["'](http:\/\/news\.zzedu\.net\.cn\/tz\/[^"']+\.shtml)["']/gi))];
const jhtmlLinks = [...new Set(listText.match(/href=["'](https?:\/\/zzjy\.zhengzhou\.gov\.cn\/tzgg\/[^"']+\.jhtml)["']/gi))];
console.log(`\n列表里 shtml 详情: ${shtmlLinks.length}, jhtml 详情: ${jhtmlLinks.length}`);

// 各抓 2 条详情（混合）
const fetched = [];
for (const url of [...shtmlLinks.slice(0, 2), ...jhtmlLinks.slice(0, 2)]) {
  const u = url.replace(/^href="/, '').replace(/"$/, '');
  const name = u.includes('.jhtml')
    ? `detail-${u.match(/tzgg\/(\d+)\.jhtml/)?.[1]}.jhtml.html`
    : `detail-${u.match(/tz\/(\d+)\/(\d+)\.shtml/)?.[1]}-${u.match(/tz\/(\d+)\/(\d+)\.shtml/)?.[2]}.shtml.html`;
  const t = await fetchOne(u, name, 8000);
  if (t) fetched.push({ url: u, name, len: t.length });
}

// === 3. 生成 manifest ===
if (list1 && fetched.length >= 2) {
  const crypto = await import('node:crypto');
  const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const manifest = {
    sourceKey: 'zhengzhou-education',
    publisher: '郑州市教育局',
    officialUrl: 'http://news.zzedu.net.cn/tz/',
    adapterKey: 'zhengzhou-education',
    fetchedAt: new Date().toISOString(),
    note: '混合通知公告栏目：老站 .shtml + 新政务域名 .jhtml 详情各半；动态"加载更多"分页暂只抓首屏；URL 协议在 adapter.parseDetail 里按 host 分流。',
    files: [
      { name: 'public-list-1.html', url: 'http://news.zzedu.net.cn/tz/', sha256: hash(list1) },
      ...fetched.map(f => ({ name: f.name, url: f.url, sha256: hash(f.len) })), // 占位 hash，详情文件也需读
    ],
  };
  // 用真实 hash 替换
  manifest.files = manifest.files.map(f => {
    if (f.name === 'public-list-1.html') return f;
    const p = path.join(FIXTURE, f.name);
    if (existsSync(p)) {
      const t = readFileSync(p, 'utf8');
      return { ...f, sha256: hash(t) };
    }
    return f;
  });
  writeFileSync(path.join(FIXTURE, 'public-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('\nMANIFEST 已生成');
  console.log(JSON.stringify(manifest, null, 2));
}
