import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLA_POLICIES,
  LONG_WAITING_SUPPLEMENT_HOURS,
  SUPPLEMENT_REMINDER_HOURS,
  adjustDeadlineForPriority,
  canTransitionTicket,
  canUserSupplement,
  computeDeadlines,
  computeUpdateDeadlines,
  isEffectiveResponse,
  makeTicketNo,
  pauseDeadline,
  reminderCycleKey,
  resumeDeadline,
  suggestPriority,
  validateOwnerPair,
  validateParseManualCompletion,
  validatePriorityChange,
  validatePublishedResolution,
  validateSlaPolicy,
  validateSourceAlertCompletion,
  validateSupplementInput,
  type OwnerCandidate,
} from './service-desk.domain.js';

const HOUR = 60 * 60 * 1000;

describe('工单状态机（S1/S2）', () => {
  it('用户补充只允许「待用户补充」；终态不能补充或重开', () => {
    expect(canUserSupplement('need_supplement')).toBe(true);
    expect(canUserSupplement('pending_review')).toBe(false);
    expect(canUserSupplement('reviewing')).toBe(false);
    expect(canUserSupplement('resolved')).toBe(false);
    expect(canUserSupplement('rejected')).toBe(false);
    expect(canTransitionTicket('resolved', 'reviewing')).toBe(false);
    expect(canTransitionTicket('rejected', 'pending_review')).toBe(false);
  });

  it('待复核只能由补充产生，员工可从待复核继续核对或再次请求补充', () => {
    expect(canTransitionTicket('need_supplement', 'pending_review')).toBe(true);
    expect(canTransitionTicket('pending_review', 'reviewing')).toBe(true);
    expect(canTransitionTicket('pending_review', 'need_supplement')).toBe(true);
    expect(canTransitionTicket('submitted', 'pending_review')).toBe(false);
  });
});

describe('优先级（D06）', () => {
  const now = new Date('2026-11-08T00:00:00Z');

  it('已知报名截止在 72 小时内才建议高优先级', () => {
    expect(
      suggestPriority({
        now,
        registrationEnd: new Date(now.getTime() + 24 * HOUR).toISOString(),
      }).priority,
    ).toBe('high');
    expect(
      suggestPriority({
        now,
        registrationEnd: new Date(now.getTime() + 100 * HOUR).toISOString(),
      }).priority,
    ).toBe('medium');
  });

  it('未知截止不编造倒计时，也不会因用户自选变高', () => {
    expect(suggestPriority({ now, registrationEnd: null }).priority).toBe('medium');
    expect(suggestPriority({ now, registrationEnd: 'not-a-date' }).priority).toBe(
      'medium',
    );
  });

  it('人工调整必须填写至少 5 个字原因', () => {
    const rejected = validatePriorityChange({ priority: 'high', reason: '急' });
    expect(rejected.ok).toBe(false);
    const ok = validatePriorityChange({
      priority: 'high',
      reason: '报名截止 48 小时内且涉及资格错误',
    });
    expect(ok.ok).toBe(true);
  });
});

