/**
 * 受邀试用指标与看板领域逻辑（v7.0 模块 7，纯函数）。
 *
 * 口径依据《教招有据-模块0-品牌清单与版本决策记录》：
 * - 北极星 key = north_star_progress_7d（不与旧 meaningful_progress_7d 混用）；
 *   分母 = 获得真实有效机会（dataset=real）且满 7 日观察期的受邀真实用户
 *   （排除 seed / 员工 / 演示环境）；分子 = 其中 7 日内关注并完成有效推进动作的去重人数；
 * - 看板单列：有效机会获得率、画像各步、依据理解、关注、补信息导致结论变化、
 *   材料完成、准备报名、进入官方报名入口、已报名、主要目标；
 * - 四层分群彼此隔离：seed / live × 员工(STAFF_ROLES) / 真实 × invited / demo；
 * - 事件只允许白名单类型与标量维度；资格原文、证件信息在摄取前被拒绝。
 */
import { STAFF_ROLES } from '../auth/admin.guard.js';
import type {
  AnnouncementReviewStatus,
  AnnouncementTimeline,
  RecruitmentAnnouncement,
} from '../matching/types.js';
import type { MonitoringCoverage } from '../matching/coverage.js';

// ==================== 事件白名单（服务端只接受已登记的必需事件） ====================

export const TRIAL_EVENT_TYPES = [
  // 受邀试用漏斗（模块 0 事件字典 + 本模块新增 4 类）
  'profile_completed',
  'profile_step_completed',
  'opportunity_revealed',
  'match_basis_viewed',
  'opportunity_followed',
  'opportunity_unfollowed',
  'qualification_supplemented',
  'follow_status_changed',
  'primary_target_set',
  'material_status_changed',
  'register_entry_opened',
  // —— v7.1 M9 分析事件：首页/地区偏好/无结果/订阅/提醒/地图/日程同步/节点/冲突/改期 ——
  'home_start_match_clicked',
  'region_preference_selected',
  'no_result_reason_viewed',
  'subscription_changed',
  'opportunity_notification_viewed',
  'opportunity_notification_clicked',
  'map_entry_clicked',
  'schedule_sync_completed',
  'schedule_node_viewed',
  'schedule_conflict_viewed',
  'announcement_reschedule_viewed',
  // —— v7.2 保存后的下一步 + 官方确认（曝光/复制可重复发生，不去重） ——
  'next_action_opened',
  'consultation_template_copied',
  // —— v7.2 整合收口：结果工作台与定向补充流程（枚举维度，正文由 sanitizeProps 拒绝） ——
  'result_tab_changed',
  'supplement_opened',
  'supplement_recomputed',
  'supplement_returned_to_result',
] as const;

export type TrialEventType = (typeof TRIAL_EVENT_TYPES)[number];

export const TRIAL_MODULES = [
  'profile',
  'opportunity',
  'target',
  'evidence',
  'review',
  'material',
  'resource',
  'plan',
  'feedback',
  'replan',
  'correction',
  'privacy',
  'storage',
  'home',
  'schedule',
  'subscription',
  'notification',
] as const;

export type TrialModule = (typeof TRIAL_MODULES)[number];

/**
 * 去重范围（once-per-user 语义在库层用 @@unique([userId, dedupKey]) 实现）：
 * - user：同账号只记一次（重复点击 / 换设备重报不重复计）；
 * - user_unit：同账号同机会只记一次；
 * - user_step：同账号同画像步只记一次；
 * - null：不去重（状态流转类事件本身可多次发生）。
 */
