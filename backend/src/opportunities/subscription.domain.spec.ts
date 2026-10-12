/**
 * 新机会订阅领域规则测试（v7.1 M6）。
 * 覆盖：订阅匹配规则、未审核/过期/明确不符合/非官方来源不提醒、
 * 首次同步基线回填、重复同步幂等、新版本再提醒、用工偏好过滤、账号隔离。
 */
import { describe, expect, it } from 'vitest';
import type {
  ApplicationUnit,
  EvidenceAnchor,
  RecruitmentAnnouncement,
  UserRecruitmentProfile,
} from '../matching/types.js';
import {
  deriveSubscriptionCriteria,
  firstQualifyingUnit,
  planOpportunityNotices,
  subscriptionRegionMatches,
  type SubscriptionCriteria,
} from './subscription.domain.js';

const NOW = new Date('2026-10-12T10:00:00+08:00');

function anchor(state: EvidenceAnchor['state'] = 'official'): EvidenceAnchor {
  return {
    id: 'src-1',
    locator: { kind: 'url', url: 'https://example.gov.cn/a' },
    state,
    checkedAt: '2026-10-10T12:00:00+08:00',
  };
}

function makeUnit(overrides: Partial<ApplicationUnit> = {}): ApplicationUnit {
  return {
    id: 'unit-hz-01',
    code: 'HZ01',
    name: '杭州初中语文岗位组',
    announcementId: 'ann-hz',
    versionId: 'ann-hz-v1',
    region: { code: '330100', province: '浙江省', city: '杭州市' },
    subject: 'chinese',
    stage: 'middle',
    headcount: 12,
    organizationType: 'government_unified',
    employmentNature: {
      code: 'public_institution_staff',
      officialName: '事业编制',
    },
    allocation: { code: 'direct_school', description: '' },
    requirements: [],
    ...overrides,
  };
}

function makeAnnouncement(
  overrides: Partial<RecruitmentAnnouncement> = {},
  versionOverrides: Partial<RecruitmentAnnouncement['versions'][number]> = {},
): RecruitmentAnnouncement {
  const base: RecruitmentAnnouncement = {
    id: 'ann-hz',
    title: '杭州市教育局直属学校招聘公告',
    publisher: '杭州市教育局',
    organizationType: 'government_unified',
    officialUrl: 'https://example.gov.cn/a',
    subjectScope: ['chinese'],
    region: { code: '330100', province: '浙江省', city: '杭州市' },
    lifecycle: 'active',
    firstPublishedAt: '2026-09-28T09:00:00+08:00',
    versions: [
      {
        id: 'ann-hz-v1',
        announcementId: 'ann-hz',
        versionNumber: 1,
        sourceKind: 'original',
        publishedAt: '2026-09-28T09:00:00+08:00',
        officialSource: anchor(),
        timeline: {
          registrationStart: '2026-10-01',
          registrationEnd: '2026-10-20',
        },
        units: [makeUnit()],
        ...versionOverrides,
      },
    ],
    ...overrides,
  };
  return base;
}

const CRITERIA: SubscriptionCriteria = {
  regions: [{ code: '330100', province: '浙江省', city: '杭州市' }],
  subject: 'chinese',
  naturePreference: 'official_open',
};

describe('deriveSubscriptionCriteria：从画像派生默认订阅', () => {
  it('只接受事业编 → public_only；接受多种官方用工 → official_open；空 → undecided', () => {
    const base: UserRecruitmentProfile = {
      regions: [{ code: '330100', province: '浙江省', city: '杭州市', level: 'required' }],
      educationLevel: 'bachelor',
      degree: 'bachelor',
      majorFullName: '汉语言文学（师范）',
      graduationDate: '2026-06-30',
      employmentStatus: 'fresh_unemployed',
      socialSecurityMonths: 0,
      teacherCert: { status: 'obtained', subject: 'chinese', stage: 'middle' },
      acceptedEmploymentNatures: ['public_institution_staff'],
    };
    expect(deriveSubscriptionCriteria(base).naturePreference).toBe('public_only');
    expect(
      deriveSubscriptionCriteria({
        ...base,
        acceptedEmploymentNatures: ['public_institution_staff', 'record_filing'],
      }).naturePreference,
    ).toBe('official_open');
    expect(
      deriveSubscriptionCriteria({ ...base, acceptedEmploymentNatures: [] })
        .naturePreference,
    ).toBe('undecided');
    expect(deriveSubscriptionCriteria(base).subject).toBe('chinese');
    expect(deriveSubscriptionCriteria(base).regions[0]!.code).toBe('330100');
  });
});