describe('内部时限（E01/E03/E06）', () => {
  it('默认三档时限与用户约定的 2h/8h、8h/24h、24h/72h 一致', () => {
    expect(DEFAULT_SLA_POLICIES.high.firstResponseMinutes).toBe(120);
    expect(DEFAULT_SLA_POLICIES.high.updateMinutes).toBe(480);
    expect(DEFAULT_SLA_POLICIES.medium.firstResponseMinutes).toBe(480);
    expect(DEFAULT_SLA_POLICIES.medium.updateMinutes).toBe(1440);
    expect(DEFAULT_SLA_POLICIES.low.firstResponseMinutes).toBe(1440);
    expect(DEFAULT_SLA_POLICIES.low.updateMinutes).toBe(4320);
    expect(DEFAULT_SLA_POLICIES.high.escalationGraceMinutes).toBe(120);
    expect(DEFAULT_SLA_POLICIES.medium.escalationGraceMinutes).toBe(480);
    expect(DEFAULT_SLA_POLICIES.low.escalationGraceMinutes).toBe(1440);
  });

  it('首次响应与升级截止按自然小时计算', () => {
    const startedAt = new Date('2026-11-08T00:00:00Z');
    const deadlines = computeDeadlines(DEFAULT_SLA_POLICIES.high, startedAt);
    expect(deadlines.responseDueAt.toISOString()).toBe('2026-11-08T02:00:00.000Z');
    expect(deadlines.updateDueAt.toISOString()).toBe('2026-11-08T08:00:00.000Z');
    expect(deadlines.escalationDueAt.toISOString()).toBe('2026-11-08T04:00:00.000Z');
  });

  it('待用户补充暂停计时并保存剩余额度，恢复后不重置完整额度', () => {
    const dueAt = new Date('2026-11-08T08:00:00Z');
    const pausedAt = new Date('2026-11-08T03:00:00Z');
    const remaining = pauseDeadline(pausedAt, dueAt);
    expect(remaining).toBe(5 * HOUR);
    const resumedAt = new Date('2026-11-10T00:00:00Z');
    expect(resumeDeadline(resumedAt, remaining).toISOString()).toBe(
      '2026-11-10T05:00:00.000Z',
    );
  });

  it('已超时暂停保存为 0，不使用负数', () => {
    expect(pauseDeadline(new Date('2026-11-08T10:00:00Z'), new Date('2026-11-08T08:00:00Z'))).toBe(0);
    expect(pauseDeadline(new Date(), null)).toBe(0);
  });

  it('提高优先级可提前未到期期限；降低优先级不延长', () => {
    const changedAt = new Date('2026-11-08T02:00:00Z');
    const cycleStartedAt = new Date('2026-11-08T00:00:00Z');
    const currentDueAt = new Date('2026-11-11T00:00:00Z'); // low: 72h
    const earlier = adjustDeadlineForPriority({
      changedAt,
      currentDueAt,
      cycleStartedAt,
      from: 'low',
      to: 'high',
      policy: DEFAULT_SLA_POLICIES.high,
    });
    expect(earlier?.toISOString()).toBe('2026-11-08T08:00:00.000Z');
    expect(
      adjustDeadlineForPriority({
        changedAt,
        currentDueAt,
        cycleStartedAt,
        from: 'high',
        to: 'low',
        policy: DEFAULT_SLA_POLICIES.low,
      }),
    ).toBeNull();
  });

  it('认领、查看、内部备注不算有效响应', () => {
    expect(isEffectiveResponse('claim')).toBe(false);
    expect(isEffectiveResponse('view')).toBe(false);
    expect(isEffectiveResponse('internal_note')).toBe(false);
    expect(isEffectiveResponse('public_update')).toBe(true);
    expect(isEffectiveResponse('request_supplement')).toBe(true);
    expect(isEffectiveResponse('resolved')).toBe(true);
  });

  it('等待用户提醒阈值：48 小时提醒、7 天长期待补充', () => {
    expect(SUPPLEMENT_REMINDER_HOURS).toBe(48);
    expect(LONG_WAITING_SUPPLEMENT_HOURS).toBe(168);
  });

  it('催办周期键随阶段/周期变化而不重复轰炸', () => {
    const cycle = new Date('2026-11-08T00:00:00Z');
    expect(
      reminderCycleKey({ status: 'reviewing', cycleStartedAt: cycle, pausedAt: null }),
    ).toBe(`cycle:${cycle.toISOString()}`);
    expect(
      reminderCycleKey({
        status: 'need_supplement',
        cycleStartedAt: cycle,
        pausedAt: new Date('2026-11-09T00:00:00Z'),
      }),
    ).toBe('wait:2026-11-09T00:00:00.000Z');
  });

  it('时限配置拒绝非正数、越界值', () => {
    expect(validateSlaPolicy({ firstResponseMinutes: 0, updateMinutes: 10, escalationGraceMinutes: 10 }).ok).toBe(false);
    expect(validateSlaPolicy({ firstResponseMinutes: 10, updateMinutes: -1, escalationGraceMinutes: 10 }).ok).toBe(false);
    expect(validateSlaPolicy({ firstResponseMinutes: 10.5, updateMinutes: 10, escalationGraceMinutes: 10 }).ok).toBe(false);
    expect(validateSlaPolicy({ firstResponseMinutes: 120, updateMinutes: 480, escalationGraceMinutes: 120 }).ok).toBe(true);
  });
});

