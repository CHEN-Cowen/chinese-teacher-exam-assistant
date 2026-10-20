import { describe, expect, it } from 'vitest';
import {
  HIGH_IMPACT_FIELDS,
  assertCanApprove,
  assertCanPublish,
  assertTransition,
  buildReviewRecord,
  canPublish,
  computeContentHash,
  diffVersions,
  extractionIdempotencyKey,
  findDuplicateSnapshot,
  findHighImpactFieldsWithoutAnchor,
  findUnconfirmedAutoFields,
  isApprovalAction,
  markAutoFieldsConfirmed,
  nextStatusAfterReview,
  publishVersion,
  retryFailedRun,
  type CandidateField,
  type ExtractionCandidate,
  type ExtractionRunStatus,
  type PublishedVersion,
} from './domain.js';

// ==================== 测试夹具 ====================

function candidate(
  fields: CandidateField[],
  parserVersion = 'deterministic-parser@1',
): ExtractionCandidate {
  return { fields, parserVersion };
}

function anchorFor(field: string) {
  return {
    field,
    locator: { kind: 'excerpt' as const, excerpt: `关于${field}的原文` },
  };
}

function validCandidate(): ExtractionCandidate {
  return candidate([
    { field: 'title', value: '杭州市教育局招聘公告' },
    { field: 'registration_time', value: '2026-11-01 至 2026-11-07', anchor: anchorFor('registration_time') },
    { field: 'exam_time', value: '2026-12-13', anchor: anchorFor('exam_time') },
    { field: 'subjects', value: '语文', anchor: anchorFor('subjects') },
    { field: 'headcount', value: '50', anchor: anchorFor('headcount') },
  ]);
}

function publishedV1(): PublishedVersion {
  return {
    id: 'ann-hz-v1',
    announcementId: 'ann-hz',
    versionNumber: 1,
    status: 'published',
    payload: validCandidate(),
    publishedAt: '2026-10-01T10:00:00Z',
  };
}

// ==================== 1. 重复文件不生成重复快照 ====================

describe('快照去重（SHA-256 内容哈希）', () => {
  it('相同内容产生相同哈希，已存在快照时返回已有 id，不创建重复', () => {
    const content = '<html>公告正文</html>';
    const hash = computeContentHash(content);

    const existing = [{ id: 'snap-1', contentHash: hash }];
    const dupId = findDuplicateSnapshot(existing, hash);
    expect(dupId).toBe('snap-1');
  });

  it('不同内容产生不同哈希，不命中已有快照', () => {
    const hash1 = computeContentHash('公告A');
    const hash2 = computeContentHash('公告B');
    expect(hash1).not.toBe(hash2);

    const existing = [{ id: 'snap-1', contentHash: hash1 }];
    expect(findDuplicateSnapshot(existing, hash2)).toBeNull();
  });

  it('Buffer 与 string 输入对相同字节产生一致哈希', () => {
    const text = 'test-content';
    expect(computeContentHash(text)).toBe(computeContentHash(Buffer.from(text, 'utf-8')));
  });
});

// ==================== 2. 未审核候选不能发布 ====================

describe('发布门禁', () => {
  it('只有 approved 状态可以发布', () => {
    expect(canPublish('approved')).toBe(true);
    const nonPublishable: ExtractionRunStatus[] = [
      'submitted',
      'extracting',
      'pending_review',
      'rejected',
      'failed',
      'published',
    ];
    for (const s of nonPublishable) {
      expect(canPublish(s)).toBe(false);
    }
  });

  it('pending_review（未审核）发布时抛错', () => {
    expect(() => assertCanPublish('pending_review')).toThrow(/未审核候选不得发布/);
  });

  it('approved 状态发布不抛错', () => {
    expect(() => assertCanPublish('approved')).not.toThrow();
  });
});

// ==================== 3. 无证据的高影响字段不能通过 ====================

