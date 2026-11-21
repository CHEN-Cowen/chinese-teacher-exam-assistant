/**
 * D06 / PRD 11.7 U06 往年参考（后端）测试。
 *
 * 覆盖：
 * - 历史归属口径：已截止进历史；截止当天/预告/跨年仍有效不进；withdrawn 进；
 * - M5 合规：test 样本与 AI 初核待复核真实记录不进往年参考（诚实空态）；
 * - 筛选（批次年/地区前缀/学段/用工性质/关键词）、分页边界、样本范围说明；
 * - 完整程度与存档说明（sourceHealth 失效）；
 * - 详情：历史事实 + 版本链 + 可选对照（无画像 comparison 为 null）；
 * - 查询串校验：非法 year/page/regionCode/keyword 拒绝而非静默猜测。
 */
import { describe, expect, it } from 'vitest';
import type {
  AnnouncementTimeline,
  ApplicationUnit,
  EvidenceReviewState,
  RecruitmentAnnouncement,
  SourceHealth,
  UserRecruitmentProfile,
} from '../matching/types.js';
import {
  buildHistoryDetail,
  buildHistoryList,
  collectHistoricalUnits,
  parseHistoryQuery,
  toHistoryUnitDTO,
} from './history.js';

const NOW = new Date('2026-10-28T08:00:00+08:00'); // 北京 2026-10-28

