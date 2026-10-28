/**
 * 分阶段教育经历（D01）纯函数：迁移、规整、校验、旧值确认。
 *
 * 设计约束：
 * - 旧单一字段（educationLevel/degree/majorFullName/graduationDate）原值完整保留；
 * - 迁移只生成一条 `source=legacy` 记录并标记“阶段归属待确认”，
 *   绝不把单一专业自动复制成本科/硕士多段；
 * - 未填写的字段保持缺省，匹配侧只能得到 UNKNOWN，不臆造事实；
 * - 本文件不读写浏览器存储，确保可被服务端/测试复用。
 */
import type { DegreeCode } from "@/lib/announcements/types";
import type {
  EducationExperience,
  EducationStage,
  UserRecruitmentProfile,
} from "./types";

export type { EducationExperience } from "./types";

export const EDUCATION_STAGE_ORDER: EducationStage[] = [
  "secondary",
  "college",
  "bachelor",
  "master",
  "doctorate",
];

export const EDUCATION_STAGE_LABELS: Record<EducationStage, string> = {
  secondary: "中专/高中",
  college: "大专",
  bachelor: "本科",
  master: "硕士研究生",
  doctorate: "博士研究生",
};

export const EDUCATION_STATUS_LABELS: Record<
  NonNullable<EducationExperience["status"]>,
  string
> = {
  in_progress: "在读/待毕业",
  graduated: "已毕业",
};

export const DEGREE_STATUS_LABELS: Record<
  NonNullable<EducationExperience["degreeStatus"]>,
  string
> = {
  none: "无学位",
  in_progress: "在读/待授予",
  obtained: "已取得",
};

export const STUDY_MODE_LABELS: Record<
  NonNullable<EducationExperience["studyMode"]>,
  string
> = {
  full_time: "全日制",
  part_time: "非全日制",
  other: "其他",
};

export const TEACHER_TRAINING_LABELS: Record<
  EducationExperience["teacherTraining"],
  string
> = {
  yes: "师范类/师范方向",
  no: "非师范",
  unknown: "未说明",
};

export function stageRank(stage: EducationStage | undefined): number {
  if (!stage) return -1;
  return EDUCATION_STAGE_ORDER.indexOf(stage);
}

export function isEducationStage(value: unknown): value is EducationStage {
  return (
    typeof value === "string" &&
    (EDUCATION_STAGE_ORDER as string[]).includes(value)
  );
}

export function degreeLabel(degree: DegreeCode | undefined): string {
  if (!degree || degree === "none") return "无学位";
  return { bachelor: "学士", master: "硕士", doctorate: "博士" }[degree];
}

function stageFromDegree(degree: DegreeCode | undefined): EducationStage | undefined {
  if (degree === "doctorate") return "doctorate";
  if (degree === "master") return "master";
  if (degree === "bachelor") return "bachelor";
  return undefined;
}

/** 旧字段是否存在（任一即视为需要迁移） */
export function hasLegacyEducationFacts(profile: UserRecruitmentProfile): boolean {
  return Boolean(
    profile.educationLevel ||
      profile.degree ||
      profile.majorFullName?.trim() ||
      profile.graduationDate,
  );
}

function legacyStatus(
  graduationDate: string | undefined,
  nowIso: string,
): EducationExperience["status"] | undefined {
  if (!graduationDate) return undefined;
  const graduation = new Date(graduationDate).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(graduation) || Number.isNaN(now)) return undefined;
  return graduation > now ? "in_progress" : "graduated";
}

/**
 * 把旧单一字段迁移为一条待确认记录。
 * 阶段只按旧最高学历/学位推断，并显式标记 `stageNeedsConfirmation`：
 * 用户可能是在硕士学历下填写了本科专业，系统不能默认归属正确。
 */
