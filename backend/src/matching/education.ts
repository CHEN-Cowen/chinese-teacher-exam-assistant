/**
 * 分阶段教育经历（D01）后端规则层。
 *
 * 与前端 lib/profile/education.ts 使用同一套 JSON 结构与校验口径，
 * 但后端独立实现，避免跨包路径依赖。只做三件事：
 * 1. 规整/校验画像中的 educationExperiences；
 * 2. 从分阶段记录解析可用教育事实（旧单一字段兜底）；
 * 3. 为专业条件挑选“采用的教育经历”。
 *
 * 不变量：缺事实只能导向 UNKNOWN，不能因为数据缺失或迁移未确认而 FAIL。
 */
import type {
  CredentialLevel,
  DegreeCode,
  EducationExperience,
  UserRecruitmentProfile,
} from '../matching/types.js';

export const EDUCATION_STAGE_RANK: Record<CredentialLevel, number> = {
  secondary: 0,
  college: 1,
  bachelor: 2,
  master: 3,
  doctorate: 4,
};

const DEGREE_RANK: Record<DegreeCode, number> = {
  none: -1,
  bachelor: 2,
  master: 3,
  doctorate: 4,
};

const STAGES = new Set<CredentialLevel>([
  'secondary',
  'college',
  'bachelor',
  'master',
  'doctorate',
]);
const DEGREES = new Set<DegreeCode>([
  'none',
  'bachelor',
  'master',
  'doctorate',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 结构规整：丢弃无法解释的字段，不补任何事实 */
export function normalizeEducationExperiences(
  input: unknown,
): EducationExperience[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw): EducationExperience | null => {
      if (!isRecord(raw)) return null;
      const id = cleanString(raw.id);
      const majorFullName =
        typeof raw.majorFullName === 'string' ? raw.majorFullName.trim() : '';
      // 空专业保留到校验阶段报错，避免静默丢弃用户输入
      if (!id) return null;
      if (raw.stage !== undefined && !STAGES.has(raw.stage as CredentialLevel)) {
        return null;
      }
      if (
        raw.degree !== undefined &&
        !DEGREES.has(raw.degree as DegreeCode)
      ) {
        return null;
      }
      const teacherTraining: EducationExperience['teacherTraining'] =
        raw.teacherTraining === 'yes' || raw.teacherTraining === 'no'
          ? raw.teacherTraining
          : 'unknown';
      return {
        id,
        ...(raw.stage ? { stage: raw.stage as CredentialLevel } : {}),
        ...(cleanString(raw.schoolName)
          ? { schoolName: cleanString(raw.schoolName)! }
          : {}),
        majorFullName,
        ...(cleanString(raw.majorCode)
          ? { majorCode: cleanString(raw.majorCode)! }
          : {}),
        ...(cleanString(raw.majorCatalogVersion)
          ? { majorCatalogVersion: cleanString(raw.majorCatalogVersion)! }
          : {}),
        ...(raw.status === 'in_progress' || raw.status === 'graduated'
          ? { status: raw.status }
          : {}),
        ...(cleanString(raw.graduationDate)
          ? { graduationDate: cleanString(raw.graduationDate)! }
          : {}),
        ...(raw.degree ? { degree: raw.degree as DegreeCode } : {}),
        ...(raw.degreeStatus === 'none' ||
        raw.degreeStatus === 'in_progress' ||
        raw.degreeStatus === 'obtained'
          ? { degreeStatus: raw.degreeStatus }
          : {}),
        ...(raw.studyMode === 'full_time' ||
        raw.studyMode === 'part_time' ||
        raw.studyMode === 'other'
          ? { studyMode: raw.studyMode }
          : {}),
        teacherTraining,
        ...(cleanString(raw.teacherTrainingNote)
          ? { teacherTrainingNote: cleanString(raw.teacherTrainingNote)! }
          : {}),
        majorConfirmed: raw.majorConfirmed === true,
        source: raw.source === 'legacy' ? 'legacy' : 'user',
        ...(raw.stageNeedsConfirmation === true
          ? { stageNeedsConfirmation: true }
          : {}),
      };
    })
    .filter((item): item is EducationExperience => item !== null);
}

