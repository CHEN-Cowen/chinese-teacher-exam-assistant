import { describe, expect, it } from 'vitest';
import { reconcileSource, type SourceChecklist, type SourceObservation } from './source-reconciliation.js';

const checklist = (): SourceChecklist => ({
  sourceKey: 'test-source', listUrl: 'https://example.gov.cn/list',
  window: { from: '2026-01-01', to: '2026-01-31' },
  verification: 'verified', checkedAt: '2026-10-24T00:00:00Z',
  entries: [
    { url: 'https://example.gov.cn/a', title: '招聘公告', publishedAt: '2026-01-09', disposition: 'target', reason: '初始招聘' },
    { url: 'https://example.gov.cn/b', title: '取消公告', publishedAt: '2026-01-10', disposition: 'target', reason: '高影响变更' },
    { url: 'https://example.gov.cn/c', title: '成绩', publishedAt: '2026-01-11', disposition: 'excluded', reason: '后续流程' },
  ],
});
const observed = (extra: Partial<SourceObservation> = {}): SourceObservation => ({
  url: 'https://example.gov.cn/a#top', title: '招聘公告', publishedAt: '2026-01-09', outcome: 'discovered', materialComplete: true, ...extra,
});

describe('S4 独立清单对账', () => {
  it('固定分母包含取消公告，排除后续流程；重复观察不放大召回', () => {
    const result = reconcileSource(checklist(), [observed(), observed()]);
    expect(result.recall).toEqual({ numerator: 1, denominator: 2, ratio: 0.5 });
    expect(result.rows[1].outcome).toBe('not_discovered');
    expect(result.excluded).toHaveLength(1);
  });
  it.each(['access_failed', 'parse_failed', 'misclassified', 'pending_manual'] as const)('明确保留 %s，失败不算材料完整', (outcome) => {
    const result = reconcileSource(checklist(), [observed({ outcome })]);
    expect(result.rows[0].outcome).toBe(outcome);
    expect(result.materialCompleteness.numerator).toBe(0);
  });
  it('标题/日期失配不能只按 URL 自证命中', () => {
    expect(reconcileSource(checklist(), [observed({ title: '其他公告' })]).rows[0].outcome).toBe('metadata_mismatch');
  });
  it('待核验或零分母不输出比例', () => {
    expect(reconcileSource({ ...checklist(), verification: 'pending' }, [observed()]).recall.ratio).toBeNull();
    expect(reconcileSource({ ...checklist(), entries: [] }, []).recall.ratio).toBeNull();
  });
  it('重复 URL、越窗日期、缺少排除理由拒绝计算', () => {
    const input = checklist();
    expect(() => reconcileSource({ ...input, entries: [...input.entries, input.entries[0]] }, [])).toThrow(/重复/);
    expect(() => reconcileSource({ ...input, window: { from: '2026-02-30', to: '2026-03-31' } }, [])).toThrow(/窗口/);
    input.entries[2].reason = '';
    expect(() => reconcileSource(input, [])).toThrow(/理由/);
  });
});