export function buildLegacyEducationExperience(
  profile: UserRecruitmentProfile,
  nowIso: string,
): EducationExperience {
  const stage = profile.educationLevel ?? stageFromDegree(profile.degree);
  const graduationDate = profile.graduationDate;
  return {
    id: "legacy-education",
    ...(stage ? { stage } : {}),
    majorFullName: (profile.majorFullName ?? "").trim(),
    ...(graduationDate ? { graduationDate } : {}),
    ...(profile.degree ? { degree: profile.degree } : {}),
    degreeStatus:
      profile.degree && profile.degree !== "none" ? "obtained" : "none",
    status: legacyStatus(graduationDate, nowIso),
    teacherTraining: "unknown",
    majorConfirmed: false,
    source: "legacy",
    stageNeedsConfirmation: true,
  };
}

export interface MigrationResult {
  profile: UserRecruitmentProfile;
  changed: boolean;
}

/**
 * 幂等迁移：已有教育经历时不生成迁移记录；没有旧事实时原样返回。
 * `nowIso` 只用于判断旧毕业时间是在读还是已毕业，不写回其他字段。
 */
export function migrateEducationProfile(
  profile: UserRecruitmentProfile,
  nowIso: string,
): MigrationResult {
  if (profile.educationExperiences && profile.educationExperiences.length > 0) {
    return { profile, changed: false };
  }
  if (!hasLegacyEducationFacts(profile)) {
    return { profile, changed: false };
  }
  const experience = buildLegacyEducationExperience(profile, nowIso);
  return {
    profile: {
      ...profile,
      educationExperiences: [experience],
      legacyEducation: profile.legacyEducation ?? { confirmed: false },
    },
    changed: true,
  };
}

const STUDY_MODES: NonNullable<EducationExperience["studyMode"]>[] = [
  "full_time",
  "part_time",
  "other",
];
const DEGREE_STATUSES: NonNullable<EducationExperience["degreeStatus"]>[] = [
  "none",
  "in_progress",
  "obtained",
];
const TEACHER_TRAININGS: EducationExperience["teacherTraining"][] = [
  "yes",
  "no",
  "unknown",
];
const DEGREES: DegreeCode[] = ["none", "bachelor", "master", "doctorate"];

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 规整客户端/服务端传入的经历：只保留结构合法字段，不替用户补事实。
 * 非法记录返回 null，由 validate 报告具体错误。
 */
export function normalizeEducationExperience(
  raw: unknown,
): EducationExperience | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = cleanString(r.id);
  const majorFullName =
    typeof r.majorFullName === "string" ? r.majorFullName.trim() : "";
  // 空专业保留到校验阶段报错，避免静默丢弃用户输入
  if (!id) return null;
  if (r.stage !== undefined && !isEducationStage(r.stage)) return null;
  if (
    r.degree !== undefined &&
    r.degree !== null &&
    !DEGREES.includes(r.degree as DegreeCode)
  ) {
    return null;
  }
  if (
    r.status !== undefined &&
    r.status !== "in_progress" &&
    r.status !== "graduated"
  ) {
    return null;
  }
  if (
    r.degreeStatus !== undefined &&
    !DEGREE_STATUSES.includes(r.degreeStatus as NonNullable<EducationExperience["degreeStatus"]>)
  ) {
    return null;
  }
  if (
    r.studyMode !== undefined &&
    !STUDY_MODES.includes(r.studyMode as NonNullable<EducationExperience["studyMode"]>)
  ) {
    return null;
  }
  const teacherTraining = TEACHER_TRAININGS.includes(
    r.teacherTraining as EducationExperience["teacherTraining"],
  )
    ? (r.teacherTraining as EducationExperience["teacherTraining"])
    : "unknown";
  return {
    id,
    ...(r.stage !== undefined ? { stage: r.stage as EducationStage } : {}),
    ...(cleanString(r.schoolName) ? { schoolName: cleanString(r.schoolName)! } : {}),
    majorFullName,
    ...(cleanString(r.majorCode) ? { majorCode: cleanString(r.majorCode)! } : {}),
    ...(cleanString(r.majorCatalogVersion)
      ? { majorCatalogVersion: cleanString(r.majorCatalogVersion)! }
      : {}),
    ...(r.status ? { status: r.status as EducationExperience["status"] } : {}),
    ...(cleanString(r.graduationDate)
      ? { graduationDate: cleanString(r.graduationDate)! }
      : {}),
    ...(r.degree ? { degree: r.degree as DegreeCode } : {}),
    ...(r.degreeStatus
      ? { degreeStatus: r.degreeStatus as EducationExperience["degreeStatus"] }
      : {}),
    ...(r.studyMode
      ? { studyMode: r.studyMode as EducationExperience["studyMode"] }
      : {}),
    teacherTraining,
    ...(cleanString(r.teacherTrainingNote)
      ? { teacherTrainingNote: cleanString(r.teacherTrainingNote)! }
      : {}),
    majorConfirmed: r.majorConfirmed === true,
    source: r.source === "legacy" ? "legacy" : "user",
    ...(r.stageNeedsConfirmation === true ? { stageNeedsConfirmation: true } : {}),
  };
}

