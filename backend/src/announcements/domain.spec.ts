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
