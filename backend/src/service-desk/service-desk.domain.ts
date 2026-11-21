/**
 * 异常转人工与人工处理闭环领域规则（2026-11-08）。
 *
 * 纯函数：状态机、优先级建议、内部时限、暂停恢复、催办去重键、
 * 负责人配置校验、补充输入校验、补录发布关联门禁。
 * 不含 Prisma / Nest 依赖，便于时钟与并发场景单测。
 */

import { checkSubmissionUrl } from '../opportunities/announcement-submission.domain.js';
import { REVIEW_ROLES } from '../auth/admin.guard.js';

// ==================== 类型与状态 ====================

export const TICKET_TYPES = [
  'correction',
  'announcement_submission',
  'parse_manual',
  'source_alert',
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_STATUSES = [
  'submitted',
  'reviewing',
  'need_supplement',
  'pending_review',
  'resolved',
  'rejected',
  'open',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = [
  'resolved',
  'rejected',
];

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

/** 用户/员工可见状态文案（前后端唯一映射源） */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  submitted: '已提交',
  reviewing: '处理中',
  need_supplement: '待用户补充',
  pending_review: '待复核',
  resolved: '已结案',
  rejected: '未采纳',
  open: '待处理',
};

/**
 * 员工可主动设置的状态。pending_review 只能由用户在待补充工单追加信息后产生，
 * 不允许员工手动跳入；submitted/open 只能由提交或派生任务初始化产生。
 */
export const STAFF_TARGET_STATUSES: readonly TicketStatus[] = [
  'reviewing',
  'need_supplement',
  'resolved',
  'rejected',
];

const ALLOWED_TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  submitted: ['reviewing', 'need_supplement', 'resolved', 'rejected'],
  reviewing: ['need_supplement', 'resolved', 'rejected'],
  need_supplement: ['pending_review', 'reviewing', 'resolved', 'rejected'],
  pending_review: ['reviewing', 'need_supplement', 'resolved', 'rejected'],
  open: ['reviewing', 'resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export function canTransitionTicket(from: string, to: TicketStatus): boolean {
  if (!isTicketStatus(from)) return false;
  return ALLOWED_TICKET_TRANSITIONS[from].includes(to);
}

/** 用户补充只允许「待用户补充」；终态、处理中、待复核都拒绝 */
export function canUserSupplement(status: string): boolean {
  return status === 'need_supplement';
}

/** 工作台分组（服务端与前端共用） */
export const WORKBENCH_BUCKETS = [
  'unassigned',
  'mine',
  'pending_review',
  'waiting_user',
  'overdue',
  'escalated',
  'closed',
  'all',
] as const;
export type WorkbenchBucket = (typeof WORKBENCH_BUCKETS)[number];

export function isWorkbenchBucket(value: string): value is WorkbenchBucket {
  return (WORKBENCH_BUCKETS as readonly string[]).includes(value);
}

// ==================== 优先级 ====================

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export interface PrioritySuggestion {
  priority: Priority;
  reason: string;
}

/**
 * 系统优先级建议：只在截止时间**已知**时使用倒计时；
 * 未知截止一律中优先级，不编造“72 小时内”之类的事实。
 * 用户不能自选优先级，避免全部任务被标记为高。
 */
export function suggestPriority(input: {
  now: Date;
  registrationEnd?: string | null;
}): PrioritySuggestion {
  const raw = input.registrationEnd?.trim();
  if (raw) {
    const end = new Date(raw);
    if (!Number.isNaN(end.getTime())) {
      const diffMs = end.getTime() - input.now.getTime();
      if (diffMs > 0 && diffMs <= 72 * 60 * 60 * 1000) {
        return {
          priority: 'high',
          reason: `报名截止 72 小时内（${end.toISOString()}），涉及资格或时间错误`,
        };
      }
    }
  }
  return { priority: 'medium', reason: '常规人工处理任务（截止未知或非临期）' };
}

export function validatePriorityChange(input: {
  priority: unknown;
  reason: unknown;
}):
  | { ok: true; priority: Priority; reason: string }
  | { ok: false; message: string } {
  if (typeof input.priority !== 'string' || !isPriority(input.priority)) {
    return { ok: false, message: '优先级只能是高/中/低' };
  }
  const reason =
    typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 5) {
    return { ok: false, message: '调整优先级必须填写至少 5 个字的原因' };
  }
  if (reason.length > 200) {
    return { ok: false, message: '优先级原因不能超过 200 字' };
  }
  return { ok: true, priority: input.priority, reason };
}

