/**
 * WB3：字段注册表测试（单一事实源 + 标准化边界）。
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_REGISTRY,
  HIGH_IMPACT_FIELD_SET,
  allFieldNames,
  displayNameOf,
  getFieldRegistration,
  isHighImpactField,
  isRequiredField,
  isUnknownAllowed,
  normalizationStrategyOf,
} from './field-registry.js';

describe('字段注册表（单一事实源）', () => {
  it('字段名全局唯一，无重复注册', () => {
    const names = FIELD_REGISTRY.map((r) => r.field);
    expect(new Set(names).size).toBe(names.length);
  });

  it('覆盖提示词要求的全部字段（至少纳入清单）', () => {
    const requiredFields = [
      'job_code',
      'region',
      'unit_name',
      'stage',
      'subject',
      'headcount',
      'education',
      'degree',
      'major',
      'teacher_cert',
      'age',
      'age_basis_date',
      'age_exception',
      'hukou',
      'work_experience',
      'employment_nature',
      'registration_time',
      'registration_end_time',
      'materials',
      'official_entry',
      'batch',
    ];
    for (const f of requiredFields) {
      expect(allFieldNames()).toContain(f);
    }
  });

  it('每条注册项都有完整元数据（scope/highImpact/required/allowUnknown/evidence/normalization/displayName）', () => {
    for (const r of FIELD_REGISTRY) {
      expect(['announcement', 'job', 'both']).toContain(r.scope);
      expect(typeof r.highImpact).toBe('boolean');
      expect(typeof r.required).toBe('boolean');
      expect(typeof r.allowUnknown).toBe('boolean');
      expect(['required', 'optional', 'none']).toContain(r.evidence);
      expect(r.normalization).toBeTruthy();
      expect(r.displayName).toBeTruthy();
    }
  });

  it('高影响字段集合与注册表 highImpact 标记一致', () => {
    for (const r of FIELD_REGISTRY) {
      expect(HIGH_IMPACT_FIELD_SET.has(r.field)).toBe(r.highImpact);
    }
  });

  it('「师范」专业字段标准化策略为 preserve-major', () => {
    expect(normalizationStrategyOf('major')).toBe('preserve-major');
  });

  it('学历标准化策略为 education，编制为 employment-nature，入口为 url', () => {
    expect(normalizationStrategyOf('education')).toBe('education');
    expect(normalizationStrategyOf('employment_nature')).toBe('employment-nature');
    expect(normalizationStrategyOf('official_entry')).toBe('url');
  });

  it('isHighImpactField/isRequiredField/isUnknownAllowed 与注册表一致', () => {
    expect(isHighImpactField('education')).toBe(true);
    expect(isHighImpactField('degree')).toBe(true);
    expect(isRequiredField('education')).toBe(true);
    expect(isRequiredField('degree')).toBe(false);
    expect(isUnknownAllowed('degree')).toBe(true);
    expect(isUnknownAllowed('education')).toBe(false);
  });

  it('displayNameOf 未登记字段回退为字段名本身', () => {
    expect(displayNameOf('education')).toBe('学历');
    expect(displayNameOf('not_registered')).toBe('not_registered');
  });

  it('getFieldRegistration 未登记字段返回 undefined', () => {
    expect(getFieldRegistration('education')).toBeDefined();
    expect(getFieldRegistration('not_registered')).toBeUndefined();
  });
});
