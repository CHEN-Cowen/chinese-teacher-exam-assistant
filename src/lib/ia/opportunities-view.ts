/**
 * 机会页视图模型（模块 3 骨架）。
 *
 * 输入：v6.1 seed 公告 + 用户画像；输出：机会首页三层信息直接消费的结构。
 * 资格规则全部复用 lib/matching/domain.ts，本文件不重复实现任何判断逻辑；
 * 不做后端调用、不做 React 状态，纯函数确定性输出（测试依赖此性质）。
 */
import type {
  AnnouncementVersion,
  EmploymentNatureCode,
  RecruitmentAnnouncement,
  RegionRef,
  SchoolPlacement,
} from "@/lib/announcements/types";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import type {
  GateResult,
  MatchDimensionResult,
  OpportunityMatchStatus,
} from "@/lib/matching/types";
import {
  buildCandidates,
  groupByMissingDimension,
  isValidOpportunity,
  sortCandidates,
  type OpportunityCandidate,
} from "@/lib/matching/domain";
import { isRegistrationOpen } from "@/lib/announcements/domain";
import {
  bucketClosedUnits,
  gateStateMeta,
  primaryFailedGate,
  type ClosedBucketKey,
} from "@/lib/gate-states";
import {
  dateWithWeekday,
  daysUntil,
  deadlineText,
  dimensionLabel,
  natureShortLabel,
  regionFullLabel,
  regionLabel,
  stageLabel,
  subjectLabel,
} from "./labels";

/** 单条条件的行内展示（机会卡展开后的第二层） */
export interface DimensionView {
  label: string;
  value: MatchDimensionResult["value"];
  /** 公告对该条件的原文表述（官方事实）；地区维度为 null */
  officialRequirement: string | null;
  /** 系统按画像给出的预筛判断（推断，不是官方结论） */
  reason: string;
}

export interface ClosedBucketView {
  key: ClosedBucketKey;
  label: string;
  rows: OpportunityRow[];
}

export interface OpportunityRow {
  unitId: string;
  announcementId: string;
  /** 地区/报考单元 */
  regionText: string;
  /** 完整省市区（v7.1 M4 卡片第一层；未公布的层级省略，不猜测补齐） */
  regionFullText: string;
  unitName: string;
  /** 学科（v7.1 M4 卡片第一层：学段和学科） */
  subjectText: string;
  /** 用工性质/学段 */
  natureText: string;
  /** 用工形式稳定编码（v7.1 M3 偏好筛选用；文案变化不影响此编码） */
  natureCode: EmploymentNatureCode;
  stageText: string;
  /** 招聘人数 */
  headcount: number;
  /** 匹配状态（四档文字，卡片不靠颜色表达） */
  status: OpportunityMatchStatus;
  /** 报名截止一句话 */
  deadline: string;
  /** 报名截止 ISO 日期（排序与剩余天数计算用，不直接展示） */
  registrationEnd: string;
  registrationClosed: boolean;
  /** 分配方式编码（任教学校表达用；招聘单位/岗位组名不得当作最终学校） */
  allocationCode: string;
  /** 官方逐校列明的定岗状态（未登记视为未知，不虚构学校） */
  schoolPlacement?: SchoolPlacement;
  /** 行政区引用（v7.1 M5 地图入口构造用；公告未公布的层级为空，不猜测补齐） */
  region: RegionRef;
  /** 一句话依据 */
  oneLineReason: string;
  /** 主异常闸门 code（无失败闸门为 null） */
  gateCode: string | null;
  /** 闸门失败原因（已截止/来源失效等；为空表示闸门全过） */
  gateReason: string | null;
  /** 逐项条件（第二层展开用） */
  dimensions: DimensionView[];
  /** 官方公告链接（第三层） */
  officialUrl: string;
  publisher: string;
  checkedAtText: string;
  registerUrl?: string;
}

export interface NeedInfoGroup {
  dimension: string;
  dimensionText: string;
  count: number;
  rows: OpportunityRow[];
}

export type RiskTone = "must" | "info";

export interface OpportunityRisk {
  tone: RiskTone;
  text: string;
}

export interface OpportunitiesView {
  /** 第一层：一句结论 */
  conclusion: string;
  /** 覆盖范围与更新时间（未覆盖 ≠ 没有招聘） */
  coverage: string;
  /** 第一层：一个风险（没有风险时为 null，不制造虚假紧迫感） */
  risk: OpportunityRisk | null;
  /** 第一层：唯一优先机会；无有效机会时为 null（页面转空态） */
  priority: OpportunityRow | null;
  /** 有效机会总数（闸门全过且非明确不符合） */
  validCount: number;
  preliminary: OpportunityRow[];
  needInfoGroups: NeedInfoGroup[];
  manualReview: OpportunityRow[];
  /** 闸门通过但总体明确不符合 */
  notEligible: OpportunityRow[];
  /** 仅因岗位地区不在画像可接受范围而未推荐（不是资格不符合） */
  regionOutOfScope: OpportunityRow[];
  /** 闸门失败（已截止/来源失效等），不进主要推荐但保留原因可查 */
  closed: OpportunityRow[];
  /** closed 按异常态（来源失效/过期/待复核…）的稳定分桶 */
  closedBuckets: ClosedBucketView[];
  /** 画像中当前没有任何公告覆盖的地区（暂未收录 ≠ 没有招聘） */
  uncoveredRegions: { code: string; label: string }[];
}

