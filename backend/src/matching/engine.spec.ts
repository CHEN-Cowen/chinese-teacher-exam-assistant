import { describe, expect, it } from 'vitest';
import { CATALOG_ANNOUNCEMENTS, SCENARIO_IDS } from './catalog.js';
import {
  buildCandidates,
  currentVersion,
  evaluateRequirement,
  evaluateRegion,
  groupByMissingDimension,
  isUserVisibleInCatalog,
  isValidOpportunity,
  majorNameMatches,
  normalizeMajor,
  sortCandidates,
} from './engine.js';
import type {
  Requirement,
  UserRecruitmentProfile,
} from './types.js';

describe('S2 区县精度', () => {
  const profile: UserRecruitmentProfile = { regions: [{ code: '320106', province: '江苏省', city: '南京市', level: 'required' }], acceptedEmploymentNatures: [] };
  it('同市不同区县不误判符合', () => {
    expect(evaluateRegion('320104', profile).value).toBe('FAIL');
    expect(evaluateRegion('320106', profile).value).toBe('PASS');
  });
  it('只有市级地区时区县匹配未知，不判不符或符合', () => {
    expect(evaluateRegion('320100', profile).value).toBe('UNKNOWN');
  });
});

const NOW = '2026-10-04T12:00:00+08:00';

