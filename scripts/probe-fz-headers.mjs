// 一次性：确定 /fjdzapp/search 最小必需请求头（不提交）
import dns from 'node:dns';
import https from 'node:https';

dns.setServers(['223.5.5.5', '114.114.114.114']);

function post(extraHeaders, label) {
  return new Promise((resolve) => {
    const body = 'channelid=229105&classsql=' + encodeURIComponent('chnlid=47610') +
      '&sortfield=' + encodeURIComponent('-docorderpri,-docreltime') +
      '&classcol=publishyear&classsort=0&page=1&prepage=15';
    const url = new URL('https://jyj.fuzhou.gov.cn/fjdzapp/search');
    dns.promises.resolve4(url.hostname).then(([ip]) => {
      const req = https.request({
        host: ip, method: 'POST',
        headers: {
          Host: url.hostname, 'User-Agent': 'JiaozhaoYoujuBot/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body), ...extraHeaders,
        },
        path: url.pathname, timeout: 30000, rejectUnauthorized: false,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const t = Buffer.concat(chunks).toString('utf8');
          let verdict;
          try { verdict = JSON.parse(t).error ? 'FAIL' : 'OK'; } catch { verdict = 'RAW'; }
          console.log(label, '->', res.statusCode, verdict, t.slice(0, 80));
          resolve();
        });
      });
      req.on('error', (e) => { console.log(label, 'ERR', e.message); resolve(); });
      req.write(body); req.end();
    });
  });
}

await post({}, 'A 无任何额外头        ');
await post({ Referer: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/' }, 'B 仅 Referer         ');
await post({ 'X-Requested-With': 'XMLHttpRequest' }, 'C 仅 X-Requested-With');
await post({ Origin: 'https://jyj.fuzhou.gov.cn' }, 'D 仅 Origin          ');
