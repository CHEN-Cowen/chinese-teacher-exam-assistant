/**
 * 资格匹配纯函数规则层（PRD 7.4）。
 *
 * 判定顺序（PRD 判断顺序）：
 * 1. 闸门：学科未开放 / 已截止 / 不在收录范围 / 公告失效 / 无官方来源 → 不进推荐；
 * 2. 地区硬边界；
 * 3. 学历、专业、身份、教师资格等硬性条件逐项四值判定；
 * 4. 无法判断 → UNKNOWN（补信息）或 MANUAL_REVIEW（人工确认）；
 * 5. 聚合总结果并排序。
 *
 * 聚合规则（本模块唯一口径，页面与 service 不得自行实现）：
 * - 任一硬性条件 FAIL        → 明确不符合；
 * - 无硬性 FAIL 且存在需人工确认 → 建议人工确认（软性条件不满足同档处理）；
 * - 无 FAIL/MANUAL 且有 UNKNOWN → 补充信息后判断；
 * - 关键条件全部 PASS        → 初步符合。
 *
 * 不变量：用户未填写的信息只能得到 UNKNOWN，永远不会被转换成 FAIL。
 */
import type {
  AnnouncementVersion,
  ApplicationUnit,
  CredentialLevel,
  EmploymentNatureCode,
  RecruitmentAnnouncement,
  Requirement,
} from "@/lib/announcements/types";
import { IN_SCOPE_EMPLOYMENT_NATURES, OPEN_SUBJECTS } from "@/lib/announcements/types";
import { currentVersion } from "@/lib/announcements/domain";
import {
  EDUCATION_STAGE_LABELS,
  majorCandidates,
  resolveEducationFacts,
} from "@/lib/profile/education";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import type {
  GateResult,
  MatchDimensionResult,
  MatchValue,
  OpportunityMatchResult,
  OpportunityMatchStatus,
  ValidOpportunity,
} from "./types";

const EDUCATION_RANK: Record<CredentialLevel, number> = {
  secondary: 0,
  college: 1,
  bachelor: 2,
  master: 3,
  doctorate: 4,
};

