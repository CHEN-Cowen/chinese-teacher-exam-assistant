// 郑州探测 — 单次进程，强制公共 DNS，批量抓取
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

const UA = 'JiaozhaoYoujuBot/1.0';

async function get(urlStr, depth = 3) {
  const url = new URL(urlStr);
  const [ip] = await dns.promises.resolve4(url.hostname);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      method: 'GET',
      host: ip,
      headers: {
        'Host': url.hostname,
        'User-Agent': UA,
        'Accept': '*/*',
      },
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

async function fetchOne(url, name) {
  console.log(`\n--- ${name}: ${url} ---`);
  try {
    const r = await get(url);
    console.log('status:', r.status, 'finalUrl:', r.finalUrl, 'len:', r.text.length);
    mkdirSync('.tmp-zz', { recursive: true });
    const file = path.join('.tmp-zz', name);
    writeFileSync(file, r.text, 'utf8');
    return r.text;
  } catch (e) {
    console.log('ERROR:', e.message || e, e.cause ? ('cause=' + e.cause.code) : '');
    return null;
  }
}

// === 1. 通知公告列表首页 ===
const list1 = await fetchOne('http://news.zzedu.net.cn/tz/', 'tz-page1.html');

// === 2. 尝试分页 ===
const pageUrls = [
  'http://news.zzedu.net.cn/tz/index_2.shtml',
  'http://news.zzedu.net.cn/tz/2.shtml',
  'http://news.zzedu.net.cn/tz/tz_2.shtml',
  'http://news.zzedu.net.cn/tz/index_3.shtml',
];
for (const u of pageUrls) {
  const t = await fetchOne(u, 'tz-page-' + u.split('/').pop());
  if (t && t.includes('暂无数据')) console.log('  (空页)');
}

// === 3. shtml 详情（老站静态页） ===
const shtml1 = await fetchOne('http://news.zzedu.net.cn/tz/10/34486640.shtml', 'shtml-detail-1.html');
const shtml2 = await fetchOne('http://news.zzedu.net.cn/tz/10/34486986.shtml', 'shtml-detail-2.html');

// === 4. jhtml 详情（新政务域名） ===
const jhtml1 = await fetchOne('https://zzjy.zhengzhou.gov.cn/tzgg/10291575.jhtml', 'jhtml-detail-1.html');
const jhtml2 = await fetchOne('https://zzjy.zhengzhou.gov.cn/tzgg/10287767.jhtml', 'jhtml-detail-2.html');

// 分析 list1 找分页协议
if (list1) {
  console.log('\n=== 分析 list1 分页 ===');
  const hits = [];
  for (const re of [
    /createPageHTML\([^)]+\)/g,
    /pageTotal\s*[^<]{0,20}/g,
    /pageCount\s*[^<]{0,20}/g,
    /index_\d+\.shtml/g,
    /tz_\d+\.shtml/g,
    /下一页[^<]{0,50}/g,
    /上一页[^<]{0,50}/g,
    /共\s*\d+\s*页[^<]{0,40}/g,
    /pagination[^)]*\)/gi,
    /href=["'][^"']*page[^"']*["']/gi,
  ]) {
    const m = list1.match(re);
    if (m) hits.push(...m.slice(0, 8).map(x => x.replace(/\s+/g,' ').slice(0, 200)));
  }
  console.log('线索:', [...new Set(hits)].join(' | '));

  // 看 ul#pageCont 下的完整结构（第 1 条）
  const contMatch = list1.match(/<ul[^>]*id=["']pageCont["'][^>]*>([\s\S]{0,3000})<\/ul>/gi);
  if (contMatch) {
    console.log('\npageCont 片段:\n' + contMatch[0].replace(/\s+/g, ' ').slice(0, 1500));
  }

  // 所有 detail 链接（按域名分组）
  const zzeduShtml = [...new Set(list1.match(/href=["'](https?:\/\/news\.zzedu\.net\.cn\/tz\/[^"']+\.shtml)["']/gi))];
  const govJhtml = [...new Set(list1.match(/href=["'](https?:\/\/zzjy\.zhengzhou\.gov\.cn\/tzgg\/[^"']+\.jhtml)["']/gi))];
  console.log('\n老站 .shtml 详情数:', zzeduShtml.length);
  console.log('新政务 .jhtml 详情数:', govJhtml.length);
}

// 分析 shtml 详情结构
if (shtml1) {
  console.log('\n=== shtml 详情结构 ===');
  const clues = [];
  for (const re of [
    /<div[^>]+id=["'][^"']*(content|Content|zoom|article|contentBody|art)["'][^>]*>/gi,
    /<div[^>]+class=["'][^"']*(content|article|zoom|art|TRS_Editor)["'][^>]*>/gi,
    /<meta[^>]+name=["']ArticleTitle["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']PubDate["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']Author["'][^>]*content=["']([^"']+)["']/gi,
    /<title>([^<]{5,})<\/title>/gi,
  ]) {
    const m = [...shtml1.matchAll(re)];
    if (m.length) clues.push(...m.slice(0, 3).map(x => (x[1] || x[0]).slice(0, 150)));
  }
  console.log(clues.join('\n'));
}

// 分析 jhtml 详情结构
if (jhtml1) {
  console.log('\n=== jhtml 详情结构 ===');
  const clues = [];
  for (const re of [
    /<div[^>]+id=["'][^"']*(content|Content|zoom|article|contentBody|art|TRS_Editor)["'][^>]*>/gi,
    /<div[^>]+class=["'][^"']*(content|article|zoom|art)["'][^>]*>/gi,
    /<meta[^>]+name=["']ArticleTitle["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']PubDate["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']Author["'][^>]*content=["']([^"']+)["']/gi,
    /<title>([^<]{5,})<\/title>/gi,
  ]) {
    const m = [...jhtml1.matchAll(re)];
    if (m.length) clues.push(...m.slice(0, 3).map(x => (x[1] || x[0]).slice(0, 150)));
  }
  console.log(clues.join('\n'));
  // 看完整正文容器
  const bodyMatch = jhtml1.match(/<(?:div|td)[^>]+id=["'](?:content|Content|zoom|article|art)[^"']*["'][^>]*>([\s\S]{100,1000})/i);
  if (bodyMatch) console.log('正文前 500:\n' + bodyMatch[1].replace(/\s+/g, ' ').slice(0, 500));
}
