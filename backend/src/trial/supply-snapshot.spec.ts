import { describe, expect, it } from 'vitest';
import type {
  AnnouncementTimeline,
  RecruitmentAnnouncement,
} from '../matching/types.js';
import type { MonitoringCoverage } from '../matching/coverage.js';
import {
  cnDateString,
  computeSupplySnapshot,
  phaseOf,
} from './trial.domain.js';

/**
 * 机会供给快照手算对账（模块 8）。
 * 固定北京时间 2026-10-06；所有期望值按该日历日手工计算。
 */
const NOW = new Date('2026-10-06T09:00:00+08:00');

function ann(
  id: string,
  over: Partial<RecruitmentAnnouncement> & {
    timeline: AnnouncementTimeline;
    unitCount: number;
    versionNumber?: number;
  },
): RecruitmentAnnouncement {
  const { timeline, unitCount, versionNumber = 1, ...rest } = over;
  return {
    id,
    title: id,
    publisher: '某教育局',
    organizationType: 'education_bureau',
    officialUrl: 'https://official.example.gov.cn/a',
    subjectScope: ['chinese'],
    region: { code: '330100', label: '杭州' } as RecruitmentAnnouncement['region'],
    lifecycle: 'active',
    firstPublishedAt: '2026-01-01',
    dataset: 'real',
    versions: [
      {
        id: `${id}-v${versionNumber}`,
        announcementId: id,
        versionNumber,
        sourceKind: 'original',
        publishedAt: '2026-01-01',
        officialSource: {} as RecruitmentAnnouncement['versions'][number]['officialSource'],
        timeline,
        units: Array.from({ length: unitCount }, (_, i) => ({ id: `${id}-u${i + 1}` })) as RecruitmentAnnouncement['versions'][number]['units'],
      },
    ],
    ...rest,
  } as RecruitmentAnnouncement;
}

function coverage(over: Partial<MonitoringCoverage> = {}): MonitoringCoverage {
  return {
    subject: 'chinese',
    subjectLabel: '语文教师',
    status: 'monitoring_no_open',
    provinces: [
      {
        code: '330000',
        label: '浙江省',
        status: 'monitoring_no_open',
        monitoredRegionCodes: ['330100', '330200'],
        scopeNote: '',
      },
    ],
    regions: [
      {
        code: '330100',
        label: '杭州',
        authority: '杭州市教育局',
        sources: [
          { id: 's1', name: '栏目1', url: 'https://a', lastCheckedAt: '2026-10-06T08:00:00+08:00', ok: true },
          { id: 's2', name: '栏目2', url: 'https://b', lastCheckedAt: '2026-10-06T08:00:00+08:00', ok: true },
        ],
      },
      {
        code: '330200',
        label: '宁波',
        authority: '宁波市教育局',
        sources: [
          { id: 's3', name: '栏目3', url: 'https://c', lastCheckedAt: '2026-10-05T08:00:00+08:00', ok: false, failReason: '404' },
        ],
      },
    ],
    lastCheckedAt: '2026-10-06T08:00:00+08:00',
    openOpportunityCount: 0,
    nextWindowNote: '',
    scopeNote: '',
    ...over,
  };
}

