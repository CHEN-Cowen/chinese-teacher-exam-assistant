/**
 * WB6：审核导出与实测指标（纯函数，单一事实源）。
 *
 * 目标：让 WorkBuddy 比赛成果「可下载、可复核、可复算」：
 * - JSON 导出：保留结构化 scope、证据定位、alternatives 与人工审核记录；
 * - UTF-8 CSV 导出：一行一个「岗位 × 字段」，列固定有序并有版本说明；
 * - 实测指标：按 run 与按 job 输出可复算指标，每个比例同时给出分子、分母与公式；
 *   没有可靠时间戳就返回 null（由 UI 显示「未记录」），不补零；
 *   没有黄金答案或独立人工裁决，绝不输出准确率/召回率/提效百分比——
 *   「人工采用率」不是「准确率」。
 *
 * 安全红线：
 * - CSV 单元格以 = + - @ 开头时加 `'` 前缀做公式注入防护（原值保留在 `'` 后可追溯，
 *   JSON 导出保留完全原值）；
 * - locator 如含 URL，复用既有 redactUrl 规则（协议+host+path，丢弃 query 中的
 *   签名/凭据参数），管理员仍能定位官方原件；
 * - 不导出访问令牌、Cookie、对象存储签名 query、数据库连接信息或用户敏感画像；
 *   candidate.rawJson 不进入导出（原始正文过大且可能含无关内容）。
 *
 * 本文件只包含无副作用纯函数；持久化读取在 export.service.ts。
 */
import {
  groupFieldsByScope,
  normalizeCandidateField,
  type CandidateField,
  type ExtractionCandidate,
} from './domain.js';
import { isHighImpactField } from './field-registry.js';
import { redactUrl } from '../sourcing/fetch/safe-fetcher.js';
import { isCatalogPayload } from './catalog-payload-assembler.js';
import {
  evaluateChecklist,
  fixedDenominatorCompleteness,
  isRetrospective,
  type ExpectedChecklist,
} from './expected-checklist.js';

// ==================== 版本与列契约 ====================

/** 导出 schema 版本：列或结构变化时必须递增并更新说明 */
export const EXPORT_SCHEMA_VERSION = 'wb-export@1.0.0';

/**
 * CSV 列（固定顺序，共 14 列）。
 * 版本说明（schema v1.0.0）：
 * - sample_id：样本标识（run 的快照 id，对应黄金样本 announcement.id 语义）；
 * - job_id：岗位稳定标识（jobScope.key）；公共/归属未知字段为空；
 * - field：候选字段名（field-catalog.md 口径）；
 * - value：候选值（conflict 时为主值，全部替代值见 alternatives 列）；
 * - source_file：证据来源文件（附件名 / 脱敏 URL / 公告正文）；
 * - quote：原文摘录（证据锚点 excerpt）；
 * - locator：证据定位文本（kind + 位置，URL 已按 redactUrl 脱敏）；
 * - status：extracted / unknown / conflict；
 * - scope：announcement / job / unknown；
 * - rule_version：产生该字段的规则/解析器版本；
 * - run_id：提取任务 id；
 * - human_revision：人工决策动作（adopt/edit/reject/pending，来自真实审核记录）；
 * - reason：字段级人工决策原因（无决策时为空）；
 * - alternatives：conflict 替代值 JSON 数组（[{value,excerpt}]），非冲突为空。
 */
export const CSV_COLUMNS = [
  'sample_id',
  'job_id',
  'field',
  'value',
  'source_file',
  'quote',
  'locator',
  'status',
  'scope',
  'rule_version',
  'run_id',
  'human_revision',
  'reason',
  'alternatives',
] as const;

/** CSV 公式注入防护与转义说明（随 JSON 导出 notes 与指标口径一并输出） */
export const CSV_FORMULA_NOTE =
  "CSV 单元格以 = + - @ 开头时会加英文单引号 ' 前缀防公式注入；去掉前缀即原值，JSON 导出保留完全原值。";

