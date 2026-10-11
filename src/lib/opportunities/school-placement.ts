/**
 * 报考单元「具体任教学校」展示派生（纯函数，与后端 school-placement.ts 同口径）。
 *
 * 硬性规则：招聘单位（区教育局/学校联盟）和岗位组名称都不是最终任教学校。
 * - schoolPlacement.specified：官方岗位表逐校列明，展示具体校名；
 * - unspecified 或未登记：展示「具体学校未知」+ 官方口径说明，
 *   按分择岗/统一调配绝不展示虚构校名，也不允许回退到 unit.name。
 */
import type { SchoolPlacementDTO } from "./api-types";

interface PlacementInput {
  allocation: { code: string; description?: string };
  schoolPlacement?: SchoolPlacementDTO;
}

/** 各分配方式在「未显式登记定岗学校」时的保守说明 */
export const ALLOCATION_UNKNOWN_SCHOOL_NOTE: Record<string, string> = {
  direct_school: "按报考学校直接定岗，具体学校以官方岗位计划表为准",
  score_based_choice: "按考试成绩择岗录取，录取前具体学校未知",
  unified_assignment: "录取后由主管部门统一调配，具体学校未知",
  other: "定岗方式与具体学校以公告及岗位计划表为准",
};

export interface SchoolDisplay {
  /** 只有官方逐校列明才为 true */
  known: boolean;
  schoolName: string | null;
  /** 未知时的官方口径说明 */
  note: string | null;
}

export function deriveSchoolDisplay(unit: PlacementInput): SchoolDisplay {
  const placement = unit.schoolPlacement;
  if (placement?.status === "specified") {
    return { known: true, schoolName: placement.schoolName, note: null };
  }
  const note =
    placement?.status === "unspecified"
      ? placement.note
      : (ALLOCATION_UNKNOWN_SCHOOL_NOTE[unit.allocation.code] ??
        ALLOCATION_UNKNOWN_SCHOOL_NOTE.other!);
  return { known: false, schoolName: null, note };
}

/** 卡片/详情统一文案行；未知时格式为「具体学校未知（说明）」 */
export function schoolDisplayText(unit: PlacementInput): string {
  const display = deriveSchoolDisplay(unit);
  return display.known
    ? display.schoolName!
    : `具体学校未知（${display.note}）`;
}