describe('负责人配置（D01）', () => {
  const users = new Map<string, OwnerCandidate>([
    ['u-duty', { id: 'u-duty', role: 'exam_reviewer', isActive: true }],
    ['u-backup', { id: 'u-backup', role: 'admin', isActive: true }],
    ['u-inactive', { id: 'u-inactive', role: 'exam_reviewer', isActive: false }],
    ['u-member', { id: 'u-member', role: 'member', isActive: true }],
  ]);

  it('必须同时配置两个不同、启用且有处理权限的账号', () => {
    expect(
      validateOwnerPair({ dutyOwnerId: 'u-duty', backupOwnerId: 'u-backup', users }).ok,
    ).toBe(true);
    expect(
      validateOwnerPair({ dutyOwnerId: 'u-duty', backupOwnerId: 'u-duty', users }),
    ).toMatchObject({ ok: false, issues: ['same'] });
    expect(validateOwnerPair({ dutyOwnerId: '', backupOwnerId: 'u-backup', users })).toMatchObject(
      { ok: false, issues: ['missing'] },
    );
    expect(
      validateOwnerPair({ dutyOwnerId: 'u-inactive', backupOwnerId: 'u-backup', users }),
    ).toMatchObject({ ok: false, issues: ['inactive'] });
    expect(
      validateOwnerPair({ dutyOwnerId: 'u-member', backupOwnerId: 'u-backup', users }),
    ).toMatchObject({ ok: false, issues: ['no_permission'] });
    expect(
      validateOwnerPair({ dutyOwnerId: 'ghost', backupOwnerId: 'u-backup', users }),
    ).toMatchObject({ ok: false, issues: ['not_found'] });
  });
});

