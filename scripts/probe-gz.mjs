// 探测广州教育局/市政府门户栏目与分页协议（一次性只读，不提交）
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

async function get(urlStr, depth = 5, headers = {}) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  let ip;
  try {
    [ip] = await dns.promises.resolve4(url.hostname);
  } catch (e) {
    throw new Error('DNS_FAIL ' + url.hostname + ' ' + e.message);
  }
  return new Promise((resolve, reject) => {
    const req = mod.request({
      method: 'GET',
      host: ip,
      servername: url.hostname,
      headers: {
        Host: url.hostname,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json,*/*',
        ...headers,
      },
      path: url.pathname + url.search,
      timeout: 30000,
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
        const next = new URL(res.headers.location, urlStr).href;
        get(next, depth - 1, headers).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          finalUrl: urlStr,
          mime: res.headers['content-type'] || '',
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function post(urlStr, body, headers = {}) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  const [ip] = await dns.promises.resolve4(url.hostname);
  return new Promise((resolve, reject) => {
    const req = mod.request({
      method: 'POST',
      host: ip,
      servername: url.hostname,
      headers: {
        Host: url.hostname,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      path: url.pathname + url.search,
      timeout: 30000,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        mime: res.headers['content-type'] || '',
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end(body);
  });
}

async function probe(label, urlStr, headers) {
  console.log('\n===== PROBE', label, urlStr, '=====');
  try {
    const r = await get(urlStr, 5, headers);
    mkdirSync('.tmp-gz', { recursive: true });
    const file = path.join(
      '.tmp-gz',
      label + '-' + urlStr.replace(/^https?:\/\//, '').replace(/[\/:?=&]/g, '_').slice(0, 70) + '.html',
    );
    writeFileSync(file, r.text, 'utf8');
    console.log('status:', r.status, 'mime:', r.mime, 'len:', r.text.length, '->', file);
    const clues = r.text.match(
      /createPageHTML|index_\d+\.htm|pageTotal|pageCount|totalpage|totalRecord|TRS_|_p\d+\.htm|pageIndex|\.shtml|\.jhtml|__NEXT_DATA__|window\.__/g,
    );
    console.log('clues:', [...new Set(clues || [])].slice(0, 20));
    const anchors = [...r.text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
    const detLike = anchors.filter((m) => /(?:t|content|art|info|detail|\.htm|\.shtml|\.jhtml)/i.test(m[1]));
    console.log('anchors total:', anchors.length, 'detail-like:', detLike.length);
    for (const m of detLike.slice(0, 12)) {
      console.log('  ', m[1], '|', m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60));
    }
    const jsApi = [...new Set((r.text.match(/["'`](\/[^"'`]*(?:api|search|list|query|json)[^"'`]*)["'`]/gi) || []))];
    console.log('js api candidates:', jsApi.slice(0, 15));
    return r;
  } catch (e) {
    console.log('ERROR:', e.message || e);
    return null;
  }
}

await probe('jyj-home', 'https://jyj.gz.gov.cn/');
await probe('gov-home', 'https://www.gz.gov.cn/');
await probe('gov-tzgg', 'https://www.gz.gov.cn/yw/tzgg/');
await probe('gov-wsgs', 'https://www.gz.gov.cn/yw/wsgs/');