const DEDUP_SCOPES: Record<TrialEventType, 'user' | 'user_unit' | 'user_step' | null> = {
  profile_completed: 'user',
  profile_step_completed: 'user_step',
  opportunity_revealed: 'user',
  match_basis_viewed: 'user_unit',
  opportunity_followed: 'user_unit',
  opportunity_unfollowed: null,
  qualification_supplemented: null,
  follow_status_changed: null,
  primary_target_set: null,
  material_status_changed: null,
  register_entry_opened: 'user_unit',
  // M9：首页主按钮、地图入口、地区偏好、提醒曝光/点击、冲突曝光按用户幂等；
  // 订阅变更、无结果曝光、同步结果、节点查看、改期查看为状态/查看类，不去重。
  home_start_match_clicked: 'user',
  region_preference_selected: 'user',
  no_result_reason_viewed: null,
  subscription_changed: null,
  opportunity_notification_viewed: 'user',
  opportunity_notification_clicked: 'user',
  map_entry_clicked: 'user_unit',
  schedule_sync_completed: null,
  schedule_node_viewed: null,
  schedule_conflict_viewed: 'user',
  announcement_reschedule_viewed: null,
  // v7.2：面板随机会数据重算可能多次曝光、问题可多次复制，均不去重
  next_action_opened: null,
  consultation_template_copied: null,
  // v7.2 收口：标签切换/补充打开/重算/返回均为可重复行为，不去重
  result_tab_changed: null,
  supplement_opened: null,
  supplement_recomputed: null,
  supplement_returned_to_result: null,
};

export function dedupKeyFor(
  type: string,
  unitId: string | null,
  props: Record<string, string | number | boolean> | null,
): string | null {
  const scope = DEDUP_SCOPES[type as TrialEventType];
  if (!scope) return null;
  if (scope === 'user') return `once:${type}`;
  if (scope === 'user_unit') return `once:${type}:${unitId ?? ''}`;
  return `once:${type}:${typeof props?.step === 'number' ? props.step : ''}`;
}

// ==================== props 脱敏（拒绝资格原文与证件信息） ====================

export type SanitizedProps = Record<string, string | number | boolean>;

export type SanitizeResult =
  | { ok: true; props: SanitizedProps | null }
  | { ok: false; reason: string };

// 键名允许前端既有的 camelCase/snake_case（如 validCount、social_security）；
// 键名命中敏感词即整事件拒绝：证件/身份/自由文本类字段一律不落库。
const PROP_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const SENSITIVE_KEY_RE =
  /(id_?card|identity|passport|cert_?(no|number)|id_?number|social_?credit|phone|mobile|email|address|birth|password|secret|token|content|body|text|note|raw|original|excerpt|description|answer|remark|comment|question|contact|name)/i;
const MAX_PROPS = 8;
const MAX_STRING_LEN = 64;

export function sanitizeProps(raw: unknown): SanitizeResult {
  if (raw === undefined || raw === null) return { ok: true, props: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'props_must_be_object' };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PROPS) return { ok: false, reason: 'too_many_props' };
  const out: SanitizedProps = {};
  for (const [key, value] of entries) {
    if (!PROP_KEY_RE.test(key)) return { ok: false, reason: 'bad_prop_key' };
    if (SENSITIVE_KEY_RE.test(key)) return { ok: false, reason: 'sensitive_prop_key' };
    if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { ok: false, reason: 'bad_prop_value' };
      out[key] = value;
    } else if (typeof value === 'string') {
      // 只允许短枚举/ID 片段；长文本（资格原文、证件号等）一律拒绝
      if (value.length === 0 || value.length > MAX_STRING_LEN) {
        return { ok: false, reason: 'prop_value_too_long' };
      }
      out[key] = value;
    } else {
      return { ok: false, reason: 'prop_value_not_scalar' };
    }
  }
  return { ok: true, props: out };
}

// ==================== 分群：seed/live × 员工/真实 × invited/demo ====================

export type TrialCohortKey = 'invited' | 'invited_staff' | 'demo' | 'seed';

export const TRIAL_COHORT_LABELS: Record<TrialCohortKey, string> = {
  invited: '受邀真实用户（主列）',
  invited_staff: '受邀员工账号',
  demo: '演示环境',
  seed: '演示种子（seed）',
};

/** 看板分群顺序：主列在前，其余单列隔离，绝不混算 */
export const TRIAL_COHORT_ORDER: TrialCohortKey[] = [
  'invited',
  'invited_staff',
  'demo',
  'seed',
];

export interface TrialEventRecord {
  userId: string;
  userRole: string;
  type: string;
  unitId: string | null;
  /** demo=演示台账机会 / real=真实监测台账机会 / null（服务端解析，不信任客户端） */
  dataset: string | null;
  source: string;
  authMode: string;
  props: Record<string, unknown> | null;
  occurredAt: Date;
}

