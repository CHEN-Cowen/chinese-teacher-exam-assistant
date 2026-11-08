#!/usr/bin/env node
/**
 * E08 隔离演练脚本：真实 API + 真实数据库/Redis + 独立 Worker 的缩短时限催办/升级演练。
 *
 * 这不是单测的替代品：脚本只通过 HTTP 打到隔离环境，检查真实事务、真实扫描与真实站内通知。
 * 本机无 PostgreSQL/Redis 时无法执行，属于环境阻塞，不等于代码未实现。
 *
 * 前置条件：
 * 1. 隔离环境 API 已启动（默认 http://127.0.0.1:3100），连接**隔离**数据库与 Redis。
 * 2. 独立 Worker 已在运行：`node dist/worker.js`；GET /health 的 worker 字段应为 up。
 * 3. 已存在管理员、普通用户、日常负责人、备用负责人账号（不得伪造值守账号）。
 * 4. Worker 扫描间隔已缩短：启动 Worker/API 前设 SERVICE_DESK_SCAN_INTERVAL_MS，例如 30000。
 *
 * 用法（PowerShell 示例）：
 *   $env:BACKEND_BASE_URL="http://127.0.0.1:3100"
 *   $env:DRILL_ADMIN_EMAIL="..."; $env:DRILL_ADMIN_PASSWORD="..."
 *   $env:DRILL_USER_EMAIL="...";  $env:DRILL_USER_PASSWORD="..."
 *   $env:DRILL_DUTY_EMAIL="...";  $env:DRILL_BACKUP_EMAIL="..."
 *   node scripts/service-desk-sla-drill.mjs
 *
 * 可选：
 *   DRILL_DUTY_PASSWORD / DRILL_BACKUP_PASSWORD（提供后可直查其站内通知，验证提醒与去重）
 *   DRILL_REGION_CODE（默认 110000）
 *   DRILL_OFFICIAL_URL（默认使用带时间戳的 moe 公网示例链接，避免去重冲突）
 *
 * 退出码：0 全部检查通过；1 存在失败；2 环境不可用/前置缺失。
 */

const BASE = (process.env.BACKEND_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
const REGION_CODE = process.env.DRILL_REGION_CODE ?? '110000';
const SHORT_MINUTES = Number(process.env.DRILL_POLICY_MINUTES ?? 1);
const WAIT_RESPONSE_MS = Number(process.env.DRILL_WAIT_RESPONSE_MS ?? 75_000);
const WAIT_ESCALATION_MS = Number(process.env.DRILL_WAIT_ESCALATION_MS ?? 65_000);

const DEFAULT_POLICIES = {
  high: { firstResponseMinutes: 120, updateMinutes: 480, escalationGraceMinutes: 120 },
  medium: { firstResponseMinutes: 480, updateMinutes: 1440, escalationGraceMinutes: 480 },
  low: { firstResponseMinutes: 1440, updateMinutes: 4320, escalationGraceMinutes: 1440 },
};

const checks = [];

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`[BLOCKED] 缺少环境变量 ${name}`);
    process.exit(2);
  }
  return value.trim();
}

function check(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${id}  ${detail}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rawRequest(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const wrapped = new Error(`无法连接隔离环境 ${BASE}${path}: ${error.message}`);
    wrapped.code = 'ENV';
    throw wrapped;
  }
  const text = await response.text();
  let data = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  const setCookie =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  return { status: response.status, ok: response.ok, data, setCookie };
}

function describeError(data) {
  if (data && typeof data === 'object') {
    const message = data.message ?? data.error;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
    return JSON.stringify(data);
  }
  return String(data ?? '');
}

