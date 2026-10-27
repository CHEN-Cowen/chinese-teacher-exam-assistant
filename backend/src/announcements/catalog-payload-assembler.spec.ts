/**
 * WB5：目录载荷构造器（catalog-payload-assembler）单元测试。
 *
 * 输入数据全部内联（隔离约束：src/ 不得 import tests/fixtures）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCatalogPayload,
  CatalogPayloadError,
  type CatalogDataset,
} from './catalog-payload-assembler.js';
import type { ExtractionCandidate } from './domain.js';
import type { CandidateField } from './domain.js';
import { projectCatalogVersion } from '../catalog/publication-projector.js';

function anchoredJob(
  field: string,
  value: string,
  jobKey: string,
  extra: Partial<CandidateField> = {},
): CandidateField {
  return {
    field,
    value,
    status: 'extracted',
    scope: 'job',
    jobScope: { key: jobKey },
    decision: { action: 'adopt', reason: '审核采纳', operatorId: 'r1', decidedAt: '2026-10-20T00:00:00.000Z' },
    anchor: { field, locator: { kind: 'excerpt', excerpt: `${field}原文` } },
    origin: 'rule',
    ...extra,
  };
}

function anchoredAnn(
  field: string,
  value: string,
  extra: Partial<CandidateField> = {},
): CandidateField {
  return {
    field,
    value,
    status: 'extracted',
    scope: 'announcement',
    decision: { action: 'adopt', reason: '审核采纳', operatorId: 'r1', decidedAt: '2026-10-20T00:00:00.000Z' },
    anchor: { field, locator: { kind: 'excerpt', excerpt: `${field}原文` } },
    origin: 'rule',
    ...extra,
  };
}

function makeCandidate(fields: CandidateField[]): ExtractionCandidate {
  return { fields, parserVersion: 'extract-v2' };
}

function makeMetadata(overrides: Partial<any> = {}): any {
  return {
    announcementId: 'ann-1',
    publisher: '示例市教育局',
    officialUrl: 'https://www.example.gov.cn/test/notice',
    regionCode: '330100',
    dataset: 'test' as CatalogDataset,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<any> = {}): any {
  return {
    versionId: 'ann-1-v1',
    versionNumber: 1,
    sourceKind: 'original',
    publishedAt: '2026-10-20T02:00:00.000Z',
    ...overrides,
  };
}

/** 两个已审核岗位的最小合法字段集 */
function twoJobsFields(): CandidateField[] {
  return [
    anchoredAnn('announcement_title', '【测试】示例市教育局2026年招聘公告'),
    anchoredAnn('region', '浙江省杭州市'),
    anchoredAnn('registration_time', '2026-10-20 至 2026-11-05 17:00'),
    // 岗位 A
    anchoredJob('job_code', '3301A01', 'job-A-3301A01'),
    anchoredJob('unit_name', '示例市第一中学', 'job-A-3301A01'),
    anchoredJob('stage', '初中', 'job-A-3301A01'),
    anchoredJob('subject', '语文', 'job-A-3301A01'),
    anchoredJob('headcount', '2', 'job-A-3301A01'),
    anchoredJob('major', '汉语言文学（师范）', 'job-A-3301A01'),
    anchoredJob('education', '本科及以上', 'job-A-3301A01'),
    anchoredJob('employment_nature', '事业编制', 'job-A-3301A01'),
    // 岗位 B
    anchoredJob('job_code', '3301A02', 'job-B-3301A02'),
    anchoredJob('unit_name', '示例市第二中学', 'job-B-3301A02'),
    anchoredJob('stage', '高中', 'job-B-3301A02'),
    anchoredJob('subject', '语文', 'job-B-3301A02'),
    anchoredJob('headcount', '1', 'job-B-3301A02'),
    anchoredJob('major', '数学与应用数学', 'job-B-3301A02'),
    anchoredJob('education', '硕士研究生及以上', 'job-B-3301A02'),
    anchoredJob('employment_nature', '事业编制', 'job-B-3301A02'),
  ];
}

