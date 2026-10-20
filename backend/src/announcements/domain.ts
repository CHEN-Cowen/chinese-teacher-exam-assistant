/**
 * 公告提取、审核与版本留痕领域纯函数（后端）。
 *
 * 对应 docs/v6.1-data-pipeline.md 与 PRD v6.1 第 7.2、7.10 节。
 * 本文件只包含无副作用、无存储、无网络的纯函数：
 * - 内容哈希与快照去重；
 * - 提取任务状态机；
 * - 高影响字段证据锚点校验；
 * - 已发布版本只追加（不可变）；
 * - 审核留痕（修改前后值）；
 * - 失败重试幂等。
 *
 * 业务持久化与权限在 service 层实现；service 调用本模块做规则判定。
 */
import { createHash } from 'node:crypto';

// ==================== 类型 ====================

/** 提取任务主状态机（数据管道文档第 4 节） */
export type ExtractionRunStatus =
  | 'submitted'
  | 'extracting'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'published';

/** 公告版本状态 */
export type VersionStatus = 'published' | 'superseded' | 'withdrawn';

/** 审核动作 */
export type ReviewAction =
  | 'approve'
  | 'approve_with_edit'
  | 'reject'
  | 'mark_incomplete';

/** 证据定位类型（与前端 v6.1 EvidenceLocator 对齐） */
export type EvidenceLocator =
  | { kind: 'url'; url: string; anchor?: string }
  | { kind: 'file'; fileId: string; fileName: string; page?: number }
  | {
      kind: 'worksheet';
      fileId: string;
      fileName: string;
      sheet: string;
      cell?: string;
    }
  | { kind: 'excerpt'; excerpt: string };

/** 字段级证据锚点：高影响字段必须具备才能审核通过 */
export interface EvidenceAnchorInput {
  field: string;
  locator: EvidenceLocator;
  excerpt?: string;
  /**
   * 富定位数据（v7.2 证据链）：快照 id、存储 key、内容哈希、来源 URL、
   * 页码/单元格/选择器等，保证任意字段可回到原文。可空（兼容旧锚点）。
   */
  locatorData?: Record<string, unknown>;
}

/** 字段来源：确定性规则 / AI 候选 / OCR 候选（AI 与 OCR 只能产生候选） */
export type FieldOrigin = 'rule' | 'ai' | 'ocr';

/**
 * 字段归属范围（WB1 岗位级候选契约）：
 * - `announcement`：公告公共范围（只出现一次，对整份公告成立）；
 * - `job`：岗位范围（随岗位变化），必须携带 `jobKey`；
 * - `unknown`：原文结构无法判定归属，进入人工审核，不得猜归属。
 */
export type FieldScope = 'announcement' | 'job' | 'unknown';

/**
 * 候选字段结构化状态（WB1）：
 * - `extracted`：成功提取到一个值；
 * - `unknown`：原文未写明 / 无法判定（未知 ≠ 不符合）；
 * - `conflict`：同一字段存在两个及以上互相矛盾的值（禁止静默覆盖）。
 */
export type FieldStatus = 'extracted' | 'unknown' | 'conflict';

/**
 * 岗位范围来源信息（WB1）：稳定 key + 可选的来源定位。
 * `key` 不能依赖可被人工编辑的名称，建议由来源文档/工作表/数据行形成；
 * 岗位编号（jobCode）只是业务属性，不是唯一技术依赖。
 */
export interface JobScopeInfo {
  /** 稳定岗位 key（公告内唯一，如 `sheet:岗位表:row:2` 或来源文档+行号派生） */
  key: string;
  /** 官方岗位编号/代码（业务属性，可能缺失） */
  jobCode?: string;
  /** 来源工作表名 */
  sheet?: string;
  /** 来源数据行号 */
  row?: number;
}

/**
 * 冲突状态的替代值（WB1）：保留所有值及其各自证据，不允许拼接成一段字符串。
 */
export interface FieldAlternative {
  /** 替代值原文 */
  value: string;
  /** 该替代值的来源定位（worksheet/cell、段落或 URL 锚点） */
  source: EvidenceLocator;
  /** 原文摘录（可选） */
  excerpt?: string;
}