// ==================== CSV 转义与防护 ====================

/**
 * CSV 单元格转义（RFC 4180 + 公式注入防护）：
 * 1. 以 = + - @ 开头 → 前缀 `'`（防护 Excel/LibreOffice 公式执行，原值紧随其后可追溯）；
 * 2. 含逗号、双引号、换行 → 整体加双引号包裹，内部双引号翻倍；
 * 3. 中文按 UTF-8 原样输出（文件级带 BOM，见 buildCsv）。
 */
export function csvEscapeCell(raw: string): string {
  let value = raw;
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 组装 UTF-8 CSV 文本：表头 + 数据行 + BOM。
 * 换行统一 \r\n（RFC 4180）；BOM 保证 Excel 正确识别中文。
 */
export function buildCsv(rows: Array<Record<string, string>>): string {
  const header = CSV_COLUMNS.map(csvEscapeCell).join(',');
  const body = rows
    .map((row) => CSV_COLUMNS.map((col) => csvEscapeCell(row[col] ?? '')).join(','))
    .join('\r\n');
  return `\uFEFF${header}\r\n${body}\r\n`;
}

// ==================== 证据定位文本与脱敏 ====================

interface ExportAnchor {
  locator?: { kind?: string; url?: string; fileId?: string; fileName?: string; page?: number; sheet?: string; cell?: string; excerpt?: string };
  excerpt?: string;
}

/** 脱敏单个候选字段（URL 定位去 query；其余结构原样保留） */
export function sanitizeFieldForExport(field: CandidateField): CandidateField {
  const out: CandidateField = { ...field };
  if (out.anchor?.locator) {
    const locator = out.anchor.locator as unknown as Record<string, unknown>;
    if (typeof locator['url'] === 'string') {
      out.anchor = {
        ...out.anchor,
        locator: {
          ...locator,
          url: redactUrl(locator['url']),
        } as unknown as NonNullable<CandidateField['anchor']>['locator'],
      };
    }
  }
  if (out.alternatives) {
    out.alternatives = out.alternatives.map((alt) => {
      const source = alt.source as unknown as Record<string, unknown> | undefined;
      if (source && typeof source['url'] === 'string') {
        return {
          ...alt,
          source: { ...source, url: redactUrl(source['url'] as string) } as never,
        };
      }
      return alt;
    });
  }
  return out;
}

/** 导出用候选：字段逐一脱敏；rawJson 不导出 */
export function sanitizeCandidateForExport(
  candidate: ExtractionCandidate,
): ExtractionCandidate {
  return {
    fields: candidate.fields.map(sanitizeFieldForExport),
    parserVersion: candidate.parserVersion,
  };
}

/** locator 列的可读文本（URL 已脱敏，管理员可据此定位官方原件） */
export function locatorText(anchor: ExportAnchor | undefined): string {
  const locator = anchor?.locator;
  if (!locator) return '';
  switch (locator.kind) {
    case 'url':
      return `url:${redactUrl(locator.url ?? '')}`;
    case 'worksheet':
      return [
        `worksheet:${locator.sheet ?? ''}`,
        locator.cell ? `cell=${locator.cell}` : '',
        locator.fileId ? `file=${locator.fileId}` : '',
      ]
        .filter(Boolean)
        .join(';');
    case 'file':
      return `file:${locator.fileName ?? ''}${locator.page != null ? `;page=${locator.page}` : ''}`;
    case 'excerpt':
      return 'excerpt:文本摘录';
    default:
      return String(locator.kind ?? '');
  }
}

/** source_file 列：附件名 / 脱敏 URL / 公告正文 */
export function sourceFileText(anchor: ExportAnchor | undefined): string {
  const locator = anchor?.locator;
  if (!locator) return '';
  switch (locator.kind) {
    case 'url':
      return redactUrl(locator.url ?? '');
    case 'worksheet':
    case 'file':
      return locator.fileName ?? '';
    case 'excerpt':
      return '公告正文';
    default:
      return '';
  }
}

// ==================== CSV 行构造 ====================

/** 一行 = 一个「岗位 × 字段」（公共字段 job_id 为空） */
export interface ExportRowInput {
  runId: string;
  snapshotId: string;
  candidate: ExtractionCandidate;
}

export function buildExportRows(input: ExportRowInput): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const raw of input.candidate.fields) {
    const f = sanitizeFieldForExport(raw);
    const norm = normalizeCandidateField(f);
    rows.push({
      sample_id: input.snapshotId,
      job_id: norm.scope === 'job' ? (f.jobScope?.key ?? '') : '',
      field: f.field,
      value: norm.status === 'unknown' ? '' : f.value,
      source_file: sourceFileText(f.anchor as ExportAnchor | undefined),
      quote:
        f.anchor?.excerpt ??
        (f.anchor?.locator && (f.anchor.locator as { kind?: string }).kind === 'excerpt'
          ? (f.anchor.locator as { excerpt?: string }).excerpt ?? ''
          : ''),
      locator: locatorText(f.anchor as ExportAnchor | undefined),
      status: norm.status,
      scope: norm.scope,
      rule_version: f.ruleVersion ?? '',
      run_id: input.runId,
      human_revision: f.decision?.action ?? '',
      reason: f.decision?.reason ?? '',
      alternatives:
        f.alternatives && f.alternatives.length > 0
          ? JSON.stringify(
              f.alternatives.map((a) => ({ value: a.value, excerpt: a.excerpt ?? '' })),
            )
          : '',
    });
  }
  return rows;
}

