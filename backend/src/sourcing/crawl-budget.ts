/**
 * 受控单来源试跑预算（v7.2）。
 *
 * 目标：手动试跑必须“先算账再抓取”，任何入口（发现/入队/执行/重试/重放）
 * 都不能绕过上限。常规调度不建预算行，行为与之前完全一致。
 *
 * 计数口径（必须区分清楚，避免把逻辑任务数当成请求数）：
 * - maxListPages：实际发起的栏目页获取次数（含 304；失败也占用，避免原地重试）；
 * - maxDetails / maxAttachments*：准入的**逻辑任务数**，按 canonicalUrl 去重，
 *   重投、重放、并发重复投递都不重复占用；
 * - maxHttpRequests：实际发出的 **HTTP 请求次数**，含 SafeFetcher 内部重试与
 *   重定向跳转；由每次请求前的预算闸门原子扣减。
 */
export interface TrialBudgetLimits {
  maxListPages: number;
  maxDetails: number;
  maxAttachmentsPerDocument: number;
  maxAttachmentsTotal: number;
  maxHttpRequests: number;
}

/** 首轮建议值：1 页列表、3 篇详情、每篇 2 个附件、整轮 6 个附件、20 次请求 */
export const TRIAL_BUDGET_DEFAULTS: TrialBudgetLimits = {
  maxListPages: 1,
  maxDetails: 3,
  maxAttachmentsPerDocument: 2,
  maxAttachmentsTotal: 6,
  maxHttpRequests: 20,
};

/** 服务端硬上限：即使管理员传入更大值也不放行，避免“预算”名存实亡 */
export const TRIAL_BUDGET_HARD_CAPS: TrialBudgetLimits = {
  maxListPages: 20,
  maxDetails: 50,
  maxAttachmentsPerDocument: 10,
  maxAttachmentsTotal: 100,
  maxHttpRequests: 300,
};

export type TrialBudgetStatus = 'active' | 'stopped' | 'exhausted';

export interface TrialBudgetRemaining {
  listPages: number;
  details: number;
  attachments: number;
  httpRequests: number;
}

export interface TrialBudgetSnapshot extends TrialBudgetLimits {
  runId: string;
  sourceId: string;
  status: TrialBudgetStatus;
  listPagesUsed: number;
  detailsUsed: number;
  attachmentsUsed: number;
  httpRequestsUsed: number;
  listPagesDeferred: number;
  detailsDeferred: number;
  attachmentsDeferred: number;
  remaining: TrialBudgetRemaining;
  stopReason: string | null;
  stoppedAt: string | null;
}

/** 'unbudgeted' 表示该运行没有预算（常规调度），调用方按原行为继续 */
export type BudgetGate = 'ok' | 'exhausted' | 'stopped' | 'unbudgeted';

/** 'duplicate' 表示该 URL 已准入过，可继续投递（队列幂等键会吸收重复任务） */
export type AdmissionResult =
  | 'admitted'
  | 'duplicate'
  | 'exhausted'
  | 'stopped'
  | 'unbudgeted';

export type DeferrableKind = 'listPages' | 'details' | 'attachments';

export class TrialBudgetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrialBudgetValidationError';
  }
}

function positiveInt(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TrialBudgetValidationError(`${name} 必须是 ≥1 的整数，收到：${value}`);
  }
  return parsed;
}

/**
 * 合并默认值并做服务端校验。输入未提供的字段用首轮建议值；
 * 任何越界、非整数、自相矛盾（每篇 > 整轮）都直接拒绝。
 */
