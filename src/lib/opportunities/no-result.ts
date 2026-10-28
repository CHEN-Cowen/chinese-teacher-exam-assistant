/**
 * 无结果反馈状态机（v7.1 M6 + D04 多原因归因，纯函数）。
 *
 * D04 / PRD 11.5：无结果必须按真实数据区分多种原因，且允许多个原因并存：
 * 当前无在招已发布岗位 / 偏好限制 / 明确资格不符 / 资料不足 / 覆盖有限 /
 * 更新异常 / 材料待审核 / 尚未报名（时间待定）/ 已截止。
 * 「请求失败」不属于业务无结果：页面以 ErrorState 区分，网络失败不显示业务零结果。
 *
 * 面板同时展示：当前筛选（画像条件摘要）、统计范围、分阶段数量（按报考单元去重）、
 * 最近成功检查时间与统计生成时间、非实时回退说明、主要下一步。
 *
 * 旧三态接口 buildNoResultState 保留（埋点 reasonCode 与既有测试沿用）：
 * 1. region_uncovered    当前地区暂未覆盖（≠ 当地没有招聘）；
 * 2. no_open_recruitment 已覆盖范围当前没有开放招聘；
 * 3. qualification_gap   存在岗位但资格暂不满足（含待补信息/需人工确认/已截止）。
 */
import type { OpportunityListViewModel } from "./list-view";
import { buildConditionItems } from "@/lib/results/condition-summary";
import type { UserRecruitmentProfile } from "@/lib/profile/types";

export type NoResultKind =
  | "region_uncovered"
  | "no_open_recruitment"
  | "qualification_gap";

export interface NoResultState {
  kind: NoResultKind;
  title: string;
  reason: string;
  nextStep: string;
}

// ==================== D04 多原因模型 ====================

export type NoResultReasonKind =
  /** 部分意向地区暂未收录官方公告（覆盖有限 ≠ 当地没有招聘） */
  | "coverage_limited"
  /** 资格可判断但不在「只考虑」地区/偏好范围内 */
  | "preference_limited"
  /** 存在非地区资格维度的明确不符合 */
  | "qualification_fail"
  /** 画像缺关键资料或旧资料阶段归属未确认 */
  | "info_insufficient"
  /** 报名已截止（历史留档） */
  | "closed_expired"
  /** 报名时间待官方通知 / 尚未开始 */
  | "not_yet_open"
  /** 真实公告 AI 初核待人工复核（只计数，不展示内容） */
  | "material_pending_review"
  /** 来源检查失败/暂停/不可用、公告撤回或覆盖为非实时回退 */
  | "update_anomaly"
  /** 监测范围内当前没有在报岗位（核对时点结果） */
  | "no_open_published";

export interface NoResultReason {
  kind: NoResultReasonKind;
  title: string;
  detail: string;
  nextStep?: string;
}

/** 主原因优先级：决定面板标题与旧三态映射；越靠前越需要用户先知道 */
const PRIMARY_ORDER: readonly NoResultReasonKind[] = [
  "coverage_limited",
  "preference_limited",
  "qualification_fail",
  "closed_expired",
  "not_yet_open",
  "material_pending_review",
  "update_anomaly",
  "info_insufficient",
  "no_open_published",
];

export interface NoResultStageCount {
  label: string;
  count: number;
}

export interface NoResultPanelModel {
  /** 旧三态（埋点 reasonCode 与页面 testid 沿用） */
  legacyKind: NoResultKind;
  /** 主原因（面板标题/主下一步） */
  primary: NoResultReason;
  /** 全部并存原因（含主原因，按 PRIMARY_ORDER 排序） */
  reasons: NoResultReason[];
  /** 当前筛选：画像条件摘要（地区级别/学历/专业/学段学科/用工偏好） */
  filterText: string | null;
  /** 统计范围一句话（监测城市/来源/在报数与去重口径） */
  scopeText: string;
  /** 分阶段数量（按报考单元去重） */
  stageCounts: NoResultStageCount[];
  /** 最近成功检查时间（ISO） */
  lastCheckedAt: string;
  /** 统计生成时间（ISO；caliber 缺失时为 null） */
  generatedAt: string | null;
  /** 非实时回退说明（caliber.isFallback 时透传） */
  fallbackNote: string | null;
}

function bucketCount(view: OpportunityListViewModel, key: string): number {
  return (
    view.closedBuckets.find((bucket) => bucket.key === key)?.units.length ?? 0
  );
}

