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
 *   8. W4：在隔离 DB/Redis 上验证知识库多角色权限、横向越权、索引后撤回、
 *      AI 关闭时问答明确失败而招聘公告闭环仍可用（AI 使用 mock，不联网）。
 *      注意：mock 只证明代码链路，真实百炼 API 需另配 Key 联调。
 *   9. W5：真实官方来源快照（安徽省教育厅特岗招聘公告）入库→审核→发布→索引，
 *      验证省级/城市/过期覆盖投影、范围问答、公告×政策冲突并列、
 *      无覆盖不伪造引用、AI 关闭时政策问答 503 而覆盖查询仍可用。
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
 *               境内可 docker.nju.edu.cn/postgres:17-alpine；
 *               最终验收可用 pgvector/pgvector:pg17 验证真实向量路径）
 *   REDIS_IMAGE 覆盖 Redis 镜像（默认 redis:7-alpine）
 *   SMOKE_REAL_AI=1  切换真实百炼 Embedding/Rerank/Chat（需 DASHSCOPE_API_KEY，
 *               可选 BAILIAN_*_MODEL 覆盖模型）；默认 mock
 *
 * 清理保证：无论成败都会结束临时进程、删除本测试创建的临时容器；
 * 不使用具名数据卷，不触碰开发者已有容器、数据卷与数据库。
 * 超时：整体看门狗默认 8 分钟、真实模型模式 15 分钟；
 * 失败时输出 API / Worker / 迁移 / 容器日志。
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_IMAGE = process.env.DB_IMAGE ?? 'postgres:17-alpine';
/** SMOKE_REAL_AI=1 时切换真实百炼 Embedding/Rerank/Chat；密钥只从环境变量读取。 */
const REAL_AI = process.env.SMOKE_REAL_AI === '1';
const REDIS_IMAGE = process.env.REDIS_IMAGE ?? 'redis:7-alpine';
const SUFFIX = `${process.pid}-${Date.now().toString(36)}`;
const PG_NAME = `kb-smoke-pg-${SUFFIX}`;
const REDIS_NAME = `kb-smoke-redis-${SUFFIX}`;
const PG_USER = 'jiaozhao';
const PG_PASSWORD = 'jiaozhao-smoke';
const PG_DB = 'jiaozhao';
const API_PORT = 20000 + (process.pid % 20000);
const DEMO_PORT = API_PORT + 1;
const AI_OFF_PORT = API_PORT + 2;
const INTERNAL_TOKEN = 'ci-smoke-token';
const WATCHDOG_MS = (REAL_AI ? 15 : 8) * 60 * 1000;
const HEALTH_TIMEOUT_MS = 120_000;
const FORBIDDEN_LOG_PATTERNS = [
  'UnknownExportException',
  'UnknownDependenciesException',
  "Nest can't resolve dependencies",
];

const logs = { api: '', worker: '', migrate: '', demo: '', aioff: '' };
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
    ['W4 Demo API 日志', logs.demo],
    ['W4 AI-off API 日志', logs.aioff],
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

async function apiCall(port, pathname, options = {}) {
  const headers = { 'x-internal-token': INTERNAL_TOKEN };
  if (options.user) {
    headers['x-user-id'] = options.user;
    headers['x-user-role'] = options.role ?? 'user';
  }
  let body;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应（如 403 文本） */
  }
  return { status: response.status, json, text };
}

function check(condition, message) {
  if (!condition) fail(`W4 知识库隔离验证失败：${message}`);
}

async function waitForApi(port, label) {
  await waitFor(label, 90_000, async () => {
    const response = await apiCall(port, '/health');
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    if (response.json?.status !== 'ok' || response.json?.db !== 'up') {
      throw new Error(`health 未就绪：${JSON.stringify(response.json)}`);
    }
    return true;
  });
}

