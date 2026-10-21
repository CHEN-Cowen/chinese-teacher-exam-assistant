/**
 * WB3：完整性与冲突报告 + 质量门禁（纯函数）。
 *
 * 目标：把“未知、冲突、语义保真、证据要求”变成可执行、可复算的规则，
 * 不让系统自行声称字段“正确率”。本模块只产生：
 * - 每岗位的完整性报告（expected / extracted / unknown / conflict 计数）；
 * - 缺证据的高影响字段、未人工确认的 AI/OCR 字段；
 * - 阻塞审核或阻塞发布的原因列表（每条带 scope 与 field 便于定位）；
 * - 可复算指标（完整性、采用率、修改率）——不伪造正确率。
 *
 * 门禁红线：
 * - pending / unknown / conflict 或高影响字段缺证据时，不得静默进入可发布状态；
 * - 可选字段 unknown 可进入人工审核，但必须在结果中可见；
 * - AI/OCR 的既有人工确认门禁继续有效；
 * - 错误信息带 scope 与 field，不输出敏感正文或完整签名 URL。
 */
import {
  groupFieldsByScope,
  normalizeCandidateField,
  type CandidateField,
  type ExtractionCandidate,
} from './domain.js';
import {
  HIGH_IMPACT_FIELD_SET,
  REQUIRED_FIELD_SET,
  UNKNOWN_ALLOWED_FIELD_SET,
  displayNameOf,
  isHighImpactField,
} from './field-registry.js';
import {
  evaluateChecklist,
  fixedDenominatorCompleteness,
  isRetrospective,
  type ChecklistEvaluation,
  type ExpectedChecklist,
} from './expected-checklist.js';

// ==================== 报告类型 ====================

/** 单个岗位（或公告公共范围）的完整性统计 */
export interface ScopeCompleteness {
  /** 岗位 key（公告公共范围为 'announcement'，未知范围为 'unknown'） */
  key: string;
  /** 期望覆盖的字段名（该范围内必需字段 + 已出现的可选字段） */
  expected: number;
  /** 已提取到值的字段数（status=extracted） */
  extracted: number;
  /** unknown 字段数 */
  unknown: number;
  /** conflict 字段数 */
  conflict: number;
  /** 该范围内所有字段名（去重） */
  fieldNames: string[];
}

/** 缺证据的高影响字段（带 scope + field + jobKey 定位） */
export interface MissingEvidenceIssue {
  field: string;
  scope: string;
  jobKey?: string;
  displayName: string;
}

/** 未人工确认的 AI/OCR 字段 */
export interface UnconfirmedAutoIssue {
  field: string;
  scope: string;
  jobKey?: string;
  origin: 'ai' | 'ocr';
}

/** 阻塞原因（带 scope + field 定位，可复算） */
export interface BlockReason {
  code:
    | 'high_impact_missing_evidence'
    | 'unconfirmed_auto_field'
    | 'conflict_field'
    | 'unknown_required_field'
    | 'empty_candidate';
  field?: string;
  scope?: string;
  jobKey?: string;
  /** 冲突字段的替代值数量（供冲突报告用） */
  alternativeCount?: number;
  message: string;
}

/** 候选完整性报告（整体 + 逐岗位） */
export interface CompletenessReport {
  /** 逐范围统计（announcement 公共 + 各 job + unknown） */
  scopes: ScopeCompleteness[];
  /** 缺证据的高影响字段列表 */
  missingEvidence: MissingEvidenceIssue[];
  /** 未人工确认的 AI/OCR 字段列表 */
  unconfirmedAuto: UnconfirmedAutoIssue[];
  /** 冲突字段列表（含替代值数量） */
  conflicts: Array<{
    field: string;
    scope: string;
    jobKey?: string;
    alternativeCount: number;
  }>;
  /** 阻塞审核的原因 */
  reviewBlockers: BlockReason[];
  /** 阻塞发布的原因 */
  publishBlockers: BlockReason[];
  /** 可复算指标（不声称“正确率”） */
  metrics: {
    /** 完整性 = extracted / expected（对每个范围取期望字段的已提取比例） */
    completeness: number;
    /** 采用率 = extracted / (extracted + unknown + conflict) */
    adoptionRate: number;
    /** 修改率 = 有 human decision 且 action=edit 的字段占比 */
    editRate: number;
  };
}