// ==================== 实测指标（可复算，不冒充准确率） ====================

/** 单个 scope（公告公共 / 某岗位 / 归属未知）的实测指标 */
export interface ScopeMetrics {
  key: string;
  /** 应有字段数 = 该 scope 内去重出现过的字段名数（与 WB3 scopes.expected 同口径） */
  expected: number;
  extracted: number;
  unknown: number;
  conflict: number;
  /** 有证据的高影响字段数（携带 anchor 的高影响字段） */
  highImpactEvidenced: number;
  /** 应有高影响字段数 = 该 scope 内出现的高影响字段总数 */
  highImpactExpected: number;
  adopt: number;
  edit: number;
  reject: number;
  pending: number;
  /** 人工修改字段数 = decision.action=edit 的字段数 */
  humanModified: number;
}

/** 比例指标：分子、分母、公式、值（分母为 0 时值为 null，不输出编造比例） */
export interface RatioMetric {
  key: 'completeness' | 'highImpactEvidenceCoverage' | 'humanAdoptionRate';
  numerator: number;
  denominator: number;
  formula: string;
  value: number | null;
}

/** 时间指标：没有可靠时间戳时为 null（UI 显示「未记录」，不补零） */
export interface TimingMetrics {
  /** 总耗时（ms）= finishedAt − createdAt；任一缺失为 null */
  totalDurationMs: number | null;
  /**
   * 审核事件跨度（ms）= 末条审核记录时间 − 首条审核记录时间。
   * 这是「事件跨度」，不是「人工投入时长」——审核员中途可能等待、离开或并行，
   * 不得当作人工投入上报（M6-01）。
   */
  reviewDurationMs: number | null;
  /** 重试次数（run.retryCount） */
  retryCount: number;
}

// ==================== M6：时间计量（自报式，不补造历史） ====================

/**
 * 最小任务时间计量（M6-A）。除 run 原始时间戳（createdAt/finishedAt）与审核
 * 事件跨度外，人工投入/等待/返工/暂停等**只来自人工自报**，无记录一律 null，
 * 绝不从旧日志猜工作分钟、也不填 0（0 会误导为「零成本」）。
 */
