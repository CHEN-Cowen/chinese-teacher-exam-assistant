// 探测武汉详情页结构（一次性只读，不提交）
import dns from 'node:dns';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function get(urlStr, depth = 5) {
  const url = new URL(urlStr);
  const [ip] = await dns.promises.resolve4(url.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET', host: ip, servername: url.hostname,
        headers: { Host: url.hostname, 'User-Agent': UA },
        path: url.pathname + url.search, timeout: 30000, rejectUnauthorized: false,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth > 0) {
          get(new URL(res.headers.location, urlStr).href, depth - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function probeDetail(label, r) {
  console.log('\n=====', label, 'status:', r.status, 'len:', r.text.length);
  writeFileSync('.tmp-wh/' + label + '.html', r.text, 'utf8');
  const metas = [...r.text.matchAll(/<meta[^>]+name=["']([^"']+)["'][^>]*content=["']([^"']{0,90})["']/gi)];
  console.log('metas:', metas.map((m) => m[1] + '=' + m[2]).slice(0, 18));
  for (const pat of [/id=["']zoom["']/i, /class=["'][^"']*article[^"']*["']/i, /TRS_Editor/i, /id=["']ivs_content["']/i, /class=["'][^"']*content[^"']*["']/i]) {
    const idx = r.text.search(pat);
    console.log('container clue', pat.source, '->', idx);
  }
  const attach = [...r.text.matchAll(/href=["']([^"']+\.(?:docx?|xlsx?|pdf|zip))["']/gi)];
  console.log('attachments:', attach.map((m) => m[1]).slice(0, 12));
}

mkdirSync('.tmp-wh', { recursive: true });

// 1) 招聘相关（拟聘用公示，可能含附件）
probeDetail('detail-recruit', await get('https://jyj.wuhan.gov.cn/zwdt/tsgg/202611/t20261105_2874543.shtml'));
// 2) 普通通知（资格认定公告，可能含附件）
probeDetail('detail-notice', await get('https://jyj.wuhan.gov.cn/zwdt/tsgg/202610/t20261016_2862600.shtml'));
// 3) 分页第 3 页抽样（确认 index_2.shtml 有效 + 取一条旧条目看零附件详情）
const p3 = await get('https://jyj.wuhan.gov.cn/zwdt/tsgg/index_2.shtml');
console.log('\n===== page3 status:', p3.status, 'len:', p3.text.length, 'posts:', (p3.text.match(/t\d{8}_\d+\.shtml/g) || []).length);
writeFileSync('.tmp-wh/tsgg-page3.html', p3.text, 'utf8');
const first3 = [...p3.text.matchAll(/href=["'](\.\/[^"']*t\d{8}_\d+\.shtml)["'][^>]*title=["']([^"']+)["']/gi)];
console.log('page3 first3:', first3.slice(0, 3).map((m) => m[1] + ' | ' + m[2].slice(0, 50)));
if (first3.length > 0) {
  const u = new URL(first3[0][1], 'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_2.shtml').href;
  probeDetail('detail-old', await get(u));
}