/**
 * W4 隔离环境知识库流程：
 * 多角色（访客/普通用户/管理员）→ 入库审核发布 → Worker 索引 → 检索/问答
 * → 横向越权反馈 → 撤回后不可检索 → AI 关闭时问答 503 且招聘闭环仍 200。
 */
async function runKnowledgeFlow() {
  const admin = { user: 'w4-admin', role: 'admin' };
  const userA = { user: 'w4-user-a', role: 'user' };
  const userB = { user: 'w4-user-b', role: 'user' };

  // 1) 访客与普通用户不能入库/调试检索
  let response = await apiCall(DEMO_PORT, '/knowledge/documents', {
    method: 'POST',
    body: { title: '匿名不应创建', documentType: 'announcement', content: '' },
  });
  check(response.status === 401, `demo 访客入库应为 401，实际 ${response.status}`);
  response = await apiCall(DEMO_PORT, '/knowledge/documents', {
    method: 'POST',
    ...userA,
    body: { title: '用户不应创建', documentType: 'announcement', content: '' },
  });
  check(response.status === 403, `普通用户入库应为 403，实际 ${response.status}`);
  response = await apiCall(DEMO_PORT, '/knowledge/search', {
    method: 'POST',
    ...userA,
    body: { question: '报名截止时间' },
  });
  check(response.status === 403, `普通用户检索调试应为 403，实际 ${response.status}`);

  // 2) 管理员入库 → 送审 → 批准 → 发布
  const created = await apiCall(DEMO_PORT, '/knowledge/documents', {
    method: 'POST',
    ...admin,
    body: {
      title: 'W4 隔离验证公告',
      documentType: 'announcement',
      content:
        '<html><body><h1>W4 隔离验证公告</h1><p>报名截止时间为 2026 年 11 月 15 日 17:00。</p><p>资格审查结果于 2026 年 11 月 20 日公布。</p></body></html>',
      mimeType: 'text/html',
      officialUrl: 'https://example.gov.cn/w4-smoke',
    },
  });
  check(
    created.status === 201 || created.status === 200,
    `入库失败 HTTP ${created.status}: ${created.text.slice(0, 200)}`,
  );
  const versionId = created.json?.versionId;
  const documentId = created.json?.documentId;
  check(Boolean(versionId && documentId), '入库响应缺少 versionId/documentId');

  for (const action of ['submit-review', 'approve', 'publish']) {
    const result = await apiCall(
      DEMO_PORT,
      `/knowledge/versions/${versionId}/${action}`,
      {
        method: 'POST',
        ...admin,
        body: action === 'approve' ? { note: 'W4 自动验收' } : {},
      },
    );
    check(
      result.status === 201 || result.status === 200,
      `${action} 失败 HTTP ${result.status}: ${result.text.slice(0, 200)}`,
    );
  }

  // 3) 等 Worker 完成索引（默认 mock；SMOKE_REAL_AI=1 时走真实百炼）
  await waitFor('知识索引 ready', REAL_AI ? 180_000 : 90_000, async () => {
    const result = await apiCall(DEMO_PORT, '/knowledge/index-jobs?limit=50', admin);
    check(result.status === 200, `索引任务查询 HTTP ${result.status}`);
    const item = (result.json?.items ?? []).find(
      (row) => row.versionId === versionId,
    );
    if (!item || item.status !== 'ready') {
      throw new Error(`索引未就绪：${item ? item.status : '无任务'}`);
    }
    return true;
  });
  console.log('[smoke] W4 知识索引 ready ✓');

  // 4) 发布后管理员检索有命中
  const searchBefore = await apiCall(DEMO_PORT, '/knowledge/search', {
    method: 'POST',
    ...admin,
    body: { question: '报名截止时间' },
  });
  check(
    searchBefore.status === 201 || searchBefore.status === 200,
    `管理员检索 HTTP ${searchBefore.status}`,
  );
  check(
    (searchBefore.json?.items ?? []).length > 0,
    '发布后检索应有命中',
  );

  // 5) 用户 A 提问；用户 B 不能对他人回答反馈（横向越权）
  const ask = await apiCall(DEMO_PORT, '/knowledge/qa', {
    method: 'POST',
    ...userA,
    body: { question: '报名截止时间是什么时候' },
  });
  check(
    ask.status === 201 || ask.status === 200,
    `用户 A 问答 HTTP ${ask.status}: ${ask.text.slice(0, 200)}`,
  );
  check(
    ask.json?.status === 'answered',
    `问答状态应为 answered，实际 ${ask.json?.status}`,
  );
  check((ask.json?.citations ?? []).length > 0, '回答缺少原文引用');
  check(ask.json?.mode === 'mock', `隔离验证应标记 mock，实际 ${ask.json?.mode}`);
  const answerId = ask.json?.id;

  const crossFeedback = await apiCall(
    DEMO_PORT,
    `/knowledge/qa/${answerId}/feedback`,
    { method: 'POST', ...userB, body: { type: 'helpful' } },
  );
  check(
    crossFeedback.status === 404,
    `用户 B 对他人回答反馈应为 404，实际 ${crossFeedback.status}`,
  );
  const ownFeedback = await apiCall(
    DEMO_PORT,
    `/knowledge/qa/${answerId}/feedback`,
    {
      method: 'POST',
      ...userA,
      body: { type: 'incorrect', comment: 'W4 自动验收打标' },
    },
  );
  check(
    ownFeedback.status === 201 || ownFeedback.status === 200,
    `用户 A 反馈失败 HTTP ${ownFeedback.status}`,
  );

  const historyB = await apiCall(DEMO_PORT, '/knowledge/qa/history', userB);
  check(historyB.status === 200, `用户 B 历史 HTTP ${historyB.status}`);
  check(
    (historyB.json?.items ?? []).length === 0,
    '用户 B 历史不应包含他人回答',
  );

  // 6) 撤回后立刻不可检索、问答转拒答
  const withdraw = await apiCall(
    DEMO_PORT,
    `/knowledge/documents/${documentId}/withdraw`,
    {
      method: 'POST',
      ...admin,
      body: { reason: 'W4 隔离验收：撤回后不可检索' },
    },
  );
  check(
    withdraw.status === 201 || withdraw.status === 200,
    `撤回失败 HTTP ${withdraw.status}: ${withdraw.text.slice(0, 200)}`,
  );
  const searchAfter = await apiCall(DEMO_PORT, '/knowledge/search', {
    method: 'POST',
    ...admin,
    body: { question: '报名截止时间' },
  });
  check(
    (searchAfter.json?.items ?? []).length === 0,
    '撤回后检索不应再有命中',
  );
  const askAfter = await apiCall(DEMO_PORT, '/knowledge/qa', {
    method: 'POST',
    ...userA,
    body: { question: '报名截止时间是什么时候' },
  });
  check(
    askAfter.json?.status === 'refused',
    `撤回后应拒答，实际 ${askAfter.json?.status}`,
  );

  // 7) AI 关闭：问答明确 503，招聘公告覆盖接口仍可用
  const demoCoverage = await apiCall(DEMO_PORT, '/opportunities/coverage');
  check(demoCoverage.status === 200, `招聘覆盖接口 HTTP ${demoCoverage.status}`);

  const offHealth = await apiCall(AI_OFF_PORT, '/health');
  check(offHealth.json?.ai === 'off', `AI-off 健康应报告 off，实际 ${offHealth.json?.ai}`);
  const offAsk = await apiCall(AI_OFF_PORT, '/knowledge/qa', {
    method: 'POST',
    ...userA,
    body: { question: '报名截止时间是什么时候' },
  });
  check(
    offAsk.status === 503 && offAsk.json?.code === 'ai_disabled',
    `AI 关闭问答应 503 ai_disabled，实际 ${offAsk.status} ${offAsk.text.slice(0, 200)}`,
  );
  const offCoverage = await apiCall(AI_OFF_PORT, '/opportunities/coverage');
  check(
    offCoverage.status === 200,
    `AI 关闭时招聘覆盖接口应 200，实际 ${offCoverage.status}`,
  );

  console.log('[smoke] W4 多角色/横向越权/撤回/AI 关闭隔离验证 ✓');
}

