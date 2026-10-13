/**
 * v7.2 证据链：AI 候选抽取护栏（可选能力，默认未接入）。
 *
 * 原则：
 * - AI 只能作为"候选抽取器"在标准文档之后运行，不能替代 OCR 的原文识别；
 * - AI 输出必须通过结构校验，且每个高影响字段必须带原文锚点；
 * - 没有锚点的 AI 字段只能进入 pendingVerification（待核对），
 *   绝不进入可发布的候选字段；
 * - AI 产物 origin='ai'：人工确认前不能发布（domain.assertCanPublish）。
 */
import type { CandidateField } from '../domain.js';
import type { ParsedDocument } from '../../document-processing/parsed-document.js';

export const AI_CANDIDATE_VERSION = 'ai-candidate@1.0.0';

/** AI 候选提供方接口（接口先行；未来接入境内可直连供应商） */
export interface AiCandidateProvider {
  readonly serviceVersion: string;
  propose(input: { parsed: ParsedDocument }): Promise<CandidateField[]>;
}

export interface AiCandidateResult {
  /** 带锚点、可进入候选的 AI 字段（origin=ai） */
  fields: CandidateField[];
  /** 无锚点的 AI 字段：只能待核对，不进入候选 */
  pendingVerification: Array<{ field: string; value: string; reason: string }>;
}

/** AI 候选整备：无锚点字段降级为待核对；有锚点字段标记 origin=ai */
export function integrateAiCandidates(
  rawFields: CandidateField[],
): AiCandidateResult {
  const fields: CandidateField[] = [];
  const pendingVerification: AiCandidateResult['pendingVerification'] = [];
  for (const field of rawFields) {
    if (!field.anchor) {
      pendingVerification.push({
        field: field.field,
        value: field.value,
        reason: 'AI 结果缺少原文锚点，只能待核对',
      });
      continue;
    }
    fields.push({
      ...field,
      origin: 'ai',
      anchor: field.anchor,
      needsHumanConfirm: true,
    });
  }
  return { fields, pendingVerification };
}
