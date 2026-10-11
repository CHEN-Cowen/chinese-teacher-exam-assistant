import { describe, expect, it } from 'vitest';
import {
  ALLOCATION_UNKNOWN_SCHOOL_NOTE,
  deriveSchoolPlacement,
  isSchoolKnown,
  schoolDisplayText,
} from './school-placement.js';
import type { ApplicationUnit, SchoolPlacement } from './types.js';

/** 只构造派生函数关心的字段，避免大夹具 */
function unitLike(
  code: ApplicationUnit['allocation']['code'],
  schoolPlacement?: SchoolPlacement,
  name = '某区教育局·小学语文教师岗位组',
): Pick<ApplicationUnit, 'allocation' | 'schoolPlacement' | 'name'> {
  return { name, allocation: { code, description: code }, schoolPlacement };
}

describe('学校定岗派生：招聘单位/岗位组不得被当作最终学校', () => {
  it('未显式登记定岗学校时，四种分配方式一律派生为 unspecified', () => {
    for (const code of [
      'direct_school',
      'score_based_choice',
      'unified_assignment',
      'other',
    ] as const) {
      const placement = deriveSchoolPlacement(unitLike(code));
      expect(placement.status).toBe('unspecified');
      expect(placement).toHaveProperty('note');
      expect(ALLOCATION_UNKNOWN_SCHOOL_NOTE[code].length).toBeGreaterThan(5);
      expect(isSchoolKnown(unitLike(code))).toBe(false);
    }
  });

  it('按分择岗/统一调配即使名称含校名式字样，也绝不从 unit.name 推断学校', () => {
    const u = unitLike(
      'score_based_choice',
      undefined,
      '苏州市实验小学联盟·语文教师（按分择岗）',
    );
    const text = schoolDisplayText(u);
    expect(text).toContain('具体学校未知');
    expect(text).not.toContain('苏州市实验小学联盟');
    expect(isSchoolKnown(u)).toBe(false);
  });

  it('显式 specified 才展示具体校名', () => {
    const u = unitLike('direct_school', {
      status: 'specified',
      schoolName: '杭州第二中学富春学校',
    });
    expect(isSchoolKnown(u)).toBe(true);
    expect(schoolDisplayText(u)).toBe('杭州第二中学富春学校');
  });

  it('显式 unspecified 的说明不会被分配方式默认文案覆盖', () => {
    const u = unitLike('other', {
      status: 'unspecified',
      note: '预告批次未逐校列明，以岗位计划表为准',
    });
    expect(deriveSchoolPlacement(u)).toEqual({
      status: 'unspecified',
      note: '预告批次未逐校列明，以岗位计划表为准',
    });
  });
});
