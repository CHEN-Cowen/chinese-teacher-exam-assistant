/**
 * 抓取任务幂等键（jobId）单元测试。
 *
 * 回归守护（2026-10-22 生产事故）：BullMQ 拒绝「含冒号且分段数 ≠ 3」的自定义
 * jobId（报 "Custom Id cannot contain :"）。fetch 幂等键曾是 4 段，导致真实抓取时
 * 「发现成功、投递 document.fetch 全部失败」。这里锁定：所有 jobId 不含冒号/空格、
 * 确定性生成、不同输入产生不同键。
 */
import { describe, expect, it } from 'vitest';
import {
  computeCheckWindow,
  discoverJobId,
  extractJobId,
  fetchJobId,
  parseJobId,
  projectJobId,
} from './task-queue.js';

const UUID = 'f0a42c15-603d-4fd8-9219-9fad7a8b2534';

describe('抓取任务 jobId（BullMQ 兼容性）', () => {
  it.each([
    ['discover', discoverJobId(UUID, '1792605492957-bg67ce70')],
    ['fetch', fetchJobId(UUID, 'https://edu.nanjing.gov.cn/bsfw/zpzk/202601/t20260109_123.html', 'etag-1')],
    ['parse', parseJobId(UUID, 'pdf-parser@1.0.0')],
    ['extract', extractJobId(UUID, 'rule-field-extractor@2.0.0')],
    ['project', projectJobId(UUID, 'projector@1.0.0')],
  ])('%s jobId 不含冒号与空格（BullMQ 自定义 id 限制）', (_name, id) => {
    expect(id).not.toContain(':');
    expect(id).not.toContain(' ');
  });

  it('相同输入生成相同键（幂等），不同 URL 生成不同键', () => {
    const urlA = 'https://edu.nanjing.gov.cn/a.html';
    const urlB = 'https://edu.nanjing.gov.cn/b.html';
    expect(fetchJobId(UUID, urlA, '')).toBe(fetchJobId(UUID, urlA, ''));
    expect(fetchJobId(UUID, urlA, '')).not.toBe(fetchJobId(UUID, urlB, ''));
  });

  it('version hint 缺省回退noversion，不影响幂等语义', () => {
    expect(fetchJobId(UUID, 'https://x.example/a', '')).toBe(
      fetchJobId(UUID, 'https://x.example/a', ''),
    );
  });
});

describe('computeCheckWindow', () => {
  it('schedule 触发对齐到周期窗口（同窗口幂等）', () => {
    const t = new Date('2026-10-22T02:00:00+08:00').getTime();
    const a = computeCheckWindow('schedule', 60, new Date(t));
    const b = computeCheckWindow('schedule', 60, new Date(t + 30_000));
    expect(a).toBe(b);
  });

  it('admin/retry 使用独立窗口（默认 now/nonce，不合并）', () => {
    const now = new Date('2026-10-22T02:00:00+08:00');
    const a = computeCheckWindow('admin', 60, now, 'nonce-1');
    const b = computeCheckWindow('admin', 60, now, 'nonce-2');
    expect(a).not.toBe(b);
  });
});