export function cohortOf(e: TrialEventRecord): TrialCohortKey {
  if (e.source === 'seed') return 'seed';
  if (e.authMode === 'demo') return 'demo';
  return STAFF_ROLES.includes(e.userRole) ? 'invited_staff' : 'invited';
}

// ==================== 看板计算 ====================

export interface TrialMetric {
  numerator: number;
  denominator: number;
  /** 分母为 0 时为 null（前端显示「—」，绝不显示 0%） */
  rate: number | null;
}

export interface TrialStepRow {
  step: number;
  label: string;
  users: number;
  /** 相对第 1 步完成人数；第 1 步为 0 时为 null */
  rateFromFirst: number | null;
}

export interface TrialNorthStar {
  /** 获得真实有效机会且满 7 日观察期的去重用户 */
  denominator: number;
  /** 其中 7 日内关注并完成有效推进动作的去重用户 */
  numerator: number;
  rate: number | null;
  /** 获得真实有效机会但未满 7 日观察期（单列展示，不计入分母） */
  observing: number;
}

export interface TrialCohortReport {
  users: number;
  /** 有效机会获得率 = 获得有效机会用户 ÷ 完成基础画像用户 */
  opportunityRate: TrialMetric;
  profileSteps: TrialStepRow[];
  /** 依据理解 ÷ 获得有效机会用户 */
  matchBasis: TrialMetric;
  /** 关注 ÷ 获得有效机会用户 */
  follow: TrialMetric;
  /** 补信息导致结论变化 ÷ 获得有效机会用户 */
  conclusionChanged: TrialMetric;
  /** 材料完成 ÷ 关注用户 */
  materialsDone: TrialMetric;
  /** 准备报名 ÷ 关注用户 */
  preparing: TrialMetric;
  /** 进入官方报名入口 ÷ 准备报名用户 */
  registerEntry: TrialMetric;
  /** 已报名 ÷ 进入官方报名入口用户 */
  registered: TrialMetric;
  /** 主要目标 ÷ 关注用户 */
  primaryTarget: TrialMetric;
  northStar: TrialNorthStar;
  /** 有机会事件的用户按机会数据集分列（真实台账 / 演示台账） */
  datasetSplit: { real: number; demo: number; unknown: number };
  // —— v7.1 M9 新增：首页理解 / 无结果分布 / 订阅 / 地图 / 日程同步与冲突 ——
  /** 首页主按钮点击 ÷ 画像首步完成人数（近似首页到达） */
  homeUnderstanding: TrialMetric;
  /** 无结果三态各自曝光次数（按 reasonCode 分组；10 人样本展示次数不伪装成比例） */
  noResultReasons: { reasonCode: string; count: number }[];
  /** 创建订阅用户 ÷ 获得有效机会用户；closedCount=关闭订阅的去重用户 */
  subscriptionUsage: TrialMetric;
  subscriptionClosedCount: number;
  /** 地图入口点击用户 ÷ 查看匹配依据用户 */
  mapUsage: TrialMetric;
  /** 日程同步成功次数 ÷（成功+失败）次数；另列失败原因分布 */
  scheduleSyncHealth: { success: number; failure: number; rate: number | null; failureReasons: { reasonCode: string; count: number }[] };
  /** 时间冲突曝光用户 ÷ 关注用户 */
  scheduleConflictRate: TrialMetric;
}

export interface TrialDashboard {
  generatedAt: string;
  cohorts: Record<TrialCohortKey, TrialCohortReport>;
  /** 机会供给快照（市场侧存量，来自人工巡检与真实公告台账，非用户行为事件） */
  supply: SupplySnapshot;
}

const OBSERVE_MS = 7 * 24 * 60 * 60 * 1000;

export const PROFILE_STEP_LABELS = [
  '第1步 · 可接受地区',
  '第2步 · 学历与学位',
  '第3步 · 专业全称',
  '第4步 · 毕业与就业状态',
  '第5步 · 教师资格与用工形式',
];

