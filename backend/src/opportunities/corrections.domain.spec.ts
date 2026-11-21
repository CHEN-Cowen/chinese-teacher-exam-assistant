import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isTerminalStatus,
  isVersionCorrectableField,
  validateResolution,
  validateReview,
} from './corrections.domain.js';

describe('纠错处理状态机（P0-F）', () => {
  it('合法迁移路径：submitted 可到三态，reviewing 只能到终态', () => {
    expect(canTransition('submitted', 'reviewing')).toBe(true);
    expect(canTransition('submitted', 'resolved')).toBe(true);
    expect(canTransition('submitted', 'rejected')).toBe(true);
    expect(canTransition('reviewing', 'resolved')).toBe(true);
    expect(canTransition('reviewing', 'rejected')).toBe(true);
  });

  it('终态不可再迁移；非法来源状态一律拒绝', () => {
    expect(canTransition('resolved', 'reviewing')).toBe(false);
    expect(canTransition('resolved', 'rejected')).toBe(false);
    expect(canTransition('rejected', 'resolved')).toBe(false);
    expect(canTransition('reviewing', 'reviewing')).toBe(false);
    expect(canTransition('not-a-status', 'resolved')).toBe(false);
    expect(isTerminalStatus('resolved')).toBe(true);
    expect(isTerminalStatus('reviewing')).toBe(false);
  });

  it('rejected 必须有非空处理说明；resolved/reviewing 可无说明', () => {
    expect(
      validateReview({ from: 'submitted', to: 'rejected' }).ok,
    ).toBe(false);
    expect(
      validateReview({ from: 'submitted', to: 'resolved' }).ok,
    ).toBe(true);
    expect(
      validateReview({ from: 'submitted', to: 'reviewing' }).ok,
    ).toBe(true);
    const rejected = validateReview({
      from: 'reviewing',
      to: 'rejected',
      reviewNote: '  官方原文未调整  ',
    });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(rejected.note).toBe('官方原文未调整');
  });

  it('处理说明超 500 字拒绝；不能退回 submitted', () => {
    expect(
      validateReview({
        from: 'submitted',
        to: 'resolved',
        reviewNote: '字'.repeat(501),
      }).ok,
    ).toBe(false);
    expect(
      validateReview({ from: 'reviewing', to: 'submitted' }).ok,
    ).toBe(false);
  });
});

describe('纠错结案真实性（R05）', () => {
  const versions = [
    { id: 'v1', versionNumber: 1, superseded: true },
    { id: 'v2', versionNumber: 2, superseded: false },
  ];

  it('数据类问题：必须登记已发布且晚于提交版本的修正版本', () => {
    expect(isVersionCorrectableField('major')).toBe(true);
    expect(isVersionCorrectableField('matching')).toBe(false);

    expect(
      validateResolution({
        fieldPath: 'headcount',
        submittedVersionId: 'v2',
        reviewNote: null,
        resolvedVersionId: null,
        versions,
      }).ok,
    ).toBe(false);

    // 不属于版本链
    expect(
      validateResolution({
        fieldPath: 'headcount',
        submittedVersionId: 'v1',
        reviewNote: null,
        resolvedVersionId: 'v9',
        versions,
      }).ok,
    ).toBe(false);

    // 已被取代
    expect(
      validateResolution({
        fieldPath: 'headcount',
        submittedVersionId: 'v1',
        reviewNote: null,
        resolvedVersionId: 'v1',
        versions,
      }).ok,
    ).toBe(false);

    // 晚于提交版本 → 通过
    const ok = validateResolution({
      fieldPath: 'headcount',
      submittedVersionId: 'v1',
      reviewNote: null,
      resolvedVersionId: 'v2',
      versions,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.resolvedVersionId).toBe('v2');
  });

  it('非数据类问题：不得登记版本，必须写明实际处理结果', () => {
    expect(
      validateResolution({
        fieldPath: 'matching',
        submittedVersionId: 'v2',
        reviewNote: null,
        resolvedVersionId: null,
        versions,
      }).ok,
    ).toBe(false);

    expect(
      validateResolution({
        fieldPath: 'dead_link',
        submittedVersionId: 'v2',
        reviewNote: '已替换为官方新链接',
        resolvedVersionId: 'v2',
        versions,
      }).ok,
    ).toBe(false);

    const ok = validateResolution({
      fieldPath: 'matching',
      submittedVersionId: 'v2',
      reviewNote: '已复核匹配规则并复测，结论已订正',
      resolvedVersionId: null,
      versions,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.resolvedVersionId).toBeNull();
  });
});
