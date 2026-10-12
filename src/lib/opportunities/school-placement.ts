/**
 * 报考单元「具体任教学校」展示派生（纯函数，与后端 school-placement.ts 同口径）。
 *
 * 硬性规则（v7.1 M4）：招聘单位（区教育局/学校联盟）和岗位组名称都不是最终任教学校。
 * - schoolPlacement.specified：官方岗位表逐校列明，展示校名和市区；
 * - unspecified 或未登记：按分配方式给官方口径说明（录用后选岗/统一调配不虚构校名，
 *   也不允许回退到 unit.name），未知信息明确显示未知，不通过猜测补齐。
 */
import type { SchoolPlacementDTO } from "./api-types";

interface PlacementInput {
  allocation: { code: string; description?: string };
  schoolPlacement?: SchoolPlacementDTO;
}

/** 各分配方式在「未显式登记定岗学校」时的保守说明（v7.1 M4 文案口径） */
export const ALLOCATION_UNKNOWN_SCHOOL_NOTE: Record<string, string> = {
  direct_school: "具体学校未知：按报考学校直接定岗，以官方岗位计划表为准",
  score_based_choice: "录用后选岗，具体学校以官方安排为准",
  unified_assignment: "录取后统一调配，具体学校以官方安排为准",
  other: "具体学校以公告及岗位计划表为准",
};

export interface SchoolDisplay {
  /** 只有官方逐校列明才为 true */
  known: boolean;
  schoolName: string | null;
  /** 未知时的官方口径说明（完整句子，可直接展示） */
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

/**
 * 卡片/详情统一文案行（v7.1 M4）：
 * - 已知：`校名（市·区）`——传入 regionText 时附市区；
 * - 未知：直接给官方口径说明（录用后选岗/统一调配/以官方岗位计划表为准），
 *   不虚构校名，不把招聘单位或岗位组名当作学校。
 */
export function schoolDisplayText(unit: PlacementInput, regionText?: string): string {
  const display = deriveSchoolDisplay(unit);
  if (display.known) {
    return regionText ? `${display.schoolName}（${regionText}）` : display.schoolName!;
  }
  return display.note!;
}