export function normalizeEducationExperiences(input: unknown): EducationExperience[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(normalizeEducationExperience)
    .filter((item): item is EducationExperience => item !== null);
}

/** 新建一条空白经历；不预填专业/学校，避免把示例值当成用户事实 */
export function createEducationExperience(
  stage: EducationStage | undefined,
  id: string,
): EducationExperience {
  return {
    id,
    ...(stage ? { stage } : {}),
    majorFullName: "",
    teacherTraining: "unknown",
    majorConfirmed: false,
    source: "user",
  };
}

export function nextEducationStage(
  experiences: EducationExperience[],
): EducationStage | undefined {
  return EDUCATION_STAGE_ORDER.find(
    (stage) => !experiences.some((item) => item.stage === stage),
  );
}

/** 摘要：用于列表与“我的资料”展示 */
export function describeEducationExperience(
  experience: EducationExperience,
): string {
  const parts = [
    experience.stage ? EDUCATION_STAGE_LABELS[experience.stage] : "阶段待确认",
    experience.schoolName,
    experience.majorFullName || "专业未填写",
    experience.graduationDate?.slice(0, 7),
  ].filter(Boolean);
  return parts.join(" · ");
}

export interface EducationValidationIssue {
  index: number;
  field: string;
  message: string;
}

/** 服务端与编辑器共用的业务校验（结构之外的最小必要约束） */
export function validateEducationExperiences(
  experiences: EducationExperience[],
): EducationValidationIssue[] {
  const issues: EducationValidationIssue[] = [];
  const ids = new Set<string>();
  const stages = new Set<string>();
  experiences.forEach((experience, index) => {
    if (ids.has(experience.id)) {
      issues.push({ index, field: "id", message: "教育经历 id 重复" });
    }
    ids.add(experience.id);
    if (!experience.majorFullName.trim()) {
      issues.push({ index, field: "majorFullName", message: "请填写该阶段专业全称" });
    }
    if (experience.source === "user" && !experience.stage) {
      issues.push({ index, field: "stage", message: "请选择该经历的学历阶段" });
    }
    if (experience.stage) {
      if (stages.has(experience.stage)) {
        issues.push({ index, field: "stage", message: "同一学历阶段只能填写一条经历" });
      }
      stages.add(experience.stage);
    }
    if (experience.graduationDate) {
      const time = new Date(experience.graduationDate).getTime();
      if (Number.isNaN(time)) {
        issues.push({ index, field: "graduationDate", message: "毕业时间不是合法日期" });
      }
    }
    if (experience.degreeStatus && !experience.degree) {
      issues.push({ index, field: "degree", message: "填写学位状态时需同时填写学位" });
    }
  });
  return issues;
}

