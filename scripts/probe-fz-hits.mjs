// 一次性：翻福州 tzgg 接口找招聘类标题（不提交）
import dns from 'node:dns';
import https from 'node:https';

dns.setServers(['223.5.5.5', '114.114.114.114']);

function search(page) {
  return new Promise((resolve, reject) => {
    const body = 'channelid=229105&classsql=' + encodeURIComponent('chnlid=47610') +
      '&sortfield=' + encodeURIComponent('-docorderpri,-docreltime') +
      '&classsort=0&prepage=15&page=' + page;
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
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      });
      req.on('error', reject); req.write(body); req.end();
    });
  });
}

const hits = [];
for (let p = 1; p <= 60; p += 1) {
  const j = await search(p);
  if (j.error) { console.log('page', p, 'error', j); break; }
  for (const d of j.data) {
    if (/招聘|拟聘用|录用|资格考试|选聘/.test(d.doctitle || '')) {
      hits.push({ page: p, date: (d.docreltime || '').slice(0, 10), title: d.doctitle, url: d.chnldocurl });
    }
  }
}
console.log('hits:', hits.length);
for (const h of hits.slice(0, 30)) console.log(` p${h.page} ${h.date} ${h.title} -> ${h.url}`);