export interface TimeTrackingInput {
  /** 人工开始时间（ISO）；缺失=未记录 */
  startedAt?: string | null;
  /** 人工验收完成时间（ISO）；缺失=未记录（任务可能未结束） */
  completedAt?: string | null;
  /** 人工投入时长（毫秒，自报）；缺失=未记录 */
  humanEffortMs?: number | null;
  /** 人工等待时长（毫秒，自报）；缺失=未记录 */
  waitingMs?: number | null;
  /** 返工时长（毫秒，自报）；缺失=未记录 */
  reworkMs?: number | null;
  /** 暂停/中断次数（自报）；缺失=未记录 */
  pauseCount?: number | null;
  /** 重试次数（自报或复用 run.retryCount）；缺失=未记录 */
  retryCount?: number | null;
}

export interface TimeTrackingReport {
  /** 是否未结束（有 startedAt 但无 completedAt） */
  notFinished: boolean;
  /** 人工事件跨度（ms）= completedAt − startedAt；任一缺失或负值为 null */
  eventSpanMs: number | null;
  /** 人工投入（自报）；无记录 null */
  humanEffortMs: number | null;
  /** 人工等待（自报）；无记录 null */
  waitingMs: number | null;
  /** 返工（自报）；无记录 null */
  reworkMs: number | null;
  /** 暂停/中断次数（自报）；无记录 null */
  pauseCount: number | null;
  /** 重试次数（自报）；无记录 null */
  retryCount: number | null;
  /** 说明：墙钟/人工投入/等待可能并行，不强求相加 */
  note: string;
}

/**
 * 计算最小任务时间计量（M6-01/M6-A）。
 *
 * 处理规则：
 * - 未结束（有 startedAt 无 completedAt）→ notFinished=true，eventSpanMs=null；
 * - 负时间（completedAt < startedAt）→ eventSpanMs=null，不输出负值；
 * - 重复事件/重复操作：由自报方去重后传入，本函数只做区间差，不重复累加；
 * - 暂停/恢复：pauseCount 为自报计数，本函数不臆造恢复时长；
 * - 无记录（null/undefined）→ 对应字段为 null，不填 0；
 * - 墙钟总时长、人工投入、等待三者可能并行，不做相加（note 说明）。
 */
export function computeTimeTracking(input: TimeTrackingInput): TimeTrackingReport {
  const startedMs = input.startedAt ? new Date(input.startedAt).getTime() : null;
  const completedMs = input.completedAt ? new Date(input.completedAt).getTime() : null;

  const notFinished = startedMs !== null && completedMs === null;
  let eventSpanMs: number | null = null;
  if (startedMs !== null && completedMs !== null && completedMs >= startedMs) {
    eventSpanMs = completedMs - startedMs;
  }

  const nonNegative = (v: number | null | undefined): number | null =>
    v == null || v < 0 ? null : v;

  return {
    notFinished,
    eventSpanMs,
    humanEffortMs: nonNegative(input.humanEffortMs),
    waitingMs: nonNegative(input.waitingMs),
    reworkMs: nonNegative(input.reworkMs),
    pauseCount:
      input.pauseCount == null || input.pauseCount < 0 ? null : input.pauseCount,
    retryCount:
      input.retryCount == null || input.retryCount < 0 ? null : input.retryCount,
    note: '墙钟总时长、人工投入与等待可能并行，三者分别报告、不做相加；无记录一律为 null 而非 0；人工投入只来自自报，审核事件跨度不是人工投入。',
  };
}

// ==================== M6：独立核验正确率（仅在可核验时计算） ====================

/**
 * 独立核验结果（M6-B6/M6-03）。只有当存在「原件独立核验」的正确答案与
 * 核验人/方式时，才允许计算正确率；否则不得输出正确率/召回率/提效百分比。
 */
export interface IndependentVerification {
  /** 核验人（自报，如「评审员 A」） */
  verifier: string;
  /** 核验方式（自报，如「对照官方原件逐字段核验」） */
  method: string;
  /** 核验的字段总数（分母） */
  totalFields: number;
  /** 判定为正确的字段数（分子） */
  correctFields: number;
}