describe('computeSupplySnapshot 手算对账', () => {
  it('四相位 + 复核状态 + 来源失效 + 单元计数（逐档手算）', () => {
    const announcements = [
      // 在报、已复核、来源健康、3 个岗位
      ann('a-open', {
        timeline: { registrationStart: '2026-10-01', registrationEnd: '2026-10-10' },
        unitCount: 3,
        reviewStatus: 'human_reviewed',
      }),
      // 预告（时间待官方通知）、待复核、2 个岗位
      ann('a-preview', { timeline: {}, unitCount: 2 }),
      // 已截止、已复核、5 个岗位
      ann('a-closed', {
        timeline: { registrationStart: '2026-09-01', registrationEnd: '2026-09-30' },
        unitCount: 5,
        reviewStatus: 'human_reviewed',
      }),
      // 已取消（withdrawn）、待复核、4 个岗位
      ann('a-withdrawn', { timeline: {}, unitCount: 4, lifecycle: 'withdrawn' }),
      // 在报但来源失效、待复核、1 个岗位
      ann('a-sourcefail', {
        timeline: { registrationStart: '2026-10-01', registrationEnd: '2026-10-10' },
        unitCount: 1,
        sourceHealth: { ok: false, checkedAt: '2026-10-05T00:00:00+08:00', failReason: '撤稿' },
      }),
      // 演示台账公告：9 个岗位也必须被排除，绝不构成真实供给
      ann('d-demo', {
        timeline: { registrationStart: '2026-10-01', registrationEnd: '2026-10-10' },
        unitCount: 9,
        dataset: 'demo',
      }),
    ];

    const snap = computeSupplySnapshot(announcements, coverage({ openOpportunityCount: 4 }), NOW);

    expect(snap.announcements.total).toBe(5);
    expect(snap.announcements.active).toBe(4);
    expect(snap.announcements.withdrawn).toBe(1);
    expect(snap.announcements.open).toBe(2);
    expect(snap.announcements.preview).toBe(1);
    expect(snap.announcements.closed).toBe(1);
    expect(snap.announcements.sourceFailed).toBe(1);
    expect(snap.announcements.review).toEqual({ humanReviewed: 2, pending: 3 });
    // 3+2+5+4+1 = 15（含历史与取消批次最新版本）；在报单元 = 3+1 = 4
    expect(snap.units.total).toBe(15);
    expect(snap.units.open).toBe(4);
    expect(snap.coverage.monitoredRegions).toBe(2);
    expect(snap.coverage.monitoredSources).toBe(3);
    expect(snap.coverage.sourcesUnhealthy).toBe(1);
    expect(snap.crossCheck).toEqual({
      manualOpenCount: 4,
      computedOpenUnits: 4,
      consistent: true,
    });
  });

  it('人工巡检数与按时间计算数不一致：标记必须排查，不静默取其一', () => {
    const announcements = [
      ann('a-open', {
        timeline: { registrationStart: '2026-10-01', registrationEnd: '2026-10-10' },
        unitCount: 2,
      }),
    ];
    const snap = computeSupplySnapshot(announcements, coverage({ openOpportunityCount: 9 }), NOW);
    expect(snap.crossCheck).toEqual({
      manualOpenCount: 9,
      computedOpenUnits: 2,
      consistent: false,
    });
  });

  it('空样本：全部为 0 且交叉核对一致', () => {
    const snap = computeSupplySnapshot([], coverage({ openOpportunityCount: 0 }), NOW);
    expect(snap.announcements.total).toBe(0);
    expect(snap.units).toEqual({ total: 0, open: 0 });
    expect(snap.crossCheck.consistent).toBe(true);
  });

  it('存在多个版本时只取最新版本统计岗位（旧版本已截止、新版本在报）', () => {
    const a = ann('a-rev', {
      timeline: { registrationStart: '2026-10-01', registrationEnd: '2026-10-10' },
      unitCount: 3,
      versionNumber: 2,
    });
    a.versions.unshift({
      ...a.versions[0],
      id: 'a-rev-v1',
      versionNumber: 1,
      timeline: { registrationStart: '2026-01-01', registrationEnd: '2026-01-10' },
      units: Array.from({ length: 10 }, (_, i) => ({ id: `old-u${i + 1}` })) as never,
    });
    const snap = computeSupplySnapshot([a], coverage({ openOpportunityCount: 3 }), NOW);
    expect(snap.announcements.open).toBe(1);
    expect(snap.units.total).toBe(3);
    expect(snap.units.open).toBe(3);
  });
});

describe('phaseOf 报名相位边界', () => {
  const open = { registrationStart: '2026-10-01', registrationEnd: '2026-10-10' };
  it('截止日当天仍算在报，次日算已截止', () => {
    expect(phaseOf(open, 'active', '2026-10-10')).toBe('open');
    expect(phaseOf(open, 'active', '2026-10-11')).toBe('closed');
  });
  it('开始日当天算在报；开始日前算预告', () => {
    expect(phaseOf(open, 'active', '2026-10-01')).toBe('open');
    expect(phaseOf(open, 'active', '2026-09-30')).toBe('preview');
  });
  it('官方未给报名日期 → 预告（待官方通知），不臆造日期', () => {
    expect(phaseOf({}, 'active', '2026-10-06')).toBe('preview');
  });
  it('已给开始日且已开始但无截止日 → 在报；开始日未到 → 预告', () => {
    expect(phaseOf({ registrationStart: '2026-10-01' }, 'active', '2026-10-06')).toBe('open');
    expect(phaseOf({ registrationStart: '2026-11-01' }, 'active', '2026-10-06')).toBe('preview');
  });
  it('lifecycle=withdrawn 一律为取消，不受日期影响', () => {
    expect(phaseOf(open, 'withdrawn', '2026-10-06')).toBe('withdrawn');
  });
});

describe('cnDateString 北京时间日历日', () => {
  it('UTC 16:30 已是北京次日 00:30', () => {
    expect(cnDateString(new Date('2026-10-06T16:30:00Z'))).toBe('2026-10-07');
  });
  it('UTC 当天上午仍是北京当天', () => {
    expect(cnDateString(new Date('2026-10-06T01:00:00Z'))).toBe('2026-10-06');
  });
});
