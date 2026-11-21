import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  extractiveAnswer,
  hybridScore,
  lexicalScore,
  parseCitations,
  tokenize,
  validateCitations,
} from './qa-domain.js';

describe('问答检索纯函数', () => {
  it('中文二元组切词，不会把整句当作一个词', () => {
    expect(tokenize('报名时间')).toEqual(['报名', '名时', '时间']);
    expect(tokenize('2026年 报名')).toContain('2026');
  });

  it('词法相关度：命中越多分越高，无关材料为 0', () => {
    const question = '报名截止时间是什么时候';
    expect(lexicalScore(question, '报名截止时间为 2026 年 11 月 15 日')).toBeCloseTo(0.5, 5);
    expect(lexicalScore(question, '招聘岗位包括语文教师')).toBe(0);
  });

  it('余弦相似度处理未归一化向量与空向量', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('向量缺失时混合分数退回词法分，不虚增', () => {
    expect(hybridScore(0.4, null)).toBeCloseTo(0.4, 5);
    expect(hybridScore(0.4, 0.9)).toBeGreaterThan(0.6);
  });

  it('引用解析去重并按出现顺序', () => {
    expect(parseCitations('依据[2][1]，另见[2]。')).toEqual([2, 1]);
  });

  it('引用校验区分有效与越界编号', () => {
    const result = validateCitations('依据[1]，参考[9]。', 3);
    expect(result.valid).toEqual([1]);
    expect(result.invalid).toEqual([9]);
    expect(result.hasCitation).toBe(true);
    expect(validateCitations('没有引用', 3)).toEqual({
      valid: [],
      invalid: [],
      hasCitation: false,
    });
  });

  it('抽取式回答带编号且限制条数', () => {
    const answer = extractiveAnswer([
      { content: '报名截止时间为 2026 年 11 月 15 日。' },
      { content: '笔试时间为 2026 年 11 月 22 日。' },
      { content: '面试时间另行通知。' },
      { content: '第四条不应出现。' },
    ]);
    expect(answer).toContain('[1]');
    expect(answer).toContain('[3]');
    expect(answer).not.toContain('[4]');
    expect(answer).not.toContain('第四条');
  });
});
