// 探测石家庄教育局官网结构与列表分页形态（一次性只读，不提交）
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
  mkdirSync('.tmp-sjz', { recursive: true });
  const file = path.join('.tmp-sjz', label + '.html');
  writeFileSync(file, text, 'utf8');
  return file;
}

// 1) 首页：确认可达性与栏目入口
const home = await get('http://sjzjyj.sjz.gov.cn/');
console.log('HOME status:', home.status, 'mime:', home.mime, 'len:', home.text.length, 'final:', home.finalUrl);
dump('home', home.text);

// 从首页提取所有导航/栏目锚点，找招聘相关栏目
const anchors = [...home.text.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
const cols = [];
for (const m of anchors) {
  const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (/招聘|招考|人事|教师|公告|公示|通知|录用|选聘|遴选/.test(text) && text.length <= 20) {
    cols.push({ href: m[1], text });
  }
}
console.log('\n栏目候选:');
for (const c of cols.slice(0, 30)) console.log('  ', c.text, '->', c.href);
