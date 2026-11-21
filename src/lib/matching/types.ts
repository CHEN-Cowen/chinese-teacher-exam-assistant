/**
 * 资格匹配结果类型（PRD 7.4）。
 *
 * 单条件四值：PASS / FAIL / UNKNOWN / MANUAL_REVIEW
 * 机会总结果四档：初步符合 / 补充信息后判断 / 建议人工确认 / 明确不符合
 */
import type { RequirementDimension } from "@/lib/announcements/types";

/** 单条件判定值 */
export type MatchValue = "PASS" | "FAIL" | "UNKNOWN" | "MANUAL_REVIEW";

/** 机会总结果（用户可见四档） */
export type OpportunityMatchStatus =
  | "preliminary_eligible" // 初步符合
  | "need_more_info" // 补充信息后判断
  | "manual_review" // 建议人工确认
  | "not_eligible"; // 明确不符合

/** 单个条件维度的判定结果（逐项可解释） */
export interface MatchDimensionResult {
  /** 地区维度没有 requirement id，使用固定值 "region" */
  requirementId: string;
  dimension: RequirementDimension;
  value: MatchValue;
  /** 面向用户的一句话依据（含公告口径） */
  reason: string;
  /** 是否硬性条件不满足（用于排序与解释） */
  hard: boolean;
  /** 用户事实摘要（说明采用哪条资料/哪一阶段） */
  userFact?: string;
  /** 专业条件实际采用的教育经历 */
  adoptedEducation?: {
    experienceId: string;
    stage?: string;
    majorFullName: string;
  }[];
  /** 该条件下一步动作 */
  nextStep?: string;
}

/** 匹配前置闸门（不参与四值聚合的收录/时效判断） */
export type GateCode =
  | "subject_not_open" // 学科当前未开放
  | "registration_unconfirmed" // 报名时间尚未公布
  | "registration_closed" // 报名已截止
  | "out_of_scope_nature" // 用工性质不在收录范围
  | "announcement_withdrawn" // 公告已取消/失效
  | "source_unavailable" // 官方来源巡检确认不可访问（撤稿/404/域名失效）
  | "no_official_source" // 没有已核对的官方来源
  | "evidence_not_reviewed" // 高影响证据未经人工复核
  | "evidence_stale"; // 核对记录超期

export interface GateResult {
  code: GateCode;
  passed: boolean;
  reason: string;
}

/** 一个报考单元的完整匹配结果（页面只读这个结构，不自行计算） */
export interface OpportunityMatchResult {
  unitId: string;
  announcementId: string;
  versionId: string;
  /** 闸门是否全部通过；任一不通过不进入主要推荐 */
  gates: GateResult[];
  dimensions: MatchDimensionResult[];
  overall: OpportunityMatchStatus;
  /** 资格初步符合但不在“必须接受”的地区范围内（偏好范围外，不是不符合） */
  preferenceOutOfScope?: boolean;
  /** 一句话匹配依据（用于机会卡） */
  summary: string;
}

/** 有效机会（北极星指标口径，PRD 3.3） */
export interface ValidOpportunity {
  unitId: string;
  match: OpportunityMatchResult;
}

export const MATCH_STATUS_LABELS: Record<OpportunityMatchStatus, string> = {
  preliminary_eligible: "初步符合",
  need_more_info: "补充信息后判断",
  manual_review: "建议人工确认",
  not_eligible: "明确不符合",
};
