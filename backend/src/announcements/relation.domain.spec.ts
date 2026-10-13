/**
 * v7.2 公告关系（补充/延期/取消）proposeRelation 纯函数测试。
 */
import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_RELATION_TYPES,
  CONFIRMED_RELATION_TYPES,
  isRelationCandidate,
  proposeRelation,
} from './relation.domain.js';

const ANN_DOC = {
  id: 'doc-ann-1',
  canonicalUrl: 'https://example.gov.cn/notice/1',
  firstSeenAt: '2026-10-01T00:00:00.000Z',
};

describe('proposeRelation', () => {
  it('恰有 1 个公告父候选 → confirmed，relationType 为确定值', () => {
    for (const kind of ['supplement', 'delay', 'cancel'] as const) {
      const result = proposeRelation({
        kind,
        existingAnnouncementDocuments: [ANN_DOC],
      });
      expect(result).toEqual({
        kind,
        parentDocumentId: 'doc-ann-1',
        confirmed: true,
        relationType: kind,
      });
    }
  });

  it('0 个公告父候选 → 候选关系（Candidate 后缀），parentDocumentId=null', () => {
    const result = proposeRelation({
      kind: 'supplement',
      existingAnnouncementDocuments: [],
    });
    expect(result).toEqual({
      kind: 'supplement',
      parentDocumentId: null,
      confirmed: false,
      relationType: 'supplementCandidate',
    });
  });

  it('≥2 个公告父候选 → 候选关系，进入人工审核', () => {
    const result = proposeRelation({
      kind: 'delay',
      existingAnnouncementDocuments: [
        ANN_DOC,
        { ...ANN_DOC, id: 'doc-ann-2', canonicalUrl: 'https://example.gov.cn/notice/2' },
      ],
    });
    expect(result).toEqual({
      kind: 'delay',
      parentDocumentId: null,
      confirmed: false,
      relationType: 'delayCandidate',
    });
  });

  it('cancel 多候选 → cancelCandidate', () => {
    const result = proposeRelation({
      kind: 'cancel',
      existingAnnouncementDocuments: [ANN_DOC, { ...ANN_DOC, id: 'doc-ann-3' }],
    });
    expect(result?.relationType).toBe('cancelCandidate');
    expect(result?.confirmed).toBe(false);
  });

  it('announcement / attachment / 未知 kind → 返回 null（不建立关系）', () => {
    for (const kind of ['announcement', 'attachment', 'unknown-kind']) {
      expect(
        proposeRelation({ kind, existingAnnouncementDocuments: [ANN_DOC] }),
      ).toBeNull();
    }
  });
});

describe('关系类型常量与判定', () => {
  it('确定值与候选值互不重叠', () => {
    for (const value of CONFIRMED_RELATION_TYPES) {
      expect(CANDIDATE_RELATION_TYPES).not.toContain(value);
      expect(isRelationCandidate(value)).toBe(false);
    }
  });

  it('isRelationCandidate 只认 Candidate 后缀', () => {
    expect(isRelationCandidate('supplementCandidate')).toBe(true);
    expect(isRelationCandidate('delayCandidate')).toBe(true);
    expect(isRelationCandidate('cancelCandidate')).toBe(true);
    expect(isRelationCandidate('supplement')).toBe(false);
    expect(isRelationCandidate(null)).toBe(false);
    expect(isRelationCandidate(undefined)).toBe(false);
  });
});
