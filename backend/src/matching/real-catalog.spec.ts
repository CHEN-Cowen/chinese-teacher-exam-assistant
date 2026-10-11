import { describe, expect, it } from 'vitest';
import {
  COVERAGE_VERSION,
  REAL_COVERAGE,
} from './coverage.js';
import {
  REAL_ANNOUNCEMENTS,
  REAL_ANNOUNCEMENT_IDS,
  REAL_CATALOG_VERSION,
  REAL_CHECKED_AT,
} from './real-catalog.js';
import { buildCandidates, isValidOpportunity } from './engine.js';
import { deriveSchoolPlacement } from './school-placement.js';
import type { UserRecruitmentProfile } from './types.js';

const PROFILE: UserRecruitmentProfile = {
  regions: [
    { code: '330000', province: '浙江省', level: 'required' },
    { code: '320000', province: '江苏省', level: 'consider' },
  ],
  educationLevel: 'bachelor',
  degree: 'bachelor',
  majorFullName: '汉语言文学（师范）',
  graduationDate: '2026-06-30',
  employmentStatus: 'fresh_unemployed',
  socialSecurityMonths: 0,
  teacherCert: { status: 'obtained', subject: 'chinese', stage: 'middle' },
  acceptedEmploymentNatures: [
    'public_institution_staff',
    'record_filing',
    'post_quota',
    'headcount_control',
    'other',
  ],
};

const candidates = buildCandidates(
  REAL_ANNOUNCEMENTS,
  PROFILE,
  REAL_CHECKED_AT,
);

function of(announcementId: string) {
  return candidates.filter((c) => c.announcement.id === announcementId);
}

