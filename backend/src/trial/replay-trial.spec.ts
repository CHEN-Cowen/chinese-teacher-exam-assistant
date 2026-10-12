/**
 * 受邀试用指标手算对账（v7.0 模块 7 回放样本）。
 *
 * 用固定基准时间逐条手算期望值，覆盖：
 * 1. 完整旅程主样本（含重复点击关注/官方入口的重复行）；
 * 2. 未满 7 日观察期（单列「观察中」，不进分母）；
 * 3. 重复点击（去重用户口径，重复行不虚增）；
 * 4. 取消关注（计关注、不计后续阶段、不进北极星分子）；
 * 5. 跨设备（同账号两台设备 → 1 个去重用户）；
 * 6. 空样本（分母 0 → rate=null，显示「—」，绝不显示 0%）；
 * 7. seed/live × 员工/真实 × invited/demo 四层分群隔离；
 * 8. 补信息导致结论变化；
 * 9. 机会数据集分列（北极星只认真实台账机会）。
 */
import { describe, expect, it } from 'vitest';
import {
  computeTrialDashboard,
  sanitizeProps,
  dedupKeyFor,
  TRIAL_EVENT_TYPES,
  type TrialEventRecord,
} from './trial.domain.js';

const NOW = new Date('2026-10-06T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const REAL_UNIT = 'unit-real-hangzhou-01';
const DEMO_UNIT = 'unit-demo-01';

function at(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * DAY);
}

interface EvSpec {
  userId: string;
  type: string;
  daysAgo: number;
  unitId?: string | null;
  dataset?: string | null;
  userRole?: string;
  authMode?: string;
  source?: string;
  props?: Record<string, unknown>;
}

function ev(spec: EvSpec): TrialEventRecord {
  return {
    userId: spec.userId,
    userRole: spec.userRole ?? 'user',
    type: spec.type,
    unitId: spec.unitId === undefined ? REAL_UNIT : spec.unitId,
    dataset: spec.dataset === undefined ? 'real' : spec.dataset,
    source: spec.source ?? 'live',
    authMode: spec.authMode ?? 'invited',
    props: spec.props ?? null,
    occurredAt: at(spec.daysAgo),
  };
}