/** 北极星「有效推进动作」：报名状态推进 / 主要目标 / 官方入口 / 材料完成 / 补信息改判 */
const PROGRESSION_STATUSES = new Set(['preparing', 'registered']);

function propStr(e: TrialEventRecord, key: string): string | undefined {
  const v = e.props?.[key];
  return typeof v === 'string' ? v : undefined;
}

function propNum(e: TrialEventRecord, key: string): number | undefined {
  const v = e.props?.[key];
  return typeof v === 'number' ? v : undefined;
}

function metric(numerator: number, denominator: number): TrialMetric {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
  };
}

function isProgression(e: TrialEventRecord): boolean {
  if (e.dataset !== 'real') return false;
  switch (e.type) {
    case 'follow_status_changed':
      return PROGRESSION_STATUSES.has(propStr(e, 'to') ?? '');
    case 'primary_target_set':
    case 'register_entry_opened':
      return true;
    case 'material_status_changed':
      return propStr(e, 'to') === 'done';
    case 'qualification_supplemented':
      return propNum(e, 'conclusionChanged') === 1;
    default:
      return false;
  }
}

function emptyReport(): TrialCohortReport {
  return {
    users: 0,
    opportunityRate: metric(0, 0),
    profileSteps: PROFILE_STEP_LABELS.map((label, i) => ({
      step: i + 1,
      label,
      users: 0,
      rateFromFirst: null,
    })),
    matchBasis: metric(0, 0),
    follow: metric(0, 0),
    conclusionChanged: metric(0, 0),
    materialsDone: metric(0, 0),
    preparing: metric(0, 0),
    registerEntry: metric(0, 0),
    registered: metric(0, 0),
    primaryTarget: metric(0, 0),
    northStar: { denominator: 0, numerator: 0, rate: null, observing: 0 },
    datasetSplit: { real: 0, demo: 0, unknown: 0 },
    // M9 默认值
    homeUnderstanding: metric(0, 0),
    noResultReasons: [],
    subscriptionUsage: metric(0, 0),
    subscriptionClosedCount: 0,
    mapUsage: metric(0, 0),
    scheduleSyncHealth: { success: 0, failure: 0, rate: null, failureReasons: [] },
    scheduleConflictRate: metric(0, 0),
  };
}