export interface AccuracyReport {
  /** 是否有独立核验结果；false 时不输出正确率 */
  evaluated: boolean;
  /** 正确率分子（无核验为 null） */
  correctFields: number | null;
  /** 正确率分母（无核验为 null；分母 0 时 value=null） */
  totalFields: number | null;
  /** 核验人（无核验为 null） */
  verifier: string | null;
  /** 核验方式（无核验为 null） */
  method: string | null;
  /** 正确率值 = correct/total；无核验或分母 0 为 null */
  value: number | null;
}

/**
 * 计算正确率（M6-B6/M6-03）。
 *
 * 红线：
 * - 无独立核验结果 → evaluated=false，value=null，**不输出正确率**；
 * - 分母为 0 或正确数 > 总数 → value=null（数据异常，不编造）；
 * - 采用率（adoption）不是准确率；有锚点（anchor）不是定位成功；
 * - 绝不输出召回率、提效百分比（缺对照基线/独立答案时不具备计算条件）。
 */
export function computeAccuracy(
  verification: IndependentVerification | null | undefined,
): AccuracyReport {
  if (!verification) {
    return {
      evaluated: false,
      correctFields: null,
      totalFields: null,
      verifier: null,
      method: null,
      value: null,
    };
  }
  const correct = verification.correctFields;
  const total = verification.totalFields;
  const valid = total > 0 && correct >= 0 && correct <= total;
  return {
    evaluated: true,
    correctFields: correct,
    totalFields: total,
    verifier: verification.verifier,
    method: verification.method,
    value: valid ? correct / total : null,
  };
}

export interface ExportMetrics {
  runId: string;
  status: string;
  parserVersion: string;
  /** 数据集标记：published 版本目录载荷的 dataset；未发布为 'unmarked' */
  datasetMark: 'test' | 'demo' | 'real' | 'unmarked';
  /** 来源 host（example.* 域名即测试/演示来源） */
  sourceHost: string;
  isExampleSource: boolean;
  scopes: ScopeMetrics[];
  totals: ScopeMetrics;
  ratios: RatioMetric[];
  timing: TimingMetrics;
  /** 指标口径说明（逐条人类可读，含公式） */
  formulaNotes: string[];
  /** M2：固定分母（期望清单）口径；无清单为 null */
  fixedDenominator: FixedDenominatorMetrics | null;
}

/**
 * M2：固定分母（期望清单）指标。
 * 分母来自预先确认的清单，不从候选输出反推；缺失/未知/无法核验不移出分母。
 */
export interface FixedDenominatorMetrics {
  /** 是否有清单 */
  hasChecklist: boolean;
  /** 清单版本 */
  checklistVersion: number | null;
  /** 清单来源：independent / retrospective */
  checklistSource: 'independent' | 'retrospective' | null;
  /** 回顾性核对标记 */
  retrospective: boolean;
  /** 原始槽位 / 明确不适用 / 有效分母 / 各状态计数 */
  rawSlots: number;
  notApplicable: number;
  effectiveDenominator: number;
  byStatus: Record<string, number>;
  extracted: number;
  missing: number;
  /** 固定分母完整性 = extracted / 有效分母；无清单或分母为 0 为 null */
  completeness: number | null;
  /** 是否「未建立固定分母，完整性未评估」 */
  completenessNotEvaluated: boolean;
}

