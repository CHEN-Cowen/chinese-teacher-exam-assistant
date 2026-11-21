#!/usr/bin/env bash
# 容器内 DNS + HTTPS + 反爬端点探针
#
# 用途：当 Worker 报 "DNS_FAILED" "HOST_NOT_ALLOWED" "TIMEOUT" "BODY_TOO_SMALL" 等
# 疑似网络故障时，**直接从 Worker 容器内**发起请求，排除本地代理/中间层假阳性。
#
# 用法（在生产主机上，路径按实际 compose 项目修改）：
#
#   # 1) 只跑默认 6 个站点
#   docker exec jiaozhao-standalone-worker-1 bash /path/to/this/diagnose-container.sh
#
#   # 2) 指定目标 host（逗号分隔）
#   HOSTS=jyj.ningbo.gov.cn,www.nbyz.gov.cn \
#     docker exec jiaozhao-standalone-worker-1 bash /path/to/this/diagnose-container.sh
#
#   # 3) 额外探测反爬/可疑路径（path 需自己填）
#   DENY_PATHS="/front/document/download|/captcha" \
#     docker exec ... diagnose-container.sh
#
# 输出结构：
#   resolve <host>        # dns.lookup 结果（A/AAAA）
#   fetch <host> url=… status=… ms=… size=…  # bot UA + 直连 fetch
#   fetch <host> url=… [conditional / cache-control] status=…
#   denyhit <host> url=… # pathDenylist 命中的反爬端点（200 + 60B "禁止访问"）
set -u

HOSTS="${HOSTS:-jyj.ningbo.gov.cn,www.nbyz.gov.cn,jyj.suzhou.gov.cn,jyj.gz.gov.cn,jyj.lishui.gov.cn,www.baidu.com}"
DENY_PATHS="${DENY_PATHS:-}"
UA='JiaozhaoYoujuBot/1.0 (+official-source-fetch)'

node -e "
const dns = require('dns');
const { hosts, denyPaths } = JSON.parse(process.argv[1]);

async function resolve(h) {
  try {
    const a = await Promise.all([
      new Promise((res) => dns.lookup(h, { all: true, family: 4 }, (e, r) => res([e, r]))),
      new Promise((res) => dns.lookup(h, { all: true, family: 6 }, (e, r) => res([e, r]))),
    ]);
    const addrs = [...a[0][1]?.map(r => r.address) || [], ...a[1][1]?.map(r => r.address) || []];
    console.log('resolve', h, addrs.length ? addrs.join(',') : 'NONE', a[0][0]?.code || a[1][0]?.code || 'ok');
  } catch (e) {
    console.log('resolve', h, 'ERR', e.code || e.message);
  }
}

async function fetchUrl(host, path, extraHeaders = {}) {
  const url = 'https://' + host + (path.startsWith('/') ? path : '/' + path);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': '$UA', ...extraHeaders }, redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    const ct = r.headers.get('content-type') || '';
    const chunk = await r.arrayBuffer();
    console.log('fetch ', host.padEnd(24), 'url=' + path.padEnd(28),
      'status=' + r.status,
      'ms=' + (Date.now() - t0),
      'size=' + chunk.byteLength,
      'ct=' + ct.slice(0, 36),
      loc ? 'loc=' + loc.slice(0, 60) : '');
    if (denyPaths && new RegExp(denyPaths, 'i').test(path) && chunk.byteLength < 256) {
      const text = Buffer.from(chunk).toString('utf8').replace(/\s+/g, ' ').slice(0, 120);
      console.log('denyhit', host, path, 'body=' + text);
    }
  } catch (e) {
    console.log('fetch ', host.padEnd(24), 'url=' + path.padEnd(28),
      'ERR', e.name, e.message.slice(0, 80), 'ms=' + (Date.now() - t0));
  }
}

(async () => {
  for (const h of hosts) {
    await resolve(h);
    await fetchUrl(h, '/');
    await fetchUrl(h, '/col/');
    await fetchUrl(h, '/robots.txt');
    if (denyPaths) {
      for (const p of denyPaths.split('|')) {
        await fetchUrl(h, p.trim());
      }
    }
  }
})();
" "$(node -e "console.log(JSON.stringify({hosts: process.env.HOSTS.split(',').map(s=>s.trim()).filter(Boolean), denyPaths: process.env.DENY_PATHS || ''}))")"