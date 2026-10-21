/**
 * M2：任务期望清单（固定分母）与遗漏检测（纯函数）。
 *
 * 目标：系统能发现「整项字段漏抽」「整岗位漏抽」，且质量分母来自**输入**与
 * **预先确认的清单**，而不是从本轮候选输出反推。
 *
 * 背景（与 WB3 的断点）：
 * - WB3 `computeScopeCompleteness` 的 `expected` = 该范围「已出现的字段名」去重数；
 * - WB6 导出沿用同一口径。二者都是「从候选输出反推分母」：某字段一旦整项漏抽，
 *   分母同步变小，完整性反而可能「看起来更高」，掩盖了漏抽。
 * - M2 引入**可持久化、人工确认后冻结**的期望清单，作为固定分母；有清单的任务
 *   按清单评估（零输出岗位也出现、整字段漏抽会被点名），无清单的旧任务明确标注
 *   「未建立固定分母，完整性未评估」，不以 legacy 缺失资料冒充高完整度。
 *
 * 红线（对应提示词）：
 * - 清单只描述「哪些项要检查」，**绝不把标准答案值提供给抽取器**；评估答案与任务
 *   输入隔离；
 * - 清单的岗位集合不依赖本轮候选推断；候选之后补建清单必须标「回顾性核对」，
 *   不冒称独立基准；
 * - 原文未明示 / 不适用都需要依据或人工确认，不得因解析失败或空值自动判成
 *   「原文没有」；无法确认就保持待核验；
 * - 比例同时报告原始槽位、明确不适用、有效分母与各状态计数；缺失/未知/无法核验
 *   不隐形移出分母；
 * - 固定清单后修改必须新增版本，保留历史报告；旧任务无清单显示未评估。
 *
 * 本文件只包含无副作用的纯函数；持久化与读取在 service / store 层实现。
 */
import type { FieldScope } from './domain.js';
import { allFieldNames, getFieldRegistration } from './field-registry.js';

// ==================== 类型 ====================

/** 槽位适用性：该字段槽位在本任务中是否需要检查 */
export type SlotApplicability =
  /** 需要检查（有值、未知或应有但缺失都属于「适用」） */
  | 'applicable'
  /** 明确不适用（有依据，如「该批次不设笔试」） */
  | 'not_applicable';

/** 清单来源：独立清点 or 回顾性核对 */
export type ChecklistSource = 'independent' | 'retrospective';

/**
 * 单个期望字段槽位（公告公共或某岗位内一个「岗位×字段」槽位）。
 *
 * 槽位只记录「要检查什么」与「为什么」，不携带标准答案值——评估答案与输入隔离。
 */
export interface ExpectedSlot {
  /** 字段名（field-catalog 口径） */
  field: string;
  /** 归属范围 */
  scope: FieldScope;
  /** scope=job 时必填：指向清单内的岗位 key */
  jobKey?: string;
  /** 适用性：applicable / not_applicable */
  applicability: SlotApplicability;
  /** 适用性依据（applicable 与 not_applicable 均需说明；不能为空） */
  basis: string;
}

/** 清单内的岗位条目（岗位集合独立于本轮候选，可人工补入漏掉的岗位） */
export interface ExpectedJob {
  /** 岗位稳定 key（公告内唯一；建议与 jobScope.key 一致） */
  key: string;
  /** 官方岗位编号（可选，业务属性） */
  jobCode?: string;
  /** 岗位在原文中的来源定位（工作表名/行号/段落锚点） */
  sheet?: string;
  row?: number;
  /** 该岗位需要检查的字段槽位（去重） */
  slots: ExpectedSlot[];
}

/**
 * 任务期望清单（可持久化的固定分母）。
 *
 * 结构对齐提示词要求：sample/material bundle ID、输入版本或哈希、清单版本、
 * 岗位清单、公告公共/岗位字段槽位、适用性与依据、确认时间/操作者。
 */
