/**
 * M3：跨文件归属与冲突复核（纯函数）。
 *
 * 目标：正文、岗位附件、补充/更正材料都保留独立证据；按公告、岗位、批次、
 * 适用范围与版本判断不同值的关系，**不再通过同字段首次命中静默丢弃另一来源**。
 *
 * 背景（M1 断点）：
 * - `ManualExtractionService.runExtraction` 逐文件调用 `extractFields` 后直接拼接
 *   `allFields`——跨文件从未进入同一复核任务：
 *   - 两个文件对同岗位同字段给出**不同值** → 两条独立 `extracted` 记录，
 *     不判 conflict、不阻塞发布（真实冲突被掩盖）；
 *   - **相同值** → 两条重复记录（重复计数，证据只留一条）。
 *
 * 复核规则（对齐 M3 实施要求）：
 * 1. 每来源先独立收集候选和锚点，再归属/比较；相同字段名不阻止另一来源进入复核；
 * 2. 对齐键 = 公告身份（run 内天然隔离）+ scope + 已确认岗位身份（jobKey）+ 字段
 *    + 批次（batchId）+ 版本关系（文件 relationType）。未知身份（scope=unknown、
 *    jobKey 为空或 `job:unknown`）进入人工待确认，不猜归属、不与已知岗位合并；
 * 3. 岗位专属人数不能由公告总招聘数推成（scope 不同天然不合并）；无法把正文人数
 *    绑定到具体岗位时标待归属；
 * 4. 同一适用范围同字段不同值 → conflict：保留双方原值、来源、位置、提取版本，
 *    阻塞直接确认；相同值 → 合并为一条候选但保留**所有**证据（anchors），不只
 *    保留第一次；
 * 5. 公告统一规则（announcement）与岗位特例（job）分别保留；公共条件与例外
 *    （age / age_exception 等）分别成槽，报告给出适用关系对照，不凭「岗位优先」
 *    覆盖公共规则；
 * 6. 更正关系：relationType=replacement/supplement 的文件候选进入复核时标注来源
 *    关系；值不同仍进 conflict 待人工裁决——只有官方明确关系或人工确认后旧值
 *    才失效（WB4 裁决留痕，原 alternatives 与证据保留）。
 *
 * 本文件只包含无副作用纯函数；持久化与调用在 service 层。
 */
import {
  fieldIdentity,
  type CandidateField,
  type EvidenceAnchorInput,
  type EvidenceLocator,
  type FieldAlternative,
} from './domain.js';

// ==================== 类型 ====================

/** 参与复核的单个来源文件（正文或附件）及其独立抽取结果 */
export interface ReconcileSource {
  /** 来源文件元信息 */
  file: {
    /** 逻辑文档 id（正文/附件各自的 SourceDocument） */
    documentId: string;
    /** 快照 id */
    snapshotId: string;
    /** 文件名（正文为 URL/标题，附件为文件名） */
    name: string;
    /** body=公告正文 / attachment=附件 */
    kind: 'body' | 'attachment';
    /**
     * 来源文件的关系类型（M3-07）：replacement/supplement 等已确认的更正/补充关系；
     * null=关系不明。值不同时进 conflict 待人工，不自动覆盖旧值。
     */
    relationType?: string | null;
  };
  /** 该文件独立抽取产出的候选字段（未经跨文件比较） */
  fields: CandidateField[];
}

/** 复核报告（审计可追溯，随 rawJson 持久化） */
export interface ReconcileReport {
  /** 参与复核的来源文件数 */
  sourceCount: number;
  /** 冲突清单（identity + 各来源值与证据位置） */
  conflicts: Array<{
    identity: string;
    field: string;
    scope: string;
    jobKey?: string;
    /** 各来源值（含来源文件与提取版本） */
    values: Array<{ value: string; sourceFile: string; ruleVersion?: string; relationType?: string | null }>;
    /** 是否涉及疑似更正来源（relationType=replacement/supplement） */
    suspectedCorrection: boolean;
  }>;
  /** 同值合并清单（identity + 保留的证据数） */
  merged: Array<{ identity: string; field: string; evidenceCount: number }>;
  /** 待归属清单（身份不明，进人工待确认） */
  unattributed: Array<{
    identity: string;
    field: string;
    value: string;
    sourceFile: string;
    /** 不明原因：scope=unknown / 岗位身份不明 */
    reason: 'scope_unknown' | 'job_identity_unknown';
  }>;
  /** 公共条件与岗位特例并存的适用关系对照（不覆盖，供审核展示） */
  applicabilityRelations: Array<{
    field: string;
    announcementValue?: string;
    jobValues: Array<{ jobKey: string; value: string }>;
    note: string;
  }>;
  /** 复核告警 */
  warnings: string[];
}