function policyCheck(condition, message) {
  if (!condition) fail(`W5 政策检索隔离验证失败：${message}`);
}

async function publishKnowledge(admin, body, label) {
  const created = await apiCall(DEMO_PORT, '/knowledge/documents', {
    method: 'POST',
    ...admin,
    body,
  });
  policyCheck(
    created.status === 201 || created.status === 200,
    `${label}入库 HTTP ${created.status}: ${created.text.slice(0, 200)}`,
  );
  const versionId = created.json?.versionId;
  const documentId = created.json?.documentId;
  policyCheck(Boolean(versionId && documentId), `${label}缺少 versionId/documentId`);
  for (const action of ['submit-review', 'approve', 'publish']) {
    const result = await apiCall(
      DEMO_PORT,
      `/knowledge/versions/${versionId}/${action}`,
      {
        method: 'POST',
        ...admin,
        body: action === 'approve' ? { note: 'W5 自动验收' } : {},
      },
    );
    policyCheck(
      result.status === 201 || result.status === 200,
      `${label} ${action} HTTP ${result.status}: ${result.text.slice(0, 200)}`,
    );
  }
  return { documentId, versionId };
}

async function waitForPolicyIndex(admin, versionIds, label) {
  await waitFor(label, REAL_AI ? 180_000 : 90_000, async () => {
    const result = await apiCall(DEMO_PORT, '/knowledge/index-jobs?limit=100', admin);
    policyCheck(result.status === 200, `索引任务查询 HTTP ${result.status}`);
    const items = result.json?.items ?? [];
    const pending = versionIds.filter((versionId) => {
      const item = items.find((row) => row.versionId === versionId);
      return !item || item.status !== 'ready';
    });
    if (pending.length > 0) throw new Error(`索引未就绪：${pending.join(',')}`);
    return true;
  });
}

