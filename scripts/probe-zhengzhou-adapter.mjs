// 快速校验郑州适配器 discover + locate 逻辑
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZhengzhouEducationAdapter } from './backend/src/sourcing/adapters/zhengzhou-education.adapter.ts';

const FIX = 'tests/fixtures/golden-sources/zhengzhou-education';

function fixture(name) {
  return readFileSync(path.join(FIX, name), 'utf8');
}

const ad = new ZhengzhouEducationAdapter();

// === discover ===
console.log('\n=== discover 列表 ===');
try {
  const items = ad.discover({
    url: 'http://news.zzedu.net.cn/tz/',
    mimeType: 'text/html',
    content: fixture('public-list-1.html'),
    fetchedAt: new Date().toISOString(),
  });
  console.log('发现条目:', items.length);
  for (const it of items.slice(0, 5)) {
    console.log(`  [${it.publishedAt}] ${it.title.slice(0, 40)}... -> ${it.url}`);
  }
  // jhtml 详情
  const jhtmlItems = items.filter(i => i.url.includes('.jhtml'));
  const shtmlItems = items.filter(i => i.url.includes('.shtml'));
  console.log(`\n  jhtml 详情: ${jhtmlItems.length}`);
  console.log(`  shtml 详情: ${shtmlItems.length}`);
} catch (e) {
  console.log('ERROR:', e.message, e.code || '');
}

// === locateArticle: jhtml ===
console.log('\n=== locate jhtml 详情 ===');
try {
  const r = ad.locateArticle({
    url: 'https://zzjy.zhengzhou.gov.cn/tzgg/10291575.jhtml',
    mimeType: 'text/html',
    content: fixture('detail-10291575.jhtml.html'),
    fetchedAt: new Date().toISOString(),
  });
  console.log('标题:', r.title);
  console.log('日期:', r.publishedAt);
  console.log('正文前 100:', r.bodyText.slice(0, 100));
  console.log('附件数:', r.attachments.length);
} catch (e) {
  console.log('ERROR:', e.message, e.code || '');
}

// === locateArticle: shtml ===
console.log('\n=== locate shtml 详情 ===');
try {
  const r = ad.locateArticle({
    url: 'http://news.zzedu.net.cn/tz/10/34486640.shtml',
    mimeType: 'text/html',
    content: fixture('detail-10-34486640.shtml.html'),
    fetchedAt: new Date().toISOString(),
  });
  console.log('标题:', r.title);
  console.log('日期:', r.publishedAt);
  console.log('正文前 100:', r.bodyText.slice(0, 100));
  console.log('附件数:', r.attachments.length);
} catch (e) {
  console.log('ERROR:', e.message, e.code || '');
}