const PROFILE: UserRecruitmentProfile = {
  regions: [{ code: '330000', province: '浙江省', level: 'required' }],
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

const PAST_TIMELINE: AnnouncementTimeline = {
  registrationStart: '2025-04-14',
  registrationEnd: '2025-04-20',
  writtenExamDate: '2025-05-10',
  interviewDate: '2025-06-01',
};

function makeAnnouncement(opts: {
  id: string;
  title?: string;
  lifecycle?: 'active' | 'withdrawn';
  dataset?: 'demo' | 'real' | 'test';
  reviewStatus?: 'ai_reviewed_pending' | 'human_reviewed';
  firstPublishedAt?: string;
  publishedAt?: string;
  timeline?: AnnouncementTimeline;
  unitOverrides?: Partial<ApplicationUnit>;
  evidenceState?: EvidenceReviewState;
  sourceHealth?: SourceHealth;
  materialsCount?: number;
}): RecruitmentAnnouncement {
  const versionId = `${opts.id}-v1`;
  const evidenceState = opts.evidenceState ?? 'official';
  const unitId = opts.unitOverrides?.id ?? `${opts.id}-u1`;
  const unit: ApplicationUnit = {
    id: unitId,
    code: `${opts.id}-01`,
    name: '测试市直属学校初中语文',
    announcementId: opts.id,
    versionId,
    region: { code: '330102', province: '浙江省', city: '杭州市', district: '测试区' },
    subject: 'chinese',
    stage: 'middle',
    headcount: 2,
    organizationType: 'government_unified',
    employmentNature: { code: 'public_institution_staff', officialName: '事业编制' },
    allocation: { code: 'unified_assignment', description: '统一调配' },
    requirements: [
      {
        id: `${opts.id}-edu`,
        dimension: 'education',
        description: '本科及以上学历',
        hard: true,
        criterion: { kind: 'education', minLevel: 'bachelor' },
        evidence: {
          id: `${opts.id}-edu-ev`,
          locator: { kind: 'excerpt', excerpt: '具有国家承认的本科及以上学历' },
          state: evidenceState,
          checkedAt: '2025-04-10T00:00:00.000Z',
        },
      },
    ],
    ...(opts.materialsCount
      ? {
          materials: Array.from({ length: opts.materialsCount }, (_, index) => ({
            id: `${opts.id}-m${index}`,
            label: `材料${index}`,
            source: {
              id: `${opts.id}-m${index}-ev`,
              locator: { kind: 'excerpt' as const, excerpt: '报名材料要求' },
              state: 'official' as const,
              checkedAt: '2025-04-10T00:00:00.000Z',
            },
            applicableAudience: '所有报考者',
            required: true,
          })),
        }
      : {}),
    ...opts.unitOverrides,
  };
  return {
    id: opts.id,
    title: opts.title ?? `${opts.id} 年测试市教师招聘公告`,
    publisher: '测试市教育局',
    organizationType: 'government_unified',
    officialUrl: 'https://www.example.gov.cn/test/notice',
    subjectScope: ['chinese'],
    region: { code: '330100', province: '浙江省', city: '杭州市' },
    lifecycle: opts.lifecycle ?? 'active',
    firstPublishedAt: opts.firstPublishedAt ?? '2025-04-10T02:00:00.000Z',
    ...(opts.dataset ? { dataset: opts.dataset } : {}),
    ...(opts.reviewStatus ? { reviewStatus: opts.reviewStatus } : {}),
    ...(opts.sourceHealth ? { sourceHealth: opts.sourceHealth } : {}),
    versions: [
      {
        id: versionId,
        announcementId: opts.id,
        versionNumber: 1,
        sourceKind: 'original',
        publishedAt: opts.publishedAt ?? '2025-04-10T02:00:00.000Z',
        officialSource: {
          id: `${opts.id}-src`,
          locator: { kind: 'url', url: 'https://www.example.gov.cn/test/notice' },
          state: 'official',
          checkedAt: '2025-04-10T00:00:00.000Z',
        },
        timeline: opts.timeline ?? PAST_TIMELINE,
        units: [unit],
      },
    ],
  };
}

describe('往年参考：历史归属口径', () => {
  it('报名已截止的公告进入往年参考', () => {
    const records = collectHistoricalUnits([makeAnnouncement({ id: 'a1' })], NOW);
    expect(records).toHaveLength(1);
    expect(records[0]!.unit.id).toBe('a1-u1');
  });

  it('截止当天不算历史（按北京时间日历日比较）', () => {
    const announcement = makeAnnouncement({
      id: 'a2',
      timeline: { registrationStart: '2026-10-20', registrationEnd: '2026-10-28' },
    });
    expect(collectHistoricalUnits([announcement], NOW)).toHaveLength(0);
  });

  it('报名日期未公布的预告不算历史，仍属当前入口', () => {
    const announcement = makeAnnouncement({ id: 'a3', timeline: {} });
    expect(collectHistoricalUnits([announcement], NOW)).toHaveLength(0);
  });

  it('跨年但报名仍有效的岗位留在当前入口，不进入历史', () => {
    const announcement = makeAnnouncement({
      id: 'a4',
      timeline: { registrationStart: '2025-12-01', registrationEnd: '2026-12-31' },
    });
    expect(collectHistoricalUnits([announcement], NOW)).toHaveLength(0);
  });

  it('已撤回公告即便无报名日期也进入往年参考', () => {
    const announcement = makeAnnouncement({ id: 'a5', lifecycle: 'withdrawn', timeline: {} });
    const records = collectHistoricalUnits([announcement], NOW);
    expect(records).toHaveLength(1);
  });

  it('记录按报名截止日倒序排列', () => {
    const older = makeAnnouncement({ id: 'old' });
    const newer = makeAnnouncement({
      id: 'new',
      timeline: { registrationStart: '2026-03-01', registrationEnd: '2026-03-10' },
    });
    const records = collectHistoricalUnits([older, newer], NOW);
    expect(records.map((r) => r.announcement.id)).toEqual(['new', 'old']);
  });
});

describe('往年参考：M5 合规可见性', () => {
  it('AI 初核待复核的真实记录不进往年参考（诚实空态）', () => {
    const announcement = makeAnnouncement({
      id: 'ai-pending',
      dataset: 'real',
      reviewStatus: 'ai_reviewed_pending',
    });
    const response = buildHistoryList([announcement], {}, NOW);
    expect(response.total).toBe(0);
    expect(response.items).toHaveLength(0);
    expect(response.years).toEqual([]);
    expect(response.sampleNote).toContain('没有已收录的往年公告');
  });

  it('test 样本即便已截止也不进往年参考', () => {
    const announcement = makeAnnouncement({ id: 't1', dataset: 'test' });
    expect(buildHistoryList([announcement], {}, NOW).total).toBe(0);
  });

  it('已人工复核的真实记录照常进入往年参考，dataset 如实标注 real', () => {
    const announcement = makeAnnouncement({
      id: 'real-ok',
      dataset: 'real',
      reviewStatus: 'human_reviewed',
    });
    const response = buildHistoryList([announcement], {}, NOW);
    expect(response.total).toBe(1);
    expect(response.items[0]!.announcement.dataset).toBe('real');
    expect(response.items[0]!.announcement.reviewStatus).toBe('human_reviewed');
  });
});

describe('往年参考：筛选与分页', () => {
  const catalog = [
    makeAnnouncement({ id: 'y2025' }),
    makeAnnouncement({
      id: 'y2024',
      timeline: { registrationStart: '2024-03-01', registrationEnd: '2024-03-10' },
      publishedAt: '2024-02-20T02:00:00.000Z',
      firstPublishedAt: '2024-02-20T02:00:00.000Z',
      unitOverrides: {
        id: 'y2024-u1',
        stage: 'primary',
        employmentNature: { code: 'record_filing', officialName: '备案制' },
        region: { code: '320500', province: '江苏省', city: '苏州市' },
      },
    }),
  ];

  it('按批次年（报名开始年）筛选', () => {
    const response = buildHistoryList(catalog, { year: 2024 }, NOW);
    expect(response.total).toBe(1);
    expect(response.items[0]!.unitId).toBe('y2024-u1');
    expect(response.items[0]!.batchYear).toBe(2024);
  });

  it('无报名日期时批次年回退公告发布年', () => {
    const withdrawn = makeAnnouncement({
      id: 'w2023',
      lifecycle: 'withdrawn',
      timeline: {},
      publishedAt: '2023-05-01T02:00:00.000Z',
      firstPublishedAt: '2023-05-01T02:00:00.000Z',
    });
    const response = buildHistoryList([withdrawn], { year: 2023 }, NOW);
    expect(response.total).toBe(1);
    expect(response.items[0]!.batchYear).toBe(2023);
  });

  it('按地区代码前缀 / 学段 / 用工性质 / 关键词组合筛选', () => {
    expect(buildHistoryList(catalog, { regionCode: '32' }, NOW).total).toBe(1);
    expect(buildHistoryList(catalog, { stage: 'primary' }, NOW).total).toBe(1);
    expect(buildHistoryList(catalog, { nature: 'record_filing' }, NOW).total).toBe(1);
    expect(buildHistoryList(catalog, { keyword: '测试市教育局' }, NOW).total).toBe(2);
    expect(
      buildHistoryList(catalog, { year: 2025, regionCode: '32' }, NOW).total,
    ).toBe(0);
  });

  it('按岗位最低学历与专业范围筛选，选项来自真实数据（R06）', () => {
    const withMajor = makeAnnouncement({
      id: 'major-master',
      timeline: { registrationStart: '2024-03-01', registrationEnd: '2024-03-10' },
      unitOverrides: {
        id: 'major-master-u1',
        requirements: [
          {
            id: 'major-master-edu',
            dimension: 'education',
            description: '硕士及以上学历',
            hard: true,
            criterion: { kind: 'education', minLevel: 'master' },
            evidence: {
              id: 'major-master-edu-ev',
              locator: {
                kind: 'excerpt',
                excerpt: '具有硕士研究生及以上学历',
              },
              state: 'official',
              checkedAt: '2024-03-01T00:00:00.000Z',
            },
          },
          {
            id: 'major-master-major',
            dimension: 'major',
            description: '汉语言文学及相关专业',
            hard: true,
            criterion: { kind: 'major', majorNames: ['汉语言文学', '学科教学（语文）'] },
            evidence: {
              id: 'major-master-major-ev',
              locator: { kind: 'excerpt', excerpt: '汉语言文学及相关专业' },
              state: 'official',
              checkedAt: '2024-03-01T00:00:00.000Z',
            },
          },
        ],
      },
    });
    const all = [...catalog, withMajor];

    // 学历：精确匹配岗位最低学历，不把“本科可报硕士岗”混进来
    const bachelorOnly = buildHistoryList(all, { educationLevel: 'bachelor' }, NOW);
    expect(bachelorOnly.total).toBe(2);
    expect(
      bachelorOnly.items.every((item) => item.unitId !== 'major-master-u1'),
    ).toBe(true);
    expect(buildHistoryList(all, { educationLevel: 'master' }, NOW).total).toBe(1);

    // 专业：按公告列明范围匹配，全半角与空白差异不误伤
    expect(buildHistoryList(all, { major: '汉语言文学' }, NOW).total).toBe(1);
    expect(buildHistoryList(all, { major: '学科教学(语文)' }, NOW).total).toBe(1);
    expect(buildHistoryList(all, { major: '数学与应用数学' }, NOW).total).toBe(0);

    // 选项只来自真实数据，不预置空项
    const response = buildHistoryList(all, {}, NOW);
    expect(response.educationLevels).toEqual([
      { code: 'bachelor', label: '本科' },
      { code: 'master', label: '硕士' },
    ]);
    expect(response.availableMajors).toEqual(['汉语言文学', '学科教学（语文）']);
  });

  it('筛选后的 total 是真实结果数，与分页一致（R06）', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      makeAnnouncement({ id: `f${index}` }),
    );
    const response = buildHistoryList(
      many,
      { educationLevel: 'bachelor', page: 2, pageSize: 3 },
      NOW,
    );
    expect(response.total).toBe(7);
    expect(response.page).toBe(2);
    expect(response.items).toHaveLength(3);
    expect(buildHistoryList(many, { educationLevel: 'master' }, NOW).total).toBe(0);
  });

  it('分页：页码越界回退末页，pageSize 上限 50', () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      makeAnnouncement({ id: `p${index}` }),
    );
    const response = buildHistoryList(many, { page: 99, pageSize: 2 }, NOW);
    expect(response.total).toBe(5);
    expect(response.page).toBe(3);
    expect(response.pageSize).toBe(2);
    expect(response.items).toHaveLength(1);
    const capped = buildHistoryList(many, { pageSize: 500 }, NOW);
    expect(capped.pageSize).toBe(50);
  });

  it('样本范围说明：单年样本与多年区间均如实披露', () => {
    const single = buildHistoryList([catalog[0]!], {}, NOW);
    expect(single.years).toEqual([2025]);
    expect(single.sampleNote).toContain('目前仅收录 2025 年');
    const multi = buildHistoryList(catalog, {}, NOW);
    expect(multi.years).toEqual([2025, 2024]);
    expect(multi.sampleNote).toContain('2024—2025 年');
    expect(multi.sampleNote).toContain('不构成对本年招聘时间的推测');
  });
});

