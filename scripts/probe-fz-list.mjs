// 探测福州市教育局 TRS .htm 族列表与分页协议（一次性只读，不提交）
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
      headers: {
        'Host': url.hostname,
        'User-Agent': 'JiaozhaoYoujuBot/1.0',
        'Accept': '*/*',
      },
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
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          finalUrl: urlStr,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function probe(urlStr) {
  console.log('\n===== PROBE', urlStr, '=====');
  try {
    const r = await get(urlStr);
    mkdirSync('.tmp-fz', { recursive: true });
    const file = path.join('.tmp-fz', urlStr.replace(/^https?:\/\//, '').replace(/[\/:?=&]/g, '_').slice(0, 80) + '.html');
    writeFileSync(file, r.text, 'utf8');
    console.log('status:', r.status, 'len:', r.text.length, '->', file);

    // 分页线索
    const pageClues = r.text.match(/createPageHTML|index_\d+\.htm|pageTotal|pageCount|totalpage|totalRecord|TRS_|_p\d+\.htm/g);
    console.log('page clues:', [...new Set(pageClues || [])].slice(0, 20));

    // 详情链接
    const detLinks = [...new Set((r.text.match(/href=["']([^"']+\.htm[^"']*)["']/gi) || []))];
    console.log('.htm links:', detLinks.slice(0, 20));

    // li 结构样本
    const lis = [...r.text.matchAll(/<li[^>]*>([\s\S]{0,400}?)<\/li>/gi)];
    const good = lis.filter((m) => /href=["'][^"']+\.htm/.test(m[1]) && /\d{2,4}[-/.年]\d{1,2}[-/.月]/.test(m[1]));
    console.log('li with .htm + date:', good.length);
    for (const m of good.slice(0, 6)) console.log('  ' + m[1].replace(/\s+/g, ' ').slice(0, 300));

    // 招聘相关栏目
    const recruitCols = [...new Set((r.text.match(/href=["']([^"']*(?:zpxx|jszp|jsgz|zp|rcpy|tzgg|xxgk)[^"']*)["']/gi) || []))];
    console.log('column links:', recruitCols.slice(0, 20));
  } catch (e) {
    console.log('ERROR:', e.message || e);
  }
}

await probe('https://jyj.fuzhou.gov.cn/');
await probe('http://jyj.fuzhou.gov.cn/');
