/**
 * v7.2 公告关系（补充/延期/取消）领域纯函数。
 *
 * 职责：根据来源内已发现的公告类文档，为 supplement/delay/cancel 形态的
 * 文档提议父公告关系：
 * - 恰有 1 个同来源 kind='announcement' 的候选父文档 → 关系确定（confirmed），
 *   relationType 写确定值（supplement/delay/cancel）；
 * - 0 个或 ≥2 个候选父文档 → 关系不确定，进入人工审核队列，
 *   relationType 写候选值（supplementCandidate/delayCandidate/cancelCandidate）；
 * - announcement/attachment 或未知 kind → 不建立关系（返回 null）。
 *
 * 本文件只包含无副作用的纯函数；持久化在 source-document-store 层实现。
 */

/** 确定的公告关系形态 */
export type RelationKind = 'supplement' | 'delay' | 'cancel';

/** 关系提议结果 */
export interface RelationCandidate {
  kind: RelationKind;
  /** 确定的父公告文档 id；不确定时为 null（待人工确认） */
  parentDocumentId: string | null;
  /** true=自动确认；false=候选，需人工审核 */
  confirmed: boolean;
  /** 写入 SourceDocument.relationType 的值 */
  relationType: string;
}

/** 确定关系值（写入 relationType 表示人工/规则已确认） */
export const CONFIRMED_RELATION_TYPES: readonly string[] = [
  'supplement',
  'delay',
  'cancel',
];

/** 候选关系值（进入人工审核队列） */
export const CANDIDATE_RELATION_TYPES: readonly string[] = [
  'supplementCandidate',
  'delayCandidate',
  'cancelCandidate',
];

const RELATION_KINDS: readonly string[] = CONFIRMED_RELATION_TYPES;

/** 判断 relationType 是否为待人工确认的候选关系 */
export function isRelationCandidate(relationType: string | null | undefined): boolean {
  return (
    typeof relationType === 'string' &&
    CANDIDATE_RELATION_TYPES.includes(relationType)
  );
}

/**
 * 为一个非公告形态文档提议父公告关系。
 *
 * @param input.kind 文档形态（classifyDocumentKind 的产出）
 * @param input.existingAnnouncementDocuments 同来源已发现的 kind='announcement' 文档
 * @returns 关系提议；announcement/attachment/未知 kind 返回 null
 */
export function proposeRelation(input: {
  kind: string;
  existingAnnouncementDocuments: Array<{
    id: string;
    canonicalUrl: string;
    firstSeenAt: string;
  }>;
}): RelationCandidate | null {
  if (!RELATION_KINDS.includes(input.kind)) return null;
  const kind = input.kind as RelationKind;

  const parents = input.existingAnnouncementDocuments;
  if (parents.length === 1) {
    return {
      kind,
      parentDocumentId: parents[0].id,
      confirmed: true,
      relationType: kind,
    };
  }

  // 0 个或多个候选父文档：关系不确定，进入人工审核
  return {
    kind,
    parentDocumentId: null,
    confirmed: false,
    relationType: `${kind}Candidate`,
  };
}