/** 阶段归属确认：只改记录归属与确认标记，不改专业原文 */
export function confirmLegacyStage(
  profile: UserRecruitmentProfile,
  experienceId: string,
  stage: EducationStage,
  nowIso: string,
): UserRecruitmentProfile {
  return {
    ...profile,
    educationExperiences: (profile.educationExperiences ?? []).map((item) =>
      item.id === experienceId
        ? {
            ...item,
            stage,
            stageNeedsConfirmation: false,
            majorConfirmed: true,
          }
        : item,
    ),
    legacyEducation: { confirmed: true, confirmedAt: nowIso },
  };
}

export interface MajorCandidate {
  experienceId: string | null;
  stage?: EducationStage;
  majorFullName: string;
  /** 迁移记录阶段归属未确认 */
  stageUnconfirmed: boolean;
}

/**
 * 专业条件可比较的候选专业（D03）。
 * - 有分阶段记录：返回全部记录（公告可能只要求某一阶段）；
 * - 无记录：返回旧单一字段（阶段未知）。
 */
export function majorCandidates(
  profile: UserRecruitmentProfile,
): MajorCandidate[] {
  const facts = resolveEducationFacts(profile);
  if (facts.experiences.length > 0) {
    return facts.experiences.map((item) => ({
      experienceId: item.id,
      ...(item.stage ? { stage: item.stage } : {}),
      majorFullName: item.majorFullName,
      stageUnconfirmed: item.stageNeedsConfirmation === true,
    }));
  }
  if (!profile.majorFullName?.trim()) return [];
  return [
    {
      experienceId: null,
      majorFullName: profile.majorFullName,
      stageUnconfirmed: false,
    },
  ];
}

export interface EducationFacts {
  /** 按阶段从高到低排序的经历 */
  experiences: EducationExperience[];
  /** 最高阶段（用于学历门槛） */
  highestStage?: EducationStage;
  /** 最高阶段对应的专业（公告未指定阶段时采用） */
  majorFullName?: string;
  degree?: DegreeCode;
  /** 最高阶段对应的毕业时间（应届身份判断用；旧字段兜底） */
  graduationDate?: string;
  /** 采用的经历 id；旧单一字段兜底时为 null */
  adoptedExperienceId: string | null;
  /** true=来自旧单一字段兜底（无分阶段记录） */
  fromLegacyFields: boolean;
  /** 存在尚未确认阶段归属的迁移记录 */
  hasUnconfirmedLegacy: boolean;
}

function degreeRank(degree: DegreeCode | undefined): number {
  if (degree === "doctorate") return 4;
  if (degree === "master") return 3;
  if (degree === "bachelor") return 2;
  return -1;
}

/**
 * 从画像解析当前可用于匹配的教育事实。
 * 有分阶段记录时取最高阶段（同阶段取列表中靠前的一条）；否则回退旧字段。
 */
export function resolveEducationFacts(
  profile: UserRecruitmentProfile,
): EducationFacts {
  const experiences = profile.educationExperiences ?? [];
  const ranked = experiences
    .filter((experience) => experience.majorFullName.trim() || experience.stage)
    .sort((a, b) => stageRank(b.stage) - stageRank(a.stage));
  const highest = ranked[0];
  if (highest) {
    const highestDegree = ranked
      .map((experience) => experience.degree)
      .filter((degree): degree is DegreeCode => degree !== undefined)
      .sort((a, b) => degreeRank(b) - degreeRank(a))[0];
    return {
      experiences: ranked,
      highestStage: highest.stage,
      majorFullName: highest.majorFullName || undefined,
      degree: highestDegree ?? profile.degree,
      graduationDate: highest.graduationDate ?? profile.graduationDate,
      adoptedExperienceId: highest.id,
      fromLegacyFields: false,
      hasUnconfirmedLegacy: ranked.some((item) => item.stageNeedsConfirmation),
    };
  }
  return {
    experiences: [],
    highestStage: profile.educationLevel,
    majorFullName: profile.majorFullName,
    degree: profile.degree,
    graduationDate: profile.graduationDate,
    adoptedExperienceId: null,
    fromLegacyFields: true,
    hasUnconfirmedLegacy: false,
  };
}