export interface ExpectedChecklist {
  /** 清单版本号：固定后修改必须递增，保留历史 */
  version: number;
  /** 输入标识：快照 id（sample/material bundle ID） */
  snapshotId: string;
  /** 输入版本或哈希：内容哈希或解析版本（清单冻结时指向的输入） */
  inputHash: string;
  /** 清单来源：独立清点 / 回顾性核对（候选之后补建） */
  source: ChecklistSource;
  /** 公告公共字段槽位 */
  announcementSlots: ExpectedSlot[];
  /** 岗位清单（岗位集合 + 各自字段槽位） */
  jobs: ExpectedJob[];
  /** 冻结（确认）时间 ISO */
  frozenAt: string;
  /** 确认操作者 id */
  frozenBy: string;
  /** 冻结时附注（可选） */
  note?: string;
}

// ==================== 槽位状态（六种） ====================

/**
 * 单个期望槽位的评估结果状态。
 * 至少区分：已提取 / 原文未明示 / 应有未提取 / 明确不适用 / 来源缺失无法核验 / 冲突。
 */
export type SlotResultStatus =
  | 'extracted'
  | 'not_stated_in_source'
  | 'should_have_but_missing'
  | 'not_applicable'
  | 'source_missing_unverifiable'
  | 'conflict';

/** 单个期望槽位的评估结果 */
export interface SlotResult {
  field: string;
  scope: FieldScope;
  jobKey?: string;
  /** 清单里声明的适用性 */
  declaredApplicability: SlotApplicability;
  /** 评估后的状态 */
  status: SlotResultStatus;
  /** 候选值（extracted/conflict 时有值；其余为空） */
  value?: string;
  /** conflict 时的替代值数量 */
  alternativeCount?: number;
  /** 说明（为何判为该状态；should_have_but_missing / source_missing 时必填） */
  note?: string;
}

/** 整个清单的评估结果 */
export interface ChecklistEvaluation {
  /** 是否有清单（无清单时其余字段为空，调用方据此显示「未评估」） */
  hasChecklist: boolean;
  /** 清单版本 */
  checklistVersion?: number;
  /** 清单来源 */
  checklistSource?: ChecklistSource;
  /** 逐槽位结果（去重；零输出岗位也出现） */
  slots: SlotResult[];
  /** 岗位评估汇总（含零输出岗位） */
  jobs: Array<{
    key: string;
    jobCode?: string;
    results: SlotResult[];
  }>;
  /** 公告公共汇总 */
  announcement: SlotResult[];
  /** 指标（原始槽位 / 明确不适用 / 有效分母 / 各状态计数） */
  metrics: SlotMetrics;
}

/** 固定分母指标：原始槽位、明确不适用、有效分母、各状态计数 */
export interface SlotMetrics {
  /** 原始槽位数（清单声明的全部槽位，含 not_applicable） */
  rawSlots: number;
  /** 明确不适用槽位数（applicability=not_applicable 或评估为 not_applicable） */
  notApplicable: number;
  /** 有效分母 = 原始槽位 − 明确不适用 */
  effectiveDenominator: number;
  /** 各状态计数（逐状态，便于人工复算） */
  byStatus: Record<SlotResultStatus, number>;
  /** 已提取槽位数 */
  extracted: number;
  /** 应有未提取（遗漏）槽位数 */
  missing: number;
}

// ==================== 构建清单（纯函数） ====================

/**
 * 从「字段注册表 + 岗位枚举 + 人工适用性决策」构建期望清单。
 *
 * 关键约束：
 * - 岗位集合由调用方显式传入（独立行枚举或人工补入），本函数**不从候选字段推断**；
 * - 字段槽位从字段注册表按 scope 派生（announcement → 公告槽位，job → 每岗位槽位）；
 * - 适用性与依据由调用方给出（缺依据抛错，不静默）；
 * - 本函数只产出「要检查什么」，绝不产出标准答案值。
 *
 * @param input 输入标识与岗位集合
 * @param options 人工适用性决策（可选；默认全部 applicable，依据缺省）
 */