/**
 * 可审计的人工决策（WB1）：`adopt | edit | reject | pending`。
 * 保留编辑前后值、原因、操作者与时间。
 */
export interface HumanDecision {
  /** 决策类型 */
  action: 'adopt' | 'edit' | 'reject' | 'pending';
  /** 决策前值（edit/reject 时有意义） */
  beforeValue?: string;
  /** 决策后值（adopt/edit 时为采纳值；reject/pending 时可空） */
  afterValue?: string;
  /** 决策原因（必填） */
  reason: string;
  /** 操作者 id */
  operatorId: string;
  /** 决策时间（ISO 字符串） */
  decidedAt: string;
}

/** 提取产出的单个候选字段 */
export interface CandidateField {
  field: string;
  value: string;
  /** 证据锚点；高影响字段必填 */
  anchor?: EvidenceAnchorInput;
  /** 提取置信度 0-1，仅展示用，不替代人工审核 */
  confidence?: number;
  /** 来源：rule（默认，确定性规则）/ ai / ocr */
  origin?: FieldOrigin;
  /**
   * AI/OCR 产出且置信度不足时必须人工确认；
   * 人工审核通过时由审核服务写入 humanConfirmedAt 后才允许发布。
   */
  needsHumanConfirm?: boolean;
  /** 人工确认时间（审核通过动作时写入；AI/OCR 字段没有它不能发布） */
  humanConfirmedAt?: string;

  /**
   * WB1 增量字段（全部可选，兼容旧 JSON）：
   */
  /** 归属范围；job 时须带 jobScope 或 jobKey */
  scope?: FieldScope;
  /** 岗位范围来源信息（scope=job 时提供） */
  jobScope?: JobScopeInfo;
  /** 结构化状态；默认按 extracted 语义处理（仅兼容读取时补齐） */
  status?: FieldStatus;
  /** 产生该字段的规则/解析器版本（可审计、可回放） */
  ruleVersion?: string;
  /** 冲突时的替代值列表（各带证据），禁止静默覆盖 */
  alternatives?: FieldAlternative[];
  /** 人工决策留痕（adopt/edit/reject/pending） */
  decision?: HumanDecision;
}

/** 一次提取的候选结果（解析器/AI 产出，未经审核） */
export interface ExtractionCandidate {
  fields: CandidateField[];
  parserVersion: string;
  rawJson?: unknown;
}

/** 审核记录（只追加） */
export interface ReviewRecord {
  id: string;
  runId: string;
  reviewerId: string;
  reviewerName: string;
  action: ReviewAction;
  reason: string;
  /** 审核前的候选 JSON 快照 */
  beforePayload: ExtractionCandidate;
  /** 审核后的候选 JSON 快照（approve_with_edit 时与 before 不同） */
  afterPayload: ExtractionCandidate;
  reviewedAt: string;
}

/** 已发布的不可变公告版本 */
export interface PublishedVersion {
  id: string;
  announcementId: string;
  versionNumber: number;
  status: VersionStatus;
  payload: ExtractionCandidate;
  publishedAt: string;
  previousVersionId?: string;
  supersededAt?: string;
  /** 撤回时间（仅 withdrawn 时有值） */
  withdrawnAt?: string;
  /** 撤回原因（审计必填） */
  withdrawReason?: string;
  /** 撤回操作人 id */
  withdrawnBy?: string;
}

// ==================== 高影响字段清单 ====================

/**
 * 高影响字段：报名时间、考试时间、科目、分值、资格条件、招聘人数、
 * 用工性质、学历、专业、教师资格、年龄等。
 * 没有 EvidenceAnchor 的高影响字段不能通过审核。
 */
export const HIGH_IMPACT_FIELDS: ReadonlySet<string> = new Set([
  'registration_time',
  'exam_time',
  'subjects',
  'score',
  'qualification',
  'headcount',
  'employment_nature',
  'education',
  'major',
  'teacher_cert',
  'age',
  'hukou',
]);

export function isHighImpactField(field: string): boolean {
  return HIGH_IMPACT_FIELDS.has(field);
}

// ==================== 内容哈希与快照去重 ====================