/** 计算单个分群看板（events 必须已归属该分群） */
function computeCohort(
  events: readonly TrialEventRecord[],
  now: Date,
): TrialCohortReport {
  const report = emptyReport();
  report.users = new Set(events.map((e) => e.userId)).size;

  const byUser = new Map<string, TrialEventRecord[]>();
  for (const e of events) {
    const list = byUser.get(e.userId);
    if (list) list.push(e);
    else byUser.set(e.userId, [e]);
  }

  const distinctUsers = (pred: (e: TrialEventRecord) => boolean): number =>
    new Set(events.filter(pred).map((e) => e.userId)).size;

  // —— 漏斗人群 ——
  const isValidReveal = (e: TrialEventRecord) =>
    e.type === 'opportunity_revealed' && (propNum(e, 'validCount') ?? 0) >= 1;
  const profileUsers = distinctUsers((e) => e.type === 'profile_completed');
  const revealedUsers = distinctUsers(isValidReveal);
  const followedUsers = distinctUsers((e) => e.type === 'opportunity_followed');
  const preparingUsers = distinctUsers(
    (e) => e.type === 'follow_status_changed' && propStr(e, 'to') === 'preparing',
  );
  const registerEntryUsers = distinctUsers((e) => e.type === 'register_entry_opened');
  const registeredUsers = distinctUsers(
    (e) => e.type === 'follow_status_changed' && propStr(e, 'to') === 'registered',
  );

  report.opportunityRate = metric(revealedUsers, profileUsers);

  // 画像各步（以第 1 步完成人数为基准）
  const stepUsers = new Map<number, Set<string>>();
  for (const e of events) {
    if (e.type !== 'profile_step_completed') continue;
    const step = propNum(e, 'step');
    if (step === undefined || !Number.isInteger(step) || step < 1 || step > 5) continue;
    let set = stepUsers.get(step);
    if (!set) {
      set = new Set();
      stepUsers.set(step, set);
    }
    set.add(e.userId);
  }
  const firstStepUsers = stepUsers.get(1)?.size ?? 0;
  report.profileSteps = PROFILE_STEP_LABELS.map((label, i) => {
    const users = stepUsers.get(i + 1)?.size ?? 0;
    return {
      step: i + 1,
      label,
      users,
      rateFromFirst: firstStepUsers > 0 ? users / firstStepUsers : null,
    };
  });

  report.matchBasis = metric(
    distinctUsers((e) => e.type === 'match_basis_viewed'),
    revealedUsers,
  );
  report.follow = metric(followedUsers, revealedUsers);
  report.conclusionChanged = metric(
    distinctUsers(
      (e) => e.type === 'qualification_supplemented' && propNum(e, 'conclusionChanged') === 1,
    ),
    revealedUsers,
  );
  report.materialsDone = metric(
    distinctUsers((e) => e.type === 'material_status_changed' && propStr(e, 'to') === 'done'),
    followedUsers,
  );
  report.preparing = metric(preparingUsers, followedUsers);
  report.registerEntry = metric(registerEntryUsers, preparingUsers);
  report.registered = metric(registeredUsers, registerEntryUsers);
  report.primaryTarget = metric(
    distinctUsers((e) => e.type === 'primary_target_set'),
    followedUsers,
  );

  // —— 北极星（模块 0 口径：只看真实台账机会） ——
  const firstRealReveal = new Map<string, number>();
  for (const e of events) {
    if (!isValidReveal(e) || e.dataset !== 'real') continue;
    const at = e.occurredAt.getTime();
    const known = firstRealReveal.get(e.userId);
    if (known === undefined || at < known) firstRealReveal.set(e.userId, at);
  }
  let nsDenominator = 0;
  let nsNumerator = 0;
  let observing = 0;
  for (const [userId, revealAt] of firstRealReveal) {
    const windowEnd = revealAt + OBSERVE_MS;
    if (now.getTime() < windowEnd) {
      observing += 1;
      continue;
    }
    nsDenominator += 1;
    const userEvents = byUser.get(userId) ?? [];
    const inWindow = (e: TrialEventRecord) => {
      const at = e.occurredAt.getTime();
      return at >= revealAt && at <= windowEnd;
    };
    const followed = userEvents.some((e) => e.type === 'opportunity_followed' && inWindow(e));
    const progressed = userEvents.some((e) => isProgression(e) && inWindow(e));
    if (followed && progressed) nsNumerator += 1;
  }
  report.northStar = {
    denominator: nsDenominator,
    numerator: nsNumerator,
    rate: nsDenominator > 0 ? nsNumerator / nsDenominator : null,
    observing,
  };

  // —— 机会数据集分列（真实台账 / 演示台账） ——
  const dsReal = new Set<string>();
  const dsDemo = new Set<string>();
  const dsUnknown = new Set<string>();
  for (const e of events) {
    if (e.dataset === 'real') dsReal.add(e.userId);
    else if (e.dataset === 'demo') dsDemo.add(e.userId);
    else dsUnknown.add(e.userId);
  }
  report.datasetSplit = {
    real: dsReal.size,
    demo: dsDemo.size,
    unknown: dsUnknown.size,
  };

  // —— v7.1 M9 新增指标 ——
  // 首页理解：主按钮点击用户 ÷ 画像首步完成人数（近似首页到达）
  const homeClickers = distinctUsers((e) => e.type === 'home_start_match_clicked');
  const firstStep = stepUsers.get(1)?.size ?? 0;
  report.homeUnderstanding = metric(homeClickers, firstStep);

  // 无结果原因分布：按 reasonCode 分组计数（展示次数，10 人样本不伪装成比例）
  const reasonCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'no_result_reason_viewed') continue;
    const code = propStr(e, 'reasonCode') ?? 'unknown';
    reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
  }
  report.noResultReasons = [...reasonCounts.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count);

  // 订阅使用：创建订阅用户 ÷ 获得有效机会用户；关闭订阅去重用户数
  const subscriptionCreators = distinctUsers(
    (e) => e.type === 'subscription_changed' && propStr(e, 'action') === 'created',
  );
  report.subscriptionUsage = metric(subscriptionCreators, revealedUsers);
  report.subscriptionClosedCount = distinctUsers(
    (e) => e.type === 'subscription_changed' && propStr(e, 'action') === 'closed',
  );

  // 地图使用：地图入口点击用户 ÷ 查看匹配依据用户
  const mapClickers = distinctUsers((e) => e.type === 'map_entry_clicked');
  const basisUsers = distinctUsers((e) => e.type === 'match_basis_viewed');
  report.mapUsage = metric(mapClickers, basisUsers);

  // 日程同步健康度：success/(success+failure)；失败原因分布
  let syncSuccess = 0;
  let syncFailure = 0;
  const failureReasons = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'schedule_sync_completed') continue;
    if (propStr(e, 'status') === 'failure') {
      syncFailure += 1;
      const code = propStr(e, 'reasonCode') ?? 'unknown';
      failureReasons.set(code, (failureReasons.get(code) ?? 0) + 1);
    } else {
      syncSuccess += 1;
    }
  }
  const syncTotal = syncSuccess + syncFailure;
  report.scheduleSyncHealth = {
    success: syncSuccess,
    failure: syncFailure,
    rate: syncTotal > 0 ? syncSuccess / syncTotal : null,
    failureReasons: [...failureReasons.entries()]
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((a, b) => b.count - a.count),
  };

  // 时间冲突曝光率：看到冲突提醒的用户 ÷ 关注用户
  const conflictViewers = distinctUsers((e) => e.type === 'schedule_conflict_viewed');
  report.scheduleConflictRate = metric(conflictViewers, followedUsers);

  return report;
}