describe('高影响字段证据锚点校验', () => {
  it('所有高影响字段都有锚点时通过', () => {
    const c = validCandidate();
    expect(findHighImpactFieldsWithoutAnchor(c)).toEqual([]);
    expect(() => assertCanApprove('pending_review', c)).not.toThrow();
  });

  it('缺少锚点的高影响字段被检出，审核通过抛错', () => {
    const c = candidate([
      { field: 'registration_time', value: '2026-11-01' }, // 高影响，无 anchor
      { field: 'title', value: 'x' },
    ]);
    const missing = findHighImpactFieldsWithoutAnchor(c);
    expect(missing).toContain('registration_time');
    expect(() => assertCanApprove('pending_review', c)).toThrow(/缺少证据锚点/);
  });

  it('非 pending_review 状态不能审核通过', () => {
    expect(() => assertCanApprove('extracting', validCandidate())).toThrow(/只有待审核/);
    expect(() => assertCanApprove('approved', validCandidate())).toThrow(/只有待审核/);
  });

  it('空候选不能审核通过', () => {
    expect(() => assertCanApprove('pending_review', candidate([]))).toThrow(/候选结果为空/);
  });

  it('HIGH_IMPACT_FIELDS 包含报名/考试/科目/分值/资格等关键字段', () => {
    expect(HIGH_IMPACT_FIELDS.has('registration_time')).toBe(true);
    expect(HIGH_IMPACT_FIELDS.has('exam_time')).toBe(true);
    expect(HIGH_IMPACT_FIELDS.has('subjects')).toBe(true);
    expect(HIGH_IMPACT_FIELDS.has('qualification')).toBe(true);
  });
});

// ==================== 4. 人工修改前后均留痕 ====================

describe('审核留痕', () => {
  const current = validCandidate();

  it('approve 留痕：after 与 before 相同', () => {
    const record = buildReviewRecord({
      runId: 'run-1',
      reviewerId: 'u-1',
      reviewerName: '审核员A',
      action: 'approve',
      reason: '与原文一致',
      current,
      reviewedAt: '2026-10-02T00:00:00Z',
    });
    expect(record.beforePayload).toBe(current);
    expect(record.afterPayload).toBe(current);
    expect(record.action).toBe('approve');
    expect(record.reason).toBe('与原文一致');
  });

  it('approve_with_edit 留痕：after 为修改后版本，与 before 不同', () => {
    const edited = candidate([
      ...current.fields,
      { field: 'score', value: '100分', anchor: anchorFor('score') },
    ]);
    const record = buildReviewRecord({
      runId: 'run-1',
      reviewerId: 'u-1',
      reviewerName: '审核员A',
      action: 'approve_with_edit',
      reason: '补充分值字段',
      current,
      edited,
      reviewedAt: '2026-10-02T00:00:00Z',
    });
    expect(record.afterPayload).toBe(edited);
    expect(record.afterPayload.fields.length).toBe(current.fields.length + 1);
  });

  it('approve_with_edit 未提供 edited 时抛错', () => {
    expect(() =>
      buildReviewRecord({
        runId: 'run-1',
        reviewerId: 'u-1',
        reviewerName: '审核员A',
        action: 'approve_with_edit',
        reason: 'x',
        current,
        reviewedAt: '2026-10-02T00:00:00Z',
      }),
    ).toThrow(/必须提供修改后的候选结果/);
  });

  it('reject 留痕：after = before，状态不变为 rejected', () => {
    const record = buildReviewRecord({
      runId: 'run-1',
      reviewerId: 'u-1',
      reviewerName: '审核员A',
      action: 'reject',
      reason: '来源不明',
      current,
      reviewedAt: '2026-10-02T00:00:00Z',
    });
    expect(record.afterPayload).toBe(current);
    expect(nextStatusAfterReview('reject')).toBe('rejected');
  });

  it('isApprovalAction 正确区分通过与驳回', () => {
    expect(isApprovalAction('approve')).toBe(true);
    expect(isApprovalAction('approve_with_edit')).toBe(true);
    expect(isApprovalAction('reject')).toBe(false);
    expect(isApprovalAction('mark_incomplete')).toBe(false);
  });
});

