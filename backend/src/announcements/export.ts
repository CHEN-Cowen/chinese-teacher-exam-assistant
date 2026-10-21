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
  /** 人工审核耗时（ms）= 末条审核记录 reviewedAt − 首条审核记录 reviewedAt；不足两条为 null */
  reviewDurationMs: number | null;
  /** 重试次数（run.retryCount） */
  retryCount: number;
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
    formulaNotes: [
      '应有字段数 = 该范围内去重出现过的字段名数（与 WB3 完整性报告 expected 同口径，可用黄金样本逐条数出）',
      '有证据高影响字段数 = 高影响字段中携带证据锚点（anchor）的数量',
      '人工修改字段数 = decision.action=edit 的字段数',
      '总耗时 = finishedAt − createdAt（任一缺失记为「未记录」）',
      '人工审核耗时 = 末条审核记录时间 − 首条审核记录时间（不足两条记为「未记录」）',
      '人工采用率不是准确率：没有黄金答案或独立人工裁决时，不输出准确率/召回率/提效百分比',
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
