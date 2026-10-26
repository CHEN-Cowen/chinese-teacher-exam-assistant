import { describe, expect, it } from 'vitest';
import {
  MONITORING_STREAK_THRESHOLD,
  canClaimMonitoring,
  summarizeAllMonitoring,
  summarizeMonitoring,
  type SourceCheckRecord,
  type SourceMonitoringRecord,
} from './source-monitoring.js';

function record(
  sourceKey: string,
  checks: SourceCheckRecord[],
): SourceMonitoringRecord {
  return { sourceKey, checks };
}

const succeeded = (checkedAt: string): SourceCheckRecord => ({
  checkedAt,
  outcome: 'succeeded',
  discoveredCount: 3,
  contentHash: 'abc123',
});

describe('S5 来源级检查记录', () => {
  it('没有检查记录时状态为 unverified，不得声称正常监测', () => {
    const summary = summarizeMonitoring(record('x', []));
    expect(summary.state).toBe('unverified');
    expect(summary.checkCount).toBe(0);
    expect(summary.lastCheckedAt).toBeNull();
    expect(summary.lastDiscoveredCount).toBeNull();
    expect(canClaimMonitoring(summary)).toBe(false);
  });

  it('只有一次成功检查时仍为 verifying，未达连续阈值', () => {
    const summary = summarizeMonitoring(
      record('x', [succeeded('2026-10-26T00:00:00.000Z')]),
    );
    expect(summary.state).toBe('verifying');
    expect(summary.currentStreak).toBe(1);
    expect(canClaimMonitoring(summary)).toBe(false);
  });

  it('连续两次成功才可判定为 monitoring', () => {
    const summary = summarizeMonitoring(
      record('x', [
        succeeded('2026-10-26T00:00:00.000Z'),
        succeeded('2026-10-26T01:00:00.000Z'),
      ]),
    );
    expect(summary.state).toBe('monitoring');
    expect(summary.currentStreak).toBe(MONITORING_STREAK_THRESHOLD);
    expect(canClaimMonitoring(summary)).toBe(true);
  });

  it('no_new 也算成功检查（304 不应被当成失败）', () => {
    const summary = summarizeMonitoring(
      record('x', [
        succeeded('2026-10-26T00:00:00.000Z'),
        {
          checkedAt: '2026-10-26T01:00:00.000Z',
          outcome: 'no_new',
          discoveredCount: 0,
          contentHash: 'abc123',
        },
      ]),
    );
    expect(summary.state).toBe('monitoring');
    expect(summary.lastOutcome).toBe('no_new');
  });

  it('最近一次失败使状态降级为 degraded，且连续成功归零', () => {
    const summary = summarizeMonitoring(
      record('x', [
        succeeded('2026-10-26T00:00:00.000Z'),
        succeeded('2026-10-26T01:00:00.000Z'),
        {
          checkedAt: '2026-10-26T02:00:00.000Z',
          outcome: 'failed',
          discoveredCount: null,
          contentHash: null,
          note: '官方栏目 503',
        },
      ]),
    );
    expect(summary.state).toBe('degraded');
    expect(summary.currentStreak).toBe(0);
    expect(summary.lastDiscoveredCount).toBeNull();
    expect(canClaimMonitoring(summary)).toBe(false);
    expect(summary.reason).toContain('官方栏目 503');
  });

  it('失败后重新成功需要重新累计连续次数', () => {
    const summary = summarizeMonitoring(
      record('x', [
        succeeded('2026-10-26T00:00:00.000Z'),
        {
          checkedAt: '2026-10-26T01:00:00.000Z',
          outcome: 'failed',
          discoveredCount: null,
          contentHash: null,
        },
        succeeded('2026-10-26T02:00:00.000Z'),
      ]),
    );
    // 失败把连续成功打断，之后只有 1 次成功，未达阈值。
    expect(summary.state).toBe('verifying');
    expect(summary.currentStreak).toBe(1);
  });

  it('paused 优先于其它状态', () => {
    const summary = summarizeMonitoring(
      record('x', [
        succeeded('2026-10-26T00:00:00.000Z'),
        succeeded('2026-10-26T01:00:00.000Z'),
        {
          checkedAt: '2026-10-26T02:00:00.000Z',
          outcome: 'paused',
          discoveredCount: null,
          contentHash: null,
          note: '官方公告已发布完毕',
        },
      ]),
    );
    expect(summary.state).toBe('paused');
    expect(canClaimMonitoring(summary)).toBe(false);
  });

  it('zero_suspect 不算成功：空栏目必须人工判断', () => {
    const summary = summarizeMonitoring(
      record('x', [
        {
          checkedAt: '2026-10-26T00:00:00.000Z',
          outcome: 'zero_suspect',
          discoveredCount: 0,
          contentHash: null,
        },
        {
          checkedAt: '2026-10-26T01:00:00.000Z',
          outcome: 'zero_suspect',
          discoveredCount: 0,
          contentHash: null,
        },
      ]),
    );
    expect(summary.state).toBe('verifying');
    expect(canClaimMonitoring(summary)).toBe(false);
  });

  it('缺记录的来源在汇总时得到 unverified，不会悄悄变成在监测', () => {
    const summaries = summarizeAllMonitoring(
      [record('a', [succeeded('2026-10-26T00:00:00.000Z')])],
      ['a', 'b'],
    );
    expect(summaries.map((s) => s.sourceKey)).toEqual(['a', 'b']);
    expect(summaries[0]!.state).toBe('verifying');
    expect(summaries[1]!.state).toBe('unverified');
  });

  it('推导结果是纯函数：同一份记录必然得到同一结论', () => {
    const checks = [
      succeeded('2026-10-26T00:00:00.000Z'),
      succeeded('2026-10-26T01:00:00.000Z'),
    ];
    const first = summarizeMonitoring(record('x', checks));
    const second = summarizeMonitoring(record('x', checks));
    expect(first).toEqual(second);
  });
});
