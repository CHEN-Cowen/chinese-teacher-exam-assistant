// 探测石家庄教育局通知公告列表页 + 政府信息公开人事子栏目（一次性只读，不提交）
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

function analyzeList(label, text) {
  console.log('\n=====', label, 'len:', text.length);
  // 文章锚点 /a/YYYY/MM/DD/<id>.html
  const arts = [...text.matchAll(/<a[^>]+href=["']([^"']*\/a\/\d{4}\/\d{2}\/\d{2}\/\d+\.html)["'][^>]*>([\s\S]{0,140}?)<\/a>/gi)];
  console.log('article anchors:', arts.length);
  const seen = new Set();
  for (const m of arts) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    if (seen.size <= 12) {
      console.log('  ', m[1], '|', m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60));
    }
  }
  console.log('unique articles:', seen.size);
  // 日期模式
  const dates = text.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/g);
  console.log('date count:', dates ? dates.length : 0, 'sample:', dates ? dates.slice(0, 6) : []);
  // 分页线索
  const pageClues = text.match(/[^\s"'<>]{0,40}(?:createPageHTML|pageTotal|pageCount|totalpage|totalRecord|pageIndex|index_\d+|_page|pageNum|pageNo)[^\s"'<>]{0,60}/gi);
  console.log('page clues:', pageClues ? pageClues.slice(0, 10) : 'NONE');
  // li 结构样本
  const lis = [...text.matchAll(/<li[^>]*>([\s\S]{0,500}?)<\/li>/gi)].filter((m) => /\/a\/\d{4}\//.test(m[1]));
  console.log('li with article:', lis.length);
  for (const m of lis.slice(0, 3)) console.log('  LI:', m[1].replace(/\s+/g, ' ').slice(0, 300));
  // 招聘相关
  const recruit = arts.filter((m) => /招聘|招考|招募|遴选|选调|聘用|选聘|教师/.test(m[2]));
  console.log('recruit-titled:', recruit.length, recruit.slice(0, 10).map((m) => m[2].replace(/<[^>]+>/g, '').trim().slice(0, 50)));
}

// 1) 通知公告列表页
const tzgg = await get('http://sjzjyj.sjz.gov.cn/a/zwgk/tzgg/index.html');
console.log('TZGG status:', tzgg.status, 'mime:', tzgg.mime, 'len:', tzgg.text.length);
dump('tzgg-index', tzgg.text);
analyzeList('tzgg-index', tzgg.text);

// 2) 政府信息公开-法定主动公开内容（找人事子栏目）
try {
  const gkxx = await get('http://sjzjyj.sjz.gov.cn/a/zfxxgk/gknr/gkxx/jygk/index.html');
  console.log('\nGKXX status:', gkxx.status, 'len:', gkxx.text.length);
  dump('gkxx-jygk', gkxx.text);
  const subs = [...gkxx.text.matchAll(/<a[^>]+href=["']([^"']*\/a\/zfxxgk\/[^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)];
  const seenSub = new Set();
  console.log('zfxxgk sub-links:');
  for (const m of subs) {
    const t = m[2].replace(/<[^>]+>/g, '').trim();
    const k = m[1];
    if (!seenSub.has(k) && t) {
      seenSub.add(k);
      console.log('  ', t, '->', m[1]);
    }
  }
} catch (e) {
  console.log('GKXX ERROR', e.message);
}
