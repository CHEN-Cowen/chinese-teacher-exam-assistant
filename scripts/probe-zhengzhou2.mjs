// 用 Node http/https 模块直抓郑州 jhtml
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

// 简单 Node fetch（Node 22+）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function tryFetch(urlStr) {
  console.log(`\n===== ${urlStr} =====`);
  try {
    // 用 http/https 模块直接请求（不走 undici 代理）
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const opts = {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 15000,
    };
    const res = await new Promise((resolve, reject) => {
      const req = mod.request(urlStr, opts, (res) => {
        // 跟随一次重定向
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
          const target = new URL(res.headers.location, urlStr).href;
          console.log('  -> redirect to', target);
          // 递归一次
          tryFetch(target).then(resolve, reject);
          return;
        }
        resolve(res);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    const chunks = [];
    for await (const c of res) chunks.push(c);
    const buf = Buffer.concat(chunks);
    console.log('  status:', res.statusCode);
    console.log('  finalUrl:', urlStr);
    console.log('  contentType:', res.headers['content-type']);
    console.log('  len:', buf.length);
    const text = buf.toString('utf8');
    console.log('  head (1200):', text.slice(0, 1200));
    // 找分页/列表线索
    const pageHits = text.match(/(createPageHTML|totalRecord|pageIndex|list_\d+\.jhtml|_index_\d+\.jhtml|pagination|pageCount|共\s*\d+\s*条)/g);
    if (pageHits?.length) console.log('  page-hits:', [...new Set(pageHits)].join(', '));
    const lis = [...text.matchAll(/<li[^>]*>([\s\S]{0,250}?)<\/li>/gi)].slice(0, 5);
    if (lis.length) console.log('  li-samples:', lis.map(m => m[1].replace(/\s+/g,' ').slice(0,180)));
    // 详情 jhtml 链接
    const det = [...text.matchAll(/href=["']([^"']+\.jhtml)["']/gi)].map(m => m[1]);
    if (det.length) console.log('  jhtml-links sample:', [...new Set(det)].slice(0,10));
  } catch (e) {
    console.log('  ERROR:', e.message || e);
  }
}

const TARGETS = [
  'https://jyj.zhengzhou.gov.cn/',
  'https://jyj.zhengzhou.gov.cn/tzgg/index.jhtml',
  'http://zz41gz.zzedu.net.cn/school/gg/',
  'http://www.zzedu.net.cn/?uid=880',
  'http://www.zzedu.net.cn/tzgg/',
  'http://www.zzedu.net.cn/zzjcjy/jytz/',
  'http://www.zzedu.net.cn/zzjcjy/jytz/index.jhtml',
];

for (const u of TARGETS) {
  await tryFetch(u);
}
