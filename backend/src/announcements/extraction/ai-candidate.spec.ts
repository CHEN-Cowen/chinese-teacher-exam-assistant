/**
 * v7.2 证据链：AI 候选护栏测试（无锚点降级待核对；有锚点标记人工确认）。
 */
import { describe, expect, it } from 'vitest';
import { integrateAiCandidates } from './ai-candidate.js';
import type { CandidateField } from '../domain.js';

const anchored: CandidateField = {
  field: 'education',
  value: '本科及以上',
  anchor: {
    field: 'education',
    locator: { kind: 'excerpt', excerpt: '学历要求：本科及以上' },
    locatorData: { page: 1, snapshotId: 'snap-1' },
  },
};

const unanchored: CandidateField = {
  field: 'major',
  value: '数学类',
};

describe('integrateAiCandidates', () => {
  it('无锚点 AI 字段 → pendingVerification（绝不进入可发布候选）', () => {
    const result = integrateAiCandidates([unanchored]);
    expect(result.fields).toHaveLength(0);
    expect(result.pendingVerification).toEqual([
      { field: 'major', value: '数学类', reason: expect.stringContaining('缺少原文锚点') },
    ]);
  });

  it('有锚点 AI 字段 → origin=ai + needsHumanConfirm（人工确认前不能发布）', () => {
    const result = integrateAiCandidates([anchored]);
    expect(result.pendingVerification).toHaveLength(0);
    expect(result.fields[0]).toMatchObject({
      field: 'education',
      origin: 'ai',
      needsHumanConfirm: true,
    });
    expect(result.fields[0].anchor?.locatorData).toMatchObject({ page: 1 });
  });
});
