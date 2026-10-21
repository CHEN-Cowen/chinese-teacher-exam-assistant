/**
 * M2：期望清单（固定分母）与遗漏检测——纯函数测试。
 *
 * 覆盖提示词 M2-01 ~ M2-08 的可纯函数验证部分：
 * - M2-01：删除一个输出字段 → 期望数不变、遗漏 +1；
 * - M2-02：删除整个岗位输出 → 该岗位仍列出，缺失槽位可见；
 * - M2-03：重复字段/同槽多证据/冲突 alternatives → 分子不重复、比例不超 100%；
 * - M2-04：公共字段不按岗位数量重复计分；scope 不明待确认；
 * - M2-05：原文未明示 / 不适用 / 不可读分别显示，不能互换；
 * - M2-06：修改清单生成新版本，旧结果分母不被追溯修改；
 * - M2-07：旧任务无清单 → 明确「未建立固定分母，完整性未评估」；
 * - M2-08：同一口径可人工复算（指标逐项可数）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  computeSlotMetrics,
  evaluateChecklist,
  fixedDenominatorCompleteness,
  isRetrospective,
  type ExpectedChecklist,
  type SlotResult,
} from './expected-checklist.js';

function frozen() {
  return { frozenBy: 'admin-1', frozenAt: '2026-10-21T10:00:00.000Z' };
}

/** 两个岗位的独立清单 */
function twoJobChecklist(overrides?: {
  applicabilityOverrides?: Parameters<typeof buildChecklist>[0]['applicabilityOverrides'];
}): ExpectedChecklist {
  return buildChecklist({
    snapshotId: 'snap-1',
    inputHash: 'hash-abc',
    source: 'independent',
    jobs: [
      { key: 'job-A-3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 },
      { key: 'job-B-3301A02', jobCode: '3301A02', sheet: '岗位表', row: 3 },
    ],
    ...overrides,
    ...frozen(),
  });
}

/** 构造一个岗位的候选字段（仅含业务相关字段） */
function jobCandidate(
  jobKey: string,
  fields: Array<{ field: string; value: string; status?: string }>,
) {
  return fields.map((f) => ({
    field: f.field,
    value: f.value,
    scope: 'job' as const,
    jobScope: { key: jobKey },
    status: f.status ?? 'extracted',
  }));
}

/** 公告公共候选（最小） */
function annCandidate(
  fields: Array<{ field: string; value: string; status?: string }>,
) {
  return fields.map((f) => ({
    field: f.field,
    value: f.value,
    scope: 'announcement' as const,
    status: f.status ?? 'extracted',
  }));
}

// ==================== M2-01：删除一个输出字段 → 遗漏 +1 ====================

describe('M2-01 整项字段漏抽：期望数不变、遗漏 +1', () => {
  it('删除岗位某字段候选后，该槽位判 should_have_but_missing，有效分母不变', () => {
    const checklist = twoJobChecklist();

    // 岗位 A 完整字段，但 headcount 被删除（模拟「整项字段漏抽」）
    const jobAWithoutHeadcount = jobCandidate('job-A-3301A01', [
      { field: 'job_code', value: '3301A01' },
      { field: 'unit_name', value: '示例市第一中学' },
      { field: 'stage', value: '初中' },
      { field: 'subject', value: '语文' },
      // headcount 被删除
      { field: 'education', value: '本科及以上' },
      { field: 'major', value: '汉语言文学（师范）' },
    ]);
    // 岗位 B 完整字段（含 headcount），用于对照
    const jobBFull = jobCandidate('job-B-3301A02', [
      { field: 'job_code', value: '3301A02' },
      { field: 'unit_name', value: '示例市第二中学' },
      { field: 'stage', value: '高中' },
      { field: 'subject', value: '数学' },
      { field: 'headcount', value: '1' },
      { field: 'education', value: '硕士研究生及以上' },
      { field: 'major', value: '数学与应用数学' },
    ]);

    const evaluation = evaluateChecklist(checklist, [...jobAWithoutHeadcount, ...jobBFull]);

    // 岗位 A 的 headcount 槽位 → 应有未提取（遗漏 +1）
    const jobA = evaluation.jobs.find((j) => j.key === 'job-A-3301A01')!;
    const headcountA = jobA.results.find((r) => r.field === 'headcount')!;
    expect(headcountA.status).toBe('should_have_but_missing');

    // 岗位 B 的 headcount 仍为 extracted（对照）
    const jobB = evaluation.jobs.find((j) => j.key === 'job-B-3301A02')!;
    const headcountB = jobB.results.find((r) => r.field === 'headcount')!;
    expect(headcountB.status).toBe('extracted');

    // 有效分母不因「候选里缺 headcount」而缩小：岗位 A 与岗位 B 的槽位总数相同
    const jobASlots = checklist.jobs[0]!.slots.length;
    const jobBSlots = checklist.jobs[1]!.slots.length;
    expect(jobASlots).toBe(jobBSlots);
    expect(jobA.results.length).toBe(jobASlots);
    // 岗位 A 的 headcount 槽位仍然存在（不被候选反推删除）
    expect(jobA.results.some((r) => r.field === 'headcount')).toBe(true);
  });
});

// ==================== M2-02：删除整个岗位输出 ====================

describe('M2-02 整岗位漏抽：仍列出该岗位及其缺失槽位', () => {
  it('候选只含岗位 A 时，岗位 B 仍出现在评估结果，且其全部槽位判缺失', () => {
    const checklist = twoJobChecklist();
    const onlyJobA = jobCandidate('job-A-3301A01', [
      { field: 'job_code', value: '3301A01' },
      { field: 'unit_name', value: '示例市第一中学' },
      { field: 'stage', value: '初中' },
      { field: 'subject', value: '语文' },
      { field: 'headcount', value: '2' },
      { field: 'education', value: '本科及以上' },
      { field: 'major', value: '汉语言文学（师范）' },
    ]);

    const evaluation = evaluateChecklist(checklist, onlyJobA);

    // 岗位 B 仍被列出
    const jobB = evaluation.jobs.find((j) => j.key === 'job-B-3301A02');
    expect(jobB).toBeDefined();
    // 岗位 B 所有槽位判「应有未提取」
    const allMissing = jobB!.results.every((r) => r.status === 'should_have_but_missing');
    expect(allMissing).toBe(true);
    expect(jobB!.results.length).toBeGreaterThan(0);
  });
});

// ==================== M2-03：重复/冲突不抬高分子 ====================

describe('M2-03 重复字段、同槽多证据、冲突 alternatives：分子不重复、比例不超 100%', () => {
  it('同槽重复候选与 conflict alternatives 不抬高分子', () => {
    const checklist = twoJobChecklist();
    // 岗位 A 的 headcount 出现冲突（带 alternatives），且 headcount 字段被重复给出
    const fields = [
      ...jobCandidate('job-A-3301A01', [
        { field: 'job_code', value: '3301A01' },
        { field: 'unit_name', value: '示例市第一中学' },
        { field: 'stage', value: '初中' },
        { field: 'subject', value: '语文' },
        { field: 'education', value: '本科及以上' },
        { field: 'major', value: '汉语言文学（师范）' },
      ]),
      // headcount 冲突（重复候选，同一 identity）
      {
        field: 'headcount',
        value: '2',
        scope: 'job' as const,
        jobScope: { key: 'job-A-3301A01' },
        status: 'conflict',
        alternatives: [{ value: '2' }, { value: '3' }],
      },
      {
        field: 'headcount',
        value: '2',
        scope: 'job' as const,
        jobScope: { key: 'job-A-3301A01' },
        status: 'extracted',
      },
      ...jobCandidate('job-B-3301A02', [
        { field: 'job_code', value: '3301A02' },
        { field: 'unit_name', value: '示例市第二中学' },
        { field: 'stage', value: '高中' },
        { field: 'subject', value: '数学' },
        { field: 'headcount', value: '1' },
        { field: 'education', value: '硕士研究生及以上' },
        { field: 'major', value: '数学与应用数学' },
      ]),
    ];

    const evaluation = evaluateChecklist(checklist, fields);

    // 岗位 A headcount 槽位只有 1 个结果（去重）
    const jobA = evaluation.jobs.find((j) => j.key === 'job-A-3301A01')!;
    const headcounts = jobA.results.filter((r) => r.field === 'headcount');
    expect(headcounts).toHaveLength(1);
    expect(headcounts[0]!.status).toBe('conflict');
    expect(headcounts[0]!.alternativeCount).toBe(2);

    // 比例不超 100%：extracted ≤ 有效分母
    const comp = fixedDenominatorCompleteness(evaluation)!;
    expect(comp).toBeLessThanOrEqual(1);
  });
});

// ==================== M2-04：公共字段不按岗位重复计分 ====================

describe('M2-04 公共字段不按岗位数量重复计分', () => {
  it('公告公共字段每个只计一次，不随岗位数翻倍', () => {
    const checklist = twoJobChecklist();
    const fields = [
      ...annCandidate([
        { field: 'region', value: '杭州市' },
        { field: 'employment_nature', value: '事业编制' },
        { field: 'registration_time', value: '2026-10-20' },
        { field: 'official_entry', value: 'https://example.gov.cn' },
        { field: 'batch', value: 'wb-batch-2026-01' },
      ]),
      ...jobCandidate('job-A-3301A01', [
        { field: 'job_code', value: '3301A01' },
        { field: 'unit_name', value: '示例市第一中学' },
        { field: 'stage', value: '初中' },
        { field: 'subject', value: '语文' },
        { field: 'headcount', value: '2' },
        { field: 'education', value: '本科及以上' },
        { field: 'major', value: '汉语言文学（师范）' },
      ]),
      ...jobCandidate('job-B-3301A02', [
        { field: 'job_code', value: '3301A02' },
        { field: 'unit_name', value: '示例市第二中学' },
        { field: 'stage', value: '高中' },
        { field: 'subject', value: '数学' },
        { field: 'headcount', value: '1' },
        { field: 'education', value: '硕士研究生及以上' },
        { field: 'major', value: '数学与应用数学' },
      ]),
    ];

    const evaluation = evaluateChecklist(checklist, fields);
    // 公共 region 槽位只有一个结果
    const regionSlots = evaluation.announcement.filter((r) => r.field === 'region');
    expect(regionSlots).toHaveLength(1);
    expect(regionSlots[0]!.status).toBe('extracted');
  });
});

// ==================== M2-05：未明示/不适用/不可读分别显示 ====================

describe('M2-05 原文未明示 / 不适用 / 不可读分别显示，不能互换', () => {
  it('unknown 候选 → not_stated_in_source；声明不适用 → not_applicable；来源不可核验 → source_missing_unverifiable', () => {
    const checklist = twoJobChecklist({
      applicabilityOverrides: [
        { field: 'age_basis_date', applicability: 'not_applicable', basis: '本批次无统一年龄基准日' },
      ],
    });

    const fields = [
      ...annCandidate([
        { field: 'region', value: '杭州市' },
        // degree 岗位 B 未写明 → unknown
      ]),
      ...jobCandidate('job-A-3301A01', [
        { field: 'job_code', value: '3301A01' },
        { field: 'unit_name', value: '示例市第一中学' },
        { field: 'stage', value: '初中' },
        { field: 'subject', value: '语文' },
        { field: 'headcount', value: '2' },
        { field: 'education', value: '本科及以上' },
        { field: 'major', value: '汉语言文学（师范）' },
      ]),
      ...jobCandidate('job-B-3301A02', [
        { field: 'job_code', value: '3301A02' },
        { field: 'unit_name', value: '示例市第二中学' },
        { field: 'stage', value: '高中' },
        { field: 'subject', value: '数学' },
        { field: 'headcount', value: '1' },
        { field: 'education', value: '硕士研究生及以上' },
        { field: 'major', value: '数学与应用数学' },
        { field: 'degree', value: '', status: 'unknown' }, // 原文未明示
      ]),
    ];

    // 来源可核验：岗位 B degree unknown → not_stated_in_source
    const evaluation = evaluateChecklist(checklist, fields);
    const jobB = evaluation.jobs.find((j) => j.key === 'job-B-3301A02')!;
    const degree = jobB.results.find((r) => r.field === 'degree')!;
    expect(degree.status).toBe('not_stated_in_source');

    // age_basis_date 声明不适用 → not_applicable
    const ageBasis = evaluation.announcement.find((r) => r.field === 'age_basis_date')!;
    expect(ageBasis.status).toBe('not_applicable');

    // 来源不可核验（岗位 B 来源缺失）→ source_missing_unverifiable
    const unverifiableEval = evaluateChecklist(
      checklist,
      fields,
      { unverifiableScopes: new Set(['job:job-B-3301A02']) },
    );
    const jobBUnver = unverifiableEval.jobs.find((j) => j.key === 'job-B-3301A02')!;
    // 未提供候选的字段（如 teacher_cert）→ source_missing_unverifiable（而非 should_have_but_missing）
    const teacherCert = jobBUnver.results.find((r) => r.field === 'teacher_cert')!;
    expect(teacherCert.status).toBe('source_missing_unverifiable');

    // 三种状态互不混用
    expect(degree.status).not.toBe('should_have_but_missing');
    expect(ageBasis.status).not.toBe('source_missing_unverifiable');
    expect(teacherCert.status).not.toBe('not_stated_in_source');
  });
});

// ==================== M2-06：修改清单生成新版本 ====================

describe('M2-06 修改清单生成新版本，旧结果分母不被追溯修改', () => {
  it('清单版本可递增，评估携带版本号，旧清单对象不被修改', () => {
    const v1 = twoJobChecklist();
    // 冻结 v1 后，人为「改」成 v2（模拟新版本）：增加一个岗位
    const v2: ExpectedChecklist = {
      ...v1,
      version: 2,
      jobs: [
        ...v1.jobs,
        {
          key: 'job-C-3301A03',
          jobCode: '3301A03',
          sheet: '岗位表',
          row: 4,
          slots: v1.jobs[0]!.slots.map((s) => ({ ...s, jobKey: 'job-C-3301A03' })),
        },
      ],
    };

    // 评估 v1 时，岗位数仍为 2（旧结果不被追溯修改）
    const evalV1 = evaluateChecklist(v1, []);
    expect(evalV1.checklistVersion).toBe(1);
    expect(evalV1.jobs).toHaveLength(2);

    // 评估 v2 时，岗位数为 3
    const evalV2 = evaluateChecklist(v2, []);
    expect(evalV2.checklistVersion).toBe(2);
    expect(evalV2.jobs).toHaveLength(3);

    // v1 原始对象未被 v2 修改
    expect(v1.version).toBe(1);
    expect(v1.jobs).toHaveLength(2);
  });
});

// ==================== M2-07：旧任务无清单 ====================

describe('M2-07 旧任务无清单：明确未评估', () => {
  it('无清单时 hasChecklist=false，完整性返回 null（未评估）', () => {
    const evaluation = evaluateChecklist(null, [
      { field: 'education', value: '本科', scope: 'announcement', status: 'extracted' },
    ]);
    expect(evaluation.hasChecklist).toBe(false);
    expect(evaluation.slots).toHaveLength(0);
    expect(fixedDenominatorCompleteness(evaluation)).toBeNull();
  });
});

// ==================== M2-08：同一口径可人工复算 ====================

describe('M2-08 指标同一口径，可人工复算', () => {
  it('rawSlots / notApplicable / effectiveDenominator / 各状态计数逐项可数', () => {
    const checklist = twoJobChecklist();
    const fields = [
      ...annCandidate([{ field: 'region', value: '杭州市' }]),
      ...jobCandidate('job-A-3301A01', [
        { field: 'job_code', value: '3301A01' },
        { field: 'unit_name', value: '示例市第一中学' },
        { field: 'stage', value: '初中' },
        { field: 'subject', value: '语文' },
        { field: 'headcount', value: '2' },
        { field: 'education', value: '本科及以上' },
        { field: 'major', value: '汉语言文学（师范）' },
      ]),
      ...jobCandidate('job-B-3301A02', [
        { field: 'job_code', value: '3301A02' },
        { field: 'unit_name', value: '示例市第二中学' },
        { field: 'stage', value: '高中' },
        { field: 'subject', value: '数学' },
        { field: 'headcount', value: '1' },
        { field: 'education', value: '硕士研究生及以上' },
        { field: 'major', value: '数学与应用数学' },
      ]),
    ];

    const evaluation = evaluateChecklist(checklist, fields);
    const m = evaluation.metrics;

    // rawSlots = 公告槽位数 + 岗位A槽位数 + 岗位B槽位数
    expect(m.rawSlots).toBe(
      checklist.announcementSlots.length +
        checklist.jobs[0]!.slots.length +
        checklist.jobs[1]!.slots.length,
    );
    expect(m.notApplicable).toBe(0);
    expect(m.effectiveDenominator).toBe(m.rawSlots);

    // 逐状态计数之和 == 槽位总数
    const statusSum = Object.values(m.byStatus).reduce((a, b) => a + b, 0);
    expect(statusSum).toBe(m.rawSlots);

    // extracted 数可数：公告 1（region）+ 岗位A 7 + 岗位B 7 = 15
    expect(m.extracted).toBe(15);
    // missing = 其余 applicable 槽位未提供
    expect(m.missing).toBe(m.effectiveDenominator - m.extracted);
  });

  it('computeSlotMetrics 独立可复算', () => {
    const slots: SlotResult[] = [
      { field: 'a', scope: 'announcement', declaredApplicability: 'applicable', status: 'extracted', value: '1' },
      { field: 'b', scope: 'announcement', declaredApplicability: 'applicable', status: 'should_have_but_missing' },
      { field: 'c', scope: 'announcement', declaredApplicability: 'not_applicable', status: 'not_applicable' },
      { field: 'd', scope: 'announcement', declaredApplicability: 'applicable', status: 'conflict', value: '2', alternativeCount: 2 },
    ];
    const m = computeSlotMetrics(slots);
    expect(m.rawSlots).toBe(4);
    expect(m.notApplicable).toBe(1);
    expect(m.effectiveDenominator).toBe(3);
    expect(m.extracted).toBe(1);
    expect(m.missing).toBe(1);
    expect(m.byStatus.conflict).toBe(1);
  });

  it('isRetrospective 区分回顾性核对与独立基准', () => {
    expect(isRetrospective(twoJobChecklist())).toBe(false);
    const retro = buildChecklist({
      snapshotId: 'snap-1',
      inputHash: 'hash-abc',
      source: 'retrospective',
      jobs: [{ key: 'job-A' }],
      ...frozen(),
    });
    expect(isRetrospective(retro)).toBe(true);
  });
});