/** 专业名归一化：去首尾/多余空白，统一全角括号与大小写（不删除“师范”等语义） */
export function normalizeMajor(name: string): string {
  return name
    .trim()
    .replace(/[（）]/g, (ch) => (ch === "（" ? "(" : ")"))
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** 按 ISO 日期计算周岁；信息缺失返回 null（只能导向 UNKNOWN） */
export function ageAt(birthDateIso: string | undefined, referenceIso: string): number | null {
  if (!birthDateIso) return null;
  const birth = new Date(birthDateIso);
  const ref = new Date(referenceIso);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - birth.getFullYear();
  const monthBeforeBirthday =
    ref.getMonth() < birth.getMonth() ||
    (ref.getMonth() === birth.getMonth() && ref.getDate() < birth.getDate());
  if (monthBeforeBirthday) age -= 1;
  return age;
}

/** 地区编码前缀：省级前 2 位、市级前 4 位 */
function regionPrefix(code: string): string {
  return code.endsWith("0000")
    ? code.slice(0, 2)
    : code.endsWith("00")
      ? code.slice(0, 4)
      : code;
}

/**
 * 地区匹配（D03：偏好与资格分离）。
 * - `required` 才算浏览范围；岗位不在 required 内是偏好范围外，不是资格不符合；
 * - `preferred` / `consider` 只影响排序；
 * - 未填地区 → UNKNOWN；区县未明确 → UNKNOWN。
 */
export function evaluateRegion(
  unitRegionCode: string,
  profile: UserRecruitmentProfile,
): MatchDimensionResult {
  const base = {
    requirementId: "region",
    dimension: "region" as const,
    hard: false,
  };
  const userFact =
    profile.regions
      .map(
        (pref) =>
          `${pref.province}${pref.city ?? ""}（${
            pref.level === "required"
              ? "必须接受"
              : pref.level === "preferred"
                ? "优先"
                : "可考虑"
          }）`,
      )
      .join("、") || undefined;
  if (profile.regions.length === 0) {
    return {
      ...base,
      value: "UNKNOWN",
      reason: "尚未填写可接受地区，补充后才能按地域筛选",
    };
  }
  const matched = profile.regions.find((pref) =>
    unitRegionCode.startsWith(regionPrefix(pref.code)),
  );
  if (matched?.level === "required") {
    return {
      ...base,
      value: "PASS",
      reason: `岗位地区在你必须接受的${matched.province}${matched.city ?? ""}范围内`,
      ...(userFact ? { userFact } : {}),
    };
  }
  if (matched) {
    return {
      ...base,
      value: "PASS",
      reason:
        matched.level === "preferred"
          ? `岗位地区在你优先考虑的${matched.province}${matched.city ?? ""}范围内（偏好只影响排序）`
          : `岗位地区在你可考虑的${matched.province}${matched.city ?? ""}范围内（偏好只影响排序）`,
      ...(userFact ? { userFact } : {}),
    };
  }
  if (profile.regions.some((pref) => pref.code.startsWith(regionPrefix(unitRegionCode)))) {
    return {
      ...base,
      value: "UNKNOWN",
      reason: "岗位区县尚未明确，不能确认是否在意向地区内",
      ...(userFact ? { userFact } : {}),
    };
  }
  if (!profile.regions.some((pref) => pref.level === "required")) {
    return {
      ...base,
      value: "PASS",
      reason: "未设置“必须接受”的地区范围，该岗位地区只作为排序参考",
      ...(userFact ? { userFact } : {}),
    };
  }
  return {
    ...base,
    value: "FAIL",
    reason:
      "岗位不在你“必须接受”的地区范围内：属于偏好范围外，不是资格不符合；可调整地区偏好后恢复",
    ...(userFact ? { userFact } : {}),
  };
}

type DimensionExtras = Pick<
  MatchDimensionResult,
  "userFact" | "adoptedEducation"
>;

function dimensionResult(
  req: Requirement,
  value: MatchValue,
  reason: string,
  extras: DimensionExtras = {},
): MatchDimensionResult {
  return {
    requirementId: req.id,
    dimension: req.dimension,
    value,
    reason,
    hard: req.hard,
    ...extras,
  };
}

/** 单条件判定；所有“缺事实”分支必须返回 UNKNOWN 或 MANUAL_REVIEW */
export function evaluateRequirement(
  req: Requirement,
  profile: UserRecruitmentProfile,
  nowIso: string,
): MatchDimensionResult {
  const c = req.criterion;
  switch (c.kind) {
    case "education": {
      const facts = resolveEducationFacts(profile);
      const educationLevel = facts.highestStage ?? profile.educationLevel;
      const rank = educationLevel ? EDUCATION_RANK[educationLevel] : undefined;
      const userFact = educationLevel
        ? `${EDUCATION_STAGE_LABELS[educationLevel]}${facts.adoptedExperienceId ? "（分阶段经历）" : "（旧单一字段）"}`
        : undefined;
      if (rank == null) return unknown(req, "尚未填写最高学历");
      if (rank >= EDUCATION_RANK[c.minLevel]) {
        return pass(
          req,
          "你的学历满足公告要求的最低学历",
          userFact ? { userFact } : {},
        );
      }
      return fail(
        req,
        "最高学历低于公告要求的最低学历",
        userFact ? { userFact } : {},
      );
    }
    case "degree": {
      const facts = resolveEducationFacts(profile);
      const degree = facts.degree ?? profile.degree;
      const degreeLabel = degree
        ? { bachelor: "学士", master: "硕士", doctorate: "博士", none: "无学位" }[
            degree
          ]
        : undefined;
      if (!degree) return unknown(req, "尚未填写学位信息");
      if (EDUCATION_RANK[degreeToLevel(degree)] >= EDUCATION_RANK[degreeToLevel(c.requiredDegree)]) {
        return pass(
          req,
          "学位满足公告要求",
          degreeLabel ? { userFact: degreeLabel } : {},
        );
      }
      return fail(
        req,
        "学位未达到公告要求",
        degreeLabel ? { userFact: degreeLabel } : {},
      );
    }
    case "major": {
      const candidates = majorCandidates(profile);
      if (candidates.length === 0) return unknown(req, "尚未填写毕业证专业全称");
      const stageLabel = (stage?: CredentialLevel) =>
        stage ? EDUCATION_STAGE_LABELS[stage] : "未分阶段（旧资料）";
      const userFact =
        candidates
          .map((candidate) => `${stageLabel(candidate.stage)}：${candidate.majorFullName}`)
          .join("；") || undefined;
      const extras: DimensionExtras = userFact ? { userFact } : {};
      const matches = (name: string) =>
        c.majorNames.some((listed) => normalizeMajor(listed) === normalizeMajor(name));
      const adoptedOf = (list: typeof candidates) =>
        list.map((candidate) => ({
          experienceId: candidate.experienceId ?? "legacy-major",
          ...(candidate.stage ? { stage: candidate.stage } : {}),
          majorFullName: candidate.majorFullName,
        }));

      const stages = c.stages ? [...new Set(c.stages)] : [];
      if (stages.length === 0) {
        const facts = resolveEducationFacts(profile);
        const primary =
          candidates.find((candidate) =>
            facts.adoptedExperienceId
              ? candidate.experienceId === facts.adoptedExperienceId
              : candidate.experienceId === null,
          ) ?? candidates[0];
        if (matches(primary.majorFullName)) {
          const stageNote = primary.stage
            ? `（采用${stageLabel(primary.stage)}阶段专业“${primary.majorFullName}”）`
            : `（采用“${primary.majorFullName}”）`;
          return pass(
            req,
            `专业与公告列明专业一致${stageNote}`,
            { ...extras, adoptedEducation: adoptedOf([primary]) },
          );
        }
        if (primary.stageUnconfirmed) {
          return unknown(
            req,
            "从旧资料迁移的专业尚未确认所属学历阶段，请先确认后再判断",
            extras,
          );
        }
        if (c.ambiguous) {
          return manual(
            req,
            "公告专业目录表述存在解释空间，建议向招聘单位确认后再报名",
            extras,
          );
        }
        return fail(req, "专业不在公告列明的可报专业范围内", {
          ...extras,
          adoptedEducation: adoptedOf([primary]),
        });
      }

      const stageCandidates = stages.map((stage) => ({
        stage,
        list: candidates.filter((candidate) => candidate.stage === stage),
      }));
      const missing = stageCandidates.filter((entry) => entry.list.length === 0);
      if (missing.length > 0) {
        return unknown(
          req,
          `公告要求${missing.map((entry) => stageLabel(entry.stage)).join("、")}阶段专业，你尚未填写该阶段经历`,
          extras,
        );
      }
      const matchedStages = stageCandidates.map((entry) => ({
        stage: entry.stage,
        matched: entry.list.filter((candidate) => matches(candidate.majorFullName)),
      }));
      if ((c.stageMode ?? "any") === "all") {
        if (matchedStages.every((entry) => entry.matched.length > 0)) {
          return pass(
            req,
            `公告要求${stages.map((stage) => stageLabel(stage)).join("、")}阶段专业，你的各阶段专业均符合`,
            {
              ...extras,
              adoptedEducation: matchedStages.flatMap((entry) => adoptedOf(entry.matched)),
            },
          );
        }
        const missed = matchedStages.find((entry) => entry.matched.length === 0);
        if (
          stageCandidates
            .filter((entry) => entry.stage === missed?.stage)
            .some((entry) => entry.list.some((candidate) => candidate.stageUnconfirmed))
        ) {
          return unknown(
            req,
            "从旧资料迁移的专业尚未确认所属学历阶段，请先确认后再判断",
            extras,
          );
        }
        if (c.ambiguous) {
          return manual(
            req,
            "公告专业目录表述存在解释空间，建议向招聘单位确认后再报名",
            extras,
          );
        }
        return fail(
          req,
          `公告要求${stageLabel(missed?.stage)}阶段专业，你的该阶段专业不在列明范围内`,
          extras,
        );
      }
      const adopted = matchedStages.flatMap((entry) => adoptedOf(entry.matched));
      if (adopted.length > 0) {
        return pass(
          req,
          `专业与公告列明专业一致（采用${[
            ...new Set(
              matchedStages
                .filter((entry) => entry.matched.length > 0)
                .map((entry) => stageLabel(entry.stage)),
            ),
          ].join("、")}阶段专业）`,
          { ...extras, adoptedEducation: adopted },
        );
      }
      if (
        stageCandidates.some((entry) =>
          entry.list.some((candidate) => candidate.stageUnconfirmed),
        )
      ) {
        return unknown(
          req,
          "从旧资料迁移的专业尚未确认所属学历阶段，请先确认后再判断",
          extras,
        );
      }
      if (c.ambiguous) {
        return manual(
          req,
          "公告专业目录表述存在解释空间，建议向招聘单位确认后再报名",
          extras,
        );
      }
      return fail(
        req,
        `公告列明阶段（${stages.map((stage) => stageLabel(stage)).join("、")}）的专业均不在可报范围内`,
        extras,
      );
    }
    case "graduate_status": {
      if (!c.requireFresh) return pass(req, "公告未限制应届身份");
      const facts = resolveEducationFacts(profile);
      const graduationDate = facts.graduationDate ?? profile.graduationDate;
      if (!graduationDate) return unknown(req, "尚未填写毕业时间，无法按本公告口径判断应届身份");
      if (!profile.employmentStatus) {
        return unknown(req, "尚未填写当前就业状态，补充后按本公告口径判断应届身份");
      }
      if (
        profile.employmentStatus === "employed_fulltime" &&
        (profile.socialSecurityMonths ?? 0) > 0
      ) {
        return fail(req, "按公告口径，已落实全职工作并缴纳社保通常不视为应届毕业生");
      }
      if (profile.employmentStatus === "other") {
        return manual(req, "当前就业状态与应届口径的关系需要结合公告原文人工确认");
      }
      return pass(req, "按公告口径初步符合应届身份要求（最终以招聘单位认定为准）");
    }
    case "teacher_cert": {
      const cert = profile.teacherCert;
      // 用户选择「暂不提供教师资格情况」：缺事实只能 UNKNOWN，不得判不符合（模块 4）
      if (!cert || !cert.status) {
        return unknown(req, "尚未填写教师资格情况，补充信息后判断");
      }
      const certFact =
        cert.subject && cert.stage
          ? `${cert.subject} · ${cert.stage}${cert.status === "in_progress" ? "（在途）" : ""}`
          : undefined;
      if (cert.status === "none") return fail(req, "尚未取得公告要求的教师资格");
      if (cert.status === "in_progress") {
        if (!c.acceptInProgress || !cert.expectedDate) {
          return manual(
            req,
            "教师资格在途，是否接受“领证中”报考需向招聘单位确认",
            certFact ? { userFact: certFact } : {},
          );
        }
      }
      if (!cert.subject || !cert.stage) return unknown(req, "尚未填写教师资格的学科与学段");
      if (cert.subject === c.subject && cert.stage === c.stage) {
        return pass(
          req,
          "教师资格的学科与学段与岗位一致",
          certFact ? { userFact: certFact } : {},
        );
      }
      // 仅在公告原文明确允许高学段报考低学段时放宽，不自行推断
      if (
        c.acceptHigherStage &&
        cert.subject === c.subject &&
        teacherStageRank(cert.stage) >= teacherStageRank(c.stage)
      ) {
        return pass(
          req,
          "公告明确允许高学段教师资格报考低学段岗位，你的资格学段高于岗位要求",
          certFact ? { userFact: certFact } : {},
        );
      }
      return fail(
        req,
        "教师资格的学科或学段与岗位要求不一致",
        certFact ? { userFact: certFact } : {},
      );
    }
    case "age": {
      const age = ageAt(profile.birthDate, c.referenceDate ?? nowIso);
      if (age == null) return unknown(req, "尚未填写出生日期，补充后判断年龄是否符合");
      if (age <= c.maxAgeYears) return pass(req, `年龄 ${age} 周岁，未超过公告上限 ${c.maxAgeYears} 周岁`);
      return fail(req, `年龄 ${age} 周岁，超过公告上限 ${c.maxAgeYears} 周岁`);
    }
    case "hukou": {
      if (!profile.hukouRegionCode) return unknown(req, "该岗位有户籍要求，补充户籍信息后判断");
      const ok = c.allowedRegionCodes.some((code) => profile.hukouRegionCode!.startsWith(code.slice(0, 4)));
      if (ok) return pass(req, "户籍在公告允许范围内");
      return fail(req, "户籍不在公告允许范围内");
    }
    case "social_security": {
      if (profile.socialSecurityMonths == null) return unknown(req, "尚未填写社保缴纳情况，补充后判断");
      if (!c.requireNone) return pass(req, "公告对社保无排除性要求");
      if (profile.socialSecurityMonths === 0) return pass(req, "无社保缴纳记录，符合公告口径");
      return fail(req, "公告要求无社保缴纳记录，你的情况不满足");
    }
    case "work_experience": {
      if (profile.workExperienceMonths == null) return unknown(req, "尚未填写相关工作经历，补充后判断");
      if (profile.workExperienceMonths >= c.minMonths) return pass(req, "相关工作经历满足公告要求");
      return fail(req, "相关工作经历月数不足公告要求");
    }
    case "other": {
      const answer = profile.extraAnswers?.[req.id];
      if (c.manualReview || answer === undefined) {
        return c.manualReview
          ? manual(req, "公告特有条件，建议向招聘单位人工确认")
          : unknown(req, "该条件还需要你补充信息后判断");
      }
      return pass(req, "已根据你补充的信息初步判断（以官方审核为准）");
    }
  }
}

function pass(
  req: Requirement,
  reason: string,
  extras?: DimensionExtras,
): MatchDimensionResult {
  return dimensionResult(req, "PASS", reason, extras);
}
function fail(
  req: Requirement,
  reason: string,
  extras?: DimensionExtras,
): MatchDimensionResult {
  return dimensionResult(req, "FAIL", reason, extras);
}
function unknown(
  req: Requirement,
  reason: string,
  extras?: DimensionExtras,
): MatchDimensionResult {
  return dimensionResult(req, "UNKNOWN", reason, extras);
}
function manual(
  req: Requirement,
  reason: string,
  extras?: DimensionExtras,
): MatchDimensionResult {
  return dimensionResult(req, "MANUAL_REVIEW", reason, extras);
}

function degreeToLevel(degree: string): CredentialLevel {
  if (degree === "doctorate") return "doctorate";
  if (degree === "master") return "master";
  if (degree === "bachelor") return "bachelor";
  return "secondary";
}

/** 教师资格学段高低：幼儿园 0、小学 1、初中 2、高中 3；未知返回 -1 */
function teacherStageRank(stage: string): number {
  const ranks: Record<string, number> = {
    kindergarten: 0,
    primary: 1,
    middle: 2,
    high: 3,
  };
  return ranks[stage] ?? -1;
}

/** 前置闸门（学科开放、时效、收录范围、官方来源） */
export function evaluateGates(
  announcement: RecruitmentAnnouncement,
  version: AnnouncementVersion,
  unit: ApplicationUnit,
  nowIso: string,
): GateResult[] {
  const gates: GateResult[] = [];

  gates.push({
    code: "subject_not_open",
    passed: OPEN_SUBJECTS.includes(unit.subject as (typeof OPEN_SUBJECTS)[number]),
    reason: OPEN_SUBJECTS.includes(unit.subject as (typeof OPEN_SUBJECTS)[number])
      ? "学科在当前开放范围内"
      : "该学科当前尚未开放匹配",
  });

  const closed = new Date(version.timeline.registrationEnd).getTime() < new Date(nowIso).getTime();
  gates.push({
    code: "registration_closed",
    passed: !closed,
    reason: closed
      ? `报名已于 ${version.timeline.registrationEnd} 截止`
      : `报名进行中，截止 ${version.timeline.registrationEnd}`,
  });

  const inScope = (IN_SCOPE_EMPLOYMENT_NATURES as readonly EmploymentNatureCode[]).includes(
    unit.employmentNature.code,
  );
  gates.push({
    code: "out_of_scope_nature",
    passed: inScope,
    reason: inScope ? "用工性质在官方统一招聘收录范围内" : "用工性质不在产品收录范围",
  });

  gates.push({
    code: "announcement_withdrawn",
    passed: announcement.lifecycle !== "withdrawn",
    reason:
      announcement.lifecycle === "withdrawn" ? "公告已取消或失效" : "公告处于有效状态",
  });

  // 来源失效：与后端 kb-match-rules-1.2.0 同序同口径，只采信人工巡检确认的
  // 故障（404/撤稿/域名失效），网络抖动等偶发问题不登记 ok=false。
  const health = announcement.sourceHealth;
  gates.push({
    code: "source_unavailable",
    passed: !health || health.ok,
    reason:
      health && !health.ok
        ? `官方来源最近巡检不可用（${health.failReason ?? "原因未登记"}，巡检于 ${health.checkedAt}），暂不进入推荐`
        : "官方来源巡检正常",
  });

  const hasOfficial =
    version.officialSource.state === "official" &&
    (version.officialSource.locator.kind === "url"
      ? Boolean(version.officialSource.locator.url)
      : true);
  gates.push({
    code: "no_official_source",
    passed: hasOfficial,
    reason: hasOfficial ? "依据已从官方公告核对" : "缺少已核对的官方来源，不能进入主要推荐",
  });

  return gates;
}

/**
 * 四值聚合（唯一口径，见文件头注释）。
 * D03：地区是偏好约束，不参与资格聚合；地区 UNKNOWN 仍算信息不足。
 */
export function aggregateOverall(dimensions: MatchDimensionResult[]): OpportunityMatchStatus {
  const qualification = dimensions.filter((d) => d.dimension !== "region");
  if (qualification.some((d) => d.hard && d.value === "FAIL")) return "not_eligible";
  if (
    qualification.some(
      (d) => d.value === "MANUAL_REVIEW" || (!d.hard && d.value === "FAIL"),
    )
  ) {
    return "manual_review";
  }
  const region = dimensions.find((d) => d.dimension === "region");
  if (
    qualification.some((d) => d.value === "UNKNOWN") ||
    region?.value === "UNKNOWN"
  ) {
    return "need_more_info";
  }
  return "preliminary_eligible";
}

/** 逐条件下一步动作（D03）：告诉用户现在能做什么 */
function nextStepFor(dimension: MatchDimensionResult): string {
  if (dimension.dimension === "region") {
    if (dimension.value === "FAIL")
      return "如需浏览该岗位，可在地区偏好中把对应地区设为必须接受，或取消“必须接受”限制";
    if (dimension.value === "UNKNOWN")
      return "在“我的资料”补充必须接受的地区后重新判断";
    return "无需操作；地区偏好只影响排序和浏览范围";
  }
  switch (dimension.value) {
    case "PASS":
      return "无需操作；最终以招聘单位资格审核为准";
    case "FAIL":
      return "查看公告原文确认后，改报其他岗位或补充可补正的材料";
    case "UNKNOWN":
      return "在“我的资料”或在岗位详情补充该条件所需信息后重新判断";
    case "MANUAL_REVIEW":
      return "按公告联系方式向招聘单位确认口径后再决定是否报名";
  }
}

function summarize(
  status: OpportunityMatchStatus,
  dimensions: MatchDimensionResult[],
  preferenceOutOfScope: boolean,
): string {
  const firstNotPass = dimensions.find(
    (d) => d.value !== "PASS" && d.dimension !== "region",
  );
  switch (status) {
    case "preliminary_eligible":
      return preferenceOutOfScope
        ? "关键资格条件初步符合，但岗位不在你“必须接受”的地区范围内（偏好范围外，不是资格不符合）"
        : "关键资格条件初步符合，可关注并准备报名材料";
    case "need_more_info":
      return `需要补充信息后再判断：${firstNotPass?.reason ?? "部分条件待补充"}`;
    case "manual_review":
      return `存在需要人工确认的条件：${firstNotPass?.reason ?? "建议联系招聘单位"}`;
    case "not_eligible": {
      const hardFail = dimensions.find((d) => d.hard && d.value === "FAIL");
      return `存在明确不符合项：${hardFail?.reason ?? "硬性条件不满足"}`;
    }
  }
}

/** 评估单个报考单元（页面只消费结果，不重复实现规则） */
export function evaluateOpportunity(
  announcement: RecruitmentAnnouncement,
  version: AnnouncementVersion,
  unit: ApplicationUnit,
  profile: UserRecruitmentProfile,
  nowIso: string,
): OpportunityMatchResult {
  const gates = evaluateGates(announcement, version, unit, nowIso);
  const dimensions: MatchDimensionResult[] = [
    evaluateRegion(unit.region.code, profile),
    ...unit.requirements.map((req) => evaluateRequirement(req, profile, nowIso)),
  ].map((dimension) => ({ ...dimension, nextStep: nextStepFor(dimension) }));
  const overall = aggregateOverall(dimensions);
  const region = dimensions.find((d) => d.dimension === "region");
  // 偏好范围外与资格结论分离：地区不在“必须接受”范围，且没有硬性资格不符合，
  // 就标记 preferenceOutOfScope（即使资格仍需补充信息）。可见但不计入有效机会。
  const preferenceOutOfScope =
    region?.value === "FAIL" &&
    !dimensions.some(
      (d) => d.dimension !== "region" && d.hard && d.value === "FAIL",
    );
  return {
    unitId: unit.id,
    announcementId: announcement.id,
    versionId: version.id,
    gates,
    dimensions,
    overall,
    ...(preferenceOutOfScope ? { preferenceOutOfScope: true } : {}),
    summary: summarize(overall, dimensions, preferenceOutOfScope),
  };
}

/** 评估公告当前版本下的全部报考单元 */
export function evaluateAnnouncement(
  announcement: RecruitmentAnnouncement,
  profile: UserRecruitmentProfile,
  nowIso: string,
): OpportunityMatchResult[] {
  const version = currentVersion(announcement);
  return version.units.map((unit) =>
    evaluateOpportunity(announcement, version, unit, profile, nowIso),
  );
}

export interface OpportunityCandidate {
  announcement: RecruitmentAnnouncement;
  version: AnnouncementVersion;
  unit: ApplicationUnit;
  match: OpportunityMatchResult;
}

/** 把多条公告展平为“报考单元 × 匹配结果”候选流 */
export function buildCandidates(
  announcements: RecruitmentAnnouncement[],
  profile: UserRecruitmentProfile,
  nowIso: string,
): OpportunityCandidate[] {
  return announcements.flatMap((announcement) => {
    const version = currentVersion(announcement);
    return version.units.map((unit) => ({
      announcement,
      version,
      unit,
      match: evaluateOpportunity(announcement, version, unit, profile, nowIso),
    }));
  });
}

/**
 * 有效机会（PRD 3.3）：有官方来源、未截止、在地区范围内、
 * 用工性质在收录范围内、无已知明确不符合项。
 * 闸门失败（含已截止/非当前学科）或总体“明确不符合”均不进入。
 */
export function isValidOpportunity(match: OpportunityMatchResult): boolean {
  if (!match.gates.every((g) => g.passed)) return false;
  if (match.overall === "not_eligible") return false;
  // 偏好范围外仍然可见，但不计入有效机会
  if (match.preferenceOutOfScope) return false;
  // 地区 UNKNOWN（未填地区）不计为有效推荐，避免无地域意向时铺全量
  const region = match.dimensions.find((d) => d.dimension === "region");
  if (region?.value === "UNKNOWN") return false;
  return true;
}

export function filterValidOpportunities(
  candidates: OpportunityCandidate[],
): ValidOpportunity[] {
  return candidates
    .filter((c) => isValidOpportunity(c.match))
    .map((c) => ({ unitId: c.unit.id, match: c.match }));
}

/**
 * 默认排序（PRD 7.4）：地区偏好 → 资格确定程度 → 事业编优先。
 * “即将截止”不参与排序，只通过标签与日程提醒表达。
 */
const STATUS_RANK: Record<OpportunityMatchStatus, number> = {
  preliminary_eligible: 0,
  need_more_info: 1,
  manual_review: 2,
  not_eligible: 3,
};
const REGION_RANK = { required: 0, preferred: 1, consider: 2 } as const;
const NATURE_RANK: Record<EmploymentNatureCode, number> = {
  public_institution_staff: 0,
  record_filing: 1,
  post_quota: 1,
  headcount_control: 1,
  other: 2,
};

export function sortCandidates(
  candidates: OpportunityCandidate[],
  profile: UserRecruitmentProfile,
): OpportunityCandidate[] {
  return [...candidates].sort((a, b) => {
    const regionPrefOf = (c: OpportunityCandidate) =>
      profile.regions.find((pref) =>
        c.unit.region.code.startsWith(
          pref.code.slice(0, 4).endsWith("00") ? pref.code.slice(0, 2) : pref.code.slice(0, 4),
        ),
      )?.level ?? "consider";
    const byRegion = REGION_RANK[regionPrefOf(a)] - REGION_RANK[regionPrefOf(b)];
    if (byRegion !== 0) return byRegion;
    const byStatus = STATUS_RANK[a.match.overall] - STATUS_RANK[b.match.overall];
    if (byStatus !== 0) return byStatus;
    return NATURE_RANK[a.unit.employmentNature.code] - NATURE_RANK[b.unit.employmentNature.code];
  });
}

/** 按缺失条件维度分组（用于“另有 N 个机会需要补充户籍信息后判断”） */
export function groupByMissingDimension(
  candidates: OpportunityCandidate[],
): { dimension: string; count: number; candidates: OpportunityCandidate[] }[] {
  const groups = new Map<string, OpportunityCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.match.overall !== "need_more_info") continue;
    if (!candidate.match.gates.every((g) => g.passed)) continue;
    const unknown = candidate.match.dimensions.filter((d) => d.value === "UNKNOWN");
    const key = unknown[0]?.dimension ?? "other";
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([dimension, list]) => ({ dimension, count: list.length, candidates: list }))
    .sort((a, b) => b.count - a.count);
}