describe('原工单补充输入（A03）', () => {
  it('正文 1—2000 字，空白与超长被拒绝', () => {
    expect(validateSupplementInput({ body: '   ' }).ok).toBe(false);
    expect(validateSupplementInput({ body: 'a'.repeat(2001) }).ok).toBe(false);
    expect(validateSupplementInput({ body: '已补充毕业证专业名称' }).ok).toBe(true);
  });

  it('最多 5 个链接，仅 http/https，拒绝危险协议、凭据与内网地址', () => {
    const tooMany = Array.from({ length: 6 }, (_, index) => ({
      url: `https://example.gov.cn/notice/${index}`,
    }));
    expect(validateSupplementInput({ body: '说明', links: tooMany }).ok).toBe(false);
    for (const url of [
      'javascript:alert(1)',
      'ftp://example.gov.cn/a',
      'https://user:pass@example.gov.cn/a',
      'http://127.0.0.1/a',
      'http://localhost/a',
      'http://192.168.1.10/a',
    ]) {
      expect(validateSupplementInput({ body: '说明', links: [{ url }] }).ok).toBe(false);
    }
    const ok = validateSupplementInput({
      body: '说明',
      links: [{ url: 'https://example.gov.cn/a/', label: '公告原文' }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.links[0]!.url).toBe('https://example.gov.cn/a');
  });
});

describe('公告补录发布关联门禁（B01/B02/B05）', () => {
  const submission = { officialUrl: 'https://example.gov.cn/notice', status: 'submitted' };
  const announcement = {
    id: 'ann-1',
    officialUrl: 'https://example.gov.cn/notice',
    dataset: 'real',
    lifecycle: 'active',
  };
  const version = {
    id: 'ver-1',
    announcementId: 'ann-1',
    status: 'published',
    supersededAt: null,
    withdrawnAt: null,
  };

  it('缺关联直接拒绝结案', () => {
    expect(
      validatePublishedResolution({ submission, announcement, version }).ok,
    ).toBe(false);
  });

  it('草稿、撤回、被取代、演示数据、错误版本均拒绝', () => {
    const base = {
      submission,
      announcedAnnouncementId: 'ann-1',
      announcedVersionId: 'ver-1',
    };
    expect(
      validatePublishedResolution({
        ...base,
        announcement,
        version: { ...version, status: 'draft' },
      }),
    ).toMatchObject({ ok: false, kind: 'version_not_published' });
    expect(
      validatePublishedResolution({
        ...base,
        announcement,
        version: { ...version, withdrawnAt: new Date() },
      }),
    ).toMatchObject({ ok: false, kind: 'version_withdrawn' });
    expect(
      validatePublishedResolution({
        ...base,
        announcement,
        version: { ...version, supersededAt: new Date() },
      }),
    ).toMatchObject({ ok: false, kind: 'version_superseded' });
    expect(
      validatePublishedResolution({
        ...base,
        announcement: { ...announcement, dataset: 'demo' },
        version,
      }),
    ).toMatchObject({ ok: false, kind: 'not_real_dataset' });
    expect(
      validatePublishedResolution({
        ...base,
        announcement,
        version: { ...version, id: 'ver-other' },
      }),
    ).toMatchObject({ ok: false, kind: 'missing_version' });
  });

  it('相同链接可直接关联；不同链接必须填写 ≥10 字核验依据', () => {
    const base = {
      submission,
      announcedAnnouncementId: 'ann-1',
      announcedVersionId: 'ver-1',
    };
    const exact = validatePublishedResolution({
      ...base,
      announcement,
      version,
      resolutionBasis: null,
    });
    expect(exact).toMatchObject({ ok: true, exactLink: true });

    const different = validatePublishedResolution({
      ...base,
      announcement: { ...announcement, officialUrl: 'https://example.gov.cn/other' },
      version,
      resolutionBasis: '短依据',
    });
    expect(different).toMatchObject({ ok: false, kind: 'basis_required' });

    const verified = validatePublishedResolution({
      ...base,
      announcement: { ...announcement, officialUrl: 'https://example.gov.cn/other' },
      version,
      resolutionBasis: '经发布单位官网核对标题、岗位与报名时间一致',
    });
    expect(verified).toMatchObject({ ok: true, exactLink: false });
  });
});

describe('派生任务结案标准（F01/F03）', () => {
  it('扫描件待人工必须交接到同快照的审核任务并附证据说明', () => {
    expect(
      validateParseManualCompletion({
        parseStatus: 'pending_manual',
        handoffRun: null,
        parseSnapshotId: 'snap-1',
        evidenceNote: '',
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateParseManualCompletion({
        parseStatus: 'pending_manual',
        handoffRun: { id: 'run-1', status: 'pending_review', snapshotId: 'snap-2' },
        parseSnapshotId: 'snap-1',
        evidenceNote: '页码 3 的专业名称与原件一致',
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateParseManualCompletion({
        parseStatus: 'pending_manual',
        handoffRun: { id: 'run-1', status: 'pending_review', snapshotId: 'snap-1' },
        parseSnapshotId: 'snap-1',
        evidenceNote: '页码 3 的专业名称与原件一致',
      }),
    ).toMatchObject({ ok: true });
  });

  it('来源受限不能标记已恢复；受限结案需覆盖缺口说明', () => {
    expect(
      validateSourceAlertCompletion({
        outcome: 'resolved',
        note: '已完成恢复复查并补采缺口公告',
        sourceHealthStatus: 'blocked',
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateSourceAlertCompletion({
        outcome: 'limited',
        note: '来源需要登录，无法绕过访问限制',
        missingCheckNote: '',
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateSourceAlertCompletion({
        outcome: 'limited',
        note: '来源需要登录，无法绕过访问限制',
        missingCheckNote: '已核对近 7 天漏采 2 条，用省级门户替代入口补齐',
      }),
    ).toMatchObject({ ok: true, outcome: 'limited' });
    expect(
      validateSourceAlertCompletion({ outcome: 'rejected', note: '不处理的说明文字足够长' }),
    ).toMatchObject({ ok: false });
  });
});

describe('受理编号（稳定编号）', () => {
  it('同一业务对象生成稳定编号，仅用于定位', () => {
    const a = makeTicketNo('correction', '123e4567-e89b-12d3-a456-426614174000');
    const b = makeTicketNo('correction', '123e4567-e89b-12d3-a456-426614174000');
    expect(a).toBe(b);
    expect(a).toMatch(/^JC-[0-9A-F]{12}$/);
    expect(makeTicketNo('announcement_submission', 'abc')).toMatch(/^BK-/);
  });
});