/**
 * W5 隔离环境政策检索流程：
 * 真实官方来源快照（安徽省教育厅特岗招聘公告）入库 → 审核发布 → 索引
 * → 覆盖投影（省级/城市/过期材料）→ 范围问答 → 公告×政策冲突并列
 * → 无覆盖与故障分开 → AI 关闭时政策问答应 503。
 */
async function runPolicyFlow() {
  const admin = { user: 'w5-admin', role: 'admin' };
  const user = { user: 'w5-user', role: 'user' };
  const province = '340000';
  const cityWithDocs = '340200';
  const cityWithoutDocs = '340100';
  const year = 2026;

  // 真实抓取快照：安徽省教育厅通知公告 → 特岗计划招聘公告
  const recruitHtml = readFileSync(
    path.join(BACKEND_DIR, '..', 'tests', 'fixtures', 'golden-sources', 'anhui-policy', 'public-detail-recruit.html'),
    'utf8',
  );

  const realAnnouncement = await publishKnowledge(
    admin,
    {
      title: '安徽省2026年农村义务教育阶段学校教师特设岗位计划招聘公告',
      documentType: 'announcement',
      content: recruitHtml,
      mimeType: 'text/html',
      regionCode: province,
      year,
      publisher: '安徽省教育厅',
      officialUrl: 'https://jyt.ah.gov.cn/xwzx/tzgg/40792015.html',
    },
    '真实特岗公告',
  );

  const provincePolicy = await publishKnowledge(
    admin,
    {
      title: '安徽省2026年特岗计划实施方案（W5 对照政策）',
      documentType: 'policy',
      content:
        '<html><body><h1>安徽省2026年特岗计划实施方案</h1><p>安徽省 2026 年农村义务教育阶段学校教师特设岗位计划全省招聘 80 名，实施范围为怀远县、颍州区、宿松县。语文教师须具备本科及以上学历并取得相应教师资格。</p></body></html>',
      mimeType: 'text/html',
      regionCode: province,
      year,
      publisher: '安徽省教育厅',
      officialUrl: 'https://jyt.ah.gov.cn/xwzx/tzgg/40792015.html',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      applicableAudience: '特岗教师',
      applicableSubjects: ['chinese'],
    },
    '省级政策',
  );

  const cityPolicy = await publishKnowledge(
    admin,
    {
      title: '芜湖市2026年特岗计划招聘政策（W5 城市对照）',
      documentType: 'policy',
      content:
        '<html><body><h1>芜湖市2026年特岗计划招聘政策</h1><p>芜湖市 2026 年计划招聘特岗教师 20 名，语文教师须具备本科及以上学历。</p></body></html>',
      mimeType: 'text/html',
      regionCode: cityWithDocs,
      year,
      publisher: '芜湖市教育局',
      officialUrl: 'https://example.gov.cn/wuhu-policy',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    },
    '城市政策',
  );

  const expiredPolicy = await publishKnowledge(
    admin,
    {
      title: '2025年过渡期免试认定安排（W5 失效对照）',
      documentType: 'policy',
      content:
        '<html><body><h1>2025年过渡期免试认定安排</h1><p>2025 年过渡期免试认定安排：符合条件的教师可申请免试认定，过渡期于 2025 年 12 月 31 日结束。</p></body></html>',
      mimeType: 'text/html',
      regionCode: province,
      year,
      publisher: '安徽省教育厅',
      officialUrl: 'https://example.gov.cn/expired-policy',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31',
    },
    '失效政策',
  );

  await waitForPolicyIndex(
    admin,
    [realAnnouncement.versionId, provincePolicy.versionId, cityPolicy.versionId, expiredPolicy.versionId],
    'W5 政策材料索引 ready',
  );
  console.log('[smoke] W5 真实来源快照入库/审核/发布/索引 ✓');

  // 覆盖：省级只算省级材料；城市材料单列，不冒充全省完成；过期材料不计可问答
  const provinceCoverage = await apiCall(
    DEMO_PORT,
    `/knowledge/policy-coverage?regionCode=${province}&year=${year}`,
  );
  policyCheck(provinceCoverage.status === 200, `省级覆盖 HTTP ${provinceCoverage.status}`);
  const coverage = provinceCoverage.json;
  policyCheck(coverage.status === 'covered', `省级覆盖状态应为 covered，实际 ${coverage.status}`);
  policyCheck(
    coverage.exact.queryable === 2,
    `省级可检索材料应为 2 份（真实公告+对照政策），实际 ${coverage.exact.queryable}`,
  );
  policyCheck(coverage.exact.expired === 1, `过期材料应单列 1 份，实际 ${coverage.exact.expired}`);
  const cityBucket = (coverage.descendants ?? []).find(
    (item) => item.regionCode === cityWithDocs,
  );
  policyCheck(cityBucket?.queryable === 1, '同省城市材料应单列在 descendants，不计入全省可检索数');

  const uncoveredCoverage = await apiCall(
    DEMO_PORT,
    `/knowledge/policy-coverage?regionCode=${cityWithoutDocs}&year=${year}`,
  );
  policyCheck(uncoveredCoverage.status === 200, `无材料城市覆盖查询 HTTP ${uncoveredCoverage.status}`);
  policyCheck(
    uncoveredCoverage.json?.status === 'no_coverage',
    `无材料城市应为 no_coverage，实际 ${uncoveredCoverage.json?.status}`,
  );

  // 问答权限：匿名 401；演示用户可问
  const anonymousAsk = await apiCall(DEMO_PORT, '/knowledge/questions', {
    method: 'POST',
    body: { question: '安徽省2026年特岗计划招聘多少人', regionCode: province, year },
  });
  policyCheck(anonymousAsk.status === 401, `匿名政策问答应为 401，实际 ${anonymousAsk.status}`);

  const provinceAnswer = await apiCall(DEMO_PORT, '/knowledge/questions', {
    method: 'POST',
    ...user,
    body: {
      question: '安徽省2026年特岗计划招聘多少人，实施范围有哪些',
      regionCode: province,
      year,
    },
  });
  policyCheck(
    provinceAnswer.status === 201 || provinceAnswer.status === 200,
    `省级政策问答 HTTP ${provinceAnswer.status}: ${provinceAnswer.text.slice(0, 200)}`,
  );
  const answer = provinceAnswer.json;
  policyCheck(answer.status === 'answered', `政策回答状态应为 answered，实际 ${answer.status}`);
  policyCheck((answer.citations ?? []).length >= 2, '政策回答应包含公告与政策引用');
  policyCheck(
    (answer.citations ?? []).some((item) => item.documentType === 'announcement') &&
      (answer.citations ?? []).some((item) => item.documentType === 'policy'),
    '引用应同时包含公告与政策材料',
  );
  policyCheck(
    (answer.citations ?? []).some(
      (item) => typeof item.officialUrl === 'string' && item.officialUrl.includes('jyt.ah.gov.cn'),
    ),
    '回答引用应包含真实官方来源链接',
  );
  policyCheck((answer.conflicts ?? []).length >= 1, '公告与政策同时命中时应并列冲突候选');
  policyCheck(answer.needsOfficialConfirmation === true, '冲突场景应要求官方核实');
  policyCheck(
    answer.coverage?.status === 'covered' &&
      answer.coverage.descendants?.some((item) => item.regionCode === cityWithDocs),
    '回答应返回省级覆盖并区分同省城市材料',
  );

  const uncoveredAnswer = await apiCall(DEMO_PORT, '/knowledge/questions', {
    method: 'POST',
    ...user,
    body: { question: '合肥市2026年特岗计划招聘多少人', regionCode: cityWithoutDocs, year },
  });
  policyCheck(
    uncoveredAnswer.status === 201 || uncoveredAnswer.status === 200,
    `无覆盖政策问答 HTTP ${uncoveredAnswer.status}`,
  );
  policyCheck(
    uncoveredAnswer.json?.status === 'no_coverage',
    `无材料城市应返回 no_coverage，实际 ${uncoveredAnswer.json?.status}`,
  );
  policyCheck(
    (uncoveredAnswer.json?.citations ?? []).length === 0,
    '无覆盖回答不应伪造引用',
  );

  const expiredAnswer = await apiCall(DEMO_PORT, '/knowledge/questions', {
    method: 'POST',
    ...user,
    body: { question: '过渡期免试认定条件是什么', regionCode: province, year },
  });
  policyCheck(
    expiredAnswer.status === 201 || expiredAnswer.status === 200,
    `失效材料问答 HTTP ${expiredAnswer.status}`,
  );
  policyCheck(
    !(expiredAnswer.json?.citations ?? []).some(
      (item) => item.documentId === expiredPolicy.documentId,
    ),
    '已失效材料不得作为回答依据',
  );
  policyCheck(
    !(expiredAnswer.json?.answer ?? '').includes('过渡期免试认定安排'),
    '回答不应摘录已失效材料正文',
  );

  // AI 关闭：政策问答明确 503，覆盖查询仍可用
  const offPolicyAsk = await apiCall(AI_OFF_PORT, '/knowledge/questions', {
    method: 'POST',
    ...user,
    body: { question: '安徽省2026年特岗计划招聘多少人', regionCode: province, year },
  });
  policyCheck(
    offPolicyAsk.status === 503 && offPolicyAsk.json?.code === 'ai_disabled',
    `AI 关闭时政策问答应 503 ai_disabled，实际 ${offPolicyAsk.status} ${offPolicyAsk.text.slice(0, 200)}`,
  );
  const offCoverage = await apiCall(
    AI_OFF_PORT,
    `/knowledge/policy-coverage?regionCode=${province}&year=${year}`,
  );
  policyCheck(offCoverage.status === 200, `AI 关闭时覆盖查询应 200，实际 ${offCoverage.status}`);

  console.log('[smoke] W5 覆盖投影/政策问答/冲突/无覆盖/失效排除/AI 关闭 ✓');
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
  if (REAL_AI && !process.env.DASHSCOPE_API_KEY?.trim()) {
    fail('SMOKE_REAL_AI=1 但缺少 DASHSCOPE_API_KEY（不得写入仓库/日志）');
  }
  const baseEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    AUTH_MODE: 'invited',
    INTERNAL_TOKEN,
    FF_DB_CATALOG: 'off',
    // 默认 mock，只验证代码链路；SMOKE_REAL_AI=1 才调用真实百炼（密钥由外部环境提供）
    AI_ENABLED: 'true',
    AI_MOCK_MODE: REAL_AI ? 'false' : 'true',
  };
  if (REAL_AI) {
    console.log(
      `[smoke] 真实百炼模式：embedding=${process.env.BAILIAN_EMBEDDING_MODEL ?? 'text-embedding-v4'} ` +
        `rerank=${process.env.BAILIAN_RERANK_MODEL ?? 'qwen3-rerank'} ` +
        `chat=${process.env.BAILIAN_CHAT_MODEL ?? 'qwen-plus'}`,
    );
  }
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

  // 4b. W4 额外实例：demo 角色头（AI mock）与 AI 关闭对照，共用隔离 DB/Redis
  console.log('[smoke] 启动 W4 Demo API（demo 身份，AI mock）…');
  spawnLogged('Demo API', 'demo', process.execPath, [path.join('dist', 'main.js')], {
    ...baseEnv,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    AUTH_MODE: 'demo',
    PORT: String(DEMO_PORT),
    CRAWL_SCHEDULER_ENABLED: 'false',
  });
  console.log('[smoke] 启动 W4 AI-off API（AI_ENABLED=false）…');
  spawnLogged('AI-off API', 'aioff', process.execPath, [path.join('dist', 'main.js')], {
    ...baseEnv,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    AUTH_MODE: 'demo',
    PORT: String(AI_OFF_PORT),
    CRAWL_SCHEDULER_ENABLED: 'false',
    AI_ENABLED: 'false',
    AI_MOCK_MODE: 'false',
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

  // 8. W4：invited 访客不能访问知识库后台（招聘公开闭环仍可用）
  const visitorState = await apiCall(API_PORT, '/knowledge/index-jobs');
  check(visitorState.status === 403, `invited 访客访问知识后台应为 403，实际 ${visitorState.status}`);
  const visitorQa = await apiCall(API_PORT, '/knowledge/qa', {
    method: 'POST',
    body: { question: '报名截止时间' },
  });
  check(visitorQa.status === 403, `invited 访客问答应为 403，实际 ${visitorQa.status}`);
  const publicCoverage = await apiCall(API_PORT, '/opportunities/coverage');
  check(publicCoverage.status === 200, `招聘覆盖接口应公开可用，实际 ${publicCoverage.status}`);

  await waitForApi(DEMO_PORT, 'W4 Demo API /health');
  await waitForApi(AI_OFF_PORT, 'W4 AI-off API /health');
  await runKnowledgeFlow();
  console.log('[smoke] W4 隔离知识库流程 ✓');
  await runPolicyFlow();
  console.log('[smoke] W5 隔离政策检索流程 ✓');

  // 持续运行确认：全部进程都活到流程结束（exit 事件会把 failed 置位）
  if (failed) fail(failureReason);
  console.log('[smoke] API、Worker 与 W4 实例持续运行 ✓');
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