/** 单 scope 指标计算（纯函数，可用黄金样本人工复算） */
export function computeScopeMetrics(
  key: string,
  fields: CandidateField[],
): ScopeMetrics {
  const seen = new Set<string>();
  let extracted = 0;
  let unknown = 0;
  let conflict = 0;
  let highImpactEvidenced = 0;
  let highImpactExpected = 0;
  let adopt = 0;
  let edit = 0;
  let reject = 0;
  let pending = 0;

  for (const raw of fields) {
    const norm = normalizeCandidateField(raw);
    seen.add(raw.field);
    if (norm.status === 'extracted') extracted += 1;
    else if (norm.status === 'unknown') unknown += 1;
    else if (norm.status === 'conflict') conflict += 1;

    if (isHighImpactField(raw.field)) {
      highImpactExpected += 1;
      if (raw.anchor) highImpactEvidenced += 1;
    }

    switch (raw.decision?.action) {
      case 'adopt':
        adopt += 1;
        break;
      case 'edit':
        edit += 1;
        break;
      case 'reject':
        reject += 1;
        break;
      case 'pending':
        pending += 1;
        break;
      default:
        break;
    }
  }

  return {
    key,
    expected: seen.size,
    extracted,
    unknown,
    conflict,
    highImpactEvidenced,
    highImpactExpected,
    adopt,
    edit,
    reject,
    pending,
    humanModified: edit,
  };
}

/** 聚合多个 scope 的合计 */
function sumScopes(key: string, scopes: ScopeMetrics[]): ScopeMetrics {
  return {
    key,
    expected: scopes.reduce((s, x) => s + x.expected, 0),
    extracted: scopes.reduce((s, x) => s + x.extracted, 0),
    unknown: scopes.reduce((s, x) => s + x.unknown, 0),
    conflict: scopes.reduce((s, x) => s + x.conflict, 0),
    highImpactEvidenced: scopes.reduce((s, x) => s + x.highImpactEvidenced, 0),
    highImpactExpected: scopes.reduce((s, x) => s + x.highImpactExpected, 0),
    adopt: scopes.reduce((s, x) => s + x.adopt, 0),
    edit: scopes.reduce((s, x) => s + x.edit, 0),
    reject: scopes.reduce((s, x) => s + x.reject, 0),
    pending: scopes.reduce((s, x) => s + x.pending, 0),
    humanModified: scopes.reduce((s, x) => s + x.humanModified, 0),
  };
}

function ratio(
  key: RatioMetric['key'],
  numerator: number,
  denominator: number,
  formula: string,
): RatioMetric {
  return {
    key,
    numerator,
    denominator,
    formula,
    value: denominator > 0 ? numerator / denominator : null,
  };
}

/**
 * 计算整个 run 的实测指标（按 run + 按公告公共/逐岗位）。
 *
 * 口径（人工可复算）：
 * - 应有字段数：该 scope 内去重出现过的字段名数（与 WB3 computeScopeCompleteness
 *   的 expected 同口径，黄金样本可逐条数出）；
 * - 有证据高影响字段数：高影响字段中携带 anchor 的数量；
 * - 人工修改字段数：decision.action=edit 的字段数；
 * - 完整性 = extracted / expected；高影响证据覆盖率 = 有证据高影响 / 应有高影响；
 * - 人工采用率 = (adopt+edit) / 有决策字段数（adoption，不是准确率）；
 * - 无黄金答案或独立人工裁决 → 不输出准确率/召回率/提效百分比。
 */