describe('S2 正式发布与岗位完善', () => {
  it('正式数据缺复核身份不得发布', () => {
    expect(() => buildCatalogPayload(makeCandidate(twoJobsFields()),
      makeMetadata({ dataset: 'real' }), makeCtx())).toThrow(/复核/);
  });

  it('报名时间只有一个明确日期时按上下文分类：截止语义记为 registrationEnd，不臆造开始日', () => {
    const fields = [
      ...twoJobsFields().filter((f) => f.field !== 'registration_time'),
      // 宁波 2026 实例：官方正文只写「自公告发布之日至2026年7月16日」
      anchoredAnn('registration_time', '自公告发布之日至2026年7月16日'),
    ];
    const timeline = buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx())
      .version.timeline;
    expect(timeline.registrationEnd).toBe('2026-07-16');
    expect(timeline.registrationStart).toBeUndefined();
    // 对照：无截止语义的单日期仍是开始日
    const startOnly = buildCatalogPayload(
      makeCandidate([
        ...twoJobsFields().filter((f) => f.field !== 'registration_time'),
        anchoredAnn('registration_time', '2026年7月13日开始'),
      ]),
      makeMetadata(),
      makeCtx(),
    ).version.timeline;
    expect(startOnly.registrationStart).toBe('2026-07-13');
    expect(startOnly.registrationEnd).toBeUndefined();
  });

  it('公共资格继承、岗位资格覆盖且各项保留证据，复杂条件人工确认', () => {
    const fields = twoJobsFields().filter((f) => f.field !== 'education');
    fields.push(anchoredAnn('education', '本科及以上'),
      anchoredJob('education', '仅硕士', 'job-B-3301A02'),
      anchoredAnn('teacher_cert', '具有相应教师资格证'),
      anchoredAnn('age', '35周岁以下，博士可放宽'),
      anchoredAnn('age_basis_date', '2026-10-01'),
      anchoredAnn('degree', '学士学位'),
      anchoredAnn('hukou', '不限'),
      anchoredAnn('work_experience', '两年相关经历'));
    const units = buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()).version.units;
    expect(units[0]!.requirements.find((r) => r.dimension === 'education')!.criterion)
      .toEqual({ kind: 'education', minLevel: 'bachelor' });
    expect(units[1]!.requirements.find((r) => r.dimension === 'education')!.criterion)
      .toEqual({ kind: 'other', manualReview: true });
    for (const unit of units) {
      expect(unit.requirements.map((r) => r.dimension)).toEqual(expect.arrayContaining(['age', 'teacher_cert', 'degree', 'hukou', 'work_experience']));
      expect(unit.requirements.every((r) => !!r.evidence.locator)).toBe(true);
    }
  });

  it('招聘机构与岗位区县独立，未知用工不猜事业编，保留多来源证据', () => {
    const fields = twoJobsFields();
    const region = anchoredJob('region', JSON.stringify({ code: '330106', province: '浙江省', city: '杭州市', district: '西湖区' }), 'job-A-3301A01');
    region.anchor = { field: 'region', locator: { kind: 'url', url: 'https://www.example.gov.cn/a', anchor: 'job-a' }, locatorData: { snapshotId: 'snap-1' } };
    region.anchors = [region.anchor, { field: 'region', locator: { kind: 'worksheet', fileId: 'f1', fileName: '岗位表.xlsx', sheet: '岗位', cell: 'A2' } }];
    fields.push(region);
    fields.find((f) => f.field === 'employment_nature')!.value = '未说明';
    const [a, b] = buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()).version.units;
    expect(a!.region.district).toBe('西湖区');
    expect(b!.region.district).toBeUndefined();
    expect(a!.recruitmentOrganization).toBe('示例市第一中学');
    expect(a!.employmentNature).toEqual({ code: 'other', officialName: '未说明' });
    const evidence = Object.values(a!.fieldEvidence!).flat();
    expect(evidence.some((e) => e.locator.kind === 'url' && e.locator.anchor === 'job-a' && e.locatorData?.snapshotId === 'snap-1')).toBe(true);
    expect(evidence.some((e) => e.locator.kind === 'worksheet' && e.locator.cell === 'A2')).toBe(true);
    expect(a!.allocation.code).toBe('other');
    const payload = buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx());
    const projected = projectCatalogVersion({ id: 'ann-1-v1', announcementId: 'ann-1', versionNumber: 1, status: 'published', payload }, new Date());
    expect(projected.version.units[0]!.fieldEvidence).toEqual(a!.fieldEvidence);
    expect(projected.version.units[0]!.recruitmentOrganization).toBe(a!.recruitmentOrganization);
  });

  it('只有其他学科或学科不明确不能发布语文机会', () => {
    for (const value of ['数学', '语文或英语']) {
      const fields = twoJobsFields().map((f) => f.field === 'subject' ? { ...f, value } : f);
      expect(() => buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx())).toThrow(CatalogPayloadError);
    }
  });
});