/** 资料不足：关键事实缺失或旧资料阶段归属未确认（有未确认经历时判断只能受限） */
function infoInsufficientReason(
  profile: UserRecruitmentProfile | undefined,
): NoResultReason | null {
  if (!profile) return null;
  const lacksMajor =
    !profile.majorFullName?.trim() &&
    !(profile.educationExperiences ?? []).some((e) => e.majorFullName?.trim());
  const legacyUnconfirmed =
    profile.legacyEducation?.confirmed === false ||
    (profile.educationExperiences ?? []).some(
      (e) => e.stageNeedsConfirmation === true,
    );
  const lacksCert = !profile.teacherCert;
  if (!lacksMajor && !legacyUnconfirmed && !lacksCert) return null;
  const parts: string[] = [];
  if (legacyUnconfirmed) parts.push("旧资料的教育阶段归属尚未确认");
  if (lacksMajor) parts.push("尚未填写专业信息");
  if (lacksCert) parts.push("尚未填写教师资格情况");
  return {
    kind: "info_insufficient",
    title: "你的报考资料还缺关键信息",
    detail: `${parts.join("；")}。缺资料的条件只能判「信息不足」，不会当作不符合，也不会当作符合。`,
    nextStep: "前往「我的资料」补全或确认后，机会列表会立即重新核对。",
  };
}

/**
 * D04：多原因无结果归因。仅在没有任何可行动机会（validCount === 0）时调用有意义；
 * 返回按 PRIMARY_ORDER 排序的原因数组（至少 1 条，目录全空时由 no_open_published 兜底）。
 */
export function buildNoResultReasons(
  view: OpportunityListViewModel,
  profile?: UserRecruitmentProfile,
): NoResultReason[] {
  const reasons: NoResultReason[] = [];

  if (view.uncoveredRegions.length > 0) {
    reasons.push({
      kind: "coverage_limited",
      title: "部分意向地区暂未收录官方公告",
      detail: `${view.uncoveredRegions.map((r) => r.label).join("、")} 暂未进入监测范围。暂未收录不等于当地没有招聘：可能公告尚未发布，或该地区还没接入我们的来源。`,
      nextStep: "报名前以当地教育局、人社局官网为准；可先订阅，该地区核对到公告后会在站内提醒。",
    });
  }

  if (view.regionOutOfScope.length > 0) {
    reasons.push({
      kind: "preference_limited",
      title: `有 ${view.regionOutOfScope.length} 个岗位在你的偏好范围外`,
      detail:
        "这些岗位资格上没有明确不符合，但不在你「只考虑」的地区范围内；偏好不是公告条件，调整偏好即可重新纳入。",
      nextStep: "用下方「调整地区偏好」先看影响预览，再决定是否保存。",
    });
  }

  if (view.notEligible.length > 0) {
    reasons.push({
      kind: "qualification_fail",
      title: `${view.notEligible.length} 个岗位资格条件明确不符合`,
      detail:
        "逐项核对了公告的学历、专业、证书等条件后存在明确不满足项；具体不符合项见页面底部留档与详情页逐条件说明。",
      nextStep: "核对不符合项：有些条件可在报名前补齐或向招聘单位确认。",
    });
  }

  const expired = bucketCount(view, "expired");
  if (expired > 0) {
    reasons.push({
      kind: "closed_expired",
      title: `${expired} 个岗位报名已截止`,
      detail: "已截止岗位不进入推荐，公告留档与官方依据仍可在页面底部追溯。",
    });
  }

  const pending = bucketCount(view, "pending");
  if (pending > 0) {
    reasons.push({
      kind: "not_yet_open",
      title: `${pending} 个批次报名时间尚未公布或尚未开始`,
      detail: "公告已发布但报名时间待官方通知；这不是已截止，也不是可报名。",
      nextStep: "订阅后，报名时间核对明确时会在站内提醒。",
    });
  }

  if (view.pendingReviewCount > 0) {
    reasons.push({
      kind: "material_pending_review",
      title: `${view.pendingReviewCount} 条真实公告正在人工核对`,
      detail:
        "这些公告已完成 AI 初核、等待人工复核；核对发布前不会进入推荐，也不当作正式依据。",
    });
  }

  const anomalyUnits = bucketCount(view, "source") + bucketCount(view, "withdrawn");
  const failedSources = view.coverage.sources.filter(
    (s) => s.state === "check_failed" || s.state === "blocked",
  ).length;
  const isFallback = view.coverage.caliber?.isFallback === true;
  if (anomalyUnits > 0 || failedSources > 0 || isFallback) {
    const parts: string[] = [];
    if (anomalyUnits > 0) parts.push(`${anomalyUnits} 条公告来源失效或已撤回`);
    if (failedSources > 0) parts.push(`${failedSources} 个官方来源最近一次检查失败或不可用`);
    if (isFallback) parts.push("当前覆盖统计为非实时快照");
    reasons.push({
      kind: "update_anomaly",
      title: "部分来源最近更新异常",
      detail: `${parts.join("；")}。异常来源的公告不会沿用旧结论充当实时结果，恢复后会重新核对。`,
    });
  }

  const info = infoInsufficientReason(profile);
  if (info) reasons.push(info);

  if (view.coverage.openOpportunityCount === 0) {
    reasons.push({
      kind: "no_open_published",
      title: "监测范围内当前没有在报岗位",
      detail:
        "这是最近核对时点的结果：检查正常但没有新增公告属于正常状态，不算故障；不代表之后不会有。",
      nextStep: "订阅新机会提醒：人工核对发布的新公告会在站内通知中心提醒。",
    });
  }

  return reasons.sort(
    (a, b) => PRIMARY_ORDER.indexOf(a.kind) - PRIMARY_ORDER.indexOf(b.kind),
  );
}

