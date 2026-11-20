import { setGlobalDispatcher, ProxyAgent } from 'undici';
// 郑州在国内可能需要直连，undici 无系统代理；先简单 fetch
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TARGETS = [
  'https://jyj.zhengzhou.gov.cn/',
  'https://jyj.zhengzhou.gov.cn/tzgg/index.jhtml',
  'https://www.zzedu.net.cn/?id=961&type=41',
  'https://www.zzedu.net.cn/tzgg/list.jhtml',
  'https://www.zzedu.net.cn/zhaopin/index.jhtml',
  'https://www.zzedu.net.cn/rczp/index.jhtml',
];
for (const url of TARGETS) {
  console.log(`\n===== ${url} =====`);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    console.log('status:', res.status);
    console.log('finalUrl:', res.url);
    console.log('content-type:', res.headers.get('content-type'));
    console.log('body-len:', text.length);
    // 前 1200 字符的原始 DOM
    const head = text.slice(0, 1200);
    console.log('head:\n' + head);
    // 找分页相关脚本或链接
    const pageHits = [];
    for (const re of [
      /createPageHTML\([^)]+\)/g,
      /totalRecord\s*:\s*\d+/g,
      /pageIndex[^<]{0,80}/g,
      /list_\d+\.jhtml/g,
      /tzgg_\d+\.jhtml/g,
      /index_\d+\.jhtml/g,
      /list\.jhtml\?page=\d+/g,
      /pagination/g,
      /page_div/g,
      /共\s*\d+\s*条/g,
      /pageCount[^<]{0,80}/g,
    ]) {
      const m = text.match(re);
      if (m) pageHits.push(...m.slice(0, 3));
    }
    if (pageHits.length) {
      console.log('page-hits:\n' + [...new Set(pageHits)].join('\n'));
    }
    // 找列表 li 的原始片段
    const liMatch = text.match(/<li[^>]*>[\s\S]{0,150}?<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{5,60})<\/a>[\s\S]{0,80}?<span[^>]*>([\d\- ]{6,10})/g);
    if (liMatch) {
      console.log('list-samples:');
      for (const m of liMatch.slice(0, 5)) console.log('  ' + m.replace(/\s+/g, ' ').slice(0, 160));
    }
    // 找详情 .jhtml 或 .shtml 链接
    const detailLinks = [...text.matchAll(/href=["']([^"']+(\.jhtml|\.shtml))["']/g)].map((m) => m[1]);
    if (detailLinks.length) {
      console.log('detail-links sample:', [...new Set(detailLinks)].slice(0, 10));
    }
  } catch (e) {
    console.log('ERROR:', e && e.stack || e);
  }
}
