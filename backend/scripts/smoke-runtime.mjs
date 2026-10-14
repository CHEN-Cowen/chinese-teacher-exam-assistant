#!/usr/bin/env node
/**
 * 后端 + 抓取 Worker 真实启动冒烟测试（阻断级）。
 *
 * 目的：防止"编译/单测全绿、进程起不来"的故障再次进入镜像
 * （参考生产回滚事件 sha-9f6164f7：UnknownExportException /
 * UnknownDependenciesException 只在真实启动时暴露）。
 *
 * 覆盖：
 *   1. 临时 PostgreSQL 容器启动并健康（独立随机端口，不动开发者现有数据）；
 *   2. 临时 Redis 容器启动并健康；
 *   3. `prisma migrate deploy` 成功退出；
 *   4. 编译后的 `node dist/main.js` 持续运行；
 *   5. 编译后的 `node dist/worker.js` 持续运行（CRAWL_WORKER_PAUSED=true，
 *      验证暂停消费仍上报心跳）；
 *   6. 带 x-internal-token 请求 /health，必须返回
 *      { status:"ok", api:"up", db:"up", redis:"up", worker:"up" }；
 *   7. API 与 Worker 日志不得出现 UnknownExportException /
 *      UnknownDependenciesException / "Nest can't resolve dependencies"。
 *
 * 安全配置（与任务约定一致）：
 *   AUTH_MODE=invited INTERNAL_TOKEN=ci-smoke-token
 *   CRAWL_SCHEDULER_ENABLED=false CRAWL_WORKER_PAUSED=true FF_DB_CATALOG=off
 *
 * 运行方式（仓库 backend 目录或仓库根目录均可）：
 *   node scripts/smoke-runtime.mjs            # 在 backend/ 内
 *   node backend/scripts/smoke-runtime.mjs    # 在仓库根目录
 *
 * 环境变量：
 *   DB_IMAGE    覆盖 PostgreSQL 镜像（默认 postgres:17-alpine，
 *               境内可 docker.nju.edu.cn/postgres:17-alpine）
 *   REDIS_IMAGE 覆盖 Redis 镜像（默认 redis:7-alpine）
 *
 * 清理保证：无论成败都会结束临时进程、删除本测试创建的临时容器；
 * 不使用具名数据卷，不触碰开发者已有容器、数据卷与数据库。
 * 超时：整体看门狗 5 分钟，失败时输出 API / Worker / 迁移 / 容器日志。
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_IMAGE = process.env.DB_IMAGE ?? 'postgres:17-alpine';
const REDIS_IMAGE = process.env.REDIS_IMAGE ?? 'redis:7-alpine';
const SUFFIX = `${process.pid}-${Date.now().toString(36)}`;
const PG_NAME = `kb-smoke-pg-${SUFFIX}`;
const REDIS_NAME = `kb-smoke-redis-${SUFFIX}`;
const PG_USER = 'jiaozhao';
const PG_PASSWORD = 'jiaozhao-smoke';
const PG_DB = 'jiaozhao';
const API_PORT = 20000 + (process.pid % 20000);
const INTERNAL_TOKEN = 'ci-smoke-token';
const WATCHDOG_MS = 5 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 120_000;
const FORBIDDEN_LOG_PATTERNS = [
  'UnknownExportException',
  'UnknownDependenciesException',
  "Nest can't resolve dependencies",
];

const logs = { api: '', worker: '', migrate: '' };
const children = [];
let failed = false;
let failureReason = '';

function appendLog(bucket, chunk) {
  logs[bucket] += chunk.toString();
  // 环形截断，防止长时间运行撑爆内存（保留最后 ~512KB）
  if (logs[bucket].length > 512 * 1024) {
    logs[bucket] = logs[bucket].slice(-256 * 1024);
  }
}

function fail(reason) {
  failed = true;
  failureReason = reason;
  throw new Error(reason);
}

async function docker(args, options = {}) {
  return execFileAsync('docker', args, { maxBuffer: 16 * 1024 * 1024, ...options });
}

async function dockerAvailable() {
  try {
    await docker(['version', '--format', '{{.Server.Version}}']);
    return true;
  } catch {
    return false;
  }
}

async function hostPort(container, containerPort) {
  const { stdout } = await docker(['port', container, `${containerPort}/tcp`]);
  // 输出形如 "127.0.0.1:55432"（可能多行，取第一行）
  const first = stdout.trim().split('\n')[0];
  const port = Number(first.split(':').pop());
  if (!Number.isInteger(port) || port <= 0) {
    fail(`无法解析容器 ${container} 的宿主机端口：${stdout.trim()}`);
  }
  return port;
}

async function waitFor(label, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`等待 ${label} 超时（${timeoutMs / 1000}s）。最后一次错误：${lastError}`);
}

function spawnLogged(label, bucket, command, args, env) {
  const child = spawn(command, args, {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendLog(bucket, chunk));
  child.stderr.on('data', (chunk) => appendLog(bucket, chunk));
  child.on('exit', (code) => {
    if (!failed && code !== 0 && code !== null) {
      failed = true;
      failureReason = `${label} 意外退出（code=${code}）`;
    }
  });
  children.push(child);
  return child;
}

async function cleanup() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* 已退出 */
    }
  }
  // 给 Node 进程 2s 优雅退出（enableShutdownHooks），之后强制
  await new Promise((resolve) => setTimeout(resolve, 2000));
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
  for (const name of [PG_NAME, REDIS_NAME]) {
    try {
      await docker(['rm', '-f', name]);
    } catch {
      /* 容器可能不存在 */
    }
  }
}