/** 与前端模块 1 seed 画像同构：2026 届本科师范生，未填户籍/出生日期 */
const BASE_PROFILE: UserRecruitmentProfile = {
  regions: [
    { code: '330000', province: '浙江省', level: 'required' },
    { code: '320000', province: '江苏省', level: 'consider' },
    { code: '340000', province: '安徽省', level: 'consider' },
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

function candidatesFor(profile: UserRecruitmentProfile) {
  return buildCandidates(CATALOG_ANNOUNCEMENTS, profile, NOW);
}

function matchOf(
  candidates: ReturnType<typeof buildCandidates>,
  announcementId: string,
) {
  const found = candidates.find((c) => c.announcement.id === announcementId);
  if (!found) throw new Error(`缺少场景公告 ${announcementId}`);
  return found.match;
}

describe('资格匹配引擎：四类结果端到端判定', () => {
  it('杭州场景：关键条件全部 PASS → preliminary_eligible', () => {
    const match = matchOf(candidatesFor(BASE_PROFILE), SCENARIO_IDS.eligible);
    expect(match.gates.every((g) => g.passed)).toBe(true);
    expect(match.overall).toBe('preliminary_eligible');
    expect(match.dimensions.every((d) => d.value === 'PASS')).toBe(true);
  });

  it('鄞州场景：缺户籍事实 → need_more_info 且户籍维度为 UNKNOWN（不是 FAIL）', () => {
    const match = matchOf(candidatesFor(BASE_PROFILE), SCENARIO_IDS.needHukou);
    expect(match.overall).toBe('need_more_info');
    const hukou = match.dimensions.find((d) => d.dimension === 'hukou');
    expect(hukou?.value).toBe('UNKNOWN');
    expect(isValidOpportunity(match)).toBe(true);
  });

  it('苏州场景：专业目录表述歧义 → manual_review（专业维度 MANUAL_REVIEW，不自动判定）', () => {
    const match = matchOf(
      candidatesFor(BASE_PROFILE),
      SCENARIO_IDS.majorAmbiguous,
    );
    expect(match.overall).toBe('manual_review');
    const major = match.dimensions.find((d) => d.dimension === 'major');
    expect(major?.value).toBe('MANUAL_REVIEW');
  });

  it('南京场景：硕士门槛 + 高中教资双硬伤 → not_eligible', () => {
    const match = matchOf(
      candidatesFor(BASE_PROFILE),
      SCENARIO_IDS.educationFail,
    );
    expect(match.overall).toBe('not_eligible');
    const education = match.dimensions.find((d) => d.dimension === 'education');
    const cert = match.dimensions.find((d) => d.dimension === 'teacher_cert');
    expect(education?.value).toBe('FAIL');
    expect(cert?.value).toBe('FAIL');
    expect(isValidOpportunity(match)).toBe(false);
  });
});

describe('资格匹配引擎：时效闸门与版本治理', () => {
  it('温州场景：报名已截止 → 闸门失败并退出有效推荐', () => {
    const candidates = candidatesFor(BASE_PROFILE);
    const match = matchOf(candidates, SCENARIO_IDS.closed);
    const closedGate = match.gates.find((g) => g.code === 'registration_closed');
    expect(closedGate?.passed).toBe(false);
    expect(isValidOpportunity(match)).toBe(false);
  });

  it('合肥场景：只评估当前 v2（扩招 8 人、延期），v1 被标记取代但不参与匹配', () => {
    const candidates = candidatesFor(BASE_PROFILE);
    const hefei = candidates.find(
      (c) => c.announcement.id === SCENARIO_IDS.supplemented,
    );
    expect(hefei?.version.versionNumber).toBe(2);
    expect(hefei?.unit.id).toBe('unit-hefei-01-v2');
    expect(hefei?.unit.headcount).toBe(8);
    const v1 = hefei!.announcement.versions.find((v) => v.versionNumber === 1);
    expect(v1?.supersededAt).toBeTruthy();
    const match = hefei!.match;
    expect(match.overall).toBe('preliminary_eligible');
    expect(match.versionId).toBe('ann-hefei-v2');
  });
});

describe('资格匹配引擎：画像修改后即时重算', () => {
  it('只填写地区时其余基础字段都保持 UNKNOWN，不会崩溃或误判不符合', () => {
    const partial: UserRecruitmentProfile = {
      regions: BASE_PROFILE.regions,
      acceptedEmploymentNatures: BASE_PROFILE.acceptedEmploymentNatures,
    };
    const match = matchOf(candidatesFor(partial), SCENARIO_IDS.eligible);
    expect(match.overall).toBe('need_more_info');
    expect(
      match.dimensions
        .filter((dimension) =>
          ['education', 'major', 'graduate_status', 'teacher_cert'].includes(
            dimension.dimension,
          ),
        )
        .every((dimension) => dimension.value === 'UNKNOWN'),
    ).toBe(true);
  });

  it('补充宁波户籍后，鄞州从 need_more_info 变为 preliminary_eligible', () => {
    const before = matchOf(candidatesFor(BASE_PROFILE), SCENARIO_IDS.needHukou);
    expect(before.overall).toBe('need_more_info');

    const supplemented: UserRecruitmentProfile = {
      ...BASE_PROFILE,
      hukouRegionCode: '330212',
    };
    const after = matchOf(
      candidatesFor(supplemented),
      SCENARIO_IDS.needHukou,
    );
    expect(after.overall).toBe('preliminary_eligible');
    const hukou = after.dimensions.find((d) => d.dimension === 'hukou');
    expect(hukou?.value).toBe('PASS');
  });

  it('补充非宁波户籍 → 户籍维度 FAIL，总体 not_eligible', () => {
    const profile: UserRecruitmentProfile = {
      ...BASE_PROFILE,
      hukouRegionCode: '330100',
    };
    const after = matchOf(candidatesFor(profile), SCENARIO_IDS.needHukou);
    expect(after.overall).toBe('not_eligible');
  });

  it('未填地区时地区维度为 UNKNOWN，且该机会不进入有效推荐（不臆造意向）', () => {
    const profile: UserRecruitmentProfile = {
      ...BASE_PROFILE,
      regions: [],
    };
    const match = matchOf(candidatesFor(profile), SCENARIO_IDS.eligible);
    const region = match.dimensions.find((d) => d.dimension === 'region');
    expect(region?.value).toBe('UNKNOWN');
    expect(isValidOpportunity(match)).toBe(false);
  });

  it('补充出生日期后年龄维度从 UNKNOWN 变 PASS（缺信息绝不判 FAIL）', () => {
    const ageReq: Requirement = {
      id: 'age-test',
      dimension: 'age',
      description: '35 周岁以下',
      hard: true,
      criterion: { kind: 'age', maxAgeYears: 35 },
      evidence: {
        id: 'age-test-ev',
        locator: { kind: 'url', url: 'https://example.gov.cn/a' },
        state: 'official',
        checkedAt: NOW,
      },
    };
    const before = evaluateRequirement(ageReq, BASE_PROFILE, NOW);
    expect(before.value).toBe('UNKNOWN');
    const after = evaluateRequirement(
      ageReq,
      { ...BASE_PROFILE, birthDate: '1995-06-01' },
      NOW,
    );
    expect(after.value).toBe('PASS');
  });
});

describe('资格匹配引擎：专业匹配只有精确名称/已审核别名/人工确认', () => {
  it('精确名称（归一化全角括号后）匹配', () => {
    expect(
      majorNameMatches('汉语言文学（师范）', ['汉语言文学（师范）']),
    ).toBe(true);
    expect(normalizeMajor(' 汉语言文学（师范） ')).toBe(
      normalizeMajor('汉语言文学(师范)'),
    );
  });

  it('已审核别名可命中（如“汉语言文学教育”→“汉语言文学”），并让杭州专业 PASS', () => {
    expect(majorNameMatches('汉语言文学教育', ['汉语言文学'])).toBe(true);
    const profile: UserRecruitmentProfile = {
      ...BASE_PROFILE,
      majorFullName: '汉语言文学教育',
    };
    const match = matchOf(candidatesFor(profile), SCENARIO_IDS.eligible);
    const major = match.dimensions.find((d) => d.dimension === 'major');
    expect(major?.value).toBe('PASS');
  });

  it('不使用任何相似度：未列明专业在非歧义公告中直接 FAIL', () => {
    const profile: UserRecruitmentProfile = {
      ...BASE_PROFILE,
      majorFullName: '中文教育',
    };
    const match = matchOf(candidatesFor(profile), SCENARIO_IDS.eligible);
    const major = match.dimensions.find((d) => d.dimension === 'major');
    expect(major?.value).toBe('FAIL');
  });

  it('歧义公告中未列明专业进入 MANUAL_REVIEW 而不是 FAIL', () => {
    const profile: UserRecruitmentProfile = {
      ...BASE_PROFILE,
      majorFullName: '中文教育',
    };
    const match = matchOf(candidatesFor(profile), SCENARIO_IDS.majorAmbiguous);
    const major = match.dimensions.find((d) => d.dimension === 'major');
    expect(major?.value).toBe('MANUAL_REVIEW');
  });
});

describe('资格匹配引擎：排序与缺失维度分组', () => {
  it('默认排序首位为“必选地区 + 初步符合 + 事业编”的杭州', () => {
    const sorted = sortCandidates(candidatesFor(BASE_PROFILE), BASE_PROFILE);
    expect(sorted[0]?.announcement.id).toBe(SCENARIO_IDS.eligible);
  });

  it('need_more_info 候选按缺失维度分组（鄞州进入 hukou 组）', () => {
    const groups = groupByMissingDimension(candidatesFor(BASE_PROFILE));
    const hukouGroup = groups.find((g) => g.dimension === 'hukou');
    expect(hukouGroup?.count).toBe(1);
    expect(hukouGroup?.candidates[0]?.announcement.id).toBe(
      SCENARIO_IDS.needHukou,
    );
  });

  it('每个候选都指向具体公告版本 id（结论可追溯）', () => {
    for (const candidate of candidatesFor(BASE_PROFILE)) {
      expect(candidate.match.versionId).toBe(candidate.version.id);
      expect(candidate.version.officialSource.locator.kind).toBe('url');
    }
  });
});

describe('资格匹配引擎：当前版本选择', () => {
  it('多版本公告取 versionNumber 最大者', () => {
    const hefei = CATALOG_ANNOUNCEMENTS.find(
      (a) => a.id === SCENARIO_IDS.supplemented,
    )!;
    expect(currentVersion(hefei).id).toBe('ann-hefei-v2');
  });
});

// ==================== M5：目录可见性（数据集合 × 人工复核状态分离） ====================

describe('M5 目录可见性：isUserVisibleInCatalog', () => {
  const base = (dataset?: 'demo' | 'real' | 'test', reviewStatus?: string) =>
    ({ dataset, reviewStatus }) as {
      dataset?: 'demo' | 'real';
      reviewStatus?: 'ai_reviewed_pending' | 'human_reviewed';
    };

  it('demo（含缺省）始终可见', () => {
    expect(isUserVisibleInCatalog(base('demo'))).toBe(true);
    expect(isUserVisibleInCatalog(base(undefined))).toBe(true);
  });

  it('test 样本永不进入用户端（M5-05）', () => {
    expect(isUserVisibleInCatalog(base('test'))).toBe(false);
    // 即便被错误标记为 human_reviewed 也不放行（test 是自动化样本）
    expect(isUserVisibleInCatalog(base('test', 'human_reviewed'))).toBe(false);
  });

  it('real 仅在 human_reviewed 后可见；AI 初核待复核不可见（M5-03）', () => {
    expect(isUserVisibleInCatalog(base('real', 'human_reviewed'))).toBe(true);
    expect(isUserVisibleInCatalog(base('real', 'ai_reviewed_pending'))).toBe(false);
    expect(isUserVisibleInCatalog(base('real', undefined))).toBe(false);
  });
});