describe('buildCatalogPayload：合法构造', () => {
  it('两个已审核岗位构成两个 units，projector 可接受的结构', () => {
    const payload = buildCatalogPayload(
      makeCandidate(twoJobsFields()),
      makeMetadata(),
      makeCtx(),
    );

    expect(payload.dataset).toBe('test');
    expect(payload.announcement.id).toBe('ann-1');
    expect(payload.announcement.publisher).toBe('示例市教育局');
    expect(payload.announcement.officialUrl).toBe('https://www.example.gov.cn/test/notice');
    expect(payload.version.units).toHaveLength(2);

    const [a, b] = payload.version.units;
    expect(a!.code).toBe('3301A01');
    expect(b!.code).toBe('3301A02');
    // unit id 稳定且与公告版本一致（id 前缀包含公告 id）
    expect(a!.id.startsWith('ann-1-unit-')).toBe(true);
    expect(a!.versionId).toBe('ann-1-v1');
  });

  it('第二个岗位字段不混入第一个岗位（major/education 各自独立）', () => {
    const payload = buildCatalogPayload(
      makeCandidate(twoJobsFields()),
      makeMetadata(),
      makeCtx(),
    );

    const [a, b] = payload.version.units;
    const aMajor = a!.requirements.find((r) => r.dimension === 'major');
    const bMajor = b!.requirements.find((r) => r.dimension === 'major');
    expect(aMajor!.description).toBe('汉语言文学（师范）');
    expect(bMajor!.description).toBe('数学与应用数学');

    const aEdu = a!.requirements.find((r) => r.dimension === 'education');
    const bEdu = b!.requirements.find((r) => r.dimension === 'education');
    expect(aEdu!.criterion).toEqual({ kind: 'education', minLevel: 'bachelor' });
    expect(bEdu!.criterion).toEqual({ kind: 'education', minLevel: 'master' });
  });

  it('real dataset 附带 human_reviewed 与复核人', () => {
    const payload = buildCatalogPayload(
      makeCandidate([...twoJobsFields(), anchoredAnn('teacher_cert', '具有相应教师资格'), anchoredAnn('age', '35周岁及以下')]),
      makeMetadata({ dataset: 'real', reviewedBy: 'reviewer-9', reviewedAt: '2026-10-20T01:00:00.000Z' }),
      makeCtx(),
    );
    expect(payload.dataset).toBe('real');
    expect(payload.announcement.reviewStatus).toBe('human_reviewed');
    expect(payload.announcement.reviewedBy).toBe('reviewer-9');
  });
});

describe('buildCatalogPayload：结构化失败（不猜值、不编默认）', () => {
  it('缺发布主体 → CatalogPayloadError', () => {
    expect(() =>
      buildCatalogPayload(
        makeCandidate(twoJobsFields()),
        makeMetadata({ publisher: '' }),
        makeCtx(),
      ),
    ).toThrow(CatalogPayloadError);
  });

  it('缺官方 URL → CatalogPayloadError', () => {
    expect(() =>
      buildCatalogPayload(
        makeCandidate(twoJobsFields()),
        makeMetadata({ officialUrl: '' }),
        makeCtx(),
      ),
    ).toThrow(CatalogPayloadError);
  });

  it('缺公告标题（不猜 URL）→ CatalogPayloadError', () => {
    const fields = twoJobsFields().filter((f) => f.field !== 'announcement_title');
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
  });

  it('缺地区（region 且 regionCode 都无）→ CatalogPayloadError', () => {
    const fields = twoJobsFields().filter((f) => f.field !== 'region');
    expect(() =>
      buildCatalogPayload(
        makeCandidate(fields),
        makeMetadata({ regionCode: undefined }),
        makeCtx(),
      ),
    ).toThrow(CatalogPayloadError);
  });

  it('岗位缺招聘人数 → CatalogPayloadError', () => {
    const fields = twoJobsFields().filter(
      (f) => !(f.field === 'headcount' && f.scope === 'job'),
    );
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
  });

  it('岗位缺用工性质 → CatalogPayloadError（不编默认）', () => {
    const fields = twoJobsFields().filter((f) => f.field !== 'employment_nature');
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
  });

  it('无任何已审核岗位 → CatalogPayloadError', () => {
    const fields = twoJobsFields().filter((f) => f.scope !== 'job');
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
  });

  it('混合学科只发布语文，其他学科保留在候选归档', () => {
    const fields = twoJobsFields();
    const subjectB = fields.find((f) => f.field === 'subject' && f.scope === 'job' && f.jobScope?.key === 'job-B-3301A02');
    subjectB!.value = '数学';
    const result = buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx());
    expect(result.version.units).toHaveLength(1);
    expect(result.version.units[0]!.subject).toBe('chinese');
    expect(fields.find((f) => f === subjectB)?.value).toBe('数学');
  });
});

describe('buildCatalogPayload：unknown/conflict/pending/未确认不得进入', () => {
  it('conflict 字段（headcount）→ 不进入，因缺 headcount 失败', () => {
    const fields = twoJobsFields().map((f) => {
      if (f.field === 'headcount' && f.scope === 'job' && f.jobScope?.key === 'job-A-3301A01') {
        return {
          ...f,
          status: 'conflict' as const,
          decision: undefined,
          alternatives: [
            { value: '2', source: { kind: 'excerpt' as const, excerpt: 'x' } },
            { value: '3', source: { kind: 'excerpt' as const, excerpt: 'y' } },
          ],
        };
      }
      return f;
    });
    // conflict 的 headcount 不再是 extracted，被 adoptedJobValue 排除 → 缺 headcount 失败
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
  });

  it('pending 决策的字段不进入（缺对应岗位必需字段则失败）', () => {
    const fields = twoJobsFields().map((f) => {
      if (f.field === 'headcount' && f.scope === 'job' && f.jobScope?.key === 'job-A-3301A01') {
        return { ...f, decision: { action: 'pending' as const, reason: '待确认', operatorId: 'r1', decidedAt: 'x' } };
      }
      return f;
    });
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
  });
});