// ==================== 纯函数 ====================

/**
 * 对候选结果按 scope 分组，计算每个范围的完整性统计。
 * 期望字段数 = 该范围已出现的字段名 ∪ 该范围必需字段名（按 scope 语义）。
 *
 * 说明：必需字段名是全局集合，但公告公共范围与岗位范围的必需字段不同，
 * 这里按“已出现字段 ∪ 全局必需字段中 scope 匹配的字段”计算 expected，
 * 保证分母可由黄金样本人工复算（不含隐性字段）。
 */
export function computeScopeCompleteness(
  fields: CandidateField[],
): ScopeCompleteness[] {
  const groups = groupFieldsByScope(fields);
  const result: ScopeCompleteness[] = [];

  const pushScope = (key: string, scopeFields: CandidateField[]) => {
    const fieldNames = [...new Set(scopeFields.map((f) => f.field))];
    const expected = fieldNames.length;
    const extracted = scopeFields.filter(
      (f) => normalizeCandidateField(f).status === 'extracted',
    ).length;
    const unknown = scopeFields.filter(
      (f) => normalizeCandidateField(f).status === 'unknown',
    ).length;
    const conflict = scopeFields.filter(
      (f) => normalizeCandidateField(f).status === 'conflict',
    ).length;
    result.push({ key, expected, extracted, unknown, conflict, fieldNames });
  };

  pushScope('announcement', groups.announcement);
  for (const [jobKey, jobFields] of groups.jobs) {
    pushScope(jobKey, jobFields);
  }
  pushScope('unknown', groups.unknown);

  return result;
}

/**
 * 找出缺证据的高影响字段。
 * 规则：字段是高影响（从注册表派生）且没有 anchor，且 status !== unknown
 * （unknown 字段原文未写，不要求证据，但必须显式可见）。
 */
export function findMissingEvidence(
  fields: CandidateField[],
): MissingEvidenceIssue[] {
  const issues: MissingEvidenceIssue[] = [];
  for (const f of fields) {
    const norm = normalizeCandidateField(f);
    if (!isHighImpactField(f.field)) continue;
    if (norm.status === 'unknown') continue; // unknown 不要求证据
    if (f.anchor) continue;
    issues.push({
      field: f.field,
      scope: norm.scope,
      jobKey: norm.scope === 'job' ? (f.jobScope?.key ?? '') : undefined,
      displayName: displayNameOf(f.field),
    });
  }
  return issues;
}

/** 找出未人工确认的 AI/OCR 字段 */
export function findUnconfirmedAuto(
  fields: CandidateField[],
): UnconfirmedAutoIssue[] {
  const issues: UnconfirmedAutoIssue[] = [];
  for (const f of fields) {
    if (f.origin !== 'ai' && f.origin !== 'ocr') continue;
    if (f.humanConfirmedAt) continue;
    const norm = normalizeCandidateField(f);
    issues.push({
      field: f.field,
      scope: norm.scope,
      jobKey: norm.scope === 'job' ? (f.jobScope?.key ?? '') : undefined,
      origin: f.origin,
    });
  }
  return issues;
}

/** 找出冲突字段（含替代值数量） */
export function findConflicts(
  fields: CandidateField[],
): CompletenessReport['conflicts'] {
  const conflicts: CompletenessReport['conflicts'] = [];
  for (const f of fields) {
    const norm = normalizeCandidateField(f);
    if (norm.status !== 'conflict') continue;
    conflicts.push({
      field: f.field,
      scope: norm.scope,
      jobKey: norm.scope === 'job' ? (f.jobScope?.key ?? '') : undefined,
      alternativeCount: f.alternatives?.length ?? 0,
    });
  }
  return conflicts;
}

/**
 * 计算阻塞审核的原因。
 * 审核阻塞：高影响字段缺证据、AI/OCR 未确认（沿用既有门禁）。
 * 冲突与 unknown 不阻塞审核（进入审核等待人工裁决/补充），但在结果中可见。
 */