describe('真实台账：3 条杭州/宁波公告的结构与证据', () => {
  it('台账含 3 条公告、4 个语文报考单元，全部标记 real + AI 初核待复核', () => {
    expect(REAL_ANNOUNCEMENTS).toHaveLength(3);
    expect(candidates).toHaveLength(4);
    for (const a of REAL_ANNOUNCEMENTS) {
      expect(a.dataset).toBe('real');
      expect(a.reviewStatus).toBe('ai_reviewed_pending');
      expect(a.reviewedBy).toBeNull();
      expect(a.sourceHealth?.ok).toBe(true);
      expect(a.officialUrl).toMatch(/\.gov\.cn\//);
    }
    expect(REAL_CATALOG_VERSION).toMatch(/^kb-real-catalog-/);
  });

  it('鄞州预告：报名时间留空、registration_unconfirmed 失败；语文岗 7 人且锚定岗位表序号1', () => {
    const list = of(REAL_ANNOUNCEMENT_IDS.yinzhouPreview);
    expect(list).toHaveLength(1);
    const c = list[0]!;
    expect(c.unit.headcount).toBe(7);
    expect(c.version.timeline.registrationEnd).toBeUndefined();
    expect(
      c.match.gates.find((g) => g.code === 'registration_unconfirmed')?.passed,
    ).toBe(false);
    expect(
      c.match.gates.find((g) => g.code === 'registration_closed')?.passed,
    ).toBe(true);
    expect(c.unit.sourceRow?.locator.kind).toBe('url');
    expect(c.unit.sourceRow?.excerpt).toContain('7');
    if (c.unit.sourceRow?.locator.kind === 'url') {
      expect(c.unit.sourceRow.locator.anchor).toContain('序号1');
      expect(c.unit.sourceRow.locator.url).toContain('download');
    }
  });

  it('杭州 4 月批次：2 个高中语文单元（4 人/1 人），报名已截止，岗位表序号 5/6', () => {
    const list = of(REAL_ANNOUNCEMENT_IDS.hangzhou202604);
    expect(list.map((c) => c.unit.headcount).sort((a, b) => a - b)).toEqual([1, 4]);
    for (const c of list) {
      expect(
        c.match.gates.find((g) => g.code === 'registration_closed')?.passed,
      ).toBe(false);
      expect(c.unit.registerUrl).toBe('https://jszp.hzedu.gov.cn/');
      if (c.unit.sourceRow?.locator.kind === 'url') {
        expect(c.unit.sourceRow.locator.anchor).toMatch(/序号[56]/);
      }
    }
  });

  it('宁波直属 7 月批次：宁外高中语文 2 人，报名已截止，报名入口为教育考试院链接', () => {
    const list = of(REAL_ANNOUNCEMENT_IDS.ningbo202607);
    expect(list).toHaveLength(1);
    const c = list[0]!;
    expect(c.unit.headcount).toBe(2);
    expect(c.unit.registerUrl).toContain('nbeea.nbedu.net.cn');
    expect(
      c.match.gates.find((g) => g.code === 'registration_closed')?.passed,
    ).toBe(false);
  });

  it('全部真实单元当前均不进有效推荐（闸门失败），且失败原因可解释', () => {
    for (const c of candidates) {
      expect(isValidOpportunity(c.match)).toBe(false);
      const failed = c.match.gates.filter((g) => !g.passed);
      expect(failed.length).toBeGreaterThan(0);
      for (const gate of failed) expect(gate.reason.length).toBeGreaterThan(5);
      // AI 初核证据一律不允许冒充 official
      expect(c.version.officialSource.state).not.toBe('official');
      expect(
        c.unit.requirements.every((r) => r.evidence.state === 'ai_extracted'),
      ).toBe(true);
    }
  });

  it('每条真实公告都因证据未经人工复核而失败 evidence_not_reviewed 闸门（人工发布门槛）', () => {
    for (const c of candidates) {
      const gate = c.match.gates.find((g) => g.code === 'evidence_not_reviewed');
      expect(gate, `${c.unit.id} 缺少 evidence_not_reviewed 闸门`).toBeTruthy();
      expect(gate!.passed).toBe(false);
    }
  });

  it('定岗学校：杭州二中两校与宁外逐校列明（specified）；鄞州岗位组未知（unspecified），不虚构学校', () => {
    const byId = new Map(candidates.map((c) => [c.unit.id, c]));
    const fuchun = byId.get('real-hz-202604-fuchun-chinese')!;
    const gaoxin = byId.get('real-hz-202604-gaoxin-chinese')!;
    const ningbo = byId.get('real-nb-202607-nwsis-chinese')!;
    const yinzhou = byId.get('real-yz-2026-chinese-01')!;

    expect(deriveSchoolPlacement(fuchun.unit)).toEqual({
      status: 'specified',
      schoolName: '杭州第二中学富春学校',
    });
    expect(deriveSchoolPlacement(gaoxin.unit)).toEqual({
      status: 'specified',
      schoolName: '杭州第二中学高新学校',
    });
    expect(deriveSchoolPlacement(ningbo.unit)).toEqual({
      status: 'specified',
      schoolName: '宁波外国语学校',
    });

    const yzPlacement = deriveSchoolPlacement(yinzhou.unit);
    expect(yzPlacement.status).toBe('unspecified');
    if (yzPlacement.status === 'unspecified') {
      expect(yzPlacement.note).toContain('岗位');
      expect(yzPlacement.note).not.toContain('学校）');
    }
    // 鄞州 unit.name 是岗位组名，展示文案绝不回退使用它当校名
    expect(schoolNameOrUnknown(yinzhou.unit)).toContain('具体学校未知');
    expect(schoolNameOrUnknown(yinzhou.unit)).not.toContain('鄞州区教育系统');
  });

  it('覆盖事实源：杭州/宁波已监测、当前 0 个在报、最近核对 2026-10-06', () => {
    expect(REAL_COVERAGE.status).toBe('monitoring_no_open');
    expect(REAL_COVERAGE.openOpportunityCount).toBe(0);
    expect(REAL_COVERAGE.lastCheckedAt.startsWith('2026-10-06')).toBe(true);
    const codes = REAL_COVERAGE.regions.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['330100', '330200']));
    expect(REAL_COVERAGE.scopeNote).toContain('暂未收录');
  });

  it('逐省覆盖：浙江监测 2 市；江苏 not_started 且 0 城市 0 来源，不虚构任何江苏官方渠道', () => {
    expect(COVERAGE_VERSION).toBe('kb-monitoring-coverage-1.1.0');
    const zj = REAL_COVERAGE.provinces.find((p) => p.code === '330000')!;
    const js = REAL_COVERAGE.provinces.find((p) => p.code === '320000')!;

    expect(zj.status).toBe('monitoring_no_open');
    expect(zj.monitoredRegionCodes).toEqual(['330100', '330200']);
    expect(zj.scopeNote).toContain('暂未收录');

    expect(js.status).toBe('not_started');
    expect(js.monitoredRegionCodes).toEqual([]);
    expect(js.scopeNote).toContain('暂未收录');
    expect(js.scopeNote).toContain('不代表当地没有招聘');

    // 已登记来源只能属于浙江监测城市；台账与来源中不允许出现任何江苏 URL
    const monitoredCodes = new Set(zj.monitoredRegionCodes);
    for (const region of REAL_COVERAGE.regions) {
      expect(monitoredCodes.has(region.code)).toBe(true);
      for (const source of region.sources) {
        expect(source.ok).toBe(true);
        expect(source.url).toMatch(/\.gov\.cn/);
        expect(source.url).not.toMatch(/jiangsu|js\.gov|jshrss|jseea/);
      }
    }
    const allText = JSON.stringify(REAL_COVERAGE) + JSON.stringify(REAL_ANNOUNCEMENTS);
    expect(allText).not.toMatch(/\.js\.gov\.cn|jshrss\.jshrss|jseea\.cn/);
  });
});

function schoolNameOrUnknown(unit: (typeof candidates)[number]['unit']): string {
  const placement = deriveSchoolPlacement(unit);
  return placement.status === 'specified'
    ? placement.schoolName
    : `具体学校未知（${placement.note}）`;
}