/** 复核结果：合并后的候选字段 + 报告 */
export interface ReconcileResult {
  fields: CandidateField[];
  report: ReconcileReport;
}

// ==================== 复核（纯函数） ====================

/** 身份不明判定：scope=unknown，或 job 但 jobKey 空/为兜底值 */
function isUnattributed(field: CandidateField): false | 'scope_unknown' | 'job_identity_unknown' {
  const scope = field.scope ?? 'announcement';
  if (scope === 'unknown') return 'scope_unknown';
  if (scope === 'job') {
    const key = field.jobScope?.key ?? '';
    if (!key || key === 'job:unknown') return 'job_identity_unknown';
  }
  return false;
}

/**
 * 跨文件归属与冲突复核。
 *
 * 输入各来源的独立抽取结果，输出合并后的候选字段与复核报告。
 * - 同 identity（scope+jobKey+field+batchId）：
 *   - 值全部相同 → 合并为一条，anchors 保留全部来源证据；
 *   - 值不同 → conflict（alternatives 保留全部值+来源+位置+提取版本），
 *     主值取正文来源优先（公告正文是权威原文），否则第一来源；
 * - 身份不明 → 独立保留 + 报告待归属（不猜、不合并）；
 * - 单一来源的字段原样保留（不额外加工）。
 */
export function reconcileFields(sources: ReconcileSource[]): ReconcileResult {
  const warnings: string[] = [];
  const report: ReconcileReport = {
    sourceCount: sources.length,
    conflicts: [],
    merged: [],
    unattributed: [],
    applicabilityRelations: [],
    warnings,
  };

  // 1. 展开所有（来源, 候选）对
  interface Entry {
    source: ReconcileSource;
    field: CandidateField;
    identity: string;
  }
  const entries: Entry[] = [];
  for (const source of sources) {
    for (const field of source.fields) {
      entries.push({ source, field, identity: fieldIdentity(field) });
    }
  }

  // 2. 身份不明 → 独立保留 + 待归属报告（不参与合并，M3-08）
  const unattributedEntries: Entry[] = [];
  const attributedEntries: Entry[] = [];
  for (const entry of entries) {
    const unknownReason = isUnattributed(entry.field);
    if (unknownReason) {
      unattributedEntries.push(entry);
      report.unattributed.push({
        identity: entry.identity,
        field: entry.field.field,
        value: entry.field.value,
        sourceFile: entry.source.file.name,
        reason: unknownReason,
      });
    } else {
      attributedEntries.push(entry);
    }
  }

  // 3. 按 identity 分组
  const groups = new Map<string, Entry[]>();
  for (const entry of attributedEntries) {
    const bucket = groups.get(entry.identity);
    if (bucket) bucket.push(entry);
    else groups.set(entry.identity, [entry]);
  }

  const out: CandidateField[] = [];

  for (const [identity, group] of groups) {
    if (group.length === 1) {
      // 单一来源：原样保留
      out.push(group[0]!.field);
      continue;
    }

    // 多来源：判定值是否全部一致
    const values = new Set(group.map((g) => g.field.value));

    if (values.size === 1) {
      // 同值合并（M3-04）：一条候选 + anchors 保留全部证据
      const merged = mergeSameValue(group);
      out.push(merged);
      report.merged.push({
        identity,
        field: merged.field,
        evidenceCount: merged.anchors?.length ?? 1,
      });
      continue;
    }

    // 不同值 → conflict（M3-01）：正文来源优先作为主值，alternatives 保留全部
    const conflict = buildCrossFileConflict(group, identity, warnings);
    out.push(conflict);
    report.conflicts.push({
      identity,
      field: conflict.field,
      scope: conflict.scope ?? 'announcement',
      jobKey: conflict.jobScope?.key,
      values: group.map((g) => ({
        value: g.field.value,
        sourceFile: g.source.file.name,
        ruleVersion: g.field.ruleVersion,
        relationType: g.source.file.relationType ?? null,
      })),
      suspectedCorrection: group.some(
        (g) =>
          g.source.file.relationType === 'replacement' ||
          g.source.file.relationType === 'supplement',
      ),
    });
  }

  // 身份不明的字段也进入输出（待人工确认归属，不丢弃）
  for (const entry of unattributedEntries) {
    out.push(entry.field);
  }

  // 4. 公共条件与岗位特例对照（M3-05）：同一字段名在公告级与岗位级并存时列出，
  //    不覆盖、不判冲突（scope 不同是不同槽位）
  report.applicabilityRelations = buildApplicabilityRelations(out);

  if (report.conflicts.length > 0) {
    warnings.push(
      `跨文件复核发现 ${report.conflicts.length} 个不同值冲突，已保留全部来源与证据，待人工裁决`,
    );
  }
  if (report.unattributed.length > 0) {
    warnings.push(
      `跨文件复核发现 ${report.unattributed.length} 个身份不明候选，已保留待人工确认归属`,
    );
  }

  return { fields: out, report };
}

