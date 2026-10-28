import { describe, expect, it } from 'vitest';
import type { RecruitmentAnnouncement } from '../matching/types.js';
import {
  normalizePublisherName,
  organizationDedupKey,
  organizationIdentityKey,
  planOrganizationNotices,
} from './organization-follow.domain.js';

const NOW = new Date('2026-10-28T12:00:00+08:00');

function makeAnnouncement(
  overrides: {
    id?: string;
    publisher?: string;
    regionCode?: string;
    lifecycle?: RecruitmentAnnouncement['lifecycle'];
    registrationEnd?: string;
    sourceOk?: boolean;
    dataset?: string;
    reviewStatus?: string;
  } = {},
): RecruitmentAnnouncement {
  const id = overrides.id ?? 'ann-1';
  return {
    id,
    title: `${id} 公告`,
    publisher: overrides.publisher ?? '杭州市教育局',
    organizationType: 'government_unified',
    officialUrl: 'https://example.gov.cn/ann-1',
    subjectScope: ['chinese'],
    region: { code: overrides.regionCode ?? '330100', province: '浙江省', city: '杭州市' },
    lifecycle: overrides.lifecycle ?? 'active',
    firstPublishedAt: '2026-10-01T09:00:00+08:00',
    versions: [
      {
        id: `${id}-v1`,
        announcementId: id,
        versionNumber: 1,
        sourceKind: 'original',
        publishedAt: '2026-10-01T09:00:00+08:00',
        officialSource: {
          id: 'src-1',
          locator: { kind: 'url', url: 'https://example.gov.cn/ann-1' },
          state: 'official',
          checkedAt: '2026-10-01T09:00:00+08:00',
        },
        timeline: {
          registrationStart: '2026-11-01',
          registrationEnd: overrides.registrationEnd ?? '2026-11-10',
        },
        units: [
          {
            id: `${id}-unit-1`,
            code: 'U1',
            name: '示例岗位',
            announcementId: id,
            versionId: `${id}-v1`,
            region: { code: '330102', province: '浙江省', city: '杭州市' },
            subject: 'chinese',
            stage: 'high',
            headcount: 2,
            organizationType: 'government_unified',
            employmentNature: { code: 'public_institution_staff', officialName: '事业编制' },
            allocation: { code: 'direct_school', description: '按报考学校定岗' },
            requirements: [],
          },
        ],
      },
    ],
    sourceHealth: {
      ok: overrides.sourceOk ?? true,
      checkedAt: '2026-10-01T09:00:00+08:00',
      failReason: null,
    },
    ...(overrides.dataset ? { dataset: overrides.dataset } : {}),
    ...(overrides.reviewStatus ? { reviewStatus: overrides.reviewStatus } : {}),
  } as unknown as RecruitmentAnnouncement;
}

const FOLLOW = {
  identityKey: organizationIdentityKey({
    publisherName: '杭州市教育局',
    regionCode: '330100',
  }),
  publisherName: '杭州市教育局',
  regionCode: '330100',
  followedAt: '2026-10-02T09:00:00+08:00',
};

describe('单位身份键', () => {
  it('规范化发布主体名：折叠空白与全角字符，不做模糊推断', () => {
    expect(normalizePublisherName('  杭州市  教育局 ')).toBe('杭州市 教育局');
    expect(normalizePublisherName('杭州市教育局（本级）'.normalize('NFKC'))).toBe(
      normalizePublisherName('杭州市教育局(本级)'),
    );
  });

  it('同名不同地区不串联：地区码不同则身份键不同', () => {
    const a = organizationIdentityKey({ publisherName: '市教育局', regionCode: '330100' });
    const b = organizationIdentityKey({ publisherName: '市教育局', regionCode: '320100' });
    expect(a).not.toBe(b);
  });
});

describe('单位关注新公告提醒', () => {
  it('首次同步只回填基线，不产生通知', () => {
    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement()],
      follows: [FOLLOW],
      existingKeys: new Set(),
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
    expect(plan.backfillCount).toBe(1);
    expect(plan.keys[0]?.notified).toBe(false);
  });

  it('已有基线后出现新公告：产生一条通知且幂等', () => {
    // 既有基线：关注时公告 ann-0 已回填
    const baseline = organizationDedupKey(FOLLOW.identityKey, 'ann-0', 'ann-0-v1');
    const existing = new Set([baseline]);
    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement({ id: 'ann-1' })],
      follows: [FOLLOW],
      existingKeys: existing,
      now: NOW,
    });
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]?.publisher).toBe('杭州市教育局');
    expect(plan.notices[0]?.announcementTitle).toContain('ann-1');
    expect(plan.keys[0]?.notified).toBe(true);
    // 重复同步：dedupKey 已记录则不再通知
    const again = planOrganizationNotices({
      announcements: [makeAnnouncement({ id: 'ann-1' })],
      follows: [FOLLOW],
      existingKeys: new Set([...existing, plan.keys[0]!.dedupKey]),
      now: NOW,
    });
    expect(again.notices).toHaveLength(0);
    expect(again.keys).toHaveLength(0);
  });

  it('名称相近但不完全一致不关联（更名不做模糊推断）', () => {
    const baseline = organizationDedupKey(FOLLOW.identityKey, 'ann-0', 'ann-0-v1');
    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement({ publisher: '杭州市教育局（合并后）' })],
      follows: [FOLLOW],
      existingKeys: new Set([baseline]),
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
    expect(plan.keys).toHaveLength(0);
  });

  it('已截止、撤回、来源异常或非用户可见的公告不提醒', () => {
    const baseline = organizationDedupKey(FOLLOW.identityKey, 'ann-0', 'ann-0-v1');
    const existing = new Set([baseline]);
    const cases = [
      makeAnnouncement({ id: 'a1', registrationEnd: '2026-10-01' }), // 已截止
      makeAnnouncement({ id: 'a2', lifecycle: 'withdrawn' }), // 已撤回
      makeAnnouncement({ id: 'a3', sourceOk: false }), // 来源异常
      makeAnnouncement({ id: 'a4', dataset: 'test' }), // 测试样本
      // AI 初核待复核的真实记录不进用户端（仅 real 受 reviewStatus 约束）
      makeAnnouncement({ id: 'a5', dataset: 'real', reviewStatus: 'ai_reviewed_pending' }),
    ];
    const plan = planOrganizationNotices({
      announcements: cases,
      follows: [FOLLOW],
      existingKeys: existing,
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
  });

  it('同一公告命中多个关注时各自独立幂等', () => {
    const otherFollow = {
      ...FOLLOW,
      identityKey: organizationIdentityKey({
        publisherName: '杭州市教育局',
        regionCode: '330100',
      }),
    };
    // 另一用户维度的同一身份键：键相同但在服务层按 userId 隔离；
    // 这里验证同一follow集合中两个不同身份互不影响
    const second = { ...otherFollow, identityKey: `${FOLLOW.identityKey}-other` };
    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement()],
      follows: [FOLLOW, second],
      existingKeys: new Set(),
      now: NOW,
    });
    // FOLLOW 命中回填 1 条；second 身份键不命中任何公告
    expect(plan.backfillCount).toBe(1);
  });
});