export function buildChecklist(input: {
  snapshotId: string;
  inputHash: string;
  source: ChecklistSource;
  /** 岗位集合（独立清点/人工补入，不得从候选推断） */
  jobs: Array<{
    key: string;
    jobCode?: string;
    sheet?: string;
    row?: number;
  }>;
  /** 可选：对特定字段槽位的人工适用性覆盖（缺省 applicable） */
  applicabilityOverrides?: Array<{
    field: string;
    /** 不指定 jobKey 则作用于公告公共；指定则作用于该岗位 */
    jobKey?: string;
    applicability: SlotApplicability;
    basis: string;
  }>;
  frozenBy: string;
  frozenAt: string;
  note?: string;
}): ExpectedChecklist {
  if (!input.snapshotId) throw new Error('清单缺少快照标识');
  if (!input.inputHash) throw new Error('清单缺少输入哈希/版本');
  if (!input.frozenBy) throw new Error('清单缺少确认操作者');
  if (!input.frozenAt) throw new Error('清单缺少冻结时间');

  const overrideMap = new Map<string, { applicability: SlotApplicability; basis: string }>();
  for (const o of input.applicabilityOverrides ?? []) {
    const key = `${o.jobKey ?? '__ann__'}:${o.field}`;
    if (!o.basis || o.basis.trim() === '') {
      throw new Error(`槽位 ${o.field} 的适用性缺少依据`);
    }
    overrideMap.set(key, { applicability: o.applicability, basis: o.basis });
  }

  const announcementSlots = buildAnnouncementSlots(overrideMap, undefined);
  const jobs: ExpectedJob[] = input.jobs.map((j) => ({
    key: j.key,
    jobCode: j.jobCode,
    sheet: j.sheet,
    row: j.row,
    slots: buildJobSlots(overrideMap, j.key),
  }));

  return {
    version: 1,
    snapshotId: input.snapshotId,
    inputHash: input.inputHash,
    source: input.source,
    announcementSlots,
    jobs,
    frozenAt: input.frozenAt,
    frozenBy: input.frozenBy,
    note: input.note,
  };
}

/** 公告公共槽位：字段注册表里 scope 为 announcement 或 both 的字段 */
function buildAnnouncementSlots(
  overrideMap: Map<string, { applicability: SlotApplicability; basis: string }>,
  _jobKey: undefined,
): ExpectedSlot[] {
  const slots: ExpectedSlot[] = [];
  for (const field of allFieldNames()) {
    const reg = getFieldRegistration(field);
    if (!reg) continue;
    if (reg.scope === 'job') continue; // 纯岗位字段不进公告槽位
    const override = overrideMap.get(`__ann__:${field}`);
    slots.push({
      field,
      scope: 'announcement',
      applicability: override?.applicability ?? 'applicable',
      basis:
        override?.basis ??
        (reg.required
          ? '公告公共字段（注册表必需）'
          : '公告公共字段（注册表可选）'),
    });
  }
  return slots;
}

/** 岗位槽位：字段注册表里 scope 为 job 或 both 的字段 */
function buildJobSlots(
  overrideMap: Map<string, { applicability: SlotApplicability; basis: string }>,
  jobKey: string,
): ExpectedSlot[] {
  const slots: ExpectedSlot[] = [];
  for (const field of allFieldNames()) {
    const reg = getFieldRegistration(field);
    if (!reg) continue;
    if (reg.scope === 'announcement') continue; // 纯公告字段不进岗位槽位
    const override = overrideMap.get(`${jobKey}:${field}`);
    slots.push({
      field,
      scope: 'job',
      jobKey,
      applicability: override?.applicability ?? 'applicable',
      basis:
        override?.basis ??
        (reg.required
          ? '岗位字段（注册表必需）'
          : '岗位字段（注册表可选）'),
    });
  }
  return slots;
}

