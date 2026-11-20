// 抓郑州招聘信息栏目 zpxx 与分页协议
import dns from 'node:dns';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114']);

async function get(urlStr, depth = 3) {
  const url = new URL(urlStr);
  const [ip] = await dns.promises.resolve4(url.hostname);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET',
      host: ip,
      headers: {
        'Host': url.hostname,
        'User-Agent': 'JiaozhaoYoujuBot/1.0',
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
    mkdirSync('.tmp-zz', { recursive: true });
    const file = path.join('.tmp-zz', urlStr.replace(/^https?:\/\//, '').replace(/[\/:]/g, '_').slice(0, 60) + '.html');
    writeFileSync(file, r.text, 'utf8');
    console.log('status:', r.status, 'len:', r.text.length);

    // 分页协议
    const pageScripts = r.text.match(/pageTotal|createPageHTML|index_\d+\.shtml|zpxx_\d+\.shtml|Ls\.pagination|onclick.*page|pagination|pageCount|totalRecord/g);
    console.log('page clues:', [...new Set(pageScripts || [])].slice(0, 20));

    // ul#pageCont 或类似列表容器
    const listConts = [...r.text.matchAll(/<(?:ul|div|table)[^>]*id=["']pageCont["'][^>]*>([\s\S]{0,2000})<\/(?:ul|div|table)>/gi)];
    const listConts2 = [...r.text.matchAll(/<(?:ul|div)[^>]*class=["'][^"']*list[^"']*["'][^>]*>([\s\S]{0,2000})<\/(?:ul|div)>/gi)];
    console.log('list containers:', listConts.length, listConts2.length);

    // 找 li 结构（含 a[title] 或 a 内 span 日期）
    const lis = [...r.text.matchAll(/<li[^>]*>([\s\S]{0,500}?)<\/li>/gi)];
    const good = lis.filter(m => /href=["'][^"']+(zpxx|tz|jhtml|shtml)/i.test(m[1]) || /<span[^>]*>\s*\d{1,2}月/i.test(m[1]));
    console.log('relevant li:', good.length);
    for (const m of good.slice(0, 8)) console.log('  ' + m[1].replace(/\s+/g, ' ').slice(0, 400));

    // 分页锚点
    const pageAnchors = [...new Set(r.text.match(/href=["'][^"']+index_\d+\.shtml[^"']*["']/gi))];
    console.log('page anchors:', pageAnchors.slice(0, 10));
    const pageLinks = [...new Set(r.text.match(/href=["'][^"']+page[^"']*["']/gi))];
    console.log('page links:', pageLinks.slice(0, 10));

    // 详情链接前缀
    const detLinks = [...new Set((r.text.match(/href=["']([^"']+(zpxx|tz|jhtml)[^"']+)["']/gi) || []))];
    console.log('detail samples:', detLinks.slice(0, 15));
  } catch (e) {
    console.log('ERROR:', e.message || e);
  }
}

await probe('http://news.zzedu.net.cn/zpxx/');
await probe('http://news.zzedu.net.cn/zpxx/index.shtml');
await probe('http://news.zzedu.net.cn/tz/');
// 也试试 jhtml 新域名的列表
await probe('https://zzjy.zhengzhou.gov.cn/tzgg/');
await probe('https://zzjy.zhengzhou.gov.cn/zpxx/');
