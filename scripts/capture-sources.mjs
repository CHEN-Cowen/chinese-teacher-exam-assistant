/**
 * 一次性只读采集脚本（不进入提交）：抓取官方列表页与正文页快照，输出 manifest + 文件。
 * 用法：node scripts/capture-sources.mjs '<json 配置>'
 * 配置项：{ key, listUrl, detailUrl?, requestUrl?, requestBody? }
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
      '-w',
      '\n@@STATUS:%{http_code}@@URL:%{url_effective}',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

const configs = JSON.parse(process.argv[2] ?? '[]');
const outRoot = path.resolve(process.cwd(), 'tests/fixtures/golden-sources');

for (const config of configs) {
  const dir = path.join(outRoot, config.key);
  mkdirSync(dir, { recursive: true });
  const files = [];
  const captured = [];

  for (const item of config.files) {
    const body = curl(item.url);
    const marker = body.lastIndexOf('@@STATUS:');
    const content = marker > 0 ? body.slice(0, marker) : body;
    const status = marker > 0 ? body.slice(marker + 9).trim() : 'ERROR';
    const name = item.name;
    writeFileSync(path.join(dir, name), content, 'utf8');
    const sha256 = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
    files.push({ name, url: item.url, sha256 });
    captured.push({ name, status, bytes: Buffer.byteLength(content, 'utf8') });
    console.log(`${config.key}/${name} status=${status} bytes=${Buffer.byteLength(content, 'utf8')}`);
  }

  const manifest = {
    capturedAt: new Date().toISOString(),
    sourceKind: 'official-live-snapshot',
    scope: config.scope ?? 'first-page-discovery-only',
    stableMonitoringVerified: false,
    files,
  };
  writeFileSync(
    path.join(dir, config.manifestName ?? 'public-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(`  -> ${config.key}/${config.manifestName ?? 'public-manifest.json'}`);
}