export interface EducationIssue {
  index: number;
  field: string;
  message: string;
}

/** 保存前校验；返回空数组表示通过 */
export function validateEducationExperiences(
  experiences: readonly EducationExperience[],
): EducationIssue[] {
  const issues: EducationIssue[] = [];
  const ids = new Set<string>();
  const stages = new Set<string>();
  experiences.forEach((experience, index) => {
    if (ids.has(experience.id)) {
      issues.push({ index, field: 'id', message: '教育经历 id 重复' });
    }
    ids.add(experience.id);
    if (!experience.majorFullName.trim()) {
      issues.push({ index, field: 'majorFullName', message: '请填写该阶段专业全称' });
    }
    if (experience.source === 'user' && !experience.stage) {
      issues.push({ index, field: 'stage', message: '请选择该经历的学历阶段' });
    }
    if (experience.stage) {
      if (stages.has(experience.stage)) {
        issues.push({ index, field: 'stage', message: '同一学历阶段只能填写一条经历' });
      }
      stages.add(experience.stage);
    }
    if (
      experience.graduationDate &&
      Number.isNaN(new Date(experience.graduationDate).getTime())
    ) {
      issues.push({
        index,
        field: 'graduationDate',
        message: '毕业时间不是合法日期',
      });
    }
    if (experience.degreeStatus && !experience.degree) {
      issues.push({ index, field: 'degree', message: '填写学位状态时需同时填写学位' });
    }
  });
  return issues;
}

export interface ResolvedEducationFacts {
  experiences: EducationExperience[];
  /** 最高阶段（用于学历门槛） */
  highestStage?: CredentialLevel;
  degree?: DegreeCode;
  /** 最高阶段的毕业时间 */
  graduationDate?: string;
  /** 采用经历 id；旧字段兜底时为 null */
  adoptedExperienceId: string | null;
  /** 是否存在尚未确认阶段归属的迁移记录 */
  hasUnconfirmedLegacy: boolean;
  fromLegacyFields: boolean;
}

/**
 * 解析画像教育事实。
 * - 有分阶段记录：取最高阶段；同阶段取列表靠前一条；
 * - 无记录：回退旧单一字段（保持旧行为，不影响历史画像）；
 * - 旧字段迁移记录 stageNeedsConfirmation=true 时标记出来，匹配侧需保守处理。
 */
export function resolveEducationFacts(
  profile: UserRecruitmentProfile,
): ResolvedEducationFacts {
  const experiences = normalizeEducationExperiences(
    profile.educationExperiences,
  );
  const ranked = [...experiences]
    .filter((item) => item.majorFullName || item.stage)
    .sort(
      (a, b) =>
        (b.stage ? EDUCATION_STAGE_RANK[b.stage] : -1) -
        (a.stage ? EDUCATION_STAGE_RANK[a.stage] : -1),
    );
  const highest = ranked[0];
  if (highest) {
    const degree = ranked
      .map((item) => item.degree)
      .filter((value): value is DegreeCode => value !== undefined)
      .sort((a, b) => DEGREE_RANK[b] - DEGREE_RANK[a])[0];
    return {
      experiences: ranked,
      highestStage: highest.stage,
      degree: degree ?? profile.degree,
      graduationDate: highest.graduationDate ?? profile.graduationDate,
      adoptedExperienceId: highest.id,
      hasUnconfirmedLegacy: ranked.some((item) => item.stageNeedsConfirmation),
      fromLegacyFields: false,
    };
  }
  return {
    experiences: [],
    highestStage: profile.educationLevel,
    degree: profile.degree,
    graduationDate: profile.graduationDate,
    adoptedExperienceId: null,
    hasUnconfirmedLegacy: false,
    fromLegacyFields: true,
  };
}

export interface MajorCandidate {
  experienceId: string | null;
  stage?: CredentialLevel;
  majorFullName: string;
  /** 迁移记录阶段归属未确认 */
  stageUnconfirmed: boolean;
}

/**
 * 专业条件可比较的候选专业。
 * - 有分阶段记录：返回全部记录（公告要求可能只指向某一阶段）；
 * - 无记录：返回旧单一字段（stage 未知）。
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
