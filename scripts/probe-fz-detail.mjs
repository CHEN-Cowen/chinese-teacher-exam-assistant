// 探测福州教育局通知公告列表页 + 详情页结构（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

async function get(urlStr, depth = 3) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  const [ip] = await dns.promises.resolve4(url.hostname);
  return new Promise((resolve, reject) => {
    const req = mod.request({
      method: 'GET',
      host: ip,
      headers: { 'Host': url.hostname, 'User-Agent': 'JiaozhaoYoujuBot/1.0', 'Accept': '*/*' },
      path: url.pathname + url.search,
      timeout: 30000,
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
        const next = new URL(res.headers.location, urlStr).href;
        get(next, depth - 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        finalUrl: urlStr,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function dump(name, text) {
  mkdirSync('.tmp-fz', { recursive: true });
  const file = path.join('.tmp-fz', name);
  writeFileSync(file, text, 'utf8');
  console.log('  saved', file, `(${text.length}B)`);
}

// ---- 列表页 ----
const listUrl = 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/';
const list = await get(listUrl);
console.log('LIST', listUrl, 'status:', list.status, 'len:', list.text.length);
dump('list-tzgg.html', list.text);

// 分页线索
const pageClues = list.text.match(/createPageHTML|index_\d+\.htm|totalpage|pageCount|下一页|共\s*\d+\s*页/g);
console.log('page clues:', [...new Set(pageClues || [])].slice(0, 20));
const pageAnchors = [...new Set(list.text.match(/href=["'][^"']*index_\d+\.htm[^"']*["']/gi))];
console.log('page anchors:', pageAnchors.slice(0, 10));

// li 结构
const lis = [...list.text.matchAll(/<li[^>]*>([\s\S]{0,400}?)<\/li>/gi)];
const good = lis.filter((m) => /\.htm/.test(m[1]) && /title=/.test(m[1]));
console.log('li with link+title:', good.length);
for (const m of good.slice(0, 5)) console.log('  LI: ' + m[1].replace(/\s+/g, ' ').slice(0, 280));

// 列表容器
const containers = [...list.text.matchAll(/<(ul|div)[^>]*(?:class|id)=["']([^"']*(?:list|news|xxgk|content)[^"']*)["'][^>]*>/gi)];
console.log('containers:', containers.slice(0, 12).map((m) => `${m[1]}.${m[2]}`).join(' | '));

// ---- 详情页（取列表里第一条） ----
const firstDetail = (list.text.match(/href=["'][^"']*\/tzgg\/\d{6}\/(t\d+_\d+)\.htm["']/) || [])[0];
console.log('\nfirst detail match:', firstDetail);

// 用首页已知的最新公告作详情样本
const detailUrl = 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202611/t20261105_5389939.htm';
const detail = await get(detailUrl);
console.log('DETAIL', detailUrl, 'status:', detail.status, 'len:', detail.text.length);
dump('detail-t20261105_5389939.htm', detail.text);

// 详情结构：meta、正文容器、附件
const metas = [...detail.text.matchAll(/<meta[^>]+name=["']([^"']+)["'][^>]*content=["']([^"']{0,80})/gi)];
console.log('metas:', metas.slice(0, 12).map((m) => `${m[1]}=${m[2]}`).join(' | '));
const divIds = [...detail.text.matchAll(/<div[^>]*(?:id|class)=["']([^"']+)["'][^>]*>/gi)];
console.log('div id/class:', [...new Set(divIds.map((m) => m[1]))].slice(0, 25).join(' | '));
const attachs = [...new Set(detail.text.match(/href=["'][^"']+\.(?:pdf|xlsx?|docx?|zip|rar)[^"']*["']/gi))];
console.log('attachments:', attachs.slice(0, 10));
const trsEditor = /TRS_Editor|TRS_UEDITOR|zoom|articleCont|content_/.test(detail.text);
console.log('body keywords hit:', trsEditor);
