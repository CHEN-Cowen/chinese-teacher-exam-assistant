/**
 * 报考单元「具体任教学校」派生（纯函数）。
 *
 * 硬性口径：招聘单位（区教育局/学校联盟）与岗位组名称都不是最终任教学校。
 * - 官方岗位表逐校列明时，台账显式登记 schoolPlacement.status='specified'；
 * - 统一调配 / 按分择岗 / 官方未公布时必须是 unspecified，
 *   未显式登记的单元按 allocation 给保守说明，绝不从 unit.name 推断校名。
 */
import type {
  AllocationMethodCode,
  ApplicationUnit,
  SchoolPlacement,
} from './types.js';

/** 各分配方式在「未显式登记定岗学校」时的统一保守口径 */
export const ALLOCATION_UNKNOWN_SCHOOL_NOTE: Record<
  AllocationMethodCode,
  string
> = {
  direct_school: '按报考学校直接定岗；具体任教学校以官方岗位计划表为准',
  score_based_choice: '按考试成绩择岗录取，录取前具体任教学校未知',
  unified_assignment: '录取后由主管部门统一调配，具体任教学校未知',
  other: '定岗方式与具体任教学校以公告及岗位计划表为准',
};

type PlacementInput = Pick<ApplicationUnit, 'allocation' | 'schoolPlacement'>;

/** 返回单元最终的定岗状态：显式登记优先，否则按分配方式保守派生为未知 */
export function deriveSchoolPlacement(unit: PlacementInput): SchoolPlacement {
  if (unit.schoolPlacement) return unit.schoolPlacement;
  return {
    status: 'unspecified',
    note:
      ALLOCATION_UNKNOWN_SCHOOL_NOTE[unit.allocation.code] ??
      ALLOCATION_UNKNOWN_SCHOOL_NOTE.other,
  };
}

/** 具体任教学校是否已知（只有官方逐校列明的 specified 才为 true） */
export function isSchoolKnown(unit: PlacementInput): boolean {
  return deriveSchoolPlacement(unit).status === 'specified';
}

/**
 * 用户端展示文案：已知给校名；未知给「具体学校未知（官方口径说明）」。
 * 任何未知场景都不允许回退到 unit.name。
 */
export function schoolDisplayText(unit: PlacementInput): string {
  const placement = deriveSchoolPlacement(unit);
  return placement.status === 'specified'
    ? placement.schoolName
    : `具体学校未知（${placement.note}）`;
}