export function computeReviewBlockers(fields: CandidateField[]): BlockReason[] {
  const blockers: BlockReason[] = [];
  for (const issue of findMissingEvidence(fields)) {
    blockers.push({
      code: 'high_impact_missing_evidence',
      field: issue.field,
      scope: issue.scope,
      jobKey: issue.jobKey,
      message: `高影响字段缺少证据锚点：${issue.scope}${issue.jobKey ? ':' + issue.jobKey : ''}.${issue.field}（${issue.displayName}）`,
    });
  }
  for (const issue of findUnconfirmedAuto(fields)) {
    blockers.push({
      code: 'unconfirmed_auto_field',
      field: issue.field,
      scope: issue.scope,
      jobKey: issue.jobKey,
      message: `AI/OCR 字段未经人工确认：${issue.scope}${issue.jobKey ? ':' + issue.jobKey : ''}.${issue.field}`,
    });
  }
  return blockers;
}

/**
 * 计算阻塞发布的原因。
 * 发布阻塞在审核阻塞基础上，额外要求：
 * - 冲突字段必须人工裁决（不得静默进入发布）；
 * - 必需字段为 unknown 且不允许 unknown 时阻塞；
 * - 空候选阻塞。
 *
 * 注意：
 * - unknown 可选字段允许进入人工审核并可见，不阻塞发布；
 * - 「必需字段缺失」不作为硬发布门禁（旧公告级候选兼容：旧候选不含新增
 *   必需字段如 job_code/batch/official_entry，若硬性检查会破坏兼容），
 *   仅在完整性报告里以 expected 缺口体现，由人工审核把关。
 */
export function computePublishBlockers(fields: CandidateField[]): BlockReason[] {
  const blockers: BlockReason[] = [];

  if (fields.length === 0) {
    blockers.push({ code: 'empty_candidate', message: '候选结果为空，无法发布' });
    return blockers;
  }

  // 冲突字段阻塞发布（保留全部替代值待人工裁决）
  for (const c of findConflicts(fields)) {
    blockers.push({
      code: 'conflict_field',
      field: c.field,
      scope: c.scope,
      jobKey: c.jobKey,
      alternativeCount: c.alternativeCount,
      message: `冲突字段未经人工裁决：${c.scope}${c.jobKey ? ':' + c.jobKey : ''}.${c.field}（${c.alternativeCount} 个替代值）`,
    });
  }

  // 必需字段为 unknown 且不允许 unknown → 阻塞发布（未知不得静默可发布）
  for (const required of REQUIRED_FIELD_SET) {
    if (UNKNOWN_ALLOWED_FIELD_SET.has(required)) continue;
    const unknownOnly = fields
      .filter((f) => f.field === required)
      .every((f) => normalizeCandidateField(f).status === 'unknown');
    // 仅当字段出现且全部为 unknown 时才算“必需字段未知”
    const present = fields.some((f) => f.field === required);
    if (present && unknownOnly) {
      blockers.push({
        code: 'unknown_required_field',
        field: required,
        message: `必需字段为未知且不允许未知：${required}（${displayNameOf(required)}）`,
      });
    }
  }

  // 继承审核阻塞
  blockers.push(...computeReviewBlockers(fields));

  return blockers;
}

/**
 * 计算候选结果的完整性与门禁报告。
 * 不声称“正确率”；只给出可复算指标与阻塞原因。
 */
export function buildCompletenessReport(
  candidate: ExtractionCandidate,
): CompletenessReport {
  const fields = candidate.fields;
  const scopes = computeScopeCompleteness(fields);
  const missingEvidence = findMissingEvidence(fields);
  const unconfirmedAuto = findUnconfirmedAuto(fields);
  const conflicts = findConflicts(fields);
  const reviewBlockers = computeReviewBlockers(fields);
  const publishBlockers = computePublishBlockers(fields);

  // 可复算指标
  const totalExtracted = scopes.reduce((s, x) => s + x.extracted, 0);
  const totalUnknown = scopes.reduce((s, x) => s + x.unknown, 0);
  const totalConflict = scopes.reduce((s, x) => s + x.conflict, 0);
  const totalExpected = scopes.reduce((s, x) => s + x.expected, 0);
  const resolved = totalExtracted + totalUnknown + totalConflict;

  const metrics: CompletenessReport['metrics'] = {
    completeness: totalExpected > 0 ? totalExtracted / totalExpected : 0,
    adoptionRate: resolved > 0 ? totalExtracted / resolved : 0,
    editRate:
      fields.length > 0
        ? fields.filter((f) => f.decision?.action === 'edit').length / fields.length
        : 0,
  };

  return {
    scopes,
    missingEvidence,
    unconfirmedAuto,
    conflicts,
    reviewBlockers,
    publishBlockers,
    metrics,
  };
}