export function computeExportMetrics(input: {
  runId: string;
  status: string;
  parserVersion: string;
  candidate: ExtractionCandidate;
  createdAt?: Date | string | null;
  finishedAt?: Date | string | null;
  reviewTimes?: Array<Date | string>;
  retryCount: number;
  publishedPayload?: unknown;
  sourceOfficialUrl?: string | null;
  /** M2：期望清单（固定分母）；无清单时为 null/undefined（旧任务未评估） */
  checklist?: ExpectedChecklist | null;
  /** M2：无法核验的来源集合（可选） */
  unverifiableScopes?: ReadonlySet<string>;
}): ExportMetrics {
  const groups = groupFieldsByScope(input.candidate.fields);

  const scopes: ScopeMetrics[] = [];
  if (groups.announcement.length > 0) {
    scopes.push(computeScopeMetrics('announcement', groups.announcement));
  }
  for (const [jobKey, jobFields] of groups.jobs) {
    scopes.push(computeScopeMetrics(jobKey, jobFields));
  }
  if (groups.unknown.length > 0) {
    scopes.push(computeScopeMetrics('unknown', groups.unknown));
  }

  const totals = sumScopes('run', scopes);

  const decidedCount =
    totals.adopt + totals.edit + totals.reject + totals.pending;

  const ratios: RatioMetric[] = [
    ratio(
      'completeness',
      totals.extracted,
      totals.expected,
      '完整性 = extracted / expected（分子=已提取字段数，分母=去重出现字段名数）',
    ),
    ratio(
      'highImpactEvidenceCoverage',
      totals.highImpactEvidenced,
      totals.highImpactExpected,
      '高影响证据覆盖率 = 有证据高影响字段数 / 应有高影响字段数（分子=带 anchor 的高影响字段，分母=出现的高影响字段总数）',
    ),
    ratio(
      'humanAdoptionRate',
      totals.adopt + totals.edit,
      decidedCount,
      '人工采用率 = (adopt+edit) / 有决策字段数（人工采用率不是准确率，仅反映审核动作分布）',
    ),
  ];

  // 时间指标：没有可靠时间戳 → null（UI 显示未记录，不补零）
  const createdMs = input.createdAt ? new Date(input.createdAt).getTime() : null;
  const finishedMs = input.finishedAt ? new Date(input.finishedAt).getTime() : null;
  const totalDurationMs =
    createdMs !== null && finishedMs !== null && finishedMs >= createdMs
      ? finishedMs - createdMs
      : null;

  const reviewMs = (input.reviewTimes ?? [])
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  const reviewDurationMs =
    reviewMs.length >= 2 ? reviewMs[reviewMs.length - 1]! - reviewMs[0]! : null;

  let sourceHost = '';
  try {
    sourceHost = input.sourceOfficialUrl ? new URL(input.sourceOfficialUrl).host : '';
  } catch {
    sourceHost = '';
  }

  const datasetMark = isCatalogPayload(input.publishedPayload)
    ? input.publishedPayload.dataset
    : 'unmarked';

  // M2：固定分母（期望清单）指标；无清单 → 明确「未评估」
  const evaluation = evaluateChecklist(
    input.checklist ?? null,
    input.candidate.fields.map((f) => {
      const norm = normalizeCandidateField(f);
      return {
        field: f.field,
        value: f.value,
        scope: norm.scope,
        jobScope: f.jobScope,
        status: norm.status,
        alternatives: f.alternatives,
      };
    }),
    { unverifiableScopes: input.unverifiableScopes },
  );
  const checklistMetrics = evaluation.metrics;
  const fixedDenominator: FixedDenominatorMetrics = {
    hasChecklist: evaluation.hasChecklist,
    checklistVersion: evaluation.checklistVersion ?? null,
    checklistSource: evaluation.checklistSource ?? null,
    retrospective: isRetrospective(input.checklist ?? null),
    rawSlots: checklistMetrics.rawSlots,
    notApplicable: checklistMetrics.notApplicable,
    effectiveDenominator: checklistMetrics.effectiveDenominator,
    byStatus: checklistMetrics.byStatus as unknown as Record<string, number>,
    extracted: checklistMetrics.extracted,
    missing: checklistMetrics.missing,
    completeness: fixedDenominatorCompleteness(evaluation),
    completenessNotEvaluated: !evaluation.hasChecklist,
  };

  return {
    runId: input.runId,
    status: input.status,
    parserVersion: input.parserVersion,
    datasetMark,
    sourceHost,
    isExampleSource: /\.example\./i.test(sourceHost),
    scopes,
    totals,
    ratios,
    timing: { totalDurationMs, reviewDurationMs, retryCount: input.retryCount },
    fixedDenominator,
    formulaNotes: [
      '应有字段数 = 该范围内去重出现过的字段名数（与 WB3 完整性报告 expected 同口径，可用黄金样本逐条数出）',
      '有证据高影响字段数 = 高影响字段中携带证据锚点（anchor）的数量',
      '人工修改字段数 = decision.action=edit 的字段数',
      '总耗时 = finishedAt − createdAt（任一缺失记为「未记录」）',
      '审核事件跨度 = 末条审核记录时间 − 首条审核记录时间（不足两条记为「未记录」；这是事件跨度，不是人工投入时长）',
      '人工采用率不是准确率：没有黄金答案或独立人工裁决时，不输出准确率/召回率/提效百分比',
      'M2 固定分母：完整性 = 已提取槽位 / 有效分母（原始槽位 − 明确不适用），分母来自预先确认的清单，不从候选输出反推；缺失/未知/无法核验不移出分母',
      'M2 固定分母完整性不是准确率：只反映「清单期望槽位中有多少被提取」，不声称字段值正确',
    ],
  };
}

