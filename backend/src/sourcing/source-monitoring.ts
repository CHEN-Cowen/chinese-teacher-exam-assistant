/**
 * S5：来源级检查记录（source monitoring record）。
 *
 * 背景（S0 规范「来源台账状态」）：
 * > “正常监测”：完成真实样本验收，**并有可持续检查记录**。
 * > “正常监测”必须有来源级检查记录，**不能仅凭代码中存在适配器判断**。
 *
 * 现状问题：S5 首批 9 个来源的 manifest 全部是 `stableMonitoringVerified: false`，
 * 目录里却只有一句自然语言 coverageNote 写着「持续监测未验证」，
 * 机器无法据此判断“这个来源现在能不能对外声称在监测”。
 *
 * 本模块把这件事显式建模：
 * - `SourceMonitoringRecord` 记录某个来源**到某次检查为止**的可复算事实；
 * - 状态由检查记录推导，不允许手写「正常监测」；
 * - 没有记录 = 未验证（`unverified`），有记录但未达连续次数 = `verifying`，
 *   连续达标 = `monitoring`；失败/结构变化 = `degraded`。
 *
 * 口径纪律（与本项目其它度量一致）：
 * - 只记录**可复算**的事实：检查时间、结果、发现的公告数、快照指纹；
 * - **不**输出准确率、召回率——没有独立人工标注样本就不许声称；
 * - 检查记录是**观察事实**，不是承诺：monitoring 只说明“到最近一次检查为止一切正常”。
 */

/** 单次来源检查的结果。 */
export type SourceCheckOutcome =
  /** 检查成功，且本次发现了新内容。 */
  | 'succeeded'
  /** 检查成功，但内容与上次一致（304/内容指纹未变）。 */
  | 'no_new'
  /** 检查成功，但结果为空且来源此前从未有内容——需要人工判断是栏目空还是抓取失败。 */
  | 'zero_suspect'
  /** 检查失败（网络/结构/权限）。 */
  | 'failed'
  /** 来源被明确暂停自动检查。 */
  | 'paused';

/** 来源监测状态（由检查记录推导，不可手写）。 */
export type SourceMonitoringState =
  /** 尚无任何检查记录。 */
  | 'unverified'
  /** 有检查记录，但尚未达到连续成功阈值。 */
  | 'verifying'
  /** 连续达标，可对外声称“到最近一次检查为止正常监测”。 */
  | 'monitoring'
  /** 最近一次检查失败或来源结构变化，需要处理。 */
  | 'degraded'
  /** 来源被明确暂停。 */
  | 'paused';

/**
 * 连续成功多少次才可判定为 `monitoring`。
 *
 * 取 2 而不是 1：单次成功可能只是网络偶发成功，连续两次才说明入口稳定。
 * 该阈值是**本项目自定的工程口径**，不是 S0 规范里的官方指标。
 */
export const MONITORING_STREAK_THRESHOLD = 2;

/** 一次来源检查的记录条目。 */
export interface SourceCheckRecord {
  /** 检查完成时间（ISO 8601）。 */
  checkedAt: string;
  /** 本次检查结果。 */
  outcome: SourceCheckOutcome;
  /** 本次发现的公告条目数；失败时为 null（不可声称 0）。 */
  discoveredCount: number | null;
  /** 本次抓到的内容指纹；无内容快照时为 null。 */
  contentHash: string | null;
  /** 结构变化说明（如官方模板改版、选择器失配）。 */
  note?: string;
}

/** 一个来源的检查记录集合。 */
export interface SourceMonitoringRecord {
  sourceKey: string;
  /** 按时间升序排列的检查记录。 */
  checks: readonly SourceCheckRecord[];
}

/** 监测状态的可复算推导结果。 */
export interface SourceMonitoringSummary {
  sourceKey: string;
  state: SourceMonitoringState;
  /** 记录条数（= 已执行并留痕的检查次数）。 */
  checkCount: number;
  /** 截至最近一次检查的连续成功次数。 */
  currentStreak: number;
  /** 最近一次检查时间；无记录时为 null。 */
  lastCheckedAt: string | null;
  /** 最近一次检查结果；无记录时为 null。 */
  lastOutcome: SourceCheckOutcome | null;
  /** 最近一次发现的公告数；无记录时为 null。 */
  lastDiscoveredCount: number | null;
  /** 人类可读的判定依据，供台账与接口直接展示。 */
  reason: string;
}