// ==================== 内部时限（自然小时） ====================

export interface SlaPolicy {
  firstResponseMinutes: number;
  updateMinutes: number;
  escalationGraceMinutes: number;
}

export type SlaPolicySet = Record<Priority, SlaPolicy>;

/**
 * 内部试运行默认值（自然小时，UTC 存储，本地展示）。
 * 这些不是对用户的办结承诺，用于内部发现积压与催办。
 */
export const DEFAULT_SLA_POLICIES: SlaPolicySet = {
  high: { firstResponseMinutes: 120, updateMinutes: 480, escalationGraceMinutes: 120 },
  medium: { firstResponseMinutes: 480, updateMinutes: 1440, escalationGraceMinutes: 480 },
  low: { firstResponseMinutes: 1440, updateMinutes: 4320, escalationGraceMinutes: 1440 },
};

export const SLA_MIN_MINUTES = 1;
export const SLA_MAX_MINUTES = 30 * 24 * 60; // 30 天

export function validateSlaPolicy(input: {
  firstResponseMinutes?: unknown;
  updateMinutes?: unknown;
  escalationGraceMinutes?: unknown;
}):
  | { ok: true; policy: SlaPolicy }
  | { ok: false; message: string } {
  const fields = [
    ['firstResponseMinutes', '首次有效响应时限', input.firstResponseMinutes],
    ['updateMinutes', '下一次有效处理更新时限', input.updateMinutes],
    ['escalationGraceMinutes', '超时后升级宽限', input.escalationGraceMinutes],
  ] as const;
  const out: Partial<SlaPolicy> = {};
  for (const [key, label, raw] of fields) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < SLA_MIN_MINUTES || n > SLA_MAX_MINUTES) {
      return {
        ok: false,
        message: `${label}必须是 ${SLA_MIN_MINUTES}—${SLA_MAX_MINUTES} 之间的整数分钟`,
      };
    }
    out[key] = n;
  }
  return { ok: true, policy: out as SlaPolicy };
}

export interface SlaDeadlines {
  responseDueAt: Date;
  updateDueAt: Date;
  escalationDueAt: Date;
  cycleStartedAt: Date;
}

const minutes = (n: number) => n * 60 * 1000;

/** 新阶段开始时的到期时间；existing 阶段不因配置修改而改变 */
export function computeDeadlines(
  policy: SlaPolicy,
  startedAt: Date,
): SlaDeadlines {
  return {
    responseDueAt: new Date(startedAt.getTime() + minutes(policy.firstResponseMinutes)),
    updateDueAt: new Date(startedAt.getTime() + minutes(policy.updateMinutes)),
    escalationDueAt: new Date(
      startedAt.getTime() +
        minutes(policy.firstResponseMinutes) +
        minutes(policy.escalationGraceMinutes),
    ),
    cycleStartedAt: startedAt,
  };
}

/** 有效响应后的更新周期：以发生时间重新计时，首次响应时间保持不变 */
export function computeUpdateDeadlines(
  policy: SlaPolicy,
  effectiveAt: Date,
): { updateDueAt: Date; escalationDueAt: Date; cycleStartedAt: Date } {
  return {
    updateDueAt: new Date(effectiveAt.getTime() + minutes(policy.updateMinutes)),
    escalationDueAt: new Date(
      effectiveAt.getTime() +
        minutes(policy.updateMinutes) +
        minutes(policy.escalationGraceMinutes),
    ),
    cycleStartedAt: effectiveAt,
  };
}

/** 暂停时保存剩余额度（不为负；已超时也保留 0，避免恢复后短暂重置） */
export function pauseDeadline(now: Date, dueAt: Date | null): number {
  if (!dueAt) return 0;
  return Math.max(0, dueAt.getTime() - now.getTime());
}

/** 恢复时从剩余额度继续，不重置完整额度 */
export function resumeDeadline(now: Date, remainingMs: number | null): Date {
  return new Date(now.getTime() + Math.max(0, remainingMs ?? 0));
}

/**
 * 提高优先级可提前未到期期限；降低优先级不延长当前周期。
 * 返回 null 表示保持原期限。
 */
export function adjustDeadlineForPriority(input: {
  changedAt: Date;
  currentDueAt: Date | null;
  cycleStartedAt: Date | null;
  from: Priority;
  to: Priority;
  policy: SlaPolicy;
}): Date | null {
  if (!input.currentDueAt) return null;
  const rank: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
  if (rank[input.to] > rank[input.from]) {
    const start = input.cycleStartedAt ?? input.changedAt;
    const earlier = new Date(start.getTime() + minutes(input.policy.updateMinutes));
    return earlier < input.currentDueAt ? earlier : input.currentDueAt;
  }
  return null;
}