// ==================== 评估清单（纯函数） ====================

/**
 * 遍历期望槽位，对每个槽位产出单一结果。
 *
 * 评估只使用「清单（期望） + 候选字段（实际输出）」，不读取任务输入内容：
 * - 有清单 → 固定分母评估；
 * - 无清单 → 返回 hasChecklist=false（调用方显示「未建立固定分母，完整性未评估」）。
 *
 * 槽位去重、重复候选与 alternatives 不抬高分子（每槽位单一结果）。
 *
 * @param checklist 期望清单（可空）
 * @param candidateFields 本轮候选字段（实际输出）
 * @param options 来源可读性判定（由调用方提供：哪些输入文件不可读/无法核验）
 */
export function evaluateChecklist(
  checklist: ExpectedChecklist | null | undefined,
  candidateFields: Array<{
    field: string;
    value: string;
    scope?: FieldScope;
    jobScope?: { key: string };
    status?: string;
    alternatives?: Array<{ value: string }>;
  }>,
  options: {
    /** 无法核验的来源集合（如某些附件不可读），按 scope 维度标记 */
    unverifiableScopes?: ReadonlySet<string>;
  } = {},
): ChecklistEvaluation {
  if (!checklist) {
    return { hasChecklist: false, slots: [], jobs: [], announcement: [], metrics: emptyMetrics() };
  }

  // 归一化候选：按「身份」去重（job:<jobKey>:<field> 或 announcement:<field>）
  const byIdentity = new Map<
    string,
    {
      field: string;
      value: string;
      status: string;
      alternatives?: Array<{ value: string }>;
    }
  >();
  for (const f of candidateFields) {
    const scope = f.scope ?? 'announcement';
    const jobKey = scope === 'job' ? (f.jobScope?.key ?? '') : '';
    const identity = scope === 'job' ? `job:${jobKey}:${f.field}` : `${scope}:${f.field}`;
    if (byIdentity.has(identity)) continue; // 去重：重复候选/alternatives 不抬高分子
    byIdentity.set(identity, {
      field: f.field,
      value: f.value,
      status: f.status ?? 'extracted',
      alternatives: f.alternatives,
    });
  }

  const unverifiable = options.unverifiableScopes ?? new Set<string>();

  const evaluateSlot = (slot: ExpectedSlot): SlotResult => {
    const scope = slot.scope;
    const jobKey = slot.jobKey;
    const identity =
      scope === 'job' ? `job:${jobKey}:${slot.field}` : `${scope}:${slot.field}`;

    // 明确不适用：清单声明 not_applicable → 结果也是 not_applicable
    if (slot.applicability === 'not_applicable') {
      return {
        field: slot.field,
        scope,
        jobKey,
        declaredApplicability: 'not_applicable',
        status: 'not_applicable',
        note: slot.basis,
      };
    }

    // 来源缺失/无法核验：该 scope 的来源不可读
    const scopeKey = scope === 'job' ? `job:${jobKey}` : 'announcement';
    const isUnverifiable = unverifiable.has(scopeKey) || unverifiable.has('__all__');
    if (isUnverifiable) {
      const found = byIdentity.get(identity);
      // 即便来源不可核验，若已有候选值也如实呈现（值来自可读部分或人工补入）
      if (found && found.status !== 'unknown') {
        return resultFromFound(slot, found);
      }
      return {
        field: slot.field,
        scope,
        jobKey,
        declaredApplicability: 'applicable',
        status: 'source_missing_unverifiable',
        note: '来源缺失或无法核验，无法确认原文是否写明',
      };
    }

    const found = byIdentity.get(identity);
    if (!found) {
      // 有清单、来源可核验、但没有该槽位候选 → 应有未提取（遗漏）
      return {
        field: slot.field,
        scope,
        jobKey,
        declaredApplicability: 'applicable',
        status: 'should_have_but_missing',
        note: '清单期望该字段，但候选输出中缺失（整项字段漏抽）',
      };
    }
    return resultFromFound(slot, found);
  };

  const announcement = checklist.announcementSlots.map(evaluateSlot);
  const jobs = checklist.jobs.map((job) => ({
    key: job.key,
    jobCode: job.jobCode,
    results: job.slots.map(evaluateSlot),
  }));

  const slots = [...announcement, ...jobs.flatMap((j) => j.results)];

  return {
    hasChecklist: true,
    checklistVersion: checklist.version,
    checklistSource: checklist.source,
    slots,
    jobs,
    announcement,
    metrics: computeSlotMetrics(slots),
  };
}

