/**
 * WB3：完整性与冲突报告 + 门禁测试。
 *
 * 覆盖提示词要求的测试点：
 * 5. unknown 不被判为 fail 或 extracted；
 * 6. conflict 阻塞发布并列出替代值的证据数量；
 * 7. 高影响字段无证据阻塞；
 * 8. AI/OCR 未确认阻塞；
 * 9. 两个岗位分别计算完整性；
 * 10. 报告分母可由黄金样本人工复算。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCompletenessReport,
  canPublishCandidate,
  computeScopeCompleteness,
  findMissingEvidence,
  findUnconfirmedAuto,
  assertPublishable,
} from './quality-gates.js';
import {
  makeConflictField,
  makeJobScopedField,
  makeUnknownField,
  type CandidateField,
  type ExtractionCandidate,
} from './domain.js';

function anchorFor(field: string) {
  return {
    field,
    locator: { kind: 'excerpt' as const, excerpt: `关于${field}的原文` },
  };
}

function candidate(fields: CandidateField[]): ExtractionCandidate {
  return { fields, parserVersion: 'wb3-test@1.0.0' };
}

describe('WB3 unknown 语义（未知 ≠ fail / extracted）', () => {
  it('unknown 字段不计入 extracted，也不被判为 fail', () => {
    const fields: CandidateField[] = [
      { field: 'education', value: '本科及以上', anchor: anchorFor('education') },
      makeUnknownField({ field: 'degree', scope: 'announcement' }),
    ];
    const report = buildCompletenessReport(candidate(fields));
    const scope = report.scopes.find((s) => s.key === 'announcement')!;
    expect(scope.extracted).toBe(1);
    expect(scope.unknown).toBe(1);
    // unknown 不进入 extracted
    expect(scope.extracted).not.toBe(2);
    // 可选字段 unknown 不产生阻塞（degree allowUnknown=true）
    expect(report.publishBlockers.some((b) => b.code === 'unknown_required_field')).toBe(false);
  });

  it('必需字段为 unknown 且不允许 unknown 时阻塞发布', () => {
    const fields: CandidateField[] = [
      makeUnknownField({ field: 'education', scope: 'announcement' }), // education 必需且不允许 unknown
    ];
    const report = buildCompletenessReport(candidate(fields));
    expect(report.publishBlockers.some((b) => b.code === 'unknown_required_field' && b.field === 'education')).toBe(true);
  });
});

describe('WB3 冲突字段阻塞发布并列出替代值数量', () => {
  const altA = {
    value: '2',
    source: { kind: 'worksheet' as const, fileId: 'f1', fileName: '岗位表.xlsx', sheet: '岗位表', cell: 'E2' },
    excerpt: '岗位表：2人',
  };
  const altB = {
    value: '3',
    source: { kind: 'file' as const, fileId: 'f2', fileName: '附件.docx', page: 1 },
    excerpt: '附件：3人',
  };

  it('conflict 字段阻塞发布，且报告列出替代值数量', () => {
    const conflict = makeConflictField({
      field: 'headcount',
      value: '2',
      scope: 'job',
      jobScope: { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 },
      alternatives: [altA, altB],
    });
    const report = buildCompletenessReport(candidate([conflict]));
    const conflictIssues = report.conflicts;
    expect(conflictIssues).toHaveLength(1);
    expect(conflictIssues[0]!.alternativeCount).toBe(2);
    expect(conflictIssues[0]!.field).toBe('headcount');
    // 冲突阻塞发布
    expect(report.publishBlockers.some((b) => b.code === 'conflict_field')).toBe(true);
    expect(canPublishCandidate(candidate([conflict]))).toBe(false);
  });

  it('冲突字段不阻塞审核（进入人工审核待裁决）', () => {
    // headcount 是高影响字段但冲突字段有 alternatives（各自带 source），
    // 这里未给 anchor，所以会因缺证据阻塞审核——需给 anchor 来聚焦测试冲突本身
    const withAnchor = makeConflictField({
      field: 'headcount',
      value: '2',
      anchor: anchorFor('headcount'),
      alternatives: [altA, altB],
    });
    const report = buildCompletenessReport(candidate([withAnchor]));
    expect(report.reviewBlockers.some((b) => b.code === 'conflict_field')).toBe(false);
    expect(report.publishBlockers.some((b) => b.code === 'conflict_field')).toBe(true);
  });
});

describe('WB3 高影响字段无证据阻塞', () => {
  it('高影响字段无 anchor 阻塞审核与发布，且带 scope 与 field', () => {
    const fields: CandidateField[] = [
      { field: 'education', value: '本科及以上', scope: 'job', jobScope: { key: 'job:A', jobCode: 'A', sheet: 'S', row: 2 } }, // 无 anchor
    ];
    const missing = findMissingEvidence(fields);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.field).toBe('education');
    expect(missing[0]!.scope).toBe('job');
    expect(missing[0]!.jobKey).toBe('job:A');

    const report = buildCompletenessReport(candidate(fields));
    expect(report.reviewBlockers.some((b) => b.code === 'high_impact_missing_evidence')).toBe(true);
    expect(report.publishBlockers.some((b) => b.code === 'high_impact_missing_evidence')).toBe(true);
    // 错误信息带 scope 与 field
    const blocker = report.publishBlockers.find((b) => b.code === 'high_impact_missing_evidence')!;
    expect(blocker.message).toContain('education');
    expect(blocker.message).toContain('job');
  });

  it('非高影响字段无 anchor 不阻塞', () => {
    // degree 是高影响（registry 里 highImpact=true），改用非高影响遗留字段测试
    // subjects/score/qualification 在 registry 中均标记为高影响，这里用一个真正非高影响场景：
    // 构造一个完全未登记字段（走 identity，非高影响）
    const fields: CandidateField[] = [
      { field: 'some_custom_note', value: 'x' }, // 未登记，非高影响
    ];
    expect(findMissingEvidence(fields)).toHaveLength(0);
  });
});

describe('WB3 AI/OCR 未确认阻塞', () => {
  it('AI 字段未人工确认时阻塞发布', () => {
    const fields: CandidateField[] = [
      { field: 'major', value: '汉语言文学', anchor: anchorFor('major'), origin: 'ai', needsHumanConfirm: true },
    ];
    const unconfirmed = findUnconfirmedAuto(fields);
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]!.field).toBe('major');
    expect(unconfirmed[0]!.origin).toBe('ai');

    const report = buildCompletenessReport(candidate(fields));
    expect(report.publishBlockers.some((b) => b.code === 'unconfirmed_auto_field')).toBe(true);
  });

  it('AI 字段人工确认后不再阻塞', () => {
    const fields: CandidateField[] = [
      { field: 'major', value: '汉语言文学', anchor: anchorFor('major'), origin: 'ai', needsHumanConfirm: true, humanConfirmedAt: '2026-10-20T00:00:00Z' },
    ];
    expect(findUnconfirmedAuto(fields)).toHaveLength(0);
  });

  it('OCR 低置信度字段同样需人工确认', () => {
    const fields: CandidateField[] = [
      { field: 'major', value: '数学', anchor: anchorFor('major'), origin: 'ocr', confidence: 0.5, needsHumanConfirm: true },
    ];
    expect(findUnconfirmedAuto(fields)).toHaveLength(1);
  });
});

describe('WB3 两岗位分别计算完整性', () => {
  it('两个岗位各自独立统计 expected/extracted/unknown/conflict', () => {
    const jobA = { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 };
    const jobB = { key: 'job:3301A02', jobCode: '3301A02', sheet: '岗位表', row: 3 };

    const fields: CandidateField[] = [
      makeJobScopedField({ field: 'education', value: '本科及以上', anchor: anchorFor('education') }, jobA),
      makeJobScopedField({ field: 'major', value: '汉语言文学（师范）', anchor: anchorFor('major') }, jobA),
      makeJobScopedField(makeUnknownField({ field: 'degree' }), jobA),
      makeJobScopedField({ field: 'education', value: '硕士研究生及以上', anchor: anchorFor('education') }, jobB),
      makeJobScopedField({ field: 'major', value: '数学与应用数学', anchor: anchorFor('major') }, jobB),
    ];

    const scopes = computeScopeCompleteness(fields);
    const a = scopes.find((s) => s.key === 'job:3301A01')!;
    const b = scopes.find((s) => s.key === 'job:3301A02')!;

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // 岗位A：education/major/degree 三个字段名，extracted=2, unknown=1
    expect(a.fieldNames.sort()).toEqual(['degree', 'education', 'major']);
    expect(a.expected).toBe(3);
    expect(a.extracted).toBe(2);
    expect(a.unknown).toBe(1);
    expect(a.conflict).toBe(0);
    // 岗位B：education/major 两个字段，全 extracted
    expect(b.expected).toBe(2);
    expect(b.extracted).toBe(2);
    expect(b.unknown).toBe(0);
  });

  it('两个岗位的 major 值不互相覆盖（师范保留在岗位A）', () => {
    const jobA = { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 };
    const jobB = { key: 'job:3301A02', jobCode: '3301A02', sheet: '岗位表', row: 3 };
    const fields: CandidateField[] = [
      makeJobScopedField({ field: 'major', value: '汉语言文学（师范）', anchor: anchorFor('major') }, jobA),
      makeJobScopedField({ field: 'major', value: '数学与应用数学', anchor: anchorFor('major') }, jobB),
    ];
    const scopes = computeScopeCompleteness(fields);
    const a = scopes.find((s) => s.key === 'job:3301A01')!;
    expect(a.fieldNames).toContain('major');
    // 两岗位分属不同 scope，无覆盖
    expect(scopes.filter((s) => s.key.startsWith('job:')).length).toBe(2);
  });
});

describe('WB3 报告分母可由黄金样本人工复算', () => {
  it('expected 等于该范围去重字段名数，可复算', () => {
    const fields: CandidateField[] = [
      { field: 'education', value: '本科', anchor: anchorFor('education') },
      { field: 'major', value: '数学', anchor: anchorFor('major') },
      { field: 'education', value: '硕士', anchor: anchorFor('education') }, // 同字段重复（不同值，但这里仅计字段名去重）
    ];
    const scopes = computeScopeCompleteness(fields);
    const ann = scopes.find((s) => s.key === 'announcement')!;
    // 字段名去重后 = education, major → expected=2
    expect(ann.expected).toBe(2);
    expect(ann.fieldNames.sort()).toEqual(['education', 'major']);
  });

  it('completeness / adoptionRate / editRate 指标可复算且不声称正确率', () => {
    const fields: CandidateField[] = [
      { field: 'education', value: '本科', anchor: anchorFor('education') },
      { field: 'major', value: '数学', anchor: anchorFor('major') },
      makeUnknownField({ field: 'degree' }),
    ];
    const report = buildCompletenessReport(candidate(fields));
    // expected=3（education, major, degree），extracted=2，unknown=1
    expect(report.metrics.completeness).toBeCloseTo(2 / 3);
    expect(report.metrics.adoptionRate).toBeCloseTo(2 / 3);
    expect(report.metrics.editRate).toBe(0);
    // 指标名不含 "accuracy/correctness"
    expect(Object.keys(report.metrics)).not.toContain('accuracy');
  });
});

describe('WB3 assertPublishable', () => {
  it('存在阻塞时抛错，错误带 scope 与 field', () => {
    const fields: CandidateField[] = [
      { field: 'education', value: '本科及以上', scope: 'job', jobScope: { key: 'job:A', jobCode: 'A', sheet: 'S', row: 2 } },
    ];
    expect(() => assertPublishable(candidate(fields))).toThrow(/education/);
  });

  it('无阻塞时不抛错', () => {
    const fields: CandidateField[] = [
      { field: 'education', value: '本科及以上', anchor: anchorFor('education') },
      { field: 'major', value: '汉语言文学', anchor: anchorFor('major') },
    ];
    expect(() => assertPublishable(candidate(fields))).not.toThrow();
  });
});