/** 计算原始内容的 SHA-256 十六进制摘要（用于快照去重） */
export function computeContentHash(content: string | Buffer): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 判断同一来源下是否已存在相同内容哈希的快照。
 * 存在则返回已有快照 id（不创建重复版本），否则返回 null。
 */
export function findDuplicateSnapshot(
  existing: { id: string; contentHash: string }[],
  contentHash: string,
): string | null {
  const found = existing.find((s) => s.contentHash === contentHash);
  return found ? found.id : null;
}

// ==================== 状态机 ====================

/** 合法状态迁移表 */
const TRANSITIONS: Record<ExtractionRunStatus, ExtractionRunStatus[]> = {
  submitted: ['extracting', 'failed'],
  extracting: ['pending_review', 'failed'],
  pending_review: ['approved', 'rejected'],
  approved: ['published'],
  rejected: ['pending_review'], // 驳回后可重新进入待审核（重新提取或修正）
  failed: ['submitted'], // 失败可重试：回到 submitted 再走 extracting
  published: [], // 终态
};

/**
 * 状态机迁移校验。
 * 不合法迁移抛错，由 service 层捕获并返回 400。
 */
export function assertTransition(
  from: ExtractionRunStatus,
  to: ExtractionRunStatus,
): void {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`非法状态迁移：${from} → ${to}`);
  }
}

/** 是否已进入终态（published） */
export function isTerminal(status: ExtractionRunStatus): boolean {
  return status === 'published';
}

// ==================== 高影响字段证据校验 ====================

/**
 * 校验候选结果中所有高影响字段都带有 EvidenceAnchor。
 * 返回缺失证据的高影响字段列表；空数组表示通过。
 */
export function findHighImpactFieldsWithoutAnchor(
  candidate: ExtractionCandidate,
): string[] {
  const missing: string[] = [];
  for (const f of candidate.fields) {
    if (isHighImpactField(f.field) && !f.anchor) {
      missing.push(f.field);
    }
  }
  return missing;
}

/**
 * 审核通过前置校验：
 * 1. 状态必须是 pending_review；
 * 2. 所有高影响字段必须有 EvidenceAnchor；
 * 3. 至少有一个字段。
 * 不通过抛错。
 */
export function assertCanApprove(
  status: ExtractionRunStatus,
  candidate: ExtractionCandidate,
): void {
  if (status !== 'pending_review') {
    throw new Error(`只有待审核状态的任务可以审核通过，当前状态：${status}`);
  }
  if (candidate.fields.length === 0) {
    throw new Error('候选结果为空，无法审核通过');
  }
  const missing = findHighImpactFieldsWithoutAnchor(candidate);
  if (missing.length > 0) {
    throw new Error(
      `高影响字段缺少证据锚点，无法审核通过：${missing.join('、')}`,
    );
  }
}

// ==================== 发布门禁 ====================

/** 只有审核通过（approved）的任务才能发布 */
export function canPublish(status: ExtractionRunStatus): boolean {
  return status === 'approved';
}

/** AI/OCR 来源字段：没有人工确认时间就不得发布（AI 不能自动发布） */
export function findUnconfirmedAutoFields(
  candidate: ExtractionCandidate,
): string[] {
  return candidate.fields
    .filter(
      (f) =>
        (f.origin === 'ai' || f.origin === 'ocr') &&
        !f.humanConfirmedAt,
    )
    .map((f) => f.field);
}

export function assertCanPublish(
  status: ExtractionRunStatus,
  candidate?: ExtractionCandidate,
): void {
  if (!canPublish(status)) {
    throw new Error(
      `只有审核通过的任务才能发布，当前状态：${status}。未审核候选不得发布。`,
    );
  }
  if (candidate) {
    const unconfirmed = findUnconfirmedAutoFields(candidate);
    if (unconfirmed.length > 0) {
      throw new Error(
        `AI/OCR 来源字段未经人工确认，不能发布：${unconfirmed.join('、')}`,
      );
    }
  }
}

