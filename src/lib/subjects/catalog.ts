/**
 * 全学科展示字典（W1）。
 *
 * 与后端 `backend/src/subjects/subject-catalog.ts` 保持同一套稳定代码；
 * 前端只负责展示与旧代码归一，不做“名称猜学科”。
 * 未知代码原样展示，避免把用户数据悄悄改成别科。
 */
import type { SubjectCode } from "@/lib/announcements/types";

export interface SubjectOption {
  value: SubjectCode;
  label: string;
  /** 分类：用于分组展示，不参与匹配 */
  category:
    | "language"
    | "mathematics"
    | "science"
    | "humanities"
    | "arts"
    | "physical_education"
    | "technology"
    | "preschool"
    | "special_education"
    | "vocational"
    | "other";
}

export const SUBJECT_OPTIONS: SubjectOption[] = [
  { value: "chinese", label: "语文", category: "language" },
  { value: "mathematics", label: "数学", category: "mathematics" },
  { value: "english", label: "英语", category: "language" },
  { value: "japanese", label: "日语", category: "language" },
  { value: "russian", label: "俄语", category: "language" },
  { value: "physics", label: "物理", category: "science" },
  { value: "chemistry", label: "化学", category: "science" },
  { value: "biology", label: "生物", category: "science" },
  { value: "politics", label: "思想政治", category: "humanities" },
  { value: "history", label: "历史", category: "humanities" },
  { value: "geography", label: "地理", category: "humanities" },
  { value: "music", label: "音乐", category: "arts" },
  { value: "art", label: "美术", category: "arts" },
  { value: "pe", label: "体育", category: "physical_education" },
  { value: "it", label: "信息技术", category: "technology" },
  { value: "science", label: "科学", category: "science" },
  { value: "general_technology", label: "通用技术", category: "technology" },
  {
    value: "comprehensive_practice",
    label: "综合实践",
    category: "other",
  },
  { value: "labor", label: "劳动", category: "other" },
  { value: "mental_health", label: "心理健康", category: "other" },
  { value: "preschool", label: "学前教育", category: "preschool" },
  { value: "special_education", label: "特殊教育", category: "special_education" },
  { value: "vocational", label: "职教专业课", category: "vocational" },
];

export const OPEN_SUBJECTS: readonly SubjectCode[] = SUBJECT_OPTIONS.map(
  (s) => s.value,
);

const CODE_ALIASES: Record<string, SubjectCode> = {
  math: "mathematics",
  maths: "mathematics",
  physical_education: "pe",
  information_technology: "it",
  information_tech: "it",
  info_tech: "it",
  political: "politics",
  moral_education: "politics",
  civics: "politics",
  kindergarten: "preschool",
  pre_school: "preschool",
  special: "special_education",
  vocational_education: "vocational",
  chinese_language: "chinese",
};

/** 旧数据/旧草稿代码归一；未知代码原样返回。 */
export function canonicalSubjectCode(code: string): SubjectCode {
  const trimmed = code.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.toLowerCase();
  const known = SUBJECT_OPTIONS.some((s) => s.value === normalized);
  return known ? normalized : CODE_ALIASES[normalized] ?? trimmed;
}

export function isOpenSubject(code: string | undefined): boolean {
  if (!code) return false;
  return OPEN_SUBJECTS.includes(canonicalSubjectCode(code));
}

export function subjectOptionLabel(code: string): string {
  const canonical = canonicalSubjectCode(code);
  return SUBJECT_OPTIONS.find((s) => s.value === canonical)?.label ?? code;
}

/** 岗位多学科展示：去重后按字典顺序，未知代码排在最后原样展示。 */
export function subjectLabels(
  unit: { subject?: string; subjects?: readonly string[] },
): string[] {
  const codes = [
    ...(unit.subjects ?? []),
    ...(unit.subject ? [unit.subject] : []),
  ].map(canonicalSubjectCode);
  const unique = [...new Set(codes.filter(Boolean))];
  const known = SUBJECT_OPTIONS.map((s) => s.value as string);
  return unique
    .sort((a, b) => {
      const ai = known.indexOf(a);
      const bi = known.indexOf(b);
      return (ai < 0 ? known.length : ai) - (bi < 0 ? known.length : bi);
    })
    .map(subjectOptionLabel);
}

/** 岗位学科集合：复数优先、单值回退、旧代码归一。 */
export function unitSubjectCodes(unit: {
  subject?: string;
  subjects?: readonly string[];
}): SubjectCode[] {
  const codes = [
    ...(unit.subjects ?? []),
    ...(unit.subject ? [unit.subject] : []),
  ].map(canonicalSubjectCode);
  return [...new Set(codes.filter(Boolean))];
}

/** 岗位是否至少有一个已开放学科；旧单值字段兜底。 */
export function unitHasOpenSubject(unit: {
  subject?: string;
  subjects?: readonly string[];
}): boolean {
  const codes = [...(unit.subjects ?? []), ...(unit.subject ? [unit.subject] : [])];
  return codes.some((code) => isOpenSubject(code));
}