// ==================== 5. V2 发布不覆盖 V1 ====================

describe('版本只追加', () => {
  it('首次发布 versionNumber=1，无 previousVersionId', () => {
    const { version, superseded } = publishVersion({
      announcementId: 'ann-hz',
      candidate: validCandidate(),
      previousVersion: null,
      publishedAt: '2026-10-01T10:00:00Z',
    });
    expect(version.versionNumber).toBe(1);
    expect(version.previousVersionId).toBeUndefined();
    expect(version.status).toBe('published');
    expect(superseded).toBeNull();
  });

  it('V2 发布：versionNumber=2，V1 标记 superseded 但内容不被覆盖', () => {
    const v1 = publishedV1();
    const v2Candidate = candidate([
      ...validCandidate().fields,
      { field: 'score', value: '100分', anchor: anchorFor('score') },
    ]);

    const { version, superseded } = publishVersion({
      announcementId: 'ann-hz',
      candidate: v2Candidate,
      previousVersion: v1,
      publishedAt: '2026-10-05T10:00:00Z',
    });

    expect(version.versionNumber).toBe(2);
    expect(version.previousVersionId).toBe(v1.id);

    // 旧版本被取代但内容保留
    expect(superseded).not.toBeNull();
    expect(superseded!.status).toBe('superseded');
    expect(superseded!.supersededAt).toBe('2026-10-05T10:00:00Z');
    expect(superseded!.versionNumber).toBe(1);
    // V1 的 payload 不被 V2 覆盖
    expect(superseded!.payload.fields.length).toBe(v1.payload.fields.length);
    expect(version.payload.fields.length).toBe(v2Candidate.fields.length);
  });

  it('diffVersions 正确列出 V1/V2 字段差异', () => {
    const v1 = publishedV1();
    const v2Candidate = candidate([
      ...validCandidate().fields.filter((f) => f.field !== 'headcount'),
      { field: 'headcount', value: '80', anchor: anchorFor('headcount') },
      { field: 'score', value: '100分', anchor: anchorFor('score') },
    ]);
    const { version: v2 } = publishVersion({
      announcementId: 'ann-hz',
      candidate: v2Candidate,
      previousVersion: v1,
      publishedAt: '2026-10-05T10:00:00Z',
    });

    const diffs = diffVersions(v1, v2);
    const headcountDiff = diffs.find((d) => d.field === 'headcount');
    expect(headcountDiff).toBeDefined();
    expect(headcountDiff!.changed).toBe(true);
    expect(headcountDiff!.before).toBe('50');
    expect(headcountDiff!.after).toBe('80');

    const scoreDiff = diffs.find((d) => d.field === 'score');
    expect(scoreDiff).toBeDefined();
    expect(scoreDiff!.before).toBe('');
    expect(scoreDiff!.after).toBe('100分');
  });
});

// ==================== 6. 失败任务可重试且不会重复发布 ====================

