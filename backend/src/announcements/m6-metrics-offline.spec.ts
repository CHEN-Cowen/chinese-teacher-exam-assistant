/**
 * M6：真实指标、复用与离线交付（纯函数单元测试）。
 *
 * 覆盖：
 * - M6-01：时间计量（缺时间戳/未结束/负时间/重复/暂停恢复），人工投入与事件跨度不混；
 * - M6-03：无独立核验不输出正确率；有核验才计算（分子/分母/核验人/方式）；
 * - M6-C：manifest 结构、S1/S2 复用校验（不复制冒充）、成果摘要（证据缺失标待补）。
 */
import { describe, expect, it } from 'vitest';
import { computeAccuracy, computeTimeTracking } from './export.js';
import {
  buildAchievementSummary,
  buildManifest,
  fileContentHash,
  validateReuse,
  type ReuseRecord,
} from './offline-package.js';

// ==================== M6-01：时间计量 ====================

describe('computeTimeTracking：时间口径（M6-01）', () => {
  it('缺时间戳 → 未记录（null），不补 0', () => {
    const r = computeTimeTracking({});
    expect(r.eventSpanMs).toBeNull();
    expect(r.humanEffortMs).toBeNull();
    expect(r.waitingMs).toBeNull();
    expect(r.reworkMs).toBeNull();
    expect(r.pauseCount).toBeNull();
    expect(r.retryCount).toBeNull();
    expect(r.notFinished).toBe(false);
  });

  it('有开始无完成 → 未结束，跨度为 null', () => {
    const r = computeTimeTracking({ startedAt: '2026-10-21T09:00:00.000Z' });
    expect(r.notFinished).toBe(true);
    expect(r.eventSpanMs).toBeNull();
  });

  it('负时间（完成早于开始）→ 跨度为 null，不输出负值', () => {
    const r = computeTimeTracking({
      startedAt: '2026-10-21T10:00:00.000Z',
      completedAt: '2026-10-21T09:00:00.000Z',
    });
    expect(r.notFinished).toBe(false);
    expect(r.eventSpanMs).toBeNull();
  });

  it('正常区间：事件跨度 = 完成 − 开始；自报投入/等待分别保留', () => {
    const r = computeTimeTracking({
      startedAt: '2026-10-21T09:00:00.000Z',
      completedAt: '2026-10-21T09:30:00.000Z',
      humanEffortMs: 20 * 60 * 1000,
      waitingMs: 10 * 60 * 1000,
      reworkMs: 5 * 60 * 1000,
      pauseCount: 2,
      retryCount: 1,
    });
    expect(r.eventSpanMs).toBe(30 * 60 * 1000);
    expect(r.humanEffortMs).toBe(20 * 60 * 1000);
    expect(r.waitingMs).toBe(10 * 60 * 1000);
    expect(r.reworkMs).toBe(5 * 60 * 1000);
    expect(r.pauseCount).toBe(2);
    expect(r.retryCount).toBe(1);
  });

  it('自报负值 → null（数据异常不编造）', () => {
    const r = computeTimeTracking({ humanEffortMs: -1, pauseCount: -2, retryCount: -3 });
    expect(r.humanEffortMs).toBeNull();
    expect(r.pauseCount).toBeNull();
    expect(r.retryCount).toBeNull();
  });

  it('事件跨度不等于人工投入：跨度 30 分钟、投入自报 20 分钟，二者独立', () => {
    const r = computeTimeTracking({
      startedAt: '2026-10-21T09:00:00.000Z',
      completedAt: '2026-10-21T09:30:00.000Z',
      humanEffortMs: 20 * 60 * 1000,
    });
    expect(r.eventSpanMs).toBe(30 * 60 * 1000);
    expect(r.humanEffortMs).toBe(20 * 60 * 1000);
    expect(r.eventSpanMs).not.toBe(r.humanEffortMs);
    expect(r.note).toContain('审核事件跨度不是人工投入');
  });
});

// ==================== M6-03：独立核验正确率 ====================

describe('computeAccuracy：独立核验正确率（M6-03）', () => {
  it('无独立核验 → evaluated=false，不输出正确率', () => {
    const r = computeAccuracy(null);
    expect(r.evaluated).toBe(false);
    expect(r.value).toBeNull();
    expect(r.verifier).toBeNull();
    expect(r.method).toBeNull();
  });

  it('有核验 → 计算正确率，附核验人/方式', () => {
    const r = computeAccuracy({
      verifier: '评审员 A',
      method: '对照官方原件逐字段核验',
      totalFields: 10,
      correctFields: 8,
    });
    expect(r.evaluated).toBe(true);
    expect(r.correctFields).toBe(8);
    expect(r.totalFields).toBe(10);
    expect(r.value).toBe(0.8);
    expect(r.verifier).toBe('评审员 A');
    expect(r.method).toContain('逐字段核验');
  });

  it('分母为 0 或正确数 > 总数 → value=null（数据异常）', () => {
    expect(
      computeAccuracy({ verifier: 'x', method: 'm', totalFields: 0, correctFields: 0 }).value,
    ).toBeNull();
    expect(
      computeAccuracy({ verifier: 'x', method: 'm', totalFields: 5, correctFields: 6 }).value,
    ).toBeNull();
  });
});