function toRow(candidate: OpportunityCandidate, nowIso: string): OpportunityRow {
  const { announcement, version, unit, match } = candidate;
  const primaryGate = primaryFailedGate(match.gates);
  const deadline = deadlineText(version.timeline.registrationEnd, nowIso);
  const requirementText = (requirementId: string): string | null => {
    if (requirementId === "region") return null;
    return unit.requirements.find((r) => r.id === requirementId)?.description ?? null;
  };
  return {
    unitId: unit.id,
    announcementId: announcement.id,
    regionText: regionLabel(unit.region),
    regionFullText: regionFullLabel(unit.region),
    unitName: unit.name,
    subjectText: subjectLabel(unit.subject),
    natureText: natureShortLabel(unit.employmentNature.code),
    natureCode: unit.employmentNature.code,
    stageText: stageLabel(unit.stage),
    headcount: unit.headcount,
    status: match.overall,
    deadline: deadline.text,
    registrationEnd: version.timeline.registrationEnd,
    registrationClosed: deadline.closed,
    allocationCode: unit.allocation.code,
    schoolPlacement: unit.schoolPlacement,
    region: unit.region,
    oneLineReason: match.summary,
    gateCode: primaryGate ? primaryGate.code : null,
    gateReason: primaryGate ? primaryGate.reason : null,
    dimensions: match.dimensions.map((d) => ({
      label: dimensionLabel(d.dimension),
      value: d.value,
      officialRequirement: requirementText(d.requirementId),
      reason: d.reason,
    })),
    officialUrl: announcement.officialUrl,
    publisher: announcement.publisher,
    checkedAtText: dateWithWeekday(version.officialSource.checkedAt.slice(0, 10)),
    registerUrl: unit.registerUrl,
  };
}

function gateFailText(gates: GateResult[]): string | null {
  const failed = gates.find((g) => !g.passed);
  return failed ? failed.reason : null;
}

/** 7 天内截止才提示紧急风险；更远的截止不制造焦虑 */
const URGENT_WINDOW_DAYS = 7;

function buildRisk(rows: OpportunityRow[], nowIso: string): OpportunityRisk | null {
  const urgent = rows
    .filter((r) => !r.registrationClosed)
    .sort(
      (a, b) =>
        daysUntil(a.registrationEnd, nowIso) - daysUntil(b.registrationEnd, nowIso),
    )[0];
  if (!urgent) return null;
  const daysLeft = daysUntil(urgent.registrationEnd, nowIso);
  if (daysLeft <= URGENT_WINDOW_DAYS && daysLeft >= 0) {
    return { tone: "must", text: `${urgent.regionText}的机会${urgent.deadline}，先确认能否按时提交材料` };
  }
  return {
    tone: "info",
    text: "以下为初步匹配结果，不等于保证可以报名；最终资格以招聘单位审核为准",
  };
}