/** 审核通过时为 AI/OCR 来源字段写入人工确认时间（人工确认留痕） */
export function markAutoFieldsConfirmed(
  fields: CandidateField[],
  confirmedAt: string,
): CandidateField[] {
  return fields.map((f) =>
    f.origin === 'ai' || f.origin === 'ocr' ? { ...f, humanConfirmedAt: confirmedAt } : f,
  );
}

// ==================== 版本只追加 ====================

export interface PublishVersionInput {
  announcementId: string;
  candidate: ExtractionCandidate;
  previousVersion?: PublishedVersion | null;
  publishedAt: string;
}

/**
 * 发布新版本：不可变追加，旧版本标记 superseded 但内容不被覆盖。
 * - 首次发布 versionNumber = 1；
 * - 后续发布 versionNumber 严格递增；
 * - previousVersionId 指向前一版本；
 * - 旧版本 status 变为 superseded 并记录 supersededAt；
 * - 返回新版本和被取代的旧版本副本（供 service 持久化）。
 */
export function publishVersion(
  input: PublishVersionInput,
): { version: PublishedVersion; superseded: PublishedVersion | null } {
  const prev = input.previousVersion ?? null;
  const versionNumber = prev ? prev.versionNumber + 1 : 1;

  const version: PublishedVersion = {
    id: `${input.announcementId}-v${versionNumber}`,
    announcementId: input.announcementId,
    versionNumber,
    status: 'published',
    payload: input.candidate,
    publishedAt: input.publishedAt,
    previousVersionId: prev?.id,
  };

  const superseded: PublishedVersion | null = prev
    ? { ...prev, status: 'superseded', supersededAt: input.publishedAt }
    : null;

  return { version, superseded };
}

// ==================== 版本撤回 ====================

export interface WithdrawVersionInput {
  /** 撤回原因（必填非空，供审计） */
  reason: string;
  /** 撤回时间（ISO 字符串） */
  withdrawnAt: string;
  /** 撤回操作人 id */
  withdrawnBy?: string;
}

/**
 * 撤回当前已发布版本：
 * - 仅 status='published' 可撤回，否则抛错；
 * - 原因必填非空；
 * - 不删除历史、不产生新版本、不改写 payload；
 * - 不复活旧版（旧版保持 superseded）；
 * - 撤回后 status='withdrawn'，supersededAt 记为撤回时间（时间线口径统一）。
 */
export function withdrawVersion(
  version: PublishedVersion,
  input: WithdrawVersionInput,
): PublishedVersion {
  if (version.status !== 'published') {
    throw new Error(
      `只有当前发布中的版本可以撤回，当前状态：${version.status}`,
    );
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error('撤回原因不能为空');
  }
  return {
    ...version,
    status: 'withdrawn',
    supersededAt: input.withdrawnAt,
    withdrawnAt: input.withdrawnAt,
    withdrawReason: input.reason,
    withdrawnBy: input.withdrawnBy,
  };
}

// ==================== 审核留痕 ====================

export interface SubmitReviewInput {
  runId: string;
  reviewerId: string;
  reviewerName: string;
  action: ReviewAction;
  reason: string;
  /** 当前候选结果（审核前） */
  current: ExtractionCandidate;
  /** approve_with_edit 时审核员修改后的候选结果 */
  edited?: ExtractionCandidate;
  reviewedAt: string;
}

/**
 * 构造审核记录（只追加，包含修改前后快照）。
 * - approve：after = before（值不变）；
 * - approve_with_edit：after = edited（必须提供且与 before 不同）；
 * - reject / mark_incomplete：after = before（候选不变，仅记录动作）。
 */