// ==================== 合并与冲突构造 ====================

/**
 * 同值合并（M3-04）：一条候选，anchors 保留全部来源证据。
 * anchor 保持首个来源（向后兼容：高影响字段门禁读 anchor）。
 */
function mergeSameValue(group: Array<{ source: ReconcileSource; field: CandidateField }>): CandidateField {
  const first = group[0]!;
  const anchors: EvidenceAnchorInput[] = group
    .map((g) => g.field.anchor)
    .filter((a): a is EvidenceAnchorInput => Boolean(a));
  // 单来源或无多证据 → 不加 anchors（保持结构最小）
  const needsAnchors = new Set(group.map((g) => g.source.file.snapshotId)).size > 1;
  return {
    ...first.field,
    ...(needsAnchors && anchors.length > 0 ? { anchors } : {}),
    ruleVersion: first.field.ruleVersion,
  };
}

/**
 * 跨文件冲突构造（M3-01/M3-07）：保留双方原值、来源、位置、提取版本。
 * 主值选择：公告正文（kind=body）优先——公告正文是权威原文；
 * 无正文来源时取第一来源（不猜，alternatives 全保留待人工裁决）。
 */
function buildCrossFileConflict(
  group: Array<{ source: ReconcileSource; field: CandidateField }>,
  identity: string,
  warnings: string[],
): CandidateField {
  const bodyEntry = group.find((g) => g.source.file.kind === 'body');
  const primary = bodyEntry ?? group[0]!;
  const suspectedCorrection = group.some(
    (g) =>
      g.source.file.relationType === 'replacement' ||
      g.source.file.relationType === 'supplement',
  );

  const alternatives: FieldAlternative[] = group.map((g) => ({
    value: g.field.value,
    source: locatorOf(g.field) ?? { kind: 'excerpt', excerpt: '' },
    excerpt: g.field.anchor?.excerpt ?? undefined,
    ruleVersion: g.field.ruleVersion,
    sourceFile: g.source.file.name,
  }));

  if (suspectedCorrection) {
    warnings.push(
      `${identity} 涉及疑似更正来源（replacement/supplement），需人工确认更正关系后裁决；确认前旧值不失效`,
    );
  }

  return {
    ...primary.field,
    status: 'conflict',
    // 主值保留权威来源（正文优先）；全部值与证据在 alternatives
    value: primary.field.value,
    anchor: primary.field.anchor,
    anchors: group
      .map((g) => g.field.anchor)
      .filter((a): a is EvidenceAnchorInput => Boolean(a)),
    alternatives,
    ruleVersion: primary.field.ruleVersion,
  };
}

/** 取候选字段的证据定位（构造 alternative 的 source 用） */
function locatorOf(field: CandidateField): EvidenceLocator | undefined {
  return field.anchor?.locator;
}

// ==================== 适用关系对照（M3-05） ====================

/**
 * 公共条件与岗位特例并存对照：同一字段名既有 announcement 值又有 job 值时，
 * 报告适用关系（公共条件 + 岗位特例分别保留），不覆盖。
 */
function buildApplicabilityRelations(fields: CandidateField[]): ReconcileReport['applicabilityRelations'] {
  const relations: ReconcileReport['applicabilityRelations'] = [];
  const byField = new Map<string, { announcement?: CandidateField; jobs: Array<{ jobKey: string; value: string }> }>();

  for (const f of fields) {
    const scope = f.scope ?? 'announcement';
    if (scope === 'unknown') continue; // 身份不明不参与适用关系
    const entry = byField.get(f.field) ?? { jobs: [] };
    if (scope === 'announcement') {
      // 同名公告级多条（含批次）时取第一条对照
      if (!entry.announcement) entry.announcement = f;
    } else {
      const key = f.jobScope?.key ?? '';
      if (key && !entry.jobs.some((j) => j.jobKey === key)) {
        entry.jobs.push({ jobKey: key, value: f.value });
      }
    }
    byField.set(f.field, entry);
  }

  for (const [field, entry] of byField) {
    if (entry.announcement && entry.jobs.length > 0) {
      relations.push({
        field,
        announcementValue: entry.announcement.value,
        jobValues: entry.jobs,
        note: '公告统一规则与岗位特例分别保留；岗位值不覆盖公共规则，适用关系待审核确认',
      });
    }
  }
  return relations;
}
