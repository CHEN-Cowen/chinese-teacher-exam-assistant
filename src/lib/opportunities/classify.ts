/**
 * 机会工作台三标签分类（v7.2 单一事实源）。
 *
 * 这是 `/opportunities` 三标签（优先机会 / 补充后判断 / 偏好范围外）的唯一分类入口：
 * 任何单元在这一步只属于一个桶，标签严格互斥，UI 不再各自判定。
 *
 * 互斥规则（PRD v7.2 §7.5 / D03，按以下顺序首次命中即返回）：
 * 1. 闸门失败（含截止/来源失效/撤回/未开放等）→ excluded（留档区，不进入正常机会）
 * 2. 非 actionable（未发布或证据未到 official）→ excluded
 * 3. 后端标记 preferenceOutOfScope（资格初步符合但不在“必须接受”地区内）→ outOfScope
 * 4. overall=preliminary_eligible → priority（资格和偏好都匹配）
 * 5. overall=need_more_info → supplement/unknown（补充后判断）
 * 6. overall=manual_review → supplement/consult（建议向招聘单位确认，进入补充桶但卡片专属态）
 * 7. 旧数据 overall=not_eligible 且仅地区维度 FAIL → outOfScope（兼容）
 * 8. 其余 not_eligible → excluded（明确不符合不进入主标签）
 *
 * 不复制的判定：闸门状态、维度 FAIL、overall 结论都来自后端匹配引擎，
 * 本函数只把后端结论映射到三标签桶，不做任何资格判定。
 */
import type { UnitMatchDTO } from "./api-types";
import { primaryFailedGate } from "@/lib/gate-states";
import {
  isActionableRecommendation,
  isRegionOnlyMismatch,
} from "./list-view";

export type OpportunityTab =
  | "priority"
  | "supplement"
  | "outOfScope"
  | "excluded";

/** 补充后判断桶内的子态：unknown=缺信息待补，consult=建议向招聘单位确认 */
export type SupplementVariant = "unknown" | "consult";

export interface ClassificationResult {
  tab: OpportunityTab;
  /** 仅在 tab=supplement 时有意义；其他 tab 为 null */
  supplementVariant: SupplementVariant | null;
}

/**
 * 把单个单元分到唯一桶。pure function，无副作用，可在视图模型与测试中复用。
 *
 * 注意：调用方应先确保单元已经通过 isPublishedForUser（demo 或 human_reviewed）。
 * 本函数内部用 isActionableRecommendation 兜底，未发布或证据未到 official 的单元
 * 一律落 excluded，避免 AI 初核记录混入正常机会标签。
 */
export function classifyOpportunity(unit: UnitMatchDTO): ClassificationResult {
  // 1. 闸门失败：不可用/截止/来源失效/撤回/未开放/待复核等一律不进正常机会
  if (primaryFailedGate(unit.gates) !== null) {
    return { tab: "excluded", supplementVariant: null };
  }
  // 2. 非 actionable：未发布或证据未 official——前端兜底，不进主标签
  //    isActionableRecommendation 已含 isPublishedForUser + 闸门 + 官方链接 + 证据状态
  //    但需要指定 expectedOverall，这里以 unit.overall 为准
  if (!isActionableRecommendation(unit, unit.overall)) {
    return { tab: "excluded", supplementVariant: null };
  }
  // 3. 偏好范围外（D03）：资格维度没有硬 FAIL，但岗位不在“必须接受”的地区内。
  //    后端直接标记 preferenceOutOfScope，资格结论仍是 preliminary_eligible；
  //    这类单元进入 outOfScope，不计入 priority/有效机会。
  if (unit.preferenceOutOfScope === true) {
    return { tab: "outOfScope", supplementVariant: null };
  }
  switch (unit.overall) {
    case "preliminary_eligible":
      return { tab: "priority", supplementVariant: null };
    case "need_more_info":
      return { tab: "supplement", supplementVariant: "unknown" };
    case "manual_review":
      return { tab: "supplement", supplementVariant: "consult" };
    case "not_eligible":
      // 兼容旧数据：仅地区维度 FAIL → 偏好范围外（不是资格不符合）
      if (isRegionOnlyMismatch(unit)) {
        return { tab: "outOfScope", supplementVariant: null };
      }
      // 非地区 FAIL → 明确不符合，不进入主标签
      return { tab: "excluded", supplementVariant: null };
    default:
      // 理论不可达：overall 是有限联合类型。兜底落 excluded 防止 UI 崩溃。
      return { tab: "excluded", supplementVariant: null };
  }
}

/** 便捷谓词：单元是否落在指定桶（用于卡片按桶过滤或测试断言） */
export function isTab(unit: UnitMatchDTO, tab: OpportunityTab): boolean {
  return classifyOpportunity(unit).tab === tab;
}
