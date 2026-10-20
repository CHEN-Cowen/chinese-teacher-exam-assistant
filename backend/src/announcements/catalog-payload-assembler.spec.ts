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
      makeCandidate(twoJobsFields()),
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

  it('学科非语文（不在开放范围）→ CatalogPayloadError', () => {
    const fields = twoJobsFields();
    const subjectB = fields.find((f) => f.field === 'subject' && f.scope === 'job' && f.jobScope?.key === 'job-B-3301A02');
    subjectB!.value = '数学';
    expect(() =>
      buildCatalogPayload(makeCandidate(fields), makeMetadata(), makeCtx()),
    ).toThrow(CatalogPayloadError);
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