/** 有效响应动作：认领/查看/内部备注/无意义状态切换都不算 */
export const EFFECTIVE_RESPONSE_ACTIONS = [
  'public_update',
  'request_supplement',
  'resolved',
  'rejected',
] as const;

export function isEffectiveResponse(action: string): boolean {
  return (EFFECTIVE_RESPONSE_ACTIONS as readonly string[]).includes(action);
}

export const SUPPLEMENT_REMINDER_HOURS = 48;
export const LONG_WAITING_SUPPLEMENT_HOURS = 24 * 7;

/** 催办/升级周期键：同一任务同一阶段同一周期只提醒一次 */
export function reminderCycleKey(task: {
  status: string;
  cycleStartedAt: Date | null;
  pausedAt: Date | null;
}): string {
  if (task.status === 'need_supplement') {
    return `wait:${task.pausedAt ? task.pausedAt.toISOString() : 'legacy'}`;
  }
  return `cycle:${task.cycleStartedAt ? task.cycleStartedAt.toISOString() : 'legacy'}`;
}

// ==================== 负责人配置 ====================

export interface OwnerCandidate {
  id: string;
  role: string;
  isActive: boolean;
}

export type OwnerPairCheck =
  | { ok: true; dutyOwnerId: string; backupOwnerId: string }
  | {
      ok: false;
      message: string;
      issues: Array<'missing' | 'not_found' | 'inactive' | 'no_permission' | 'same'>;
    };

/**
 * 日常/备用负责人必须是两个不同、启用且具备处理权限的现有员工账号。
 * 配置负责人不自动增加公告发布等业务权限。
 */
export function validateOwnerPair(input: {
  dutyOwnerId?: unknown;
  backupOwnerId?: unknown;
  users: ReadonlyMap<string, OwnerCandidate>;
}): OwnerPairCheck {
  const duty =
    typeof input.dutyOwnerId === 'string' ? input.dutyOwnerId.trim() : '';
  const backup =
    typeof input.backupOwnerId === 'string' ? input.backupOwnerId.trim() : '';
  if (!duty || !backup) {
    return { ok: false, issues: ['missing'], message: '必须同时配置日常负责人和备用负责人' };
  }
  if (duty === backup) {
    return { ok: false, issues: ['same'], message: '日常负责人和备用负责人必须是两个不同账号' };
  }
  const issues: Array<'not_found' | 'inactive' | 'no_permission'> = [];
  for (const id of [duty, backup]) {
    const user = input.users.get(id);
    if (!user) {
      issues.push('not_found');
      continue;
    }
    if (!user.isActive) issues.push('inactive');
    if (!REVIEW_ROLES.includes(user.role)) issues.push('no_permission');
  }
  if (issues.length > 0) {
    const message = issues.includes('not_found')
      ? '选择的账号不存在'
      : issues.includes('inactive')
        ? '选择的账号已停用'
        : '选择的账号没有人工处理权限';
    return { ok: false, issues, message };
  }
  return { ok: true, dutyOwnerId: duty, backupOwnerId: backup };
}

// ==================== 用户补充输入 ====================

export const SUPPLEMENT_BODY_MIN = 1;
export const SUPPLEMENT_BODY_MAX = 2000;
export const SUPPLEMENT_LINKS_MAX = 5;

export interface SupplementLink {
  url: string;
  label?: string;
}

export type SupplementInputCheck =
  | { ok: true; body: string; links: SupplementLink[] }
  | { ok: false; message: string };