export function buildReviewRecord(input: SubmitReviewInput): ReviewRecord {
  const { action, current, edited } = input;
  let afterPayload: ExtractionCandidate;

  switch (action) {
    case 'approve':
    case 'reject':
    case 'mark_incomplete':
      afterPayload = current;
      break;
    case 'approve_with_edit': {
      if (!edited) {
        throw new Error('修改后通过必须提供修改后的候选结果');
      }
      afterPayload = edited;
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知审核动作：${String(exhaustive)}`);
    }
  }

  return {
    id: `rlog-${input.runId}-${Date.now()}`,
    runId: input.runId,
    reviewerId: input.reviewerId,
    reviewerName: input.reviewerName,
    action,
    reason: input.reason,
    beforePayload: current,
    afterPayload,
    reviewedAt: input.reviewedAt,
  };
}

/** 判断审核动作是否通过（approve / approve_with_edit） */
export function isApprovalAction(action: ReviewAction): boolean {
  return action === 'approve' || action === 'approve_with_edit';
}

/** 审核通过后的任务状态 */
export function nextStatusAfterReview(action: ReviewAction): ExtractionRunStatus {
  if (isApprovalAction(action)) return 'approved';
  if (action === 'reject') return 'rejected';
  return 'pending_review'; // mark_incomplete 回到待审核，需补充信息
}

// ==================== 失败重试与幂等 ====================

/**
 * 失败任务可重试。重试必须：
 * 1. 当前状态为 failed；
 * 2. 复用原始快照（不重新抓取）；
 * 3. 幂等键 = snapshotId + parserVersion，防止同一快照重复出版本。
 *
 * 返回复用快照后的新任务状态。
 */
export function retryFailedRun(
  currentStatus: ExtractionRunStatus,
): ExtractionRunStatus {
  if (currentStatus !== 'failed') {
    throw new Error(`只有失败状态的任务可以重试，当前状态：${currentStatus}`);
  }
  return 'submitted';
}

/**
 * 计算提取幂等键：同一快照 + 同一解析器版本只应产出一次候选。
 * service 层用此键检查是否已有 pending_review/approved/published 的结果，
 * 避免重试产生重复发布。
 */
export function extractionIdempotencyKey(
  snapshotId: string,
  parserVersion: string,
): string {
  return `${snapshotId}:${parserVersion}`;
}

// ==================== 版本差异 ====================

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

/** 对比两个已发布版本的字段差异（用于 V1/V2 差异展示） */
export function diffVersions(
  v1: PublishedVersion,
  v2: PublishedVersion,
): FieldDiff[] {
  const map1 = new Map(v1.payload.fields.map((f) => [f.field, f.value]));
  const map2 = new Map(v2.payload.fields.map((f) => [f.field, f.value]));
  const allFields = new Set([...map1.keys(), ...map2.keys()]);

  const diffs: FieldDiff[] = [];
  for (const field of allFields) {
    const before = map1.get(field) ?? '';
    const after = map2.get(field) ?? '';
    diffs.push({ field, before, after, changed: before !== after });
  }
  return diffs;
}

// ==================== WB1：岗位级候选契约 ====================

/**
 * 候选字段的稳定身份（scope + field）。
 *
 * 供 WB2 去重使用：同一公告内，两个不同岗位的同名 `major` 字段
 * 因为 jobKey 不同而得到不同 identity；公共字段与岗位字段不会相撞。
 *
 * 规则：
 * - scope=announcement 或 unknown → `announcement:<field>`（公共字段全局唯一）；
 * - scope=job → `job:<jobKey>:<field>`（岗位字段按岗位 key 隔离）。
 */
export function fieldIdentity(field: CandidateField): string {
  const scope = normalizeFieldScope(field);
  if (scope === 'job') {
    const jobKey = field.jobScope?.key ?? '';
    return `job:${jobKey}:${field.field}`;
  }
  return `${scope}:${field.field}`;
}

/**
 * 兼容读取：把旧候选 JSON 的字段补齐默认语义，不静默改写历史数据库。
 *
 * 默认语义（仅在本函数返回的新对象中补齐）：
 * - 无 scope → `announcement`（旧字段视为公告级）；
 * - 无 status → `extracted`；
 * - 其余 WB1 字段（jobScope/alternatives/decision/ruleVersion）保持缺省，不编造。
 *
 * 注意：本函数只做读取态归一化，调用方不得用其结果回写持久化数据。
 */
export function normalizeCandidateField(
  raw: CandidateField,
): CandidateField & { scope: FieldScope; status: FieldStatus } {
  return {
    ...raw,
    scope: normalizeFieldScope(raw),
    status: raw.status ?? 'extracted',
  };
}

/** 归一化 scope：缺省视为 announcement（兼容旧 JSON） */
function normalizeFieldScope(field: CandidateField): FieldScope {
  return field.scope ?? 'announcement';
}

/**
 * 按 scope 分组候选字段（供 WB4 审核 UI 使用）。
 *
 * 返回三组：announcement / job / unknown。
 * job 组内再按 jobKey 聚合为子组，便于审核界面按岗位分区展示。
 */
export interface FieldGroups {
  announcement: CandidateField[];
  /** job 组按 jobKey 聚合；未知 jobKey 归入 `''` 桶 */
  jobs: Map<string, CandidateField[]>;
  unknown: CandidateField[];
}

export function groupFieldsByScope(fields: CandidateField[]): FieldGroups {
  const result: FieldGroups = {
    announcement: [],
    jobs: new Map<string, CandidateField[]>(),
    unknown: [],
  };
  for (const field of fields) {
    const scope = normalizeFieldScope(field);
    if (scope === 'announcement') {
      result.announcement.push(field);
    } else if (scope === 'job') {
      const key = field.jobScope?.key ?? '';
      const bucket = result.jobs.get(key);
      if (bucket) bucket.push(field);
      else result.jobs.set(key, [field]);
    } else {
      result.unknown.push(field);
    }
  }
  return result;
}

/**
 * 构造岗位范围的候选字段（WB1/WB2 共用便捷函数）。
 * 生成稳定 jobKey：优先官方岗位编号，否则用来源定位（sheet+row）派生。
 */
export function makeJobScopedField(
  field: CandidateField,
  jobScope: JobScopeInfo,
): CandidateField {
  return { ...field, scope: 'job', jobScope };
}

/**
 * 从来源定位派生稳定岗位 key（不依赖可编辑的名称）。
 * 优先官方岗位编号（jobCode），否则用 sheet+row 形成内部位置键。
 */
export function deriveJobKey(parts: {
  jobCode?: string;
  sheet?: string;
  row?: number;
  sourceKey?: string;
}): string {
  if (parts.jobCode) return `job:${parts.jobCode}`;
  if (parts.sourceKey && parts.sheet && parts.row !== undefined) {
    return `src:${parts.sourceKey}:${parts.sheet}:row:${parts.row}`;
  }
  if (parts.sheet && parts.row !== undefined) {
    return `${parts.sheet}:row:${parts.row}`;
  }
  return `job:unknown`;
}

/**
 * 构造冲突候选字段（WB1）：保留主值与全部替代值，禁止静默覆盖。
 * 调用方必须传入至少两个互不相同的值及其各自证据。
 */
export function makeConflictField(input: {
  field: string;
  value: string;
  scope?: FieldScope;
  jobScope?: JobScopeInfo;
  ruleVersion?: string;
  origin?: FieldOrigin;
  alternatives: FieldAlternative[];
}): CandidateField {
  return {
    field: input.field,
    value: input.value,
    status: 'conflict',
    scope: input.scope ?? 'announcement',
    jobScope: input.jobScope,
    ruleVersion: input.ruleVersion,
    origin: input.origin,
    alternatives: input.alternatives,
  };
}

/**
 * 构造 unknown 候选字段（WB1）：原文未写明，显式 status=unknown，
 * 不产生 value（未知 ≠ 不符合，也不等于空的 extracted）。
 */
export function makeUnknownField(input: {
  field: string;
  scope?: FieldScope;
  jobScope?: JobScopeInfo;
  ruleVersion?: string;
  origin?: FieldOrigin;
  anchor?: EvidenceAnchorInput;
}): CandidateField {
  return {
    field: input.field,
    value: '',
    status: 'unknown',
    scope: input.scope ?? 'announcement',
    jobScope: input.jobScope,
    ruleVersion: input.ruleVersion,
    origin: input.origin,
    anchor: input.anchor,
  };
}

/**
 * 构造人工决策留痕（WB1）：adopt/edit/reject/pending。
 * edit 必须提供 beforeValue 与 afterValue；reject/pending 保留 beforeValue。
 */
export function makeHumanDecision(input: {
  action: HumanDecision['action'];
  beforeValue?: string;
  afterValue?: string;
  reason: string;
  operatorId: string;
  decidedAt: string;
}): HumanDecision {
  return {
    action: input.action,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    reason: input.reason,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
  };
}
