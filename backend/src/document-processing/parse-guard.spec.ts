/**
 * v7.2 附件解析：解析安全防护测试（超大文件/空文件/压缩炸弹预算/截断）。
 */
import { describe, expect, it } from 'vitest';
import { Budget, GuardError, assertWithinLimits, clampText, readParseLimits } from './parse-guard.js';

const limits = readParseLimits({
  DOC_PARSE_MAX_BYTES: '1000',
  DOC_PARSE_MAX_PDF_PAGES: '5',
  DOC_PARSE_MAX_SHEETS: '3',
  DOC_PARSE_MAX_BLOCKS: '10',
  DOC_PARSE_MAX_CELLS: '5',
  DOC_PARSE_MAX_BLOCK_TEXT: '10',
});

describe('assertWithinLimits', () => {
  it('空文件拒绝', () => {
    expect(() => assertWithinLimits(Buffer.alloc(0), limits)).toThrowError(GuardError);
    try {
      assertWithinLimits(Buffer.alloc(0), limits);
    } catch (error) {
      expect((error as GuardError).code).toBe('EMPTY_FILE');
    }
  });

  it('超大文件拒绝（FILE_TOO_LARGE，不进入解析）', () => {
    const big = Buffer.alloc(1001);
    try {
      assertWithinLimits(big, limits);
      expect.unreachable('应当抛错');
    } catch (error) {
      expect((error as GuardError).code).toBe('FILE_TOO_LARGE');
    }
  });

  it('上限内通过', () => {
    expect(() => assertWithinLimits(Buffer.alloc(10), limits)).not.toThrow();
  });
});

describe('Budget（防压缩炸弹）', () => {
  it('预算内正常消耗', () => {
    const budget = new Budget(3);
    budget.spend();
    budget.spend(2);
    expect(() => budget.spend()).toThrowError(GuardError);
    try {
      budget.spend();
    } catch (error) {
      expect((error as GuardError).code).toBe('CELL_BUDGET_EXCEEDED');
    }
  });
});

describe('clampText', () => {
  it('超长截断并标记', () => {
    const [text, truncated] = clampText('x'.repeat(11), 10);
    expect(text).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  it('未超长原样返回', () => {
    const [text, truncated] = clampText('短文本', 10);
    expect(text).toBe('短文本');
    expect(truncated).toBe(false);
  });
});

describe('readParseLimits（环境变量）', () => {
  it('缺省回退默认值', () => {
    const fallback = readParseLimits({});
    expect(fallback.maxBlocks).toBe(20_000);
    expect(fallback.maxCells).toBe(500_000);
  });

  it('非法取值回退默认值', () => {
    const fallback = readParseLimits({ DOC_PARSE_MAX_BYTES: 'not-a-number' });
    expect(fallback.maxBytes).toBe(20 * 1024 * 1024);
  });
});
