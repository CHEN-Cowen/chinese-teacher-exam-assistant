import dns from 'node:dns';
import { URL } from 'node:url';

dns.setServers(['223.5.5.5', '114.114.114.114', '8.8.8.8']);

for (const t of ['www.zzedu.net.cn','hangzhou.gov.cn','edu.nc.gov.cn','jyt.jiangsu.gov.cn','jyj.zhengzhou.gov.cn']) {
  try { console.log(t, '=>', dns.resolve4Sync(t)); } catch(e) { console.log(t, '=> ERR', e.code || e.message); }
}

// 用 Node fetch 直接抓一个 Hangzhou 已接入来源，验证后端 SafeFetcher 理论上能否跑通
const targets = [
  'https://www.zzedu.net.cn/?uid=880',
  'https://www.zzedu.net.cn/zzjcjy/jytz/',
  'https://www.zzedu.net.cn/zzjcjy/jytz/index.jhtml',
  'https://hangzhou.gov.cn/col/col1255730/index.html',
];

for (const u of targets) {
  console.log('\n===== fetch', u, '=====');
  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131' },
      redirect: 'follow',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    console.log('status:', res.status);
    console.log('finalUrl:', res.url);
    console.log('len:', text.length);
    console.log('head:\n' + text.slice(0, 1200));
  } catch (e) {
    console.log('ERROR:', e.cause?.code || e.message || e);
  }
}