async function dumpDiagnostics() {
  const sections = [
    ['migrate 输出', logs.migrate],
    ['API (dist/main.js) 日志', logs.api],
    ['Worker (dist/worker.js) 日志', logs.worker],
  ];
  for (const name of [PG_NAME, REDIS_NAME]) {
    try {
      const { stdout, stderr } = await docker(['logs', '--tail', '60', name]);
      sections.push([`docker logs ${name}`, `${stdout}\n${stderr}`]);
    } catch {
      sections.push([`docker logs ${name}`, '(容器不存在或已删除)']);
    }
  }
  console.error('\n================ 冒烟失败诊断 ================');
  console.error(`原因：${failureReason}`);
  for (const [title, content] of sections) {
    console.error(`\n----- ${title} -----`);
    console.error(content.trim() || '(空)');
  }
  console.error('============================================\n');
}

async function main() {
  console.log(`[smoke] 临时容器：${PG_NAME} / ${REDIS_NAME}，API 端口 ${API_PORT}`);

  if (!(await dockerAvailable())) {
    fail(
      '未找到可用的 Docker。真实启动冒烟必须在本机安装 Docker 或在 CI 运行；' +
        '单元测试无法覆盖 Nest 模块图真实装配（见本文件头注释）。',
    );
  }

  // 0. 构建产物检查（CI 中 verify job 已先跑 npm run build；本地缺则现编）
  if (!existsSync(path.join(BACKEND_DIR, 'dist', 'main.js')) || !existsSync(path.join(BACKEND_DIR, 'dist', 'worker.js'))) {
    console.log('[smoke] dist 缺失，先执行 npm run build …');
    const build = spawn('npm', ['run', 'build'], {
      cwd: BACKEND_DIR,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    const code = await new Promise((resolve) => build.on('exit', resolve));
    if (code !== 0) fail(`npm run build 失败（code=${code}）`);
  }

  // 1-2. 启动临时 PostgreSQL / Redis（匿名卷，仅本测试可见的随机端口）
  console.log(`[smoke] 启动 PostgreSQL（${DB_IMAGE}）…`);
  await docker([
    'run', '-d', '--name', PG_NAME,
    '-e', `POSTGRES_USER=${PG_USER}`,
    '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    '-e', `POSTGRES_DB=${PG_DB}`,
    '-p', '127.0.0.1:0:5432',
    DB_IMAGE,
  ]);
  console.log(`[smoke] 启动 Redis（${REDIS_IMAGE}）…`);
  await docker([
    'run', '-d', '--name', REDIS_NAME,
    '-p', '127.0.0.1:0:6379',
    REDIS_IMAGE,
  ]);

  const pgPort = await hostPort(PG_NAME, 5432);
  const redisPort = await hostPort(REDIS_NAME, 6379);
  const databaseUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${pgPort}/${PG_DB}`;
  const redisUrl = `redis://127.0.0.1:${redisPort}`;
  console.log(`[smoke] PostgreSQL → 127.0.0.1:${pgPort}，Redis → 127.0.0.1:${redisPort}`);

  await waitFor('PostgreSQL 健康', 60_000, async () => {
    await docker(['exec', PG_NAME, 'pg_isready', '-U', PG_USER, '-d', PG_DB]);
    return true;
  });
  console.log('[smoke] PostgreSQL 健康 ✓');
  await waitFor('Redis 健康', 30_000, async () => {
    const { stdout } = await docker(['exec', REDIS_NAME, 'redis-cli', 'ping']);
    if (!stdout.includes('PONG')) throw new Error(stdout.trim());
    return true;
  });
  console.log('[smoke] Redis 健康 ✓');

  // 3. Prisma 迁移（直接调 prisma CLI 的 JS 入口，跨平台无 npx shim 问题）
  console.log('[smoke] 执行 prisma migrate deploy …');
  const prismaCli = path.join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(prismaCli)) fail(`未找到 prisma CLI：${prismaCli}（先 npm ci）`);
  const migrate = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  migrate.stdout.on('data', (chunk) => appendLog('migrate', chunk));
  migrate.stderr.on('data', (chunk) => appendLog('migrate', chunk));
  const migrateCode = await new Promise((resolve) => migrate.on('exit', resolve));
  if (migrateCode !== 0) fail(`prisma migrate deploy 失败（code=${migrateCode}）`);
  console.log('[smoke] 迁移成功 ✓');

  // 4-5. 启动编译后的 API 与 Worker
  const baseEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    AUTH_MODE: 'invited',
    INTERNAL_TOKEN,
    FF_DB_CATALOG: 'off',
  };
  console.log('[smoke] 启动 node dist/main.js …');
  spawnLogged('API', 'api', process.execPath, [path.join('dist', 'main.js')], {
    ...baseEnv,
    PORT: String(API_PORT),
    CRAWL_SCHEDULER_ENABLED: 'false',
  });
  console.log('[smoke] 启动 node dist/worker.js（CRAWL_WORKER_PAUSED=true）…');
  spawnLogged('Worker', 'worker', process.execPath, [path.join('dist', 'worker.js')], {
    ...baseEnv,
    CRAWL_WORKER_PAUSED: 'true',
  });

  // 6. 轮询 /health 直到五字段全 up（Worker 心跳间隔 10s，窗口放宽到 120s）
  console.log('[smoke] 等待 /health 全部 up …');
  let health = null;
  await waitFor('/health 全部 up', HEALTH_TIMEOUT_MS, async () => {
    if (failed) fail(failureReason);
    const response = await fetch(`http://127.0.0.1:${API_PORT}/health`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN },
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    health = await response.json();
    const ok =
      health.status === 'ok' &&
      health.api === 'up' &&
      health.db === 'up' &&
      health.redis === 'up' &&
      health.worker === 'up';
    if (!ok) throw new Error(`health 未就绪：${JSON.stringify(health)}`);
    return true;
  });
  console.log(`[smoke] /health ✓ ${JSON.stringify(health)}`);

  // 7. 日志中不得出现 Nest DI 致命异常
  for (const pattern of FORBIDDEN_LOG_PATTERNS) {
    if (logs.api.includes(pattern) || logs.worker.includes(pattern)) {
      fail(`日志中出现禁止模式：${pattern}`);
    }
  }
  console.log('[smoke] 日志无 Nest DI 致命异常 ✓');

  // 持续运行确认：两个进程都活到健康检查通过（exit 事件会把 failed 置位）
  if (failed) fail(failureReason);
  console.log('[smoke] API 与 Worker 持续运行 ✓');
}

const watchdog = setTimeout(() => {
  failed = true;
  failureReason = `整体看门狗超时（${WATCHDOG_MS / 1000}s）`;
  dumpDiagnostics()
    .catch(() => {})
    .finally(() => {
      cleanup().finally(() => process.exit(1));
    });
}, WATCHDOG_MS);

main()
  .then(async () => {
    clearTimeout(watchdog);
    await cleanup();
    console.log('[smoke] PASS：后端与 Worker 真实启动冒烟通过');
    process.exit(0);
  })
  .catch(async (error) => {
    clearTimeout(watchdog);
    if (!failureReason) failureReason = error instanceof Error ? error.message : String(error);
    await dumpDiagnostics();
    await cleanup();
    process.exit(1);
  });
