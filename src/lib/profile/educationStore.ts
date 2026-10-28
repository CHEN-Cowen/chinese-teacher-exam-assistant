/**
 * 分阶段教育经历的本机存储（demo/访客模式，D01）。
 *
 * invited 已登录用户的经历以服务端画像为准；本模块只在
 * demo 模式或 invited 未登录访客下使用，登录迁移时随请求体发送。
 */
import { STORAGE_KEYS } from "@/lib/mock-data";
import { loadFromStorage, saveToStorage } from "@/lib/storage";
import type { UserRecruitmentProfile } from "./types";
import {
  normalizeEducationExperiences,
  type EducationExperience,
} from "./education";

export const EDUCATION_UPDATED_EVENT = "kb:education-updated";

export const educationExperiencesService = {
  load(): EducationExperience[] {
    return normalizeEducationExperiences(
      loadFromStorage<unknown>(STORAGE_KEYS.PROFILE_EDUCATION_V1, []),
    );
  },
  save(experiences: EducationExperience[]): EducationExperience[] {
    const normalized = normalizeEducationExperiences(experiences);
    saveToStorage(STORAGE_KEYS.PROFILE_EDUCATION_V1, normalized);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(EDUCATION_UPDATED_EVENT));
    }
    return normalized;
  },
  clear(): void {
    saveToStorage(STORAGE_KEYS.PROFILE_EDUCATION_V1, []);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(EDUCATION_UPDATED_EVENT));
    }
  },
  /** 本机是否有分阶段经历（空数组也算已显式清空） */
  hasStored(): boolean {
    const raw = loadFromStorage<unknown>(STORAGE_KEYS.PROFILE_EDUCATION_V1, null);
    return Array.isArray(raw);
  },
};

/** 合并本机经历到请求画像；本机已显式保存过时以本机为准 */
export function mergeEducationIntoProfile(
  profile: UserRecruitmentProfile,
): UserRecruitmentProfile {
  const experiences = educationExperiencesService.load();
  if (!experiences.length) return profile;
  return { ...profile, educationExperiences: experiences };
}