describe('往年参考：完整程度与存档说明', () => {
  it('缺面试日期时日期口径为 3/4，材料数计入完整程度', () => {
    const announcement = makeAnnouncement({
      id: 'c1',
      timeline: {
        registrationStart: '2025-04-14',
        registrationEnd: '2025-04-20',
        writtenExamDate: '2025-05-10',
      },
      materialsCount: 2,
    });
    const records = collectHistoricalUnits([announcement], NOW);
    const dto = toHistoryUnitDTO(records[0]!);
    expect(dto.completeness.knownDateCount).toBe(3);
    expect(dto.completeness.totalDateCount).toBe(4);
    expect(dto.completeness.materialCount).toBe(2);
    expect(dto.completeness.evidenceState).toBe('official');
  });

  it('含 AI 初核/待复核证据时完整程度如实标注', () => {
    const ai = collectHistoricalUnits(
      [makeAnnouncement({ id: 'c2', evidenceState: 'ai_extracted' })],
      NOW,
    );
    expect(toHistoryUnitDTO(ai[0]!).completeness.evidenceState).toBe('ai_extracted');
    const pending = collectHistoricalUnits(
      [makeAnnouncement({ id: 'c3', evidenceState: 'pending_review' })],
      NOW,
    );
    expect(toHistoryUnitDTO(pending[0]!).completeness.evidenceState).toBe(
      'pending_review',
    );
  });

  it('官方链接失效时给存档说明，正常链接为 null', () => {
    const broken = collectHistoricalUnits(
      [
        makeAnnouncement({
          id: 's1',
          sourceHealth: {
            ok: false,
            checkedAt: '2026-10-04T00:00:00.000Z',
            failReason: '404',
          },
        }),
      ],
      NOW,
    );
    const note = toHistoryUnitDTO(broken[0]!).archiveNote;
    expect(note).toContain('官方链接已失效');
    expect(note).toContain('2026-10-04');
    const healthy = collectHistoricalUnits([makeAnnouncement({ id: 's2' })], NOW);
    expect(toHistoryUnitDTO(healthy[0]!).archiveNote).toBeNull();
  });
});