const LEGACY_KIND: Record<NoResultReasonKind, NoResultKind> = {
  coverage_limited: "region_uncovered",
  no_open_published: "no_open_recruitment",
  preference_limited: "qualification_gap",
  qualification_fail: "qualification_gap",
  info_insufficient: "qualification_gap",
  closed_expired: "qualification_gap",
  not_yet_open: "qualification_gap",
  material_pending_review: "qualification_gap",
  update_anomaly: "qualification_gap",
};

/**
 * D04 无结果面板模型：多原因 + 当前筛选 + 统计范围 + 分阶段数量 + 检查时间。
 * 有可行动机会（validCount > 0）时返回 null —— 卡片直接展示，不属于无结果。
 */
export function buildNoResultPanel(
  view: OpportunityListViewModel,
  profile?: UserRecruitmentProfile,
): NoResultPanelModel | null {
  if (view.validCount > 0) return null;
  const reasons = buildNoResultReasons(view, profile);
  if (reasons.length === 0) return null;
  const primary = reasons[0]!;

  const monitoredCityCount = new Set(
    view.coverage.provinces.flatMap((p) => p.monitoredRegionCodes),
  ).size;
  const stageCounts: NoResultStageCount[] = [
    { label: "初步符合", count: view.workbench.priority.count },
    { label: "待补充信息", count: view.workbench.supplement.count },
    { label: "偏好范围外", count: view.workbench.outOfScope.count },
    { label: "明确不符合", count: view.notEligible.length },
    { label: "已截止/留档", count: view.closed.length },
  ];
  const filterItems = profile ? buildConditionItems(profile) : [];

  return {
    legacyKind: LEGACY_KIND[primary.kind],
    primary,
    reasons,
    filterText: filterItems.length > 0 ? filterItems.join(" · ") : null,
    scopeText:
      `本次核对范围：${monitoredCityCount} 个监测城市、` +
      `${view.coverage.sources.length} 个官方来源、` +
      `${view.coverage.openOpportunityCount} 个在报岗位` +
      "（按报考单元去重，已截止与待人工复核不计入）",
    stageCounts,
    lastCheckedAt: view.coverage.lastCheckedAt,
    generatedAt: view.coverage.caliber?.generatedAt ?? null,
    fallbackNote: view.coverage.caliber?.isFallback
      ? (view.coverage.caliber.fallbackNote ?? "当前为非实时统计快照")
      : null,
  };
}

// ==================== 旧三态接口（埋点与既有测试沿用） ====================

export function buildNoResultState(
  view: OpportunityListViewModel,
): NoResultState | null {
  if (view.validCount > 0) return null;

  const visibleUnits =
    view.notEligible.length +
    view.closed.length +
    view.regionOutOfScope.length +
    view.manualReview.length +
    view.needInfoGroups.reduce((sum, g) => sum + g.units.length, 0);

  if (visibleUnits > 0) {
    return {
      kind: "qualification_gap",
      title: "有岗位，但你的条件暂时对不上",
      reason: "监测范围内存在招聘公告，但逐项核对后没有初步符合的机会；具体原因见下方各卡片与详情页逐条件说明。",
      nextStep: "核对不符合项：有些条件（如户籍、职称）可在报名前补齐或向招聘单位确认；确认无误后可订阅新公告，出现符合条件的新岗位时在站内提醒你。",
    };
  }

  if (view.uncoveredRegions.length > 0) {
    return {
      kind: "region_uncovered",
      title: "你选择的地区暂未收录官方公告",
      reason: "暂未收录不等于当地没有招聘：可能公告尚未发布，或该地区还没进入我们的监测范围。我们不猜测当地情况。",
      nextStep: "报名前以当地教育局、人社局官网为准；也可以先订阅，该地区进入监测范围并核对到公告后会在站内提醒你。",
    };
  }

  return {
    kind: "no_open_recruitment",
    title: "监测范围内当前没有开放报名的招聘",
    reason: "我们持续核对覆盖地区的官方来源，当前核对时点没有在报的招聘岗位；这是核对结果，不代表之后不会有。",
    nextStep: "订阅新机会提醒：已人工核对的匹配公告发布后，会在站内通知中心提醒你一次；也可以先准备报名材料。",
  };
}
