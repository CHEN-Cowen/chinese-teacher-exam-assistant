// 快速校验郑州 fixture
const fs = require('fs');
const list = fs.readFileSync('../tests/fixtures/golden-sources/zhengzhou-education/public-list-1.html', 'utf8');

// 看 ul#pageCont 里的每个 li 的第一个 span 文本
const cheerio = require('cheerio');
const $ = cheerio.load(list);
console.log('=== li 数量 ===', $('ul#pageCont > li').length);
$('ul#pageCont > li').each((i, e) => {
  const text = $(e).text().replace(/\s+/g, ' ').slice(0, 200);
  const spans = $(e).find('span').map((_, s) => $(s).text().trim()).get();
  const hrefs = $(e).find('a').map((_, a) => ($(a).attr('href') || '').slice(0, 100)).get();
  console.log(`\nli[${i}]: text="${text.slice(0, 80)}"`);
  console.log(`  spans:`, spans.slice(0, 3));
  console.log(`  hrefs:`, hrefs.slice(0, 2));
});