/** 补充正文 1—2000 字；最多 5 个 http/https 链接；拒绝危险协议/凭据/内网地址 */
export function validateSupplementInput(input: {
  body?: unknown;
  links?: unknown;
}): SupplementInputCheck {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length < SUPPLEMENT_BODY_MIN) {
    return { ok: false, message: '请填写补充说明' };
  }
  if (body.length > SUPPLEMENT_BODY_MAX) {
    return { ok: false, message: `补充说明不能超过 ${SUPPLEMENT_BODY_MAX} 字` };
  }
  const rawLinks = input.links ?? [];
  if (!Array.isArray(rawLinks)) {
    return { ok: false, message: '链接格式不正确' };
  }
  if (rawLinks.length > SUPPLEMENT_LINKS_MAX) {
    return { ok: false, message: `最多附加 ${SUPPLEMENT_LINKS_MAX} 个链接` };
  }
  const links: SupplementLink[] = [];
  for (const raw of rawLinks) {
    const urlValue =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'url' in raw
          ? (raw as { url?: unknown }).url
          : undefined;
    const check = checkSubmissionUrl(urlValue);
    if (!check.ok || !check.normalized) {
      return { ok: false, message: check.message ?? '链接格式不正确' };
    }
    const labelRaw =
      raw && typeof raw === 'object' && 'label' in raw
        ? (raw as { label?: unknown }).label
        : undefined;
    const label =
      typeof labelRaw === 'string' && labelRaw.trim()
        ? labelRaw.trim().slice(0, 100)
        : undefined;
    links.push({ url: check.normalized, ...(label ? { label } : {}) });
  }
  return { ok: true, body, links };
}

// ==================== 公告补录结案门禁 ====================

export interface PublishedVersionGateInput {
  submission: { officialUrl: string; status: string };
  announcement: {
    id: string;
    officialUrl?: string | null;
    dataset?: string | null;
    lifecycle?: string | null;
  } | null;
  version: {
    id: string;
    announcementId: string;
    status: string;
    supersededAt?: Date | null;
    withdrawnAt?: Date | null;
  } | null;
  announcedAnnouncementId?: string | null;
  announcedVersionId?: string | null;
  resolutionBasis?: string | null;
}

export type PublishedGateResult =
  | {
      ok: true;
      announcementId: string;
      versionId: string;
      /** true=与线索链接一致；false=人工核验的不同链接 */
      exactLink: boolean;
      basis: string | null;
    }
  | {
      ok: false;
      kind:
        | 'missing_announcement'
        | 'missing_version'
        | 'version_not_published'
        | 'version_withdrawn'
        | 'version_superseded'
        | 'not_real_dataset'
        | 'announcement_withdrawn'
        | 'basis_required';
      message: string;
    };

/**
 * 「已收录」结案门禁：必须关联真实、正式发布、未撤回、未取代的版本。
 * 不能只凭标题相似绑定；不同链接必须填写人工核验依据。
 */
export function validatePublishedResolution(
  input: PublishedVersionGateInput,
): PublishedGateResult {
  if (!input.announcedAnnouncementId || !input.announcedVersionId) {
    return {
      ok: false,
      kind: 'missing_announcement',
      message: '标记「已收录」必须关联正式公告及已发布版本，后端拒绝空关联结案',
    };
  }
  const announcement = input.announcement;
  if (!announcement || announcement.id !== input.announcedAnnouncementId) {
    return { ok: false, kind: 'missing_announcement', message: '关联的正式公告不存在' };
  }
  if (announcement.dataset !== 'real') {
    return {
      ok: false,
      kind: 'not_real_dataset',
      message: '演示或测试公告不能作为用户线索的收录结果',
    };
  }
  if (announcement.lifecycle === 'withdrawn') {
    return {
      ok: false,
      kind: 'announcement_withdrawn',
      message: '该公告已撤回，不能作为当前有效收录结果',
    };
  }
  const version = input.version;
  if (!version || version.id !== input.announcedVersionId) {
    return { ok: false, kind: 'missing_version', message: '关联的公告版本不存在' };
  }
  if (version.announcementId !== announcement.id) {
    return { ok: false, kind: 'missing_version', message: '关联版本不属于该公告' };
  }
  if (version.status !== 'published') {
    return {
      ok: false,
      kind: 'version_not_published',
      message: '关联版本尚未正式发布，不能结案为已收录',
    };
  }
  if (version.withdrawnAt) {
    return {
      ok: false,
      kind: 'version_withdrawn',
      message: '关联版本已撤回，不能作为当前有效收录结果',
    };
  }
  if (version.supersededAt) {
    return {
      ok: false,
      kind: 'version_superseded',
      message: '关联版本已被后续版本取代，请关联当前有效版本',
    };
  }
  const basis =
    typeof input.resolutionBasis === 'string' ? input.resolutionBasis.trim() : '';
  if (basis.length > 500) {
    return { ok: false, kind: 'basis_required', message: '核验依据不能超过 500 字' };
  }
  const officialUrl = announcement.officialUrl?.trim();
  if (officialUrl) {
    const a = checkSubmissionUrl(input.submission.officialUrl);
    const b = checkSubmissionUrl(officialUrl);
    if (a.ok && b.ok && a.normalized && b.normalized && a.normalized === b.normalized) {
      return {
        ok: true,
        announcementId: announcement.id,
        versionId: version.id,
        exactLink: true,
        basis: basis || null,
      };
    }
  }
  if (basis.length < 10) {
    return {
      ok: false,
      kind: 'basis_required',
      message: '线索链接与公告链接不同，必须填写至少 10 个字的核验依据（说明如何确认是同一公告）',
    };
  }
  return {
    ok: true,
    announcementId: announcement.id,
    versionId: version.id,
    exactLink: false,
    basis,
  };
}