async function call(path, options = {}) {
  const result = await rawRequest(path, options);
  if (!result.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> HTTP ${result.status}: ${describeError(result.data)}`);
  }
  return result.data;
}

async function login(email, password) {
  const result = await rawRequest('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (!result.ok) {
    throw new Error(`登录 ${email} 失败 HTTP ${result.status}: ${describeError(result.data)}`);
  }
  const sid = result.setCookie.find((item) => item.startsWith('sid='));
  if (!sid) throw new Error(`登录 ${email} 未返回 sid 会话 Cookie`);
  return sid.split(';')[0];
}

async function findTask(adminCookie, ticketNo, bucket = 'all') {
  const query = `bucket=${bucket}&page=1&pageSize=10&q=${encodeURIComponent(ticketNo)}`;
  const result = await call(`/admin/service-desk/queue?${query}`, { cookie: adminCookie });
  return result.items.find((item) => item.ticketNo === ticketNo) ?? null;
}

async function countTaskNotifications(cookie, taskId) {
  const list = await call('/schedule/notifications', { cookie });
  return list.filter((item) => typeof item.linkPath === 'string' && item.linkPath.includes(`task=${taskId}`))
    .length;
}

async function main() {
  const adminEmail = requireEnv('DRILL_ADMIN_EMAIL');
  const adminPassword = requireEnv('DRILL_ADMIN_PASSWORD');
  const userEmail = requireEnv('DRILL_USER_EMAIL');
  const userPassword = requireEnv('DRILL_USER_PASSWORD');
  const dutyEmail = requireEnv('DRILL_DUTY_EMAIL');
  const backupEmail = requireEnv('DRILL_BACKUP_EMAIL');
  const dutyPassword = process.env.DRILL_DUTY_PASSWORD?.trim() || null;
  const backupPassword = process.env.DRILL_BACKUP_PASSWORD?.trim() || null;

  // ---------- 0. 环境与 Worker ----------
  const health = await call('/health');
  check(
    'E08-ENV',
    health.db === 'up' && health.redis === 'up',
    `db=${health.db} redis=${health.redis} worker=${health.worker}`,
  );
  check(
    'E08-WORKER',
    health.worker === 'up',
    `独立 Worker 心跳 worker=${health.worker} lastSeenAt=${health.workerLastSeenAt ?? '-'}`,
  );
  if (health.db !== 'up' || health.redis !== 'up' || health.worker !== 'up') {
    console.error('[BLOCKED] 隔离数据库/Redis/Worker 未就绪，演练不执行。请先启动独立 Worker 并确认 /health。');
    process.exit(2);
  }

  const adminCookie = await login(adminEmail, adminPassword);
  const userCookie = await login(userEmail, userPassword);
  const dutyCookie = dutyPassword ? await login(dutyEmail, dutyPassword) : null;
  const backupCookie = backupPassword ? await login(backupEmail, backupPassword) : null;

  const owners = await call('/admin/service-desk/eligible-owners', { cookie: adminCookie });
  const duty = owners.find((item) => item.email === dutyEmail);
  const backup = owners.find((item) => item.email === backupEmail);
  if (!duty || !backup) {
    console.error('[BLOCKED] 日常/备用负责人必须是已启用且有处理权限的现有账号，未能在 eligible-owners 中找到。');
    process.exit(2);
  }
  check(
    'E08-D01',
    duty.id !== backup.id,
    `日常负责人=${dutyEmail} 备用负责人=${backupEmail} 为两个不同账号`,
  );

  const originalConfig = await call('/admin/service-desk/config', { cookie: adminCookie });
  const originalPolicies = await call('/admin/service-desk/policies', { cookie: adminCookie });

  let created = null;
  let taskId = null;
  try {
    // ---------- 1. 配置负责人与缩短时限 ----------
    const config = await call('/admin/service-desk/config', {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        dutyOwnerId: duty.id,
        backupOwnerId: backup.id,
        reason: 'E08 隔离演练：配置日常与备用负责人',
      },
    });
    check('E08-CONFIG', config.complete === true, `配置完整 complete=${config.complete}`);

    const policies = await call('/admin/service-desk/policies', {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        policies: ['high', 'medium', 'low'].map((priority) => ({
          priority,
          firstResponseMinutes: SHORT_MINUTES,
          updateMinutes: SHORT_MINUTES,
          escalationGraceMinutes: SHORT_MINUTES,
        })),
        reason: 'E08 隔离演练：缩短时限（仅隔离环境）',
      },
    });
    check(
      'E08-POLICY',
      policies.every((item) => item.policy.firstResponseMinutes === SHORT_MINUTES),
      `三档时限缩短为 ${SHORT_MINUTES} 分钟`,
    );

    // ---------- 2. 真实用户提交补录，生成待办 ----------
    const stamp = Date.now();
    const officialUrl =
      process.env.DRILL_OFFICIAL_URL?.trim() ||
      `https://www.moe.gov.cn/service-desk-drill-${stamp}`;
    created = await call('/opportunities/announcement-submissions', {
      method: 'POST',
      cookie: userCookie,
      body: {
        officialUrl,
        publisherName: 'E08 演练发布单位',
        regionCode: REGION_CODE,
        note: `E08 隔离演练线索 ${stamp}`,
      },
    });
    check('E08-CREATE', Boolean(created.id && created.ticketNo), `受理编号 ${created.ticketNo}`);

    const initial = await findTask(adminCookie, created.ticketNo);
    taskId = initial?.id ?? null;
    check(
      'E08-ROUTE',
      Boolean(initial && initial.defaultOwner?.email === dutyEmail),
      `新任务默认归属日常负责人 defaultOwner=${initial?.defaultOwner?.email ?? '-'}`,
    );

    // ---------- 3. 首次到期：真实扫描产生一次催办 ----------
    await sleep(WAIT_RESPONSE_MS);
    await call('/admin/service-desk/scan', { method: 'POST', cookie: adminCookie });

    const overdue = await findTask(adminCookie, created.ticketNo, 'overdue');
    check('E08-OVERDUE', Boolean(overdue), '首次有效响应超时后任务进入“已超时”分组');

    let dutyRemindersAfterFirst = null;
    if (dutyCookie && taskId) {
      dutyRemindersAfterFirst = await countTaskNotifications(dutyCookie, taskId);
      check('E08-REMIND', dutyRemindersAfterFirst >= 1, `日常负责人收到该任务提醒 ${dutyRemindersAfterFirst} 条`);
    } else {
      console.log('SKIP  E08-REMIND  未提供 DRILL_DUTY_PASSWORD，跳过直查日常负责人通知');
    }

    // ---------- 4. 重扫不轰炸 ----------
    await call('/admin/service-desk/scan', { method: 'POST', cookie: adminCookie });
    if (dutyCookie && taskId && dutyRemindersAfterFirst !== null) {
      const after = await countTaskNotifications(dutyCookie, taskId);
      check('E08-DEDUPE', after === dutyRemindersAfterFirst, `重扫后提醒数仍为 ${after} 条（未重复轰炸）`);
    } else {
      console.log('SKIP  E08-DEDUPE  未提供 DRILL_DUTY_PASSWORD，跳过通知去重直查');
    }

    // ---------- 5. 升级宽限到期：升级到备用负责人/管理员 ----------
    await sleep(WAIT_ESCALATION_MS);
    await call('/admin/service-desk/scan', { method: 'POST', cookie: adminCookie });

    const escalated = await findTask(adminCookie, created.ticketNo, 'escalated');
    check('E08-ESCALATE', Boolean(escalated), '超过升级宽限后任务进入“已升级”分组');

    if (backupCookie && taskId) {
      const backupNotifications = await countTaskNotifications(backupCookie, taskId);
      check('E08-BACKUP-NOTIFY', backupNotifications >= 1, `备用负责人收到升级提醒 ${backupNotifications} 条`);
    } else {
      console.log('SKIP  E08-BACKUP-NOTIFY  未提供 DRILL_BACKUP_PASSWORD，跳过直查备用负责人通知');
    }

    // ---------- 6. 并发转交：旧版本冲突，新版本原子接手 ----------
    const current = await findTask(adminCookie, created.ticketNo, 'all');
    if (!current) throw new Error('转交前未找到任务');
    const stale = await rawRequest(`/admin/service-desk/tasks/${current.id}/transfer`, {
      method: 'POST',
      cookie: adminCookie,
      body: { toUserId: backup.id, reason: 'E08 演练：旧版本并发转交', expectedVersion: current.statusVersion - 1 },
    });
    check(
      'E08-CONFLICT',
      stale.status === 409,
      `旧 statusVersion 转交被拒绝 HTTP ${stale.status}`,
    );

    const transferred = await call(`/admin/service-desk/tasks/${current.id}/transfer`, {
      method: 'POST',
      cookie: adminCookie,
      body: { toUserId: backup.id, reason: 'E08 演练：备用负责人原子接手', expectedVersion: current.statusVersion },
    });
    check(
      'E08-TRANSFER',
      transferred.assignee?.email === backupEmail,
      `转交后当前负责人=${transferred.assignee?.email ?? '-'}`,
    );
  } finally {
    // ---------- 7. 恢复配置与时限（任务与历史按设计要求保留） ----------
    try {
      const restorePolicies = ['high', 'medium', 'low'].map((priority) => {
        const found = originalPolicies.find((item) => item.priority === priority);
        const policy = found?.policy ?? DEFAULT_POLICIES[priority];
        return { priority, ...policy };
      });
      await call('/admin/service-desk/policies', {
        method: 'PUT',
        cookie: adminCookie,
        body: { policies: restorePolicies, reason: 'E08 演练结束：恢复原时限' },
      });
      console.log('INFO  已恢复原时限配置');
    } catch (error) {
      console.error(`WARN  恢复时限失败：${error.message}`);
    }
    try {
      if (originalConfig.dutyOwnerId && originalConfig.backupOwnerId) {
        await call('/admin/service-desk/config', {
          method: 'PUT',
          cookie: adminCookie,
          body: {
            dutyOwnerId: originalConfig.dutyOwnerId,
            backupOwnerId: originalConfig.backupOwnerId,
            reason: 'E08 演练结束：恢复原负责人配置',
          },
        });
        console.log('INFO  已恢复原负责人配置');
      } else {
        console.log('WARN  演练前负责人未配置完整，API 不支持清空，请在本隔离环境重建配置或重置数据库');
      }
    } catch (error) {
      console.error(`WARN  恢复负责人配置失败：${error.message}`);
    }
    if (created) {
      console.log(`INFO  演练工单保留：${created.ticketNo}（追加式历史不删除）`);
    }
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(`\n演练结果：${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length) {
    console.error(`失败项：${failed.map((item) => item.id).join(', ')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  if (error && error.code === 'ENV') {
    console.error(`[BLOCKED] ${error.message}`);
    process.exit(2);
  }
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
