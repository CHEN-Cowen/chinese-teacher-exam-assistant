import { describe, expect, it } from 'vitest';
import {
  canonicalSubjectCode,
  inferStageFromText,
  isOpenSubject,
  OPEN_SUBJECT_CODES,
  resolveSubject,
  resolveSubjectList,
  subjectDefinition,
  SUBJECTS,
  unitHasOpenSubject,
  unitSubjectCodes,
} from './subject-catalog.js';

describe('全学科字典', () => {
  it('每个学科名称都能解析回自身，代码稳定且唯一', () => {
    const codes = SUBJECTS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const definition of SUBJECTS) {
      const result = resolveSubject(definition.name);
      expect(result.status).toBe('resolved');
      expect(result.code).toBe(definition.code);
    }
    expect(OPEN_SUBJECT_CODES.length).toBe(SUBJECTS.length);
    expect(OPEN_SUBJECT_CODES).toContain('physics');
    expect(OPEN_SUBJECT_CODES).toContain('preschool');
  });

  it('识别学段前缀并拆出学科', () => {
    const primary = resolveSubject('小学语文');
    expect(primary.status).toBe('resolved');
    expect(primary.code).toBe('chinese');
    expect(primary.stage).toBe('primary');
    expect(inferStageFromText('初中数学')).toBe('middle');
    expect(inferStageFromText('高中物理')).toBe('high');
  });

  it('官方括号写法可识别，但不做跨学科猜测', () => {
    const result = resolveSubject('语文（小学）');
    expect(result.status).toBe('resolved');
    expect(result.code).toBe('chinese');
    expect(result.stage).toBe('primary');

    const combined = resolveSubject('语文数学');
    expect(combined.status).toBe('unknown');
    expect(combined.reviewRequired).toBe(true);
  });

  it('歧义表述返回 ambiguous 且列出候选，不自动选择', () => {
    const art = resolveSubject('艺术');
    expect(art.status).toBe('ambiguous');
    expect(art.candidates).toEqual(expect.arrayContaining(['music', 'art']));
    expect(art.code).toBeUndefined();

    const computer = resolveSubject('计算机');
    expect(computer.status).toBe('ambiguous');
    expect(computer.candidates).toEqual(
      expect.arrayContaining(['it', 'vocational']),
    );
  });

  it('未知学科保留原文并要求审核', () => {
    const result = resolveSubject('天文观测');
    expect(result.status).toBe('unknown');
    expect(result.input).toBe('天文观测');
    expect(result.reviewRequired).toBe(true);
  });

  it('旧代码归一，避免同一学科多套码', () => {
    expect(canonicalSubjectCode('physical_education')).toBe('pe');
    expect(canonicalSubjectCode('information_technology')).toBe('it');
    expect(canonicalSubjectCode('kindergarten')).toBe('preschool');
    expect(isOpenSubject('physical_education')).toBe(true);
    expect(subjectDefinition('it')?.name).toBe('信息技术');
  });

  it('岗位多学科：任一开放即通过，旧单值仍兼容', () => {
    expect(unitSubjectCodes({ subject: 'chinese' })).toEqual(['chinese']);
    expect(
      unitSubjectCodes({ subject: 'chinese', subjects: ['physics', 'chemistry'] }),
    ).toEqual(['physics', 'chemistry', 'chinese']);
    expect(unitHasOpenSubject({ subject: 'unknown_subject' })).toBe(false);
    expect(
      unitHasOpenSubject({ subject: 'chinese', subjects: ['unknown_subject'] }),
    ).toBe(true);
  });

  it('批量解析把可确定与待审核分开', () => {
    const result = resolveSubjectList(['小学语文', '艺术', '天文观测'], {
      stage: 'primary',
    });
    expect(result.codes).toEqual(['chinese']);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.reviewRequired).toBe(true);
  });
});