/**
 * 计算完整看板：把事件按 seed / live × 员工/真实 × invited/demo 分成四个隔离分群，
 * 各自独立计算指标，绝不混算。
 */
export function computeTrialDashboard(
  events: readonly TrialEventRecord[],
  now: Date = new Date(),
): Omit<TrialDashboard, 'supply'> {
  const grouped: Record<TrialCohortKey, TrialEventRecord[]> = {
    invited: [],
    invited_staff: [],
    demo: [],
    seed: [],
  };
  for (const e of events) {
    grouped[cohortOf(e)].push(e);
  }
  const cohorts = {} as Record<TrialCohortKey, TrialCohortReport>;
  for (const key of TRIAL_COHORT_ORDER) {
    cohorts[key] = computeCohort(grouped[key], now);
  }
  return { generatedAt: now.toISOString(), cohorts };
}

// ==================== 机会供给快照（市场侧存量，非用户行为事件） ====================

/**
 * 公告报名相位（按报名日历日划分；日期只取官方公告明确给出的，缺省即「待官方通知」）：
 * - open：报名开始日 ≤ 今天 ≤ 报名截止日（或已开始且官方未给截止日）；
 * - preview：未到开始日，或官方未给具体报名日期（时间待官方通知）；
 * - closed：已过报名截止日；
 * - withdrawn：公告已撤回/批次取消。
 */
export type AnnouncementPhase = 'open' | 'preview' | 'closed' | 'withdrawn';

export interface SupplySnapshot {
  generatedAt: string;
  /** 人工巡检覆盖（coverage.ts 单一事实源） */
  coverage: {
    subjectLabel: string;
    status: MonitoringCoverage['status'];
    monitoredRegions: number;
    monitoredSources: number;
    /** 巡检登记为不可用（ok=false）的官方栏目数 */
    sourcesUnhealthy: number;
    lastCheckedAt: string;
    /** 人工巡检登记的「当前在报语文岗位数」（报考单元口径） */
    openOpportunityCount: number;
  };
  announcements: {
    /** 真实监测台账公告总数（含历史批次） */
    total: number;
    active: number;
    withdrawn: number;
    /** active 公告按报名相位计数 */
    open: number;
    preview: number;
    closed: number;
    /** 最近巡检确认来源失效的公告数（sourceHealth.ok=false） */
    sourceFailed: number;
    review: {
      /** 已人工复核（human_reviewed） */
      humanReviewed: number;
      /** AI 初核待人工复核（或缺省未复核） */
      pending: number;
    };
  };
  /** 报考单元（岗位）口径：每个公告只取最新版本 */
  units: {
    /** 全部公告最新版本的岗位单元总数（含历史批次，用于台账总量核对） */
    total: number;
    /** 在报公告（phase=open）最新版本下的岗位单元数 */
    open: number;
  };
  /**
   * 交叉核对：人工巡检登记数（coverage）vs 按公告报名时间计算的在报单元数。
   * 不一致必须人工排查（巡检未更新 / 延期取消未录入），不得静默取其一当作供给事实。
   */
  crossCheck: {
    manualOpenCount: number;
    computedOpenUnits: number;
    consistent: boolean;
  };
}

