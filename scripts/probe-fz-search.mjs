// 一次性：搜索福州通知公告中教师招聘类文档（不提交）
import dns from 'node:dns';
import https from 'node:https';

dns.setServers(['223.5.5.5', '114.114.114.114']);

function search(classsql) {
  return new Promise((resolve, reject) => {
    const body = 'channelid=229105&sortfield=' + encodeURIComponent('-docorderpri,-docreltime') +
      '&classsort=0&prepage=10&page=1&classsql=' + encodeURIComponent(classsql);
    const url = new URL('https://jyj.fuzhou.gov.cn/fjdzapp/search');
    dns.promises.resolve4(url.hostname).then(([ip]) => {
      const req = https.request({
        host: ip, method: 'POST',
        headers: {
          Host: url.hostname, 'User-Agent': 'JiaozhaoYoujuBot/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/',
          Origin: 'https://jyj.fuzhou.gov.cn',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Length': Buffer.byteLength(body),
        },
        path: url.pathname, timeout: 30000, rejectUnauthorized: false,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', reject); req.write(body); req.end();
    });
  });
}

for (const q of ["chnlid=47610 and doctitle like '%招聘%'", "chnlid=47610 and doctitle like '%公开招聘%'"]) {
  const t = await search(q);
  try {
    const j = JSON.parse(t);
    console.log(q, '->', j.error ? j : `recordCount=${j.recordCount}`);
    if (!j.error) for (const d of j.data) console.log(' ', (d.docreltime || '').slice(0, 10), d.doctitle, '->', d.chnldocurl);
  } catch { console.log('raw:', t.slice(0, 200)); }
}
