/**
 * v7.2 结果页「当前条件」紧凑摘要（纯函数）。
 *
 * 访客草稿（GuestProfileDraft）与登录画像（UserRecruitmentProfile）共享同一套
 * 字段子集，本模块只依赖这个公共形状，产出统一的摘要项目：
 * 地区偏好 · 学历 · 专业 · 学段学科 · 用工形式偏好。
 * 缺失字段直接省略，不输出 undefined、空字符串或多余分隔符。
 */
import { CREDENTIAL_LEVEL_OPTIONS } from "@/lib/guest/guestSession";
import { stageLabel, subjectLabel } from "@/lib/ia/labels";
import type {
  RegionPreference,
  TeacherCertInfo,
} from "@/lib/profile/types";
import type { EmploymentNaturePreference } from "@/lib/guest/guestSession";
import type { SubjectCode } from "@/lib/announcements/types";

/** 访客草稿与登录画像的公共字段子集 */
export interface ConditionSource {
  regions?: RegionPreference[];
  educationLevel?: string;
  degree?: string;
  majorFullName?: string;
  teacherCert?: Partial<TeacherCertInfo>;
  intendedSubject?: SubjectCode;
  employmentNaturePreference?: EmploymentNaturePreference;
}

const NATURE_PREF_SHORT: Record<EmploymentNaturePreference, string> = {
  public_only: "只看事业编",
  official_open: "事业编优先",
  undecided: "全部官方岗位",
};

const REGION_LEVEL_SHORT: Record<string, string> = {
  required: "优先",
  consider: "可考虑",
};

/**
 * 构建条件摘要项目数组。顺序固定：地区 → 学历 → 专业 → 学段学科 → 用工偏好。
 * 任一项缺失时跳过，调用方用「 · 」连接。
 */
export function buildConditionItems(source: ConditionSource): string[] {
  const items: string[] = [];

  const regions = source.regions ?? [];
  if (regions.length > 0) {
    const text = regions
      .map((r) => {
        const name = r.city ?? r.province;
        const level = r.level ? REGION_LEVEL_SHORT[r.level] : undefined;
        return level ? `${name}${level}` : name;
      })
      .filter(Boolean)
      .join("、");
    if (text) items.push(text);
  }

  const educationLabel = CREDENTIAL_LEVEL_OPTIONS.find(
    (option) => option.value === source.educationLevel,
  )?.label;
  if (educationLabel) items.push(educationLabel);

  const major = source.majorFullName?.trim();
  if (major) items.push(major);

  const cert = source.teacherCert;
  if (cert?.stage && cert?.subject) {
    items.push(`${stageLabel(cert.stage)}${subjectLabel(cert.subject)}`);
  } else if (cert?.subject) {
    items.push(subjectLabel(cert.subject));
  } else if (source.intendedSubject) {
    items.push(`报考${subjectLabel(source.intendedSubject)}`);
  }

  const pref = source.employmentNaturePreference;
  if (pref !== undefined) {
    items.push(NATURE_PREF_SHORT[pref]);
  }

  return items;
}

/**
 * 构建「修改条件」入口链接：默认进入资格与偏好所在的第二屏，
 * returnTo 指向原结果页（含当前标签），保存后原路返回并重新计算。
 */
export function buildEditConditionsHref(returnTo: string): string {
  return `/onboarding?mode=edit&step=2&returnTo=${encodeURIComponent(returnTo)}`;
}