// ==================== JSON 导出结构 ====================

/** 审核记录摘要（run 级，字段级人工修订在各字段的 decision 中） */
export interface ReviewRecordSummary {
  action: string;
  reason: string;
  reviewerId: string;
  reviewerName: string;
  reviewedAt: string;
}

export interface JsonExport {
  schemaVersion: string;
  exportedAt: string;
  datasetMark: 'test' | 'demo' | 'real' | 'unmarked';
  source: {
    publisher: string;
    /** 已脱敏 URL（host+path，query 丢弃） */
    officialUrl: string;
  };
  run: {
    id: string;
    snapshotId: string;
    announcementId: string | null;
    status: string;
    parserVersion: string;
    retryCount: number;
    createdAt: string;
    updatedAt: string;
    finishedAt: string | null;
  };
  /** 脱敏后的候选（保留 scope/status/alternatives/decision；URL 定位去 query；rawJson 不导出） */
  candidate: ExtractionCandidate;
  /** 真实人工审核记录（run 级摘要，按时间升序） */
  reviewRecords: ReviewRecordSummary[];
  metrics: ExportMetrics;
  csvColumnOrder: readonly string[];
  notes: string[];
}

/** 组装 JSON 导出（服务端已保存记录，不从 UI 状态拼装） */
export function buildJsonExport(input: {
  exportedAt: Date;
  datasetMark: 'test' | 'demo' | 'real' | 'unmarked';
  source: { publisher: string; officialUrl: string };
  run: {
    id: string;
    snapshotId: string;
    announcementId: string | null;
    status: string;
    parserVersion: string;
    retryCount: number;
    createdAt: Date;
    updatedAt: Date;
    finishedAt: Date | null;
  };
  candidate: ExtractionCandidate;
  reviewRecords: ReviewRecordSummary[];
  metrics: ExportMetrics;
}): JsonExport {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    datasetMark: input.datasetMark,
    source: {
      publisher: input.source.publisher,
      officialUrl: redactUrl(input.source.officialUrl),
    },
    run: {
      id: input.run.id,
      snapshotId: input.run.snapshotId,
      announcementId: input.run.announcementId,
      status: input.run.status,
      parserVersion: input.run.parserVersion,
      retryCount: input.run.retryCount,
      createdAt: input.run.createdAt.toISOString(),
      updatedAt: input.run.updatedAt.toISOString(),
      finishedAt: input.run.finishedAt ? input.run.finishedAt.toISOString() : null,
    },
    candidate: sanitizeCandidateForExport(input.candidate),
    reviewRecords: [...input.reviewRecords].sort(
      (a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime(),
    ),
    metrics: input.metrics,
    csvColumnOrder: CSV_COLUMNS,
    notes: [
      CSV_FORMULA_NOTE,
      'locator 中的 URL 已按既有脱敏规则只保留协议+host+path（丢弃 query 中的签名/凭据），管理员可据此定位官方原件',
      'candidate.rawJson 不随导出输出；导出不包含访问令牌、Cookie、数据库连接信息或用户敏感画像',
      'metrics 中的人工采用率不是准确率；没有黄金答案或独立人工裁决时不输出准确率/召回率/提效百分比',
      'human_revision 与 reason 来自服务端已保存的真实审核记录（WB4 字段级决策），不从页面状态拼装',
    ],
  };
}