describe('subscriptionRegionMatches：地区前缀匹配', () => {
  it('省级订阅认同省、市级认同市、区县级只认精确', () => {
    const hangzhouUnit = { code: '330100', province: '浙江省', city: '杭州市' };
    const yinzhouUnit = { code: '330212', province: '浙江省', city: '宁波市', district: '鄞州区' };
    expect(subscriptionRegionMatches('330000', hangzhouUnit)).toBe(true);
    expect(subscriptionRegionMatches('330100', hangzhouUnit)).toBe(true);
    expect(subscriptionRegionMatches('330300', hangzhouUnit)).toBe(false);
    expect(subscriptionRegionMatches('330212', yinzhouUnit)).toBe(true);
    expect(subscriptionRegionMatches('330200', yinzhouUnit)).toBe(true);
    expect(subscriptionRegionMatches('330100', yinzhouUnit)).toBe(false);
  });
});

describe('firstQualifyingUnit：提醒触发条件', () => {
  it('官方来源 + 未过期 + 已人工核对 + 地区学科相符 + 无明确不符合 → 通过', () => {
    const unit = firstQualifyingUnit({
      announcement: makeAnnouncement(),
      version: makeAnnouncement().versions[0]!,
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      now: NOW,
    });
    expect(unit?.id).toBe('unit-hz-01');
  });

  it('真实台账未人工核对（ai_reviewed_pending）→ 不提醒', () => {
    const ann = makeAnnouncement({
      dataset: 'real',
      reviewStatus: 'ai_reviewed_pending',
    });
    const unit = firstQualifyingUnit({
      announcement: ann,
      version: ann.versions[0]!,
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      now: NOW,
    });
    expect(unit).toBeNull();
  });

  it('真实台账已人工核对 → 提醒', () => {
    const ann = makeAnnouncement({ dataset: 'real', reviewStatus: 'human_reviewed' });
    const unit = firstQualifyingUnit({
      announcement: ann,
      version: ann.versions[0]!,
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      now: NOW,
    });
    expect(unit?.id).toBe('unit-hz-01');
  });

  it('已过期（报名截止早于今天）→ 不提醒', () => {
    const ann = makeAnnouncement({}, {
      timeline: { registrationStart: '2026-09-01', registrationEnd: '2026-10-10' },
    });
    const unit = firstQualifyingUnit({
      announcement: ann,
      version: ann.versions[0]!,
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      now: NOW,
    });
    expect(unit).toBeNull();
  });

  it('官方未公布截止日期 → 无法确认未过期，保守不提醒', () => {
    const ann = makeAnnouncement({}, { timeline: { registrationStart: '2026-10-01' } });
    const unit = firstQualifyingUnit({
      announcement: ann,
      version: ann.versions[0]!,
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      now: NOW,
    });
    expect(unit).toBeNull();
  });

  it('非官方来源锚点或来源巡检失效 → 不提醒', () => {
    const version = { ...makeAnnouncement().versions[0]!, officialSource: anchor('ai_extracted') };
    expect(
      firstQualifyingUnit({
        announcement: makeAnnouncement(),
        version,
        criteria: CRITERIA,
        ineligibleUnitIds: new Set(),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      firstQualifyingUnit({
        announcement: makeAnnouncement({ sourceHealth: { ok: false, checkedAt: '2026-10-10T12:00:00+08:00', failReason: '404' } }),
        version: makeAnnouncement().versions[0]!,
        criteria: CRITERIA,
        ineligibleUnitIds: new Set(),
        now: NOW,
      }),
    ).toBeNull();
  });

  it('已知明确不符合（画像匹配 not_eligible）→ 不提醒', () => {
    const unit = firstQualifyingUnit({
      announcement: makeAnnouncement(),
      version: makeAnnouncement().versions[0]!,
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(['unit-hz-01']),
      now: NOW,
    });
    expect(unit).toBeNull();
  });

  it('学科不符或地区不符 → 不提醒', () => {
    const mathAnn = makeAnnouncement({}, { units: [makeUnit({ subject: 'mathematics' })] });
    expect(
      firstQualifyingUnit({
        announcement: mathAnn,
        version: mathAnn.versions[0]!,
        criteria: CRITERIA,
        ineligibleUnitIds: new Set(),
        now: NOW,
      }),
    ).toBeNull();
    const njAnn = makeAnnouncement({}, {
      units: [makeUnit({ region: { code: '320100', province: '江苏省', city: '南京市' } })],
    });
    expect(
      firstQualifyingUnit({
        announcement: njAnn,
        version: njAnn.versions[0]!,
        criteria: CRITERIA,
        ineligibleUnitIds: new Set(),
        now: NOW,
      }),
    ).toBeNull();
  });

  it('用工偏好 public_only：非事业编不提醒，事业编提醒', () => {
    const publicOnly: SubscriptionCriteria = { ...CRITERIA, naturePreference: 'public_only' };
    const annex = makeAnnouncement({}, {
      units: [makeUnit({ id: 'unit-ba-01', employmentNature: { code: 'record_filing', officialName: '备案制' } })],
    });
    expect(
      firstQualifyingUnit({
        announcement: annex,
        version: annex.versions[0]!,
        criteria: publicOnly,
        ineligibleUnitIds: new Set(),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      firstQualifyingUnit({
        announcement: makeAnnouncement(),
        version: makeAnnouncement().versions[0]!,
        criteria: publicOnly,
        ineligibleUnitIds: new Set(),
        now: NOW,
      }),
    ).not.toBeNull();
  });
});

describe('planOpportunityNotices：幂等计划', () => {
  it('首次同步：全部匹配公告做基线回填（notified=false），不产生通知', () => {
    const plan = planOpportunityNotices({
      announcements: [makeAnnouncement()],
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      existingKeys: new Set(),
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
    expect(plan.backfillCount).toBe(1);
    expect(plan.keys[0]).toMatchObject({
      announcementId: 'ann-hz',
      versionId: 'ann-hz-v1',
      dedupKey: 'ann-hz:ann-hz-v1',
      notified: false,
    });
  });

  it('重复同步：同一版本全部命中已记录键，不再产生任何通知', () => {
    const first = planOpportunityNotices({
      announcements: [makeAnnouncement()],
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      existingKeys: new Set(),
      now: NOW,
    });
    const second = planOpportunityNotices({
      announcements: [makeAnnouncement()],
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      existingKeys: new Set(first.keys.map((k) => k.dedupKey)),
      now: NOW,
    });
    expect(second.notices).toHaveLength(0);
    expect(second.keys).toHaveLength(0);
    expect(second.backfillCount).toBe(0);
  });

  it('公告发布新版本：新 dedupKey 允许再次提醒，且只提醒一次', () => {
    const logged = new Set(['ann-hz:ann-hz-v1']);
    const plan = planOpportunityNotices({
      announcements: [
        makeAnnouncement({}, {
          id: 'ann-hz-v2',
          versionNumber: 2,
          publishedAt: '2026-10-11T09:00:00+08:00',
          changeNote: '扩招 8 人，截止延期',
        }),
      ],
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      existingKeys: logged,
      now: NOW,
    });
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]).toMatchObject({
      announcementId: 'ann-hz',
      versionId: 'ann-hz-v2',
      unitId: 'unit-hz-01',
      headcount: 12,
    });
    expect(plan.keys[0]!.dedupKey).toBe('ann-hz:ann-hz-v2');
    expect(plan.keys[0]!.notified).toBe(true);
  });

  it('账号隔离：用户 A 的基线不影响用户 B 的首次回填判定', () => {
    const userAKeys = new Set(['ann-hz:ann-hz-v1']);
    // 用户 B 没有任何日志：即使公告与 A 相同，B 仍是首次同步回填
    const planB = planOpportunityNotices({
      announcements: [makeAnnouncement()],
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      existingKeys: userAKeys.size > 0 ? new Set() : userAKeys,
      now: NOW,
    });
    expect(planB.backfillCount).toBe(1);
    expect(planB.notices).toHaveLength(0);
  });

  it('不符合触发条件的公告不进计划（连基线都不记）', () => {
    const plan = planOpportunityNotices({
      announcements: [
        makeAnnouncement({ dataset: 'real', reviewStatus: 'ai_reviewed_pending' }),
      ],
      criteria: CRITERIA,
      ineligibleUnitIds: new Set(),
      existingKeys: new Set(),
      now: NOW,
    });
    expect(plan.keys).toHaveLength(0);
    expect(plan.backfillCount).toBe(0);
  });
});