/** 北京时间日历日（YYYY-MM-DD）；公告报名日期按中国大陆运营日历核对 */
export function cnDateString(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function latestVersion(a: RecruitmentAnnouncement): RecruitmentAnnouncement['versions'][number] {
  return a.versions.reduce((acc, v) => (v.versionNumber > acc.versionNumber ? v : acc), a.versions[0]);
}

export function phaseOf(timeline: AnnouncementTimeline, lifecycle: string, today: string): AnnouncementPhase {
  if (lifecycle === 'withdrawn') return 'withdrawn';
  const { registrationStart: start, registrationEnd: end } = timeline;
  if (end && today > end) return 'closed';
  if (!end) {
    // 官方未给截止日：已给开始日且已开始 → 在报；开始日未到或日期全缺 → 预告（待官方通知）
    if (start && today >= start) return 'open';
    return 'preview';
  }
  if (start && today < start) return 'preview';
  return 'open';
}

/**
 * 计算机会供给快照（模块 8 每日台账的「机会供给」行取此）。
 * 只统计 dataset='real' 的真实监测台账；演示公告永远不构成真实供给。
 */
export function computeSupplySnapshot(
  announcements: readonly RecruitmentAnnouncement[],
  coverage: MonitoringCoverage,
  now: Date = new Date(),
): SupplySnapshot {
  const today = cnDateString(now);
  const real = announcements.filter((a) => a.dataset === 'real');

  const counts = { total: real.length, active: 0, withdrawn: 0, open: 0, preview: 0, closed: 0, sourceFailed: 0 };
  const review: { humanReviewed: number; pending: number } = { humanReviewed: 0, pending: 0 };
  let unitsTotal = 0;
  let unitsOpen = 0;

  for (const a of real) {
    const status: AnnouncementReviewStatus | undefined = a.reviewStatus;
    if (status === 'human_reviewed') review.humanReviewed += 1;
    else review.pending += 1;
    if (a.sourceHealth && a.sourceHealth.ok === false) counts.sourceFailed += 1;

    const version = latestVersion(a);
    unitsTotal += version.units.length;

    const phase = phaseOf(version.timeline, a.lifecycle, today);
    if (phase === 'withdrawn') {
      counts.withdrawn += 1;
    } else {
      counts.active += 1;
      counts[phase] += 1;
      if (phase === 'open') unitsOpen += version.units.length;
    }
  }

  const sourcesUnhealthy = coverage.regions.reduce(
    (sum, r) => sum + r.sources.filter((s) => !s.ok).length,
    0,
  );

  return {
    generatedAt: now.toISOString(),
    coverage: {
      subjectLabel: coverage.subjectLabel,
      status: coverage.status,
      monitoredRegions: coverage.regions.length,
      monitoredSources: coverage.regions.reduce((sum, r) => sum + r.sources.length, 0),
      sourcesUnhealthy,
      lastCheckedAt: coverage.lastCheckedAt,
      openOpportunityCount: coverage.openOpportunityCount,
    },
    announcements: { ...counts, review },
    units: { total: unitsTotal, open: unitsOpen },
    crossCheck: {
      manualOpenCount: coverage.openOpportunityCount,
      computedOpenUnits: unitsOpen,
      consistent: coverage.openOpportunityCount === unitsOpen,
    },
  };
}