describe('失败重试与幂等', () => {
  it('failed 状态可重试，回到 submitted', () => {
    expect(retryFailedRun('failed')).toBe('submitted');
  });

  it('非 failed 状态重试抛错', () => {
    expect(() => retryFailedRun('pending_review')).toThrow(/只有失败状态/);
    expect(() => retryFailedRun('approved')).toThrow(/只有失败状态/);
  });

  it('幂等键由 snapshotId + parserVersion 组成', () => {
    const key1 = extractionIdempotencyKey('snap-1', 'parser@1');
    const key2 = extractionIdempotencyKey('snap-1', 'parser@1');
    const key3 = extractionIdempotencyKey('snap-1', 'parser@2');
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('状态机：failed → submitted → extracting → pending_review 合法', () => {
    expect(() => assertTransition('failed', 'submitted')).not.toThrow();
    expect(() => assertTransition('submitted', 'extracting')).not.toThrow();
    expect(() => assertTransition('extracting', 'pending_review')).not.toThrow();
  });

  it('状态机：published 是终态，不能再迁移', () => {
    expect(() => assertTransition('published', 'approved')).toThrow();
    expect(() => assertTransition('published', 'submitted')).toThrow();
  });

  it('状态机：pending_review 只能到 approved 或 rejected', () => {
    expect(() => assertTransition('pending_review', 'approved')).not.toThrow();
    expect(() => assertTransition('pending_review', 'rejected')).not.toThrow();
    expect(() => assertTransition('pending_review', 'published')).toThrow();
    expect(() => assertTransition('pending_review', 'extracting')).toThrow();
  });
});

// ==================== 13. AI/OCR 来源字段发布门禁（AI 不能自动发布） ====================

describe('AI/OCR 发布门禁', () => {
  const aiField: CandidateField = {
    field: 'education',
    value: '本科及以上',
    anchor: anchorFor('education'),
    origin: 'ai',
    needsHumanConfirm: true,
  };

  it('AI 字段未经人工确认时，findUnconfirmedAutoFields 能识别', () => {
    const result = findUnconfirmedAutoFields(candidate([aiField]));
    expect(result).toEqual(['education']);
  });

  it('AI 字段人工确认后不再出现在未确认列表', () => {
    const confirmed = markAutoFieldsConfirmed([aiField], '2026-10-13T08:00:00Z');
    expect(findUnconfirmedAutoFields(candidate(confirmed))).toEqual([]);
  });

  it('markAutoFieldsConfirmed 只为 AI/OCR 字段写入确认时间，rule 字段不受影响', () => {
    const ruleField: CandidateField = {
      field: 'title',
      value: '杭州市教育局招聘公告',
    };
    const confirmed = markAutoFieldsConfirmed([ruleField, aiField], '2026-10-13T08:00:00Z');
    expect(confirmed[0].humanConfirmedAt).toBeUndefined();
    expect(confirmed[1].humanConfirmedAt).toBe('2026-10-13T08:00:00Z');
  });

  it('assertCanPublish：AI 字段无人工确认时间时抛错，不能发布', () => {
    expect(() => assertCanPublish('approved', candidate([aiField]))).toThrow(
      /AI\/OCR 来源字段未经人工确认，不能发布：education/,
    );
  });

  it('assertCanPublish：AI 字段确认后可发布', () => {
    const confirmed = markAutoFieldsConfirmed([aiField], '2026-10-13T08:00:00Z');
    expect(() => assertCanPublish('approved', candidate(confirmed))).not.toThrow();
  });

  it('assertCanPublish：rule 字段不受 AI 门禁影响，直接可发布', () => {
    const ruleOnly = candidate(validCandidate().fields);
    expect(() => assertCanPublish('approved', ruleOnly)).not.toThrow();
  });

  it('assertCanPublish：状态不是 approved 时先拒绝（即便候选全确认）', () => {
    const confirmed = markAutoFieldsConfirmed([aiField], '2026-10-13T08:00:00Z');
    expect(() => assertCanPublish('pending_review', candidate(confirmed))).toThrow(
      /只有审核通过的任务才能发布/,
    );
  });

  it('OCR 字段同样适用该门禁（低置信度人工确认后才可发布）', () => {
    const ocrField: CandidateField = {
      field: 'major',
      value: '汉语言文学',
      anchor: anchorFor('major'),
      origin: 'ocr',
      confidence: 0.6,
      needsHumanConfirm: true,
    };
    expect(() => assertCanPublish('approved', candidate([ocrField]))).toThrow(
      /AI\/OCR 来源字段未经人工确认，不能发布：major/,
    );
  });
});

// ==================== 14. WB1：岗位级候选契约 ====================

import {
  deriveJobKey,
  fieldIdentity,
  groupFieldsByScope,
  makeConflictField,
  makeHumanDecision,
  makeJobScopedField,
  makeUnknownField,
  normalizeCandidateField,
  type FieldAlternative,
  type HumanDecision,
  type JobScopeInfo,
} from './domain.js';

describe('WB1 岗位归属 identity（scope+field 去重）', () => {
  const jobA: JobScopeInfo = { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 };
  const jobB: JobScopeInfo = { key: 'job:3301A02', jobCode: '3301A02', sheet: '岗位表', row: 3 };

  it('两个岗位中的同名 major 字段具有不同 identity', () => {
    const majorA = makeJobScopedField({ field: 'major', value: '汉语言文学（师范）' }, jobA);
    const majorB = makeJobScopedField({ field: 'major', value: '数学与应用数学' }, jobB);
    expect(fieldIdentity(majorA)).toBe('job:job:3301A01:major');
    expect(fieldIdentity(majorB)).toBe('job:job:3301A02:major');
    expect(fieldIdentity(majorA)).not.toBe(fieldIdentity(majorB));
  });

  it('公共字段与岗位字段不会分到同组', () => {
    const groups = groupFieldsByScope([
      { field: 'title', value: '公告标题', scope: 'announcement' },
      makeJobScopedField({ field: 'major', value: '汉语言文学（师范）' }, jobA),
      makeJobScopedField({ field: 'major', value: '数学与应用数学' }, jobB),
      { field: 'degree', value: '', status: 'unknown', scope: 'unknown' },
    ]);
    expect(groups.announcement.map((f) => f.field)).toEqual(['title']);
    expect(groups.jobs.size).toBe(2);
    expect(groups.jobs.get('job:3301A01')!.map((f) => f.field)).toEqual(['major']);
    expect(groups.unknown.map((f) => f.field)).toEqual(['degree']);
  });

  it('deriveJobKey 优先官方岗位编号，否则用 sheet+row 派生', () => {
    expect(deriveJobKey({ jobCode: '3301A01' })).toBe('job:3301A01');
    expect(deriveJobKey({ sheet: '岗位表', row: 2 })).toBe('岗位表:row:2');
    expect(deriveJobKey({ sourceKey: 'doc-1', sheet: '岗位表', row: 2 })).toBe(
      'src:doc-1:岗位表:row:2',
    );
  });
});

describe('WB1 旧候选兼容读取', () => {
  it('无 scope/status/ruleVersion 的旧字段仍能读取，默认公告级+已抽取', () => {
    const legacy: CandidateField = { field: 'title', value: '杭州市教育局招聘公告' };
    const normalized = normalizeCandidateField(legacy);
    expect(normalized.scope).toBe('announcement');
    expect(normalized.status).toBe('extracted');
    expect(normalized.ruleVersion).toBeUndefined();
    expect(normalized.value).toBe('杭州市教育局招聘公告');
  });

  it('normalizeCandidateField 不静默改写原对象', () => {
    const legacy: CandidateField = { field: 'title', value: 'x' };
    const before = { ...legacy };
    normalizeCandidateField(legacy);
    expect(legacy).toEqual(before);
  });

  it('旧 candidate 通过 assertCanApprove / assertCanPublish 不受影响（无回归）', () => {
    // 旧字段无 scope/status，仍能走原有审核/发布门禁
    expect(() => assertCanApprove('pending_review', validCandidate())).not.toThrow();
    expect(() => assertCanPublish('approved', validCandidate())).not.toThrow();
  });
});

describe('WB1 冲突状态（conflict 保留两值两证据）', () => {
  const altA: FieldAlternative = {
    value: '2',
    source: { kind: 'worksheet', fileId: 'f1', fileName: '岗位表.xlsx', sheet: '岗位表', cell: 'E2' },
    excerpt: '岗位表：2人',
  };
  const altB: FieldAlternative = {
    value: '3',
    source: { kind: 'file', fileId: 'f2', fileName: '附件.docx', page: 1 },
    excerpt: '附件：3人',
  };

  it('conflict 字段保留 value + 两个替代值及各自证据', () => {
    const f = makeConflictField({
      field: 'headcount',
      value: '2',
      alternatives: [altA, altB],
    });
    expect(f.status).toBe('conflict');
    expect(f.alternatives).toHaveLength(2);
    expect(f.alternatives!.map((a) => a.value)).toEqual(['2', '3']);
    expect(f.alternatives![0].source.kind).toBe('worksheet');
    expect(f.alternatives![1].source.kind).toBe('file');
  });

  it('conflict 是结构化状态，不是拼接字符串', () => {
    const f = makeConflictField({ field: 'headcount', value: '2', alternatives: [altA, altB] });
    expect(f.value).toBe('2'); // 主值保持单一
    expect(Array.isArray(f.alternatives)).toBe(true);
    expect(typeof f.alternatives).not.toBe('string');
  });
});

describe('WB1 unknown 状态（未知 ≠ 空的 extracted）', () => {
  it('unknown 字段显式 status=unknown，且可被识别为 unknown 而非 extracted', () => {
    const f = makeUnknownField({ field: 'degree' });
    expect(f.status).toBe('unknown');
    const normalized = normalizeCandidateField(f);
    expect(normalized.status).toBe('unknown');
    expect(normalized.status).not.toBe('extracted');
  });

  it('unknown 字段不携带有效 value（区别于 extracted 的空串误读）', () => {
    const f = makeUnknownField({ field: 'degree' });
    expect(f.value).toBe('');
    expect(f.status).toBe('unknown');
  });
});

describe('WB1 人工决策留痕（edit 保留前后值/原因/操作者/时间）', () => {
  it('edit 决策保留 beforeValue 与 afterValue', () => {
    const d: HumanDecision = makeHumanDecision({
      action: 'edit',
      beforeValue: '2',
      afterValue: '3',
      reason: '附件为最新口径',
      operatorId: 'u-1',
      decidedAt: '2026-10-20T00:00:00Z',
    });
    expect(d.action).toBe('edit');
    expect(d.beforeValue).toBe('2');
    expect(d.afterValue).toBe('3');
    expect(d.reason).toBe('附件为最新口径');
    expect(d.operatorId).toBe('u-1');
    expect(d.decidedAt).toBe('2026-10-20T00:00:00Z');
  });

  it('四种决策类型均可构造：adopt/edit/reject/pending', () => {
    const actions: HumanDecision['action'][] = ['adopt', 'edit', 'reject', 'pending'];
    for (const a of actions) {
      const d = makeHumanDecision({ action: a, reason: 'r', operatorId: 'u', decidedAt: 't' });
      expect(d.action).toBe(a);
    }
  });
});

describe('WB1 新类型可安全 JSON 序列化', () => {
  it('带 scope/status/alternatives/decision 的字段 JSON 往返一致', () => {
    const alt: FieldAlternative = {
      value: '3',
      source: { kind: 'file', fileId: 'f2', fileName: '附件.docx', page: 1 },
      excerpt: '附件：3人',
    };
    const decision: HumanDecision = makeHumanDecision({
      action: 'edit',
      beforeValue: '2',
      afterValue: '3',
      reason: '附件为最新口径',
      operatorId: 'u-1',
      decidedAt: '2026-10-20T00:00:00Z',
    });
    const f = makeConflictField({
      field: 'headcount',
      value: '2',
      scope: 'job',
      jobScope: { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 },
      ruleVersion: 'wb@1.0.0',
      alternatives: [alt],
    });
    f.decision = decision;

    const roundTrip = JSON.parse(JSON.stringify(f)) as CandidateField;
    expect(roundTrip.status).toBe('conflict');
    expect(roundTrip.scope).toBe('job');
    expect(roundTrip.jobScope?.key).toBe('job:3301A01');
    expect(roundTrip.ruleVersion).toBe('wb@1.0.0');
    expect(roundTrip.alternatives).toHaveLength(1);
    expect(roundTrip.decision?.afterValue).toBe('3');
  });
});

// ==================== 15. WB4：字段级审核决策 ====================

import {
  applyFieldDecisions,
  validateFieldDecisions,
} from './domain.js';

describe('WB4 字段级审核决策（adopt/edit/reject/pending）', () => {
  const operator = 'u-1';
  const at = '2026-10-20T12:00:00Z';

  function aiField(): CandidateField {
    return {
      field: 'major',
      value: '汉语言文学（师范）',
      scope: 'job',
      jobScope: { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 },
      origin: 'ai',
      needsHumanConfirm: true,
    };
  }

  it('adopt 保留原值并写 decision（before=after=原值）', () => {
    const f = aiField();
    const [out] = applyFieldDecisions(
      [f],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'adopt', reason: '与原文一致' }],
      operator,
      at,
    );
    expect(out.decision?.action).toBe('adopt');
    expect(out.decision?.beforeValue).toBe('汉语言文学（师范）');
    expect(out.decision?.afterValue).toBe('汉语言文学（师范）');
    expect(out.value).toBe('汉语言文学（师范）');
  });

  it('edit 必填新值，保留 before/after，字段值更新', () => {
    const f = aiField();
    const [out] = applyFieldDecisions(
      [f],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'edit', afterValue: '汉语言文学', reason: '去除师范限定' }],
      operator,
      at,
    );
    expect(out.value).toBe('汉语言文学');
    expect(out.decision?.beforeValue).toBe('汉语言文学（师范）');
    expect(out.decision?.afterValue).toBe('汉语言文学');
    expect(out.decision?.action).toBe('edit');
  });

  it('reject 保留原值并写 decision（action=reject）', () => {
    const f = aiField();
    const [out] = applyFieldDecisions(
      [f],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'reject', reason: '来源不可信' }],
      operator,
      at,
    );
    expect(out.value).toBe('汉语言文学（师范）');
    expect(out.decision?.action).toBe('reject');
    expect(out.decision?.reason).toBe('来源不可信');
  });

  it('pending 保留原值并写 decision（说明缺什么）', () => {
    const f = aiField();
    const [out] = applyFieldDecisions(
      [f],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'pending', reason: '待补充专业目录依据' }],
      operator,
      at,
    );
    expect(out.value).toBe('汉语言文学（师范）');
    expect(out.decision?.action).toBe('pending');
  });

  it('AI/OCR 字段仅在 adopt 或 edit 时写入 humanConfirmedAt', () => {
    const adopt = applyFieldDecisions(
      [aiField()],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'adopt', reason: 'r' }],
      operator,
      at,
    )[0]!;
    expect(adopt.humanConfirmedAt).toBe(at);

    const reject = applyFieldDecisions(
      [aiField()],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'reject', reason: 'r' }],
      operator,
      at,
    )[0]!;
    expect(reject.humanConfirmedAt).toBeUndefined();

    const pending = applyFieldDecisions(
      [aiField()],
      [{ identity: 'job:job:3301A01:major', field: 'major', action: 'pending', reason: 'r' }],
      operator,
      at,
    )[0]!;
    expect(pending.humanConfirmedAt).toBeUndefined();
  });

  it('目标字段不存在时抛错（不静默吞掉）', () => {
    expect(() =>
      applyFieldDecisions(
        [aiField()],
        [{ identity: 'job:nonexistent:major', field: 'major', action: 'adopt', reason: 'r' }],
        operator,
        at,
      ),
    ).toThrow(/目标不存在/);
  });

  it('edit 决策缺少新值时 validateFieldDecisions 报错', () => {
    const errs = validateFieldDecisions([
      { identity: 'job:job:3301A01:major', field: 'major', action: 'edit', reason: 'r' },
    ]);
    expect(errs.some((e) => e.includes('缺少新值'))).toBe(true);
  });

  it('缺少原因的决策报错（adopt/edit/reject/pending 一致）', () => {
    const errs = validateFieldDecisions([
      { identity: 'a', field: 'major', action: 'adopt', reason: '  ' },
    ]);
    expect(errs.some((e) => e.includes('缺少原因'))).toBe(true);
  });
});