describe('往年参考：详情与对照', () => {
  it('有画像时返回对照（带公告原文表述与证据），overall 来自资格条件维度', () => {
    const announcement = makeAnnouncement({ id: 'd1' });
    const detail = buildHistoryDetail([announcement], 'd1-u1', PROFILE, NOW);
    expect(detail).not.toBeNull();
    expect(detail!.comparison).not.toBeNull();
    expect(detail!.comparison!.overall).toBe('preliminary_eligible');
    expect(detail!.comparison!.computedAt).toBe(NOW.toISOString());
    const education = detail!.comparison!.dimensions.find(
      (dimension) => dimension.dimension === 'education',
    );
    expect(education?.requirementDescription).toBe('本科及以上学历');
    expect(education?.evidence?.locator).toEqual({
      kind: 'excerpt',
      excerpt: '具有国家承认的本科及以上学历',
    });
  });

  it('无画像时对照为 null，历史事实仍完整可读', () => {
    const announcement = makeAnnouncement({ id: 'd2' });
    const detail = buildHistoryDetail([announcement], 'd2-u1', null, NOW);
    expect(detail).not.toBeNull();
    expect(detail!.comparison).toBeNull();
    expect(detail!.item.unitId).toBe('d2-u1');
    expect(detail!.requirements).toHaveLength(1);
    expect(detail!.requirements[0]!.description).toBe('本科及以上学历');
  });

  it('找不到记录返回 null（服务层转 404）', () => {
    const announcement = makeAnnouncement({ id: 'd3' });
    expect(buildHistoryDetail([announcement], 'missing', PROFILE, NOW)).toBeNull();
  });
});