// ==================== M6-C：离线包与复用 ====================

describe('buildManifest：离线包（M6-C11）', () => {
  it('manifest 结构齐全，构造包明确标记 synthetic', () => {
    const hash = fileContentHash('hello');
    const m = buildManifest({
      packageId: 'pkg-1',
      generatedAt: new Date('2026-10-21T07:00:00.000Z'),
      synthetic: true,
      datasetMark: 'test',
      inputs: [{ sample: 'S1', description: '构造样本', version: 'v1' }],
      entries: [
        { path: 'data/run-1.csv', description: 'CSV 导出', relatedIds: ['run-1'], version: 'wb-export@1.0.0', contentHash: hash, visibility: 'redacted' },
      ],
    });
    expect(m.synthetic).toBe(true);
    expect(m.datasetMark).toBe('test');
    expect(m.schemaVersion).toBe('wb-offline-package@1.0.0');
    expect(m.entries[0].contentHash).toBe(hash);
    expect(m.licenseNote).toContain('不含个人敏感数据');
  });
});

describe('validateReuse：S1/S2 复用（M6-C9/M6-05）', () => {
  const s1: ReuseRecord = {
    sample: 'S1',
    inputDescription: '杭州公告 + 岗位表 A',
    inputVersion: 'hash-s1',
    runVersion: 'rule-field-extractor@2.0.0',
    specVersion: 'spec-workbuddy@1',
    changes: [],
    failures: [],
    reused: false,
  };

  it('S2 独立输入 + 实际改动 → 合法复用', () => {
    const s2: ReuseRecord = {
      sample: 'S2',
      inputDescription: '宁波公告 + 岗位表 B',
      inputVersion: 'hash-s2',
      runVersion: 'rule-field-extractor@2.0.0',
      specVersion: 'spec-workbuddy@1',
      changes: ['调整岗位表列映射'],
      failures: [{ at: '2026-10-21T10:00:00Z', reason: 'xlsx 表头偏移', retried: true }],
      reused: true,
    };
    expect(validateReuse(s1, s2)).toEqual([]);
  });

  it('S2 复用但输入版本与 S1 相同 → 判定复制冒充', () => {
    const s2: ReuseRecord = {
      ...s1,
      sample: 'S2',
      inputDescription: '杭州公告 + 岗位表 A',
      reused: true,
      changes: ['无'],
    };
    const errors = validateReuse(s1, s2);
    expect(errors.some((e) => e.includes('复制冒充'))).toBe(true);
  });

  it('S2 声明复用但无任何改动/失败记录 → 不构成可核对复用', () => {
    const s2: ReuseRecord = {
      sample: 'S2',
      inputDescription: '宁波公告 + 岗位表 B',
      inputVersion: 'hash-s2',
      runVersion: 'rule-field-extractor@2.0.0',
      specVersion: 'spec-workbuddy@1',
      changes: [],
      failures: [],
      reused: true,
    };
    const errors = validateReuse(s1, s2);
    expect(errors.some((e) => e.includes('不构成可核对'))).toBe(true);
  });
});

describe('buildAchievementSummary：成果摘要（M6-C14/M6-08）', () => {
  it('无 WorkBuddy 证据 → pending 明确标待补，不伪造', () => {
    const s = buildAchievementSummary({
      generatedAt: new Date('2026-10-21T07:00:00.000Z'),
      synthetic: false,
      keyNumbers: [{ label: '处理岗位数', value: '2', source: 'manifest.json#key-numbers' }],
    });
    expect(s.workbuddyEvidence).toHaveLength(0);
    expect(s.pending.some((p) => p.includes('证据缺失'))).toBe(true);
  });

  it('有证据 → 登记能力/成果/人工判断/阶段', () => {
    const s = buildAchievementSummary({
      generatedAt: new Date('2026-10-21T07:00:00.000Z'),
      synthetic: false,
      keyNumbers: [{ label: '人工修改字段', value: '1', source: 'run-1.json#metrics' }],
      workbuddyEvidence: [
        {
          referenceId: 'session-abc123',
          capability: 'Skill: workbuddy-sheetagent',
          outcome: '解析岗位表附件',
          humanJudgment: '人工复核通过',
          phase: 'in_contest',
        },
      ],
      unusedCapabilities: ['自动化：未使用'],
    });
    expect(s.workbuddyEvidence).toHaveLength(1);
    expect(s.workbuddyEvidence[0].capability).toContain('sheetagent');
    expect(s.unusedCapabilities).toContain('自动化：未使用');
    expect(s.pending).toHaveLength(0);
  });
});