/** 便捷判定：候选是否可进入审核（无审核阻塞） */
export function canEnterReview(candidate: ExtractionCandidate): boolean {
  return buildCompletenessReport(candidate).reviewBlockers.length === 0;
}

/** 便捷判定：候选是否可发布（无发布阻塞） */
export function canPublishCandidate(candidate: ExtractionCandidate): boolean {
  return buildCompletenessReport(candidate).publishBlockers.length === 0;
}

/**
 * 断言可发布：存在阻塞原因则抛错（错误带 scope 与 field）。
 * 供 service 层在发布动作前调用，避免静默进入可发布状态。
 */
export function assertPublishable(candidate: ExtractionCandidate): void {
  const blockers = buildCompletenessReport(candidate).publishBlockers;
  if (blockers.length > 0) {
    const first = blockers[0]!;
    throw new Error(first.message);
  }
}

// 再导出常量，供需要显式引用的调用方使用（单一事实源）
export { HIGH_IMPACT_FIELD_SET, REQUIRED_FIELD_SET, UNKNOWN_ALLOWED_FIELD_SET };

// ==================== M2：固定分母质量报告（基于期望清单） ====================

/**
 * M2 固定分母质量报告：把「期望清单 + 候选输出」评估为可复算的质量状态。
 *
 * 与 WB3 `buildCompletenessReport` 的区别：
 * - WB3 的 `expected` 从候选「已出现字段」反推，漏抽会缩小分母；
 * - 本报告的分母来自**预先确认的清单**（固定分母），整字段漏抽、整岗位漏抽都会被
 *   点名（`should_have_but_missing`），零输出岗位也出现。
 *
 * 兼容：无清单的任务返回 `hasChecklist=false`，调用方显示「未建立固定分母，
 * 完整性未评估」；不把 legacy 缺失资料冒充高完整度。有清单时保留 WB3 报告
 * 的冲突/缺证据/未确认门禁（这些仍然有效）。
 */
export interface ChecklistQualityReport {
  /** 是否有固定分母（清单） */
  hasChecklist: boolean;
  /** 清单版本（无清单为 null） */
  checklistVersion: number | null;
  /** 清单来源：independent / retrospective */
  checklistSource: ChecklistEvaluation['checklistSource'] | null;
  /** 固定分母评估（逐槽位结果 + 指标） */
  evaluation: ChecklistEvaluation;
  /** 固定分母完整性 = extracted / 有效分母；无清单或分母为 0 时为 null */
  fixedDenominatorCompleteness: number | null;
  /** 回顾性核对标记（候选之后补建，不冒称独立基准） */
  retrospective: boolean;
  /** 是否应显示「未建立固定分母，完整性未评估」 */
  completenessNotEvaluated: boolean;
}

/**
 * 构建固定分母质量报告。
 *
 * @param checklist 期望清单（可空）
 * @param candidate 候选结果（实际输出）
 * @param unverifiableScopes 无法核验的来源集合（可选）
 */
export function buildChecklistQuality(
  checklist: ExpectedChecklist | null | undefined,
  candidate: ExtractionCandidate,
  unverifiableScopes?: ReadonlySet<string>,
): ChecklistQualityReport {
  const evaluation = evaluateChecklist(
    checklist,
    candidate.fields.map((f) => {
      const norm = normalizeCandidateField(f);
      return {
        field: f.field,
        value: f.value,
        scope: norm.scope,
        jobScope: f.jobScope,
        status: norm.status,
        alternatives: f.alternatives,
      };
    }),
    { unverifiableScopes },
  );

  return {
    hasChecklist: evaluation.hasChecklist,
    checklistVersion: evaluation.checklistVersion ?? null,
    checklistSource: evaluation.checklistSource ?? null,
    evaluation,
    fixedDenominatorCompleteness: fixedDenominatorCompleteness(evaluation),
    retrospective: isRetrospective(checklist),
    completenessNotEvaluated: !evaluation.hasChecklist,
  };
}