describe('受邀试用看板 · 手算对账', () => {
  it('主样本：完整旅程全部指标逐项对上（含重复点击的重复行不虚增）', () => {
    // u-a：10 天前完成画像并获得 2 个真实机会，次日关注并推进，第 8 天进入官方入口并已报名。
    // 关注被连点 2 次、官方入口被点 2 次 → 重复行保留，但去重用户口径不虚增。
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-a', type: 'profile_completed', daysAgo: 10, unitId: null, dataset: null, props: { stepCount: 5 } }),
      ...[1, 2, 3, 4, 5].map((step) =>
        ev({ userId: 'u-a', type: 'profile_step_completed', daysAgo: 10, unitId: null, dataset: null, props: { step } }),
      ),
      ev({ userId: 'u-a', type: 'opportunity_revealed', daysAgo: 10, props: { validCount: 2 } }),
      ev({ userId: 'u-a', type: 'match_basis_viewed', daysAgo: 10 }),
      // 重复点击：同一用户同一机会两条 follow 行
      ev({ userId: 'u-a', type: 'opportunity_followed', daysAgo: 9 }),
      ev({ userId: 'u-a', type: 'opportunity_followed', daysAgo: 9 }),
      ev({ userId: 'u-a', type: 'follow_status_changed', daysAgo: 9, props: { from: 'considering', to: 'preparing' } }),
      ev({ userId: 'u-a', type: 'primary_target_set', daysAgo: 9 }),
      ev({ userId: 'u-a', type: 'material_status_changed', daysAgo: 8, props: { to: 'done' } }),
      // 重复点击：官方入口两条行
      ev({ userId: 'u-a', type: 'register_entry_opened', daysAgo: 8 }),
      ev({ userId: 'u-a', type: 'register_entry_opened', daysAgo: 8 }),
      ev({ userId: 'u-a', type: 'follow_status_changed', daysAgo: 8, props: { from: 'preparing', to: 'registered' } }),
    ];

    const { cohorts } = computeTrialDashboard(events, NOW);
    const r = cohorts.invited;

    expect(r.users).toBe(1);
    // 有效机会获得率 = 1/1
    expect(r.opportunityRate).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    // 画像各步：5 步各 1 人，相对第 1 步均为 1
    expect(r.profileSteps.map((s) => s.users)).toEqual([1, 1, 1, 1, 1]);
    expect(r.profileSteps.every((s) => s.rateFromFirst === 1)).toBe(true);
    expect(r.matchBasis).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.follow).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.conclusionChanged).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    expect(r.materialsDone).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.preparing).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.registerEntry).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.registered).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.primaryTarget).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    // 北极星：获得真实机会已满 7 日（分母 1），7 日内关注且完成推进（分子 1）
    expect(r.northStar).toEqual({ denominator: 1, numerator: 1, rate: 1, observing: 0 });
    expect(r.datasetSplit).toEqual({ real: 1, demo: 0, unknown: 1 });
  });

  it('未满 7 日：进「观察中」分群，不进分母，比率显示 null（—）', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-b', type: 'opportunity_revealed', daysAgo: 5, props: { validCount: 1 } }),
      ev({ userId: 'u-b', type: 'opportunity_followed', daysAgo: 4 }),
      ev({ userId: 'u-b', type: 'follow_status_changed', daysAgo: 4, props: { from: 'considering', to: 'preparing' } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const r = cohorts.invited;

    expect(r.northStar.observing).toBe(1);
    expect(r.northStar.denominator).toBe(0);
    expect(r.northStar.numerator).toBe(0);
    expect(r.northStar.rate).toBeNull();
    // 漏斗本身照常计算
    expect(r.follow).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.preparing).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  });

  it('重复点击：两条关注/两条官方入口行只算 1 个去重用户，北极星分子仍为 1', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-c', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-c', type: 'opportunity_followed', daysAgo: 7 }),
      ev({ userId: 'u-c', type: 'opportunity_followed', daysAgo: 7 }),
      ev({ userId: 'u-c', type: 'register_entry_opened', daysAgo: 6 }),
      ev({ userId: 'u-c', type: 'register_entry_opened', daysAgo: 6 }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const r = cohorts.invited;

    expect(r.follow.numerator).toBe(1);
    expect(r.registerEntry.numerator).toBe(1);
    expect(r.northStar).toEqual({ denominator: 1, numerator: 1, rate: 1, observing: 0 });
  });

  it('取消关注：计入「关注」，不计后续阶段，无推进动作不进北极星分子', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-d', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-d', type: 'opportunity_followed', daysAgo: 7 }),
      ev({ userId: 'u-d', type: 'opportunity_unfollowed', daysAgo: 6 }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const r = cohorts.invited;

    expect(r.follow).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.preparing).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    expect(r.registerEntry).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(r.northStar).toEqual({ denominator: 1, numerator: 0, rate: 0, observing: 0 });
  });

  it('跨设备：同账号两台设备重复上报 → 1 个去重用户，画像第 1 步不重复计', () => {
    const events: TrialEventRecord[] = [
      // 设备 A
      ev({ userId: 'u-e', type: 'profile_completed', daysAgo: 9, unitId: null, dataset: null }),
      ev({ userId: 'u-e', type: 'profile_step_completed', daysAgo: 9, unitId: null, dataset: null, props: { step: 1 } }),
      ev({ userId: 'u-e', type: 'opportunity_revealed', daysAgo: 9, props: { validCount: 2 } }),
      // 设备 B（同账号重报画像 + 二次获得机会 + 关注）
      ev({ userId: 'u-e', type: 'profile_completed', daysAgo: 9, unitId: null, dataset: null }),
      ev({ userId: 'u-e', type: 'profile_step_completed', daysAgo: 9, unitId: null, dataset: null, props: { step: 1 } }),
      ev({ userId: 'u-e', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-e', type: 'opportunity_followed', daysAgo: 8 }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const r = cohorts.invited;

    expect(r.users).toBe(1);
    expect(r.profileSteps[0].users).toBe(1);
    expect(r.opportunityRate).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    // 观察窗口从最早一次获得机会（9 天前）起算：已满 7 日；只有关注、无推进 → 分子 0
    expect(r.northStar).toEqual({ denominator: 1, numerator: 0, rate: 0, observing: 0 });
  });

  it('空样本：全部分群为空，比率一律 null（—），绝不出现 0% 或 NaN', () => {
    const { cohorts, generatedAt } = computeTrialDashboard([], NOW);
    for (const key of ['invited', 'invited_staff', 'demo', 'seed'] as const) {
      const r = cohorts[key];
      expect(r.users).toBe(0);
      expect(r.opportunityRate.rate).toBeNull();
      expect(r.follow.rate).toBeNull();
      expect(r.registered.rate).toBeNull();
      expect(r.northStar.rate).toBeNull();
      expect(r.northStar.observing).toBe(0);
      expect(r.profileSteps.every((s) => s.rateFromFirst === null)).toBe(true);
    }
    expect(generatedAt).toBe(NOW.toISOString());
  });

  it('分群隔离：seed / 员工 / 演示环境 / 受邀真实互不混算', () => {
    const journey = (userId: string, extra: Partial<EvSpec> = {}): TrialEventRecord[] => [
      ev({ userId, type: 'opportunity_revealed', daysAgo: 10, props: { validCount: 1 }, ...extra }),
      ev({ userId, type: 'opportunity_followed', daysAgo: 9, ...extra }),
      ev({ userId, type: 'register_entry_opened', daysAgo: 8, ...extra }),
    ];
    const events: TrialEventRecord[] = [
      ...journey('u-real'), // 受邀真实用户
      ...journey('u-staff', { userRole: 'exam_reviewer' }), // 受邀员工账号
      ...journey('u-demo', { authMode: 'demo' }), // 演示环境
      ...journey('trial-seed-u1', { source: 'seed', authMode: 'demo' }), // 演示种子
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);

    expect(cohorts.invited.users).toBe(1);
    expect(cohorts.invited_staff.users).toBe(1);
    expect(cohorts.demo.users).toBe(1);
    expect(cohorts.seed.users).toBe(1);
    // 各分群北极星独立成立（真实机会 + 满 7 日 + 关注 + 推进）
    for (const key of ['invited', 'invited_staff', 'demo', 'seed'] as const) {
      expect(cohorts[key].northStar).toEqual({ denominator: 1, numerator: 1, rate: 1, observing: 0 });
    }
  });

  it('补信息导致结论变化：只有 conclusionChanged=1 的用户计入', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-h1', type: 'opportunity_revealed', daysAgo: 9, props: { validCount: 1 } }),
      ev({ userId: 'u-h1', type: 'qualification_supplemented', daysAgo: 8, unitId: null, dataset: null, props: { fieldCount: 2, conclusionChanged: 1 } }),
      ev({ userId: 'u-h2', type: 'opportunity_revealed', daysAgo: 9, props: { validCount: 1 } }),
      ev({ userId: 'u-h2', type: 'qualification_supplemented', daysAgo: 8, unitId: null, dataset: null, props: { fieldCount: 1, conclusionChanged: 0 } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    expect(cohorts.invited.conclusionChanged).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it('数据集分列：只看演示台账机会的用户不进北极星分母', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-i', type: 'opportunity_revealed', daysAgo: 8, unitId: DEMO_UNIT, dataset: 'demo', props: { validCount: 1 } }),
      ev({ userId: 'u-i', type: 'opportunity_followed', daysAgo: 7, unitId: DEMO_UNIT, dataset: 'demo' }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const r = cohorts.invited;

    expect(r.datasetSplit).toEqual({ real: 0, demo: 1, unknown: 0 });
    expect(r.follow).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(r.northStar).toEqual({ denominator: 0, numerator: 0, rate: null, observing: 0 });
  });

  it('第 7 天边界：恰好满 7×24 小时即进入分母', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-j', type: 'opportunity_revealed', daysAgo: 7, props: { validCount: 1 } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    expect(cohorts.invited.northStar.observing).toBe(0);
    expect(cohorts.invited.northStar.denominator).toBe(1);
  });
});

// ==================== v7.1 M9 分析事件与试用看板测试 ====================

describe('M9 分析事件 · 白名单与隐私脱敏', () => {
  it('TRIAL_EVENT_TYPES 包含全部 22 类事件（11 旧 + 11 新）', () => {
    expect(TRIAL_EVENT_TYPES).toHaveLength(22);
    // M9 新增 11 类
    const m9Types = [
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
    ];
    for (const t of m9Types) {
      expect(TRIAL_EVENT_TYPES).toContain(t);
    }
  });

  it('sanitizeProps 拒绝敏感键名（身份证/地址/原文等）', () => {
    expect(sanitizeProps({ idCard: '110101199001011234' }).ok).toBe(false);
    expect(sanitizeProps({ address: '浙江省杭州市' }).ok).toBe(false);
    expect(sanitizeProps({ body: '公告正文' }).ok).toBe(false);
    expect(sanitizeProps({ answer: '我的答案' }).ok).toBe(false);
    expect(sanitizeProps({ name: '张三' }).ok).toBe(false);
    expect(sanitizeProps({ originalText: '原文内容' }).ok).toBe(false);
  });

  it('sanitizeProps 接受 M9 枚举/数量类维度', () => {
    expect(sanitizeProps({ level: 'determined' }).ok).toBe(true);
    expect(sanitizeProps({ reasonCode: 'no_coverage', kind: 'uncovered' }).ok).toBe(true);
    expect(sanitizeProps({ action: 'created', status: 'success', nodeCount: 5 }).ok).toBe(true);
    expect(sanitizeProps({ nodeKind: 'written_exam', conflictCount: 2 }).ok).toBe(true);
    expect(sanitizeProps({ notificationId: 'abc123def456' }).ok).toBe(true);
  });

  it('sanitizeProps 拒绝超长值（>64 字符，防资格原文混入）', () => {
    const longValue = 'a'.repeat(65);
    expect(sanitizeProps({ reasonCode: longValue }).ok).toBe(false);
  });

  it('sanitizeProps 拒绝嵌套对象与数组', () => {
    expect(sanitizeProps({ detail: { nested: true } }).ok).toBe(false);
    expect(sanitizeProps({ list: [1, 2, 3] }).ok).toBe(false);
  });

  it('sanitizeProps 拒绝超过 8 个属性的 props', () => {
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 9; i++) tooMany[`k${i}`] = 'v';
    expect(sanitizeProps(tooMany).ok).toBe(false);
  });
});

describe('M9 分析事件 · 去重范围', () => {
  it('region_preference_selected 按用户幂等（dedupKey=once:region_preference_selected）', () => {
    expect(dedupKeyFor('region_preference_selected', null, null)).toBe('once:region_preference_selected');
  });

  it('schedule_sync_completed 不去重（null，成功/失败都可多次记录）', () => {
    expect(dedupKeyFor('schedule_sync_completed', null, null)).toBe(null);
  });

  it('schedule_conflict_viewed 按用户幂等', () => {
    expect(dedupKeyFor('schedule_conflict_viewed', null, null)).toBe('once:schedule_conflict_viewed');
  });

  it('opportunity_notification_viewed 按用户幂等', () => {
    expect(dedupKeyFor('opportunity_notification_viewed', null, null)).toBe('once:opportunity_notification_viewed');
  });

  it('subscription_changed 不去重（创建/修改/关闭都可多次发生）', () => {
    expect(dedupKeyFor('subscription_changed', null, null)).toBe(null);
  });
});

describe('M9 分析事件 · 看板指标口径', () => {
  it('首页理解 = home_start_match_clicked 用户 ÷ 画像首步完成人数', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-h1', type: 'profile_step_completed', daysAgo: 5, unitId: null, dataset: null, props: { step: 1 } }),
      ev({ userId: 'u-h1', type: 'home_start_match_clicked', daysAgo: 5, unitId: null, dataset: null }),
      ev({ userId: 'u-h2', type: 'profile_step_completed', daysAgo: 5, unitId: null, dataset: null, props: { step: 1 } }),
      // u-h2 完成画像首步但没点首页按钮（计入分母不计分子）
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    expect(cohorts.invited.homeUnderstanding).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it('无结果原因分布：按 reasonCode 分组计数（展示次数不伪装成比例）', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-n1', type: 'no_result_reason_viewed', daysAgo: 3, unitId: null, dataset: null, props: { reasonCode: 'no_coverage', kind: 'uncovered' } }),
      ev({ userId: 'u-n1', type: 'no_result_reason_viewed', daysAgo: 3, unitId: null, dataset: null, props: { reasonCode: 'not_eligible', kind: 'not_eligible' } }),
      ev({ userId: 'u-n2', type: 'no_result_reason_viewed', daysAgo: 3, unitId: null, dataset: null, props: { reasonCode: 'no_coverage', kind: 'uncovered' } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const reasons = cohorts.invited.noResultReasons;
    expect(reasons).toHaveLength(2);
    expect(reasons.find((r) => r.reasonCode === 'no_coverage')?.count).toBe(2);
    expect(reasons.find((r) => r.reasonCode === 'not_eligible')?.count).toBe(1);
    // 按次数降序
    expect(reasons[0].count).toBeGreaterThanOrEqual(reasons[1].count);
  });

  it('订阅使用 = 创建订阅用户 ÷ 获得有效机会用户；关闭单列去重人数', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-s1', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-s1', type: 'subscription_changed', daysAgo: 7, unitId: null, dataset: null, props: { action: 'created' } }),
      ev({ userId: 'u-s1', type: 'subscription_changed', daysAgo: 6, unitId: null, dataset: null, props: { action: 'closed' } }),
      ev({ userId: 'u-s2', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      // u-s2 只修改未创建
      ev({ userId: 'u-s2', type: 'subscription_changed', daysAgo: 6, unitId: null, dataset: null, props: { action: 'modified' } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    expect(cohorts.invited.subscriptionUsage).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(cohorts.invited.subscriptionClosedCount).toBe(1);
  });

  it('地图使用 = map_entry_clicked 用户 ÷ match_basis_viewed 用户', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-m1', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-m1', type: 'match_basis_viewed', daysAgo: 8 }),
      ev({ userId: 'u-m1', type: 'map_entry_clicked', daysAgo: 7 }),
      ev({ userId: 'u-m2', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-m2', type: 'match_basis_viewed', daysAgo: 8 }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    expect(cohorts.invited.mapUsage).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it('日程同步健康度 = success/(success+failure)；失败原因分布', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-sy1', type: 'schedule_sync_completed', daysAgo: 1, unitId: null, dataset: null, props: { status: 'success', nodeCount: 3 } }),
      ev({ userId: 'u-sy1', type: 'schedule_sync_completed', daysAgo: 1, unitId: null, dataset: null, props: { status: 'success', nodeCount: 3 } }),
      ev({ userId: 'u-sy2', type: 'schedule_sync_completed', daysAgo: 1, unitId: null, dataset: null, props: { status: 'failure', reasonCode: 'network_error' } }),
      ev({ userId: 'u-sy3', type: 'schedule_sync_completed', daysAgo: 1, unitId: null, dataset: null, props: { status: 'failure', reasonCode: 'session_expired' } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    const h = cohorts.invited.scheduleSyncHealth;
    expect(h.success).toBe(2);
    expect(h.failure).toBe(2);
    expect(h.rate).toBe(0.5);
    expect(h.failureReasons).toHaveLength(2);
    expect(h.failureReasons.find((r) => r.reasonCode === 'network_error')?.count).toBe(1);
    expect(h.failureReasons.find((r) => r.reasonCode === 'session_expired')?.count).toBe(1);
  });

  it('时间冲突曝光率 = schedule_conflict_viewed 用户 ÷ 关注用户', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-c1', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-c1', type: 'opportunity_followed', daysAgo: 7 }),
      ev({ userId: 'u-c1', type: 'schedule_conflict_viewed', daysAgo: 6, unitId: null, dataset: null, props: { conflictCount: 2, nodeKind: 'written_exam' } }),
      ev({ userId: 'u-c2', type: 'opportunity_revealed', daysAgo: 8, props: { validCount: 1 } }),
      ev({ userId: 'u-c2', type: 'opportunity_followed', daysAgo: 7 }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    expect(cohorts.invited.scheduleConflictRate).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it('空样本：M9 指标全部为 null/空（绝不显示 0% 或 NaN）', () => {
    const { cohorts } = computeTrialDashboard([], NOW);
    const r = cohorts.invited;
    expect(r.homeUnderstanding.rate).toBeNull();
    expect(r.noResultReasons).toEqual([]);
    expect(r.subscriptionUsage.rate).toBeNull();
    expect(r.subscriptionClosedCount).toBe(0);
    expect(r.mapUsage.rate).toBeNull();
    expect(r.scheduleSyncHealth.rate).toBeNull();
    expect(r.scheduleSyncHealth.success).toBe(0);
    expect(r.scheduleSyncHealth.failure).toBe(0);
    expect(r.scheduleSyncHealth.failureReasons).toEqual([]);
    expect(r.scheduleConflictRate.rate).toBeNull();
  });

  it('分群隔离：M9 事件在 seed/live × 员工/真实 × invited/demo 之间互不混算', () => {
    const events: TrialEventRecord[] = [
      // 受邀真实
      ev({ userId: 'u-real', type: 'home_start_match_clicked', daysAgo: 3, unitId: null, dataset: null }),
      ev({ userId: 'u-real', type: 'profile_step_completed', daysAgo: 3, unitId: null, dataset: null, props: { step: 1 } }),
      ev({ userId: 'u-real', type: 'opportunity_revealed', daysAgo: 3, props: { validCount: 1 } }),
      ev({ userId: 'u-real', type: 'opportunity_followed', daysAgo: 2 }),
      ev({ userId: 'u-real', type: 'schedule_conflict_viewed', daysAgo: 1, unitId: null, dataset: null, props: { conflictCount: 1, nodeKind: 'written_exam' } }),
      // seed 种子
      ev({ userId: 'seed-u', type: 'home_start_match_clicked', daysAgo: 3, unitId: null, dataset: null, source: 'seed', authMode: 'demo' }),
      ev({ userId: 'seed-u', type: 'profile_step_completed', daysAgo: 3, unitId: null, dataset: null, source: 'seed', authMode: 'demo', props: { step: 1 } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);

    // 受邀真实：首页理解 1/1，冲突曝光 1/1
    expect(cohorts.invited.homeUnderstanding).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(cohorts.invited.scheduleConflictRate).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    // seed：首页理解 1/1，但冲突曝光 0/0=null
    expect(cohorts.seed.homeUnderstanding).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(cohorts.seed.scheduleConflictRate.rate).toBeNull();
  });

  it('刷新重复同步不重复计关键漏斗：schedule_sync_completed 不去重但 schedule_conflict_viewed 按用户幂等', () => {
    const events: TrialEventRecord[] = [
      ev({ userId: 'u-d1', type: 'opportunity_revealed', daysAgo: 5, props: { validCount: 1 } }),
      ev({ userId: 'u-d1', type: 'opportunity_followed', daysAgo: 4 }),
      // 两次刷新同步都记 success（不去重）
      ev({ userId: 'u-d1', type: 'schedule_sync_completed', daysAgo: 1, unitId: null, dataset: null, props: { status: 'success', nodeCount: 3 } }),
      ev({ userId: 'u-d1', type: 'schedule_sync_completed', daysAgo: 0, unitId: null, dataset: null, props: { status: 'success', nodeCount: 3 } }),
      // 冲突曝光两次（去重后只算 1 个用户）
      ev({ userId: 'u-d1', type: 'schedule_conflict_viewed', daysAgo: 1, unitId: null, dataset: null, props: { conflictCount: 1, nodeKind: 'written_exam' } }),
      ev({ userId: 'u-d1', type: 'schedule_conflict_viewed', daysAgo: 0, unitId: null, dataset: null, props: { conflictCount: 1, nodeKind: 'written_exam' } }),
    ];
    const { cohorts } = computeTrialDashboard(events, NOW);
    // 同步成功次数 = 2（不去重，反映真实刷新次数）
    expect(cohorts.invited.scheduleSyncHealth.success).toBe(2);
    // 冲突曝光去重用户 = 1（不因刷新重复计）
    expect(cohorts.invited.scheduleConflictRate.numerator).toBe(1);
  });
});