/** 判定失败/暂停的结果。 */
const FAILED_OUTCOMES: readonly SourceCheckOutcome[] = ['failed'];

function isSuccessOutcome(outcome: SourceCheckOutcome): boolean {
  return outcome === 'succeeded' || outcome === 'no_new';
}

/**
 * 由检查记录推导来源监测状态。
 *
 * 纯函数：同一份记录必然得到同一结论，可复算、可测试。
 */
export function summarizeMonitoring(
  record: SourceMonitoringRecord,
  threshold: number = MONITORING_STREAK_THRESHOLD,
): SourceMonitoringSummary {
  const { sourceKey, checks } = record;
  if (checks.length === 0) {
    return {
      sourceKey,
      state: 'unverified',
      checkCount: 0,
      currentStreak: 0,
      lastCheckedAt: null,
      lastOutcome: null,
      lastDiscoveredCount: null,
      reason: '尚无来源级检查记录，不能声称正常监测。',
    };
  }

  const last = checks[checks.length - 1]!;
  // 暂停优先于其它状态：来源被明确暂停时，即便此前连续成功也不算在监测。
  if (last.outcome === 'paused') {
    return {
      sourceKey,
      state: 'paused',
      checkCount: checks.length,
      currentStreak: 0,
      lastCheckedAt: last.checkedAt,
      lastOutcome: last.outcome,
      lastDiscoveredCount: last.discoveredCount,
      reason: last.note ?? '来源已明确暂停自动检查。',
    };
  }

  // 连续成功次数：从最近一次往前数，遇失败即中断。
  let streak = 0;
  for (let i = checks.length - 1; i >= 0; i -= 1) {
    const check = checks[i]!;
    if (!isSuccessOutcome(check.outcome)) break;
    streak += 1;
  }

  const state: SourceMonitoringState = FAILED_OUTCOMES.includes(last.outcome)
    ? 'degraded'
    : streak >= threshold
      ? 'monitoring'
      : 'verifying';

  const reason =
    state === 'degraded'
      ? (last.note ?? `最近一次检查失败（${last.checkedAt}），来源需要处理。`)
      : state === 'monitoring'
        ? `连续 ${streak} 次检查成功（阈值 ${threshold}），截至 ${last.checkedAt} 正常监测。`
        : `已有 ${checks.length} 次检查记录，连续成功 ${streak} 次，未达阈值 ${threshold}。`;

  return {
    sourceKey,
    state,
    checkCount: checks.length,
    currentStreak: streak,
    lastCheckedAt: last.checkedAt,
    lastOutcome: last.outcome,
    lastDiscoveredCount: last.discoveredCount,
    reason,
  };
}

/**
 * 汇总一组来源的监测状态。
 *
 * @param records 来源级检查记录集合
 * @param sourceKeys 需要汇总的来源；缺记录的来源会得到 `unverified`，
 *                   这样“没登记”不会悄悄变成“在监测”。
 */
export function summarizeAllMonitoring(
  records: readonly SourceMonitoringRecord[],
  sourceKeys: readonly string[],
): SourceMonitoringSummary[] {
  const byKey = new Map(records.map((record) => [record.sourceKey, record]));
  return sourceKeys.map((sourceKey) =>
    summarizeMonitoring(byKey.get(sourceKey) ?? { sourceKey, checks: [] }),
  );
}

/**
 * 判定一个来源能否对外声称“正常监测”。
 *
 * 这是 S0 规范里“正常监测”口径的唯一判定入口，避免各处各写一套。
 */
export function canClaimMonitoring(
  summary: SourceMonitoringSummary,
  threshold: number = MONITORING_STREAK_THRESHOLD,
): boolean {
  return summary.state === 'monitoring' && summary.currentStreak >= threshold;
}