export function buildOpportunitiesView(
  announcements: RecruitmentAnnouncement[],
  profile: UserRecruitmentProfile,
  nowIso: string,
): OpportunitiesView {
  const candidates = buildCandidates(announcements, profile, nowIso);
  const sorted = sortCandidates(candidates, profile);

  const valid = sorted.filter((c) => isValidOpportunity(c.match));
  const invalid = sorted.filter((c) => !isValidOpportunity(c.match));

  const preliminary = valid.filter((c) => c.match.overall === "preliminary_eligible");
  // 闸门通过但被 isValidOpportunity 剔除的候选：目前只有「未填地区 → region UNKNOWN」。
  // 缺事实 ≠ 不符合：overall 不是 not_eligible 的，必须归入「补充信息后判断」，
  // 只有 overall 明确为 not_eligible 的才进入「明确不符合」组。
  const gatePassedButInvalid = invalid.filter((c) => c.match.gates.every((g) => g.passed));
  const infoDeficit = gatePassedButInvalid.filter(
    (c) => c.match.overall !== "not_eligible",
  );
  const notEligibleAll = gatePassedButInvalid
    .filter((c) => c.match.overall === "not_eligible")
    .map((c) => toRow(c, nowIso));
  // 地区偏好不重叠与资格不符合分离（仅视图叙事，判定仍在 matching/domain.ts）
  const isRegionOnlyMismatch = (c: OpportunityCandidate): boolean => {
    const fails = c.match.dimensions.filter((d) => d.value === "FAIL");
    return fails.length > 0 && fails.every((d) => d.dimension === "region");
  };
  const regionMismatchCandidates = gatePassedButInvalid.filter(
    (c) => c.match.overall === "not_eligible" && isRegionOnlyMismatch(c),
  );
  const regionOutOfScope = regionMismatchCandidates.map((c) => toRow(c, nowIso));
  const notEligible = notEligibleAll.filter(
    (row) => !regionOutOfScope.some((r) => r.unitId === row.unitId),
  );
  const needInfoGroups = groupByMissingDimension([...valid, ...infoDeficit]).map((group) => ({
    dimension: group.dimension,
    dimensionText: dimensionLabel(group.dimension),
    count: group.count,
    rows: group.candidates.map((c) => toRow(c, nowIso)),
  }));
  const manualReview = valid
    .filter((c) => c.match.overall === "manual_review")
    .map((c) => toRow(c, nowIso));
  const closed = invalid
    .filter((c) => !c.match.gates.every((g) => g.passed))
    .map((c) => toRow(c, nowIso));
  const closedBuckets = bucketClosedUnits(
    invalid.filter((c) => !c.match.gates.every((g) => g.passed)),
    (c) => c.match.gates,
  ).map((bucket) => ({ ...bucket, rows: bucket.units.map((c) => toRow(c, nowIso)) }));

  // 暂未收录：画像地区在全部演示公告中均无同前缀岗位（真实监测覆盖由
  // preview 页另用 GUEST_COVERAGE 声明，访客视图模型只基于本批公告判定）。
  // 省级画像（330000）可被省内任意城市岗位覆盖；市级画像只认同城前缀。
  const regionPrefixesOf = (code: string): string[] =>
    code.slice(2, 4) === "00"
      ? [code.slice(0, 2)]
      : [code.slice(0, 4), code.slice(0, 2)];
  const coveredPrefixes = new Set<string>();
  for (const a of announcements)
    for (const prefix of regionPrefixesOf(a.region.code))
      coveredPrefixes.add(prefix);
  const uncoveredRegions: { code: string; label: string }[] = [];
  const seenRegionCodes = new Set<string>();
  for (const pref of profile.regions) {
    if (seenRegionCodes.has(pref.code)) continue;
    seenRegionCodes.add(pref.code);
    if (regionPrefixesOf(pref.code).some((prefix) => coveredPrefixes.has(prefix)))
      continue;
    uncoveredRegions.push({
      code: pref.code,
      label: pref.city ? `${pref.province}${pref.city}` : pref.province,
    });
  }

  const preliminaryRows = preliminary.map((c) => toRow(c, nowIso));
  const priority = preliminaryRows[0]
    ?? valid[0]
      ? toRow(valid[0], nowIso)
      : null;

  const provinces = [...new Set(announcements.map((a) => a.region.province))].join("、");
  const coverage = `已覆盖 ${provinces} 的官方公告 · 更新于 ${dateWithWeekday(nowIso.slice(0, 10))} · 未覆盖地区不等于没有招聘`;

  let conclusion: string;
  if (preliminaryRows.length > 0) {
    conclusion = `为你找到 ${preliminaryRows.length} 个初步符合的语文教师机会`;
  } else if (valid.length > 0) {
    conclusion = `有 ${valid.length} 个机会需要补充信息后才能判断`;
  } else {
    conclusion = "当前已覆盖的官方公告中，还没有你能直接考虑的机会";
  }

  const riskSource = priority ? [priority] : [];
  const risk = buildRisk(riskSource, nowIso);

  return {
    conclusion,
    coverage,
    risk,
    priority,
    validCount: valid.length,
    preliminary: preliminaryRows,
    needInfoGroups,
    manualReview,
    notEligible,
    regionOutOfScope,
    closed,
    closedBuckets,
    uncoveredRegions,
  };
}

/** 卡片「一个下一步」类型（具体 href 由页面/组件映射：登录落点在 previewEngine） */
export type GuestCardNextStepKind = "login" | "onboarding" | "official" | "expand";

export interface GuestCardNextStep {
  kind: GuestCardNextStepKind;
  label: string;
}

/**
 * 每张访客卡唯一的高强调下一步（长证据仍可单独按需展开）。
 * “展开看依据”不算下一步；异常态只给官方留档出口，不出现报名/关注动作。
 */
export function guestCardNextStep(row: OpportunityRow): GuestCardNextStep {
  if (row.gateCode) {
    return { kind: "official", label: gateStateMeta(row.gateCode).cardAction };
  }
  switch (row.status) {
    case "preliminary_eligible":
      return { kind: "login", label: "保存这个机会" };
    case "need_more_info":
      return { kind: "onboarding", label: "补充信息后判断" };
    case "manual_review":
      return { kind: "expand", label: "查看确认要点" };
    case "not_eligible": {
      const fails = row.dimensions.filter((d) => d.value === "FAIL");
      const regionOnly = fails.length > 0 && fails.every((d) => d.label === "地区意向");
      return {
        kind: "expand",
        label: regionOnly ? "查看地区范围说明" : "查看不符合原因",
      };
    }
  }
}

/** 报名是否仍在进行（页面按钮可用性判断，复用公告域规则） */
export function canRegister(version: AnnouncementVersion, nowIso: string): boolean {
  return isRegistrationOpen(version, nowIso);
}

/** 闸门原因的便捷读取（第三层/分组角标用） */
export function describeGateFailure(candidate: OpportunityCandidate): string | null {
  return gateFailText(candidate.match.gates);
}
