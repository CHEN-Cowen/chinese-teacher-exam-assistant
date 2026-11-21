/**
 * 分阶段教育经历的本机存储（demo/访客模式，D01）。
 *
 * invited 已登录用户的经历以服务端画像为准；本模块只在
 * demo 模式或 invited 未登录访客下使用，登录迁移时随请求体发送。
 *
 * R01：存储键按身份隔离。访客写原键，已登录身份写入 `原键::user:<id>`；
 * 已登录时读不到自己的键才只读回退访客原键（登录前填写的内容仍可用）。
 */
import { STORAGE_KEYS } from "@/lib/mock-data";
import {
  readIdentityScopedRaw,
  removeIdentityScoped,
  writeIdentityScopedRaw,
} from "@/lib/storageIdentity";
import type { UserRecruitmentProfile } from "./types";
import {
  normalizeEducationExperiences,
  type EducationExperience,
} from "./education";

export const EDUCATION_UPDATED_EVENT = "kb:education-updated";

function notifyUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EDUCATION_UPDATED_EVENT));
  }
}

export const educationExperiencesService = {
  load(): EducationExperience[] {
    const raw = readIdentityScopedRaw(STORAGE_KEYS.PROFILE_EDUCATION_V1);
    if (!raw) return [];
    try {
      return normalizeEducationExperiences(JSON.parse(raw));
    } catch {
      return [];
    }
  },
  save(experiences: EducationExperience[]): EducationExperience[] {
    const normalized = normalizeEducationExperiences(experiences);
    writeIdentityScopedRaw(
      STORAGE_KEYS.PROFILE_EDUCATION_V1,
      JSON.stringify(normalized),
    );
    notifyUpdated();
    return normalized;
  },
  clear(): void {
    removeIdentityScoped(STORAGE_KEYS.PROFILE_EDUCATION_V1);
    notifyUpdated();
  },
  /** 本机是否有分阶段经历（空数组也算已显式清空） */
  hasStored(): boolean {
    const raw = readIdentityScopedRaw(STORAGE_KEYS.PROFILE_EDUCATION_V1);
    if (!raw) return false;
    try {
      return Array.isArray(JSON.parse(raw));
    } catch {
      return false;
    }
  },
};

/** 合并本机经历到请求画像；本机已保存过（含显式清空为空数组）时以本机为准 */
export function mergeEducationIntoProfile(
  profile: UserRecruitmentProfile,
): UserRecruitmentProfile {
  if (!educationExperiencesService.hasStored()) return profile;
  return {
    ...profile,
    educationExperiences: educationExperiencesService.load(),
  };
}