// ==================== 派生任务结案 ====================

export type DerivedCompletionCheck =
  | { ok: true; outcome: 'resolved' | 'limited' | 'rejected' }
  | { ok: false; message: string };

/** 扫描件/解析转人工：必须真实交接到审核任务，不能自行点击完成 */
export function validateParseManualCompletion(input: {
  parseStatus: string;
  handoffRun: { id: string; status: string; snapshotId: string } | null;
  parseSnapshotId: string;
  evidenceNote: string;
}): DerivedCompletionCheck {
  if (input.parseStatus !== 'pending_manual') {
    return { ok: false, message: '该解析任务已不是待人工状态' };
  }
  if (!input.handoffRun) {
    return { ok: false, message: '必须先创建并关联人工提取的审核任务后才能完成' };
  }
  if (input.handoffRun.snapshotId !== input.parseSnapshotId) {
    return { ok: false, message: '关联的审核任务不属于同一原件快照' };
  }
  if (!['pending_review', 'approved', 'published'].includes(input.handoffRun.status)) {
    return { ok: false, message: '关联审核任务尚未进入待审核或已通过状态' };
  }
  if (input.evidenceNote.trim().length < 10) {
    return { ok: false, message: '请填写至少 10 个字的证据定位与校验说明' };
  }
  return { ok: true, outcome: 'resolved' };
}

/** 来源采集异常：真实恢复复查或如实登记「受限/停用，已说明」 */
export function validateSourceAlertCompletion(input: {
  outcome: unknown;
  note: unknown;
  sourceHealthStatus?: string | null;
  lastCheckedAt?: Date | null;
  alertFirstSeenAt?: Date | null;
  missingCheckNote?: unknown;
}):
  | { ok: true; outcome: 'resolved' | 'limited' }
  | { ok: false; message: string } {
  const outcome = input.outcome;
  if (outcome !== 'resolved' && outcome !== 'limited' && outcome !== 'rejected') {
    return { ok: false, message: '结案结果无效' };
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length < 10) {
    return { ok: false, message: '请填写至少 10 个字的处理说明' };
  }
  if (outcome === 'rejected') {
    return { ok: false, message: '来源告警不能以「不采纳」结案，请选择已恢复或受限/停用' };
  }
  if (outcome === 'resolved') {
    if (
      input.sourceHealthStatus === 'blocked' ||
      input.sourceHealthStatus === 'paused' ||
      input.sourceHealthStatus === 'degraded'
    ) {
      return {
        ok: false,
        message: '来源仍处于受限/停用/降级状态，不能标记为已恢复；请选择「受限/停用，已说明」',
      };
    }
    if (
      input.lastCheckedAt &&
      input.alertFirstSeenAt &&
      input.lastCheckedAt.getTime() < input.alertFirstSeenAt.getTime()
    ) {
      return { ok: false, message: '告警后没有新的成功检查记录，不能判定为已恢复' };
    }
  }
  if (outcome === 'limited') {
    const missing =
      typeof input.missingCheckNote === 'string' ? input.missingCheckNote.trim() : '';
    if (missing.length < 10) {
      return {
        ok: false,
        message: '受限结案必须填写覆盖缺口与漏采核对结果（至少 10 个字）',
      };
    }
  }
  return { ok: true, outcome };
}

// ==================== 票据编号 ====================

const TICKET_PREFIX: Record<TicketType, string> = {
  correction: 'JC',
  announcement_submission: 'BK',
  parse_manual: 'SM',
  source_alert: 'SY',
};

/** 稳定受理编号：前缀 + 12 位大写十六进制；仅用于定位，不替代鉴权 */
export function makeTicketNo(type: TicketType, seed: string): string {
  const hex = seed.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return `${TICKET_PREFIX[type]}-${hex.slice(0, 12).padEnd(12, '0')}`;
}

export function isTicketNo(value: string): boolean {
  return /^(JC|BK|SM|SY)-[0-9A-F]{12}$/.test(value);
}
