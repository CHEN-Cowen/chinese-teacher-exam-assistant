/**
 * 登录后机会匹配使用的“当前画像”装配（模块 5）。
 *
 * 基础画像沿用 onboarding 的访客五组草稿（kb_guest_profile_v61）；
 * 条件事实（出生日期/户籍/社保/工作经历/公告特有条件答案）只在具体机会需要时
 * 按需补问，保存在 kb_profile_supplement_v61。两者合并后随每次匹配请求提交，
 * 用户修改后立即重新请求，后端按请求即时重算（前端不做任何判定缓存）。
 *
 * 不变量：未补充的条件字段保持 undefined，由后端产出 UNKNOWN，绝不填默认值
 * 把“未填写”变成“不符合”。
 */
import { STORAGE_KEYS } from "@/lib/mock-data";
import {
  loadFromStorage,
  saveToStorage,
} from "@/lib/storage";
import {
  draftToProfile,
  guestSessionService,
} from "@/lib/guest/guestSession";
import { mergeEducationIntoProfile } from "@/lib/profile/educationStore";
import type { UserRecruitmentProfile } from "@/lib/profile/types";

/** 条件补问事实（全部可选；空字符串/未选择视为“未提供”） */
export interface SupplementFacts {
  /** YYYY-MM-DD */
  birthDate?: string;
  /** 户籍所在省代码（如 330000） */
  hukouProvinceCode?: string;
  /** 户籍所在市代码（如 330200）；有市级时市级优先 */
  hukouCityCode?: string;
  /** 社保累计缴纳月数；0 也是有效答案（无社保），undefined 才是未提供 */
  socialSecurityMonths?: number;
  workExperienceMonths?: number;
  /** 公告特有条件（requirementId → 用户答复文本） */
  extraAnswers?: Record<string, string>;
}

export const EMPTY_SUPPLEMENT_FACTS: SupplementFacts = {};

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanOptionalMonths(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return num;
}

/** 规整 localStorage 读出的补充事实，拒绝脏数据参与匹配 */
export function normalizeSupplementFacts(input: unknown): SupplementFacts {
  if (typeof input !== "object" || input === null) return {};
  const raw = input as Record<string, unknown>;
  const extraAnswers =
    typeof raw.extraAnswers === "object" &&
    raw.extraAnswers !== null &&
    !Array.isArray(raw.extraAnswers)
      ? Object.fromEntries(
          Object.entries(raw.extraAnswers as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
            .map(([k, v]) => [k, (v as string).trim()]),
        )
      : undefined;
  const facts: SupplementFacts = {
    birthDate: cleanOptionalString(raw.birthDate),
    hukouProvinceCode: cleanOptionalString(raw.hukouProvinceCode),
    hukouCityCode: cleanOptionalString(raw.hukouCityCode),
    socialSecurityMonths: cleanOptionalMonths(raw.socialSecurityMonths),
    workExperienceMonths: cleanOptionalMonths(raw.workExperienceMonths),
  };
  if (extraAnswers && Object.keys(extraAnswers).length > 0) {
    facts.extraAnswers = extraAnswers;
  }
  return facts;
}

export const supplementFactsService = {
  load(): SupplementFacts {
    return normalizeSupplementFacts(
      loadFromStorage<unknown>(STORAGE_KEYS.PROFILE_SUPPLEMENT_V61, {}),
    );
  },
  save(facts: SupplementFacts): SupplementFacts {
    const cleaned = normalizeSupplementFacts(facts);
    saveToStorage(STORAGE_KEYS.PROFILE_SUPPLEMENT_V61, cleaned);
    return cleaned;
  },
  clear(): void {
    saveToStorage(STORAGE_KEYS.PROFILE_SUPPLEMENT_V61, {});
  },
};

export type ActiveProfileReason =
  | "no_draft"
  | "incomplete"
  | "subject_not_open";

/**
 * 从完整画像派生补充事实（D05）。
 *
 * 用途：受邀登录用户的补充表单初始值来自服务端画像，而不是共享 localStorage
 * （kb_profile_supplement_v61 是本机访客/演示草稿，跨账号共享，不能预填给登录账号）。
 * 户籍还原口径：画像只存合并后的 hukouRegionCode（有市选市）；省级码（XX0000）只还原省，
 * 市级码同时还原省与市，与 SupplementForm 的省/市两个选择框对应。
 */
export function profileToSupplementFacts(
  profile: UserRecruitmentProfile | null | undefined,
): SupplementFacts {
  const facts: SupplementFacts = {};
  if (!profile) return facts;
  if (profile.birthDate) facts.birthDate = profile.birthDate;
  const hukou = profile.hukouRegionCode;
  if (hukou && /^\d{6}$/.test(hukou)) {
    if (hukou.endsWith("0000")) {
      facts.hukouProvinceCode = hukou;
    } else {
      facts.hukouProvinceCode = `${hukou.slice(0, 2)}0000`;
      facts.hukouCityCode = hukou;
    }
  }
  if (profile.socialSecurityMonths !== undefined) {
    facts.socialSecurityMonths = profile.socialSecurityMonths;
  }
  if (profile.workExperienceMonths !== undefined) {
    facts.workExperienceMonths = profile.workExperienceMonths;
  }
  if (profile.extraAnswers && Object.keys(profile.extraAnswers).length > 0) {
    facts.extraAnswers = { ...profile.extraAnswers };
  }
  return facts;
}

export type ActiveProfile =
  | { ready: false; reason: ActiveProfileReason }
  | { ready: true; profile: UserRecruitmentProfile };

/**
 * 合并基础画像与补充事实，产出提交给后端的完整画像。
 * 草稿不存在 / 五组未完成 / 非开放学科时 ready=false，调用方引导回 onboarding。
 */
export function buildActiveProfile(
  factsOverride?: SupplementFacts,
): ActiveProfile {
  const session = guestSessionService.load();
  const draft = session?.draft;
  if (!draft) return { ready: false, reason: "no_draft" };
  const base = draftToProfile(draft);
  if (!base) {
    return {
      ready: false,
      reason: draft.intendedSubject === "chinese" ? "incomplete" : "subject_not_open",
    };
  }
  const facts = normalizeSupplementFacts(factsOverride ?? supplementFactsService.load());
  const profile: UserRecruitmentProfile = {
    ...base,
    birthDate: facts.birthDate,
    hukouRegionCode: facts.hukouCityCode ?? facts.hukouProvinceCode,
    socialSecurityMonths: facts.socialSecurityMonths,
    workExperienceMonths: facts.workExperienceMonths,
    extraAnswers: facts.extraAnswers,
  };
  // D01：demo/访客本机补充的分阶段经历，随请求体提交后端重算
  return { ready: true, profile: mergeEducationIntoProfile(profile) };
}