describe('往年参考：查询串校验', () => {
  it('合法查询通过并 trim 关键词', () => {
    const parsed = parseHistoryQuery({
      year: '2025',
      regionCode: '33',
      page: '2',
      pageSize: '10',
      keyword: ' 语文 ',
    });
    expect(parsed).toEqual({
      ok: true,
      filters: { year: 2025, regionCode: '33', page: 2, pageSize: 10, keyword: '语文' },
    });
  });

  it('空查询为默认（无筛选）', () => {
    expect(parseHistoryQuery({})).toEqual({ ok: true, filters: {} });
  });

  it.each([
    [{ year: 'abcd' }, 'year 必须是 4 位年份'],
    [{ year: '1889' }, 'year 超出可查询范围（1990—2100）'],
    [{ page: '0' }, 'page 必须是正整数'],
    [{ pageSize: '-3' }, 'pageSize 必须是正整数'],
    [{ regionCode: '33x' }, 'regionCode 必须是 2—6 位行政区划代码前缀'],
    [{ keyword: 'x'.repeat(101) }, '关键词不能超过 100 字'],
    [{ educationLevel: 'phd' }, 'educationLevel 必须是 secondary / college / bachelor / master / doctorate 之一'],
    [{ major: 'x'.repeat(51) }, '专业名称不能超过 50 字'],
  ])('非法查询被拒绝：%o', (query, message) => {
    const parsed = parseHistoryQuery(query);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toBe(message);
  });

  it('学历/专业筛选参数被正确解析（R06）', () => {
    const parsed = parseHistoryQuery({
      educationLevel: ' master ',
      major: ' 汉语言文学 ',
    });
    expect(parsed).toEqual({
      ok: true,
      filters: { educationLevel: 'master', major: '汉语言文学' },
    });
  });
});