export function resolveTrialBudget(
  input: Partial<TrialBudgetLimits> = {},
): TrialBudgetLimits {
  const merged = {
    maxListPages: input.maxListPages ?? TRIAL_BUDGET_DEFAULTS.maxListPages,
    maxDetails: input.maxDetails ?? TRIAL_BUDGET_DEFAULTS.maxDetails,
    maxAttachmentsPerDocument:
      input.maxAttachmentsPerDocument ??
      TRIAL_BUDGET_DEFAULTS.maxAttachmentsPerDocument,
    maxAttachmentsTotal:
      input.maxAttachmentsTotal ?? TRIAL_BUDGET_DEFAULTS.maxAttachmentsTotal,
    maxHttpRequests:
      input.maxHttpRequests ?? TRIAL_BUDGET_DEFAULTS.maxHttpRequests,
  };
  const limits: TrialBudgetLimits = {
    maxListPages: positiveInt(merged.maxListPages, 'maxListPages'),
    maxDetails: positiveInt(merged.maxDetails, 'maxDetails'),
    maxAttachmentsPerDocument: positiveInt(
      merged.maxAttachmentsPerDocument,
      'maxAttachmentsPerDocument',
    ),
    maxAttachmentsTotal: positiveInt(
      merged.maxAttachmentsTotal,
      'maxAttachmentsTotal',
    ),
    maxHttpRequests: positiveInt(merged.maxHttpRequests, 'maxHttpRequests'),
  };
  for (const key of Object.keys(limits) as (keyof TrialBudgetLimits)[]) {
    if (limits[key] > TRIAL_BUDGET_HARD_CAPS[key]) {
      throw new TrialBudgetValidationError(
        `${key} 超过服务端硬上限 ${TRIAL_BUDGET_HARD_CAPS[key]}（收到 ${limits[key]}）`,
      );
    }
  }
  if (limits.maxAttachmentsPerDocument > limits.maxAttachmentsTotal) {
    throw new TrialBudgetValidationError(
      'maxAttachmentsPerDocument 不能大于 maxAttachmentsTotal',
    );
  }
  const minimumRequests =
    limits.maxListPages + limits.maxDetails + limits.maxAttachmentsTotal;
  if (limits.maxHttpRequests < minimumRequests) {
    throw new TrialBudgetValidationError(
      `maxHttpRequests 至少要覆盖一次完整执行：${minimumRequests}（收到 ${limits.maxHttpRequests}）`,
    );
  }
  return limits;
}

export function remainingOf(snapshot: {
  maxListPages: number;
  maxDetails: number;
  maxAttachmentsTotal: number;
  maxHttpRequests: number;
  listPagesUsed: number;
  detailsUsed: number;
  attachmentsUsed: number;
  httpRequestsUsed: number;
}): TrialBudgetRemaining {
  return {
    listPages: Math.max(0, snapshot.maxListPages - snapshot.listPagesUsed),
    details: Math.max(0, snapshot.maxDetails - snapshot.detailsUsed),
    attachments: Math.max(
      0,
      snapshot.maxAttachmentsTotal - snapshot.attachmentsUsed,
    ),
    httpRequests: Math.max(
      0,
      snapshot.maxHttpRequests - snapshot.httpRequestsUsed,
    ),
  };
}

/** 预算端口：Prisma 实现用于生产，内存实现用于隔离测试 */
export interface CrawlBudgetPort {
  create(
    runId: string,
    sourceId: string,
    limits: TrialBudgetLimits,
  ): Promise<TrialBudgetSnapshot>;
  get(runId: string): Promise<TrialBudgetSnapshot | null>;
  /** 发起栏目页请求前扣减；'unbudgeted' 表示该运行无预算 */
  consumeListPage(runId: string): Promise<BudgetGate>;
  /** 详情准入：按 canonicalUrl 幂等，重投不重复占用 */
  admitDocument(runId: string, canonicalUrl: string): Promise<AdmissionResult>;
  /** 附件准入：同时受每篇与整轮额度约束，按 canonicalUrl 幂等 */
  admitAttachment(
    runId: string,
    parentDocumentId: string,
    canonicalUrl: string,
  ): Promise<AdmissionResult>;
  /** 执行前复核准入（防止绕过入队校验的直接投递/旧任务重放） */
  isAdmitted(
    runId: string,
    kind: 'document' | 'attachment',
    canonicalUrl: string,
  ): Promise<boolean | 'unbudgeted'>;
  /** 每次实际 HTTP 请求前扣减（含重试/重定向） */
  consumeHttpAttempt(runId: string): Promise<BudgetGate>;
  /** 记录的未扫描量：用于结果中明确标记“预算内未覆盖” */
  markDeferred(
    runId: string,
    kind: DeferrableKind,
    count: number,
  ): Promise<void>;
  stop(runId: string, reason: string): Promise<TrialBudgetSnapshot | null>;
  isStopped(runId: string): Promise<boolean>;
}