/** 从已找到的候选字段产出评估结果 */
function resultFromFound(
  slot: ExpectedSlot,
  found: { value: string; status: string; alternatives?: Array<{ value: string }> },
): SlotResult {
  if (found.status === 'conflict') {
    return {
      field: slot.field,
      scope: slot.scope,
      jobKey: slot.jobKey,
      declaredApplicability: slot.applicability,
      status: 'conflict',
      value: found.value,
      alternativeCount: found.alternatives?.length ?? 0,
    };
  }
  if (found.status === 'unknown') {
    return {
      field: slot.field,
      scope: slot.scope,
      jobKey: slot.jobKey,
      declaredApplicability: slot.applicability,
      status: 'not_stated_in_source',
      note: '原文未明示（候选显式标记 unknown，非解析失败）',
    };
  }
  // extracted（或兼容读取缺省 extracted）
  return {
    field: slot.field,
    scope: slot.scope,
    jobKey: slot.jobKey,
    declaredApplicability: slot.applicability,
    status: 'extracted',
    value: found.value,
  };
}

// ==================== 指标（纯函数） ====================

function emptyMetrics(): SlotMetrics {
  return {
    rawSlots: 0,
    notApplicable: 0,
    effectiveDenominator: 0,
    byStatus: {
      extracted: 0,
      not_stated_in_source: 0,
      should_have_but_missing: 0,
      not_applicable: 0,
      source_missing_unverifiable: 0,
      conflict: 0,
    },
    extracted: 0,
    missing: 0,
  };
}

/**
 * 计算固定分母指标。
 *
 * - rawSlots = 清单全部槽位；
 * - notApplicable = 明确不适用槽位数（含清单声明与评估判定）；
 * - effectiveDenominator = rawSlots − notApplicable（缺失/未知/无法核验不移出分母）；
 * - 各状态计数逐项给出，可人工复算。
 */
export function computeSlotMetrics(slots: SlotResult[]): SlotMetrics {
  const byStatus: Record<SlotResultStatus, number> = {
    extracted: 0,
    not_stated_in_source: 0,
    should_have_but_missing: 0,
    not_applicable: 0,
    source_missing_unverifiable: 0,
    conflict: 0,
  };
  let notApplicable = 0;
  for (const s of slots) {
    byStatus[s.status] += 1;
    if (s.status === 'not_applicable') notApplicable += 1;
  }
  return {
    rawSlots: slots.length,
    notApplicable,
    effectiveDenominator: slots.length - notApplicable,
    byStatus,
    extracted: byStatus.extracted,
    missing: byStatus.should_have_but_missing,
  };
}

/**
 * 判定一个清单是否为「回顾性核对」（候选之后补建）。
 * 回顾性核对不冒称独立基准。
 */
export function isRetrospective(checklist: ExpectedChecklist | null | undefined): boolean {
  return checklist?.source === 'retrospective';
}

/**
 * 固定分母完整性：已提取 / 有效分母（排除明确不适用）。
 * 有清单时使用；无清单不调用（返回 undefined 表示未评估）。
 */
export function fixedDenominatorCompleteness(
  evaluation: ChecklistEvaluation,
): number | null {
  if (!evaluation.hasChecklist) return null;
  const d = evaluation.metrics.effectiveDenominator;
  if (d <= 0) return null;
  return evaluation.metrics.extracted / d;
}
