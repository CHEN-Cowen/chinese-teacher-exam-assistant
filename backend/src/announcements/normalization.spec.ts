/**
 * WB3：语义保真标准化测试（师范保留、学历不合并、编制不猜测、日期不推断、URL 不猜测）。
 */
import { describe, expect, it } from 'vitest';
import {
  cleanText,
  classifyEmploymentNature,
  normalizeEducation,
  normalizeEmploymentNature,
  normalizeEntryUrl,
  normalizeFieldValue,
  normalizeMajor,
} from './normalization.js';

describe('语义保真标准化', () => {
  it('「师范」保留：汉语言文学（师范）标准化后仍包含师范', () => {
    const out = normalizeMajor('汉语言文学（师范）');
    expect(out).toContain('师范');
    expect(out).toContain('汉语言文学');
  });

  it('「本科」与「本科及以上」不合并', () => {
    const a = normalizeEducation('本科');
    const b = normalizeEducation('本科及以上');
    expect(a).not.toBe(b);
    expect(a).toBe('本科');
    expect(b).toBe('本科及以上');
  });

  it('全半角标点与空白归一，不改变含义', () => {
    expect(cleanText(' 汉语言文学（师范） ')).toBe('汉语言文学（师范）');
    // 半角括号转全角
    expect(cleanText('汉语言文学(师范)')).toBe('汉语言文学（师范）');
    // 全角 ASCII 数字归一
    expect(cleanText('３５周岁')).toBe('35周岁');
  });

  it('编制/用工性质不凭近义词归一：事业编制/合同制/员额制保持不同', () => {
    const a = normalizeEmploymentNature('事业编制');
    const b = normalizeEmploymentNature('合同制');
    const c = normalizeEmploymentNature('员额制');
    expect(a).toBe('事业编制');
    expect(b).toBe('合同制');
    expect(c).toBe('员额制');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('编制分类码仅在精确命中时附加，多义/未命中返回 undefined', () => {
    expect(classifyEmploymentNature('本次招聘人员纳入事业编制管理')).toBe(
      'public_institution_staff',
    );
    expect(classifyEmploymentNature('备案制管理')).toBe('record_filing');
    // 未命中返回 undefined
    expect(classifyEmploymentNature('事业单位工作人员')).toBeUndefined();
    // 多义（同时命中事业编制与编外）返回 undefined，不静默选一
    expect(classifyEmploymentNature('事业编制与编外并存')).toBeUndefined();
  });

  it('年龄基准日/例外保持独立，缺失不推断', () => {
    // 基准日与例外是不同字段，各自标准化后仍独立
    const basis = normalizeFieldValue('age_basis_date', '2026年11月5日');
    const exception = normalizeFieldValue(
      'age_exception',
      '硕士放宽至40周岁',
    );
    expect(basis).toBe('2026年11月5日');
    expect(exception).toBe('硕士放宽至40周岁');
    expect(basis).not.toBe(exception);
  });

  it('报名 URL 不猜测：非 http/https 或空值返回 null/空', () => {
    expect(normalizeEntryUrl(' https://www.example.gov.cn/apply ')).toBe(
      'https://www.example.gov.cn/apply',
    );
    // 纯文本拒绝
    expect(normalizeEntryUrl('请登录报名系统')).toBeNull();
    // 空值拒绝
    expect(normalizeEntryUrl('')).toBeNull();
    // 内网地址拒绝
    expect(normalizeEntryUrl('192.168.1.1/apply')).toBeNull();
  });

  it('normalizeFieldValue 按注册表策略分发', () => {
    expect(normalizeFieldValue('major', '汉语言文学(师范)')).toBe(
      '汉语言文学（师范）',
    );
    expect(normalizeFieldValue('official_entry', 'https://a.gov.cn/x')).toBe(
      'https://a.gov.cn/x',
    );
    // 未登记字段走 identity（机械清洗）
    expect(normalizeFieldValue('unknown_field', '  abc  ')).toBe('abc');
  });

  it('cleanText 空/非字符串安全', () => {
    expect(cleanText('')).toBe('');
    expect(cleanText('   ')).toBe('');
  });
});
