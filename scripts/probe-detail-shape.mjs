/**
 * 一次性只读探测脚本（不进入提交）：检查正文页的标题/日期/正文容器与附件链接。
 * 用法：node scripts/probe-detail-shape.mjs <url> [...]
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('../backend/node_modules/cheerio');

const UA = 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';

function curl(url) {
  return execFileSync(
    'curl',
    [
      '-sS',
      '--ssl-revoke-best-effort',
      '--connect-timeout',
      '10',
      '--max-time',
      '30',
      '-L',
      '-A',
      UA,
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

for (const url of process.argv.slice(2)) {
  console.log(`\n===== ${url}`);
  const body = curl(url);
  const $ = load(body);
  console.log('  title:', $('title').text().trim());
  for (const name of ['ArticleTitle', 'PubDate', 'ContentSource']) {
    const node = $(`meta[name="${name}"]`);
    if (node.length) console.log(`  meta ${name}:`, node.attr('content'));
  }
  const containers = [
    '#zoom',
    '.zoom',
    '.article-content',
    '.TRS_Editor',
    '.content',
    '.bt_content',
    '.xl_con',
    '.news_content',
    '.b12c',
    '.art_con',
    '.detail_content',
  ];
  for (const selector of containers) {
    const node = $(selector);
    if (node.length) {
      console.log(
        `  容器 ${selector}: 长度 ${node.text().trim().length}, 首段 ${node.text().trim().slice(0, 90).replace(/\s+/g, ' ')}`,
      );
    }
  }
  const attachments = [];
  $('a[href]').each((_i, element) => {
    const href = $(element).attr('href') ?? '';
    if (/\.(pdf|xlsx?|docx?|zip)([?#]|$)/i.test(href) || /download/i.test(href)) {
      attachments.push(`${($(element).text() || '').trim().slice(0, 40)} -> ${href.slice(0, 120)}`);
    }
  });
  console.log(`  附件链接 ${attachments.length}:`);
  for (const item of attachments.slice(0, 8)) console.log('   -', item);
  const dates = [];
  $('span,div,td,p').each((_i, element) => {
    const text = ($(element).text() || '').trim();
    if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text) && dates.length < 6) {
      dates.push(`${text.slice(0, 30)} <${element.tagName}.${$(element).attr('class') ?? ''}>`);
    }
  });
  console.log('  日期候选:', dates.join(' | ') || '(无)');
}
