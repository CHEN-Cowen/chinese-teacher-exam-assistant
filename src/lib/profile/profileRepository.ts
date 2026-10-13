/**
 * v7.2 画像仓储抽象（PRD 7.6.1 / 7.7）。
 *
 * 统一 read/patch 两个核心能力，替代"客户端读出全部画像后全量覆盖"的旧模式。
 * - GuestLocalProfileAdapter：访客画像写入本机 localStorage（基础草稿 + 补充事实）；
 * - ServerProfileAdapter：调用服务端画像接口（GET / PATCH）。
 *
 * PATCH 语义：
 * - 只接受白名单字段；
 * - 只合并本次变化（partial merge，不是全量覆盖）；
 * - 使用 expectedUpdatedAt 乐观锁，冲突返回 409；
 * - 不做客户端读出全部画像后全量覆盖。
 *
 * 登录迁移（PRD 7.6.1）：
 * - 服务端非空优先；
 * - 服务端缺失而访客已补充则迁入；
 * - 两边冲突要求用户确认，不静默覆盖。
 */
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import type { SupplementFacts } from "@/lib/profile/activeProfile";
import {
  buildActiveProfile,
  supplementFactsService,
} from "@/lib/profile/activeProfile";
import { guestSessionService } from "@/lib/guest/guestSession";
import { profileApi } from "@/lib/profile/profileApi";

/**
 * PATCH 画像白名单字段（PRD 7.6.1）。
 * 只允许条件画像字段和用工偏好，不允许修改基础画像（地区/学历/专业/教资）
 * ——基础画像修改走 onboarding（动作分流：修改全部信息 → onboarding）。
 */
export interface ProfilePatch {
  /** YYYY-MM-DD */
  birthDate?: string;
  /** 户籍所在省代码（如 330000） */
  hukouProvinceCode?: string;
  /** 户籍所在市代码（如 330200）；有市级时市级优先 */
  hukouCityCode?: string;
  /** 社保累计缴纳月数；0 也是有效答案（无社保），undefined 才是未提供 */
  socialSecurityMonths?: number;
  /** 相关工作经历月数 */
  workExperienceMonths?: number;
  /** 公告特有条件（requirementId → 用户答复文本） */
  extraAnswers?: Record<string, string>;
}

/** PATCH 画像时携带的乐观锁值（服务端返回的 updatedAt） */
export type ExpectedUpdatedAt = string | undefined;

/** 画像读取结果 */
export interface ProfileReadResult {
  profile: UserRecruitmentProfile | null;
  /** 服务端画像的 updatedAt（用于乐观锁）；本地模式无此值 */
  updatedAt?: string;
}

/** 乐观锁冲突错误 */
export class ProfileConflictError extends Error {
  readonly status = 409;
  readonly currentProfile: UserRecruitmentProfile | null;
  readonly currentUpdatedAt: string | undefined;

  constructor(message: string, current?: {
    profile: UserRecruitmentProfile | null;
    updatedAt?: string;
  }) {
    super(message);
    this.name = "ProfileConflictError";
    this.currentProfile = current?.profile ?? null;
    this.currentUpdatedAt = current?.updatedAt;
  }
}

/**
 * 画像仓储接口（PRD 7.6.1）。
 * 只暴露 read 和 patch，不暴露全量写入（PUT 仅保留兼容或完整迁移）。
 */
export interface ProfileRepository {
  /** 读取当前画像（基础 + 条件事实合并） */
  read(): Promise<ProfileReadResult>;
  /**
   * 部分更新画像（只合并本次变化）。
   * @param changes 白名单字段
   * @param expectedUpdatedAt 乐观锁值（服务端模式用）
   * @throws ProfileConflictError 乐观锁冲突（409）
   */
  patch(
    changes: ProfilePatch,
    expectedUpdatedAt?: ExpectedUpdatedAt,
  ): Promise<ProfileReadResult>;
}

// ==================== 工具函数 ====================

/**
 * 把 ProfilePatch 转换为 SupplementFacts（本地模式用）。
 * 只提取非 undefined 的字段。
 */
export function patchToFacts(patch: ProfilePatch): SupplementFacts {
  const facts: SupplementFacts = {};
  if (patch.birthDate !== undefined) facts.birthDate = patch.birthDate;
  if (patch.hukouProvinceCode !== undefined)
    facts.hukouProvinceCode = patch.hukouProvinceCode;
  if (patch.hukouCityCode !== undefined)
    facts.hukouCityCode = patch.hukouCityCode;
  if (patch.socialSecurityMonths !== undefined)
    facts.socialSecurityMonths = patch.socialSecurityMonths;
  if (patch.workExperienceMonths !== undefined)
    facts.workExperienceMonths = patch.workExperienceMonths;
  if (patch.extraAnswers !== undefined)
    facts.extraAnswers = patch.extraAnswers;
  return facts;
}

/**
 * 合并已有补充事实与本次 patch（本地模式用）。
 * 本次 patch 中的字段覆盖已有值；未出现的字段保留已有值。
 */
export function mergeFacts(
  existing: SupplementFacts,
  patch: ProfilePatch,
): SupplementFacts {
  const merged: SupplementFacts = { ...existing };
  if (patch.birthDate !== undefined) merged.birthDate = patch.birthDate;
  if (patch.hukouProvinceCode !== undefined)
    merged.hukouProvinceCode = patch.hukouProvinceCode;
  if (patch.hukouCityCode !== undefined)
    merged.hukouCityCode = patch.hukouCityCode;
  if (patch.socialSecurityMonths !== undefined)
    merged.socialSecurityMonths = patch.socialSecurityMonths;
  if (patch.workExperienceMonths !== undefined)
    merged.workExperienceMonths = patch.workExperienceMonths;
  if (patch.extraAnswers !== undefined) {
    merged.extraAnswers = { ...(merged.extraAnswers ?? {}), ...patch.extraAnswers };
  }
  return merged;
}

// ==================== GuestLocalProfileAdapter ====================

/**
 * 访客本地画像适配器（PRD 7.6.1）。
 * 画像写入本机画像草稿和补充事实 localStorage。
 * 不涉及服务端调用，不返回 updatedAt（本地无乐观锁）。
 */
export class GuestLocalProfileAdapter implements ProfileRepository {
  async read(): Promise<ProfileReadResult> {
    const active = buildActiveProfile();
    if (!active.ready) return { profile: null };
    return { profile: active.profile };
  }

  async patch(
    changes: ProfilePatch,
    _expectedUpdatedAt?: ExpectedUpdatedAt,
  ): Promise<ProfileReadResult> {
    void _expectedUpdatedAt; // 本地模式无乐观锁
    // 合并已有补充事实与本次 patch
    const existing = supplementFactsService.load();
    const merged = mergeFacts(existing, changes);
    // 持久化
    supplementFactsService.save(merged);
    // 读取合并后的完整画像
    const active = buildActiveProfile();
    if (!active.ready) return { profile: null };
    return { profile: active.profile };
  }
}

// ==================== ServerProfileAdapter ====================

/**
 * 服务端画像适配器（PRD 7.6.1）。
 * 调用服务端 GET /profile 读取，PATCH /profile 部分更新。
 * 使用 expectedUpdatedAt 乐观锁，冲突返回 ProfileConflictError（409）。
 */
export class ServerProfileAdapter implements ProfileRepository {
  async read(): Promise<ProfileReadResult> {
    const result = await profileApi.getProfileWithMeta();
    return {
      profile: result.profile,
      updatedAt: result.updatedAt,
    };
  }

  async patch(
    changes: ProfilePatch,
    expectedUpdatedAt?: ExpectedUpdatedAt,
  ): Promise<ProfileReadResult> {
    try {
      const result = await profileApi.patchProfile(changes, expectedUpdatedAt);
      return {
        profile: result.profile,
        updatedAt: result.updatedAt,
      };
    } catch (e) {
      if (
        e instanceof Error &&
        "status" in e &&
        (e as Error & { status?: number }).status === 409
      ) {
        const body = (e as Error & { body?: { profile?: unknown; updatedAt?: string } }).body;
        throw new ProfileConflictError(
          "画像已在其他设备更新，请基于最新信息重试",
          {
            profile: (body?.profile as UserRecruitmentProfile | undefined) ?? null,
            updatedAt: body?.updatedAt,
          },
        );
      }
      throw e;
    }
  }
}

// ==================== 登录迁移（PRD 7.6.1） ====================

export type MigrationOutcome =
  | { kind: "migrated"; profile: UserRecruitmentProfile }
  | { kind: "server_kept"; profile: UserRecruitmentProfile }
  | {
      kind: "conflict";
      serverProfile: UserRecruitmentProfile;
      guestProfile: UserRecruitmentProfile;
    }
  | { kind: "nothing_to_migrate" };

/**
 * 登录迁移逻辑（PRD 7.6.1）。
 * - 服务端非空优先：服务端已有画像时保留服务端版本；
 * - 服务端缺失而访客已补充则迁入：把访客画像写入服务端；
 * - 两边冲突要求用户确认：服务端和访客都有画像且字段值不同时返回 conflict；
 * - 不静默覆盖：绝不直接用访客画像覆盖服务端已有画像。
 *
 * @returns 迁移结果。conflict 时调用方需引导用户确认。
 */
export async function migrateGuestProfile(): Promise<MigrationOutcome> {
  const session = guestSessionService.load();
  if (!session) return { kind: "nothing_to_migrate" };

  // 读取服务端画像
  const serverResult = await profileApi.getProfileWithMeta();
  const serverProfile = serverResult.profile;

  // 构建访客画像（基础 + 已有补充事实）
  const active = buildActiveProfile();
  if (!active.ready) return { kind: "nothing_to_migrate" };
  const guestProfile = active.profile;

  // 情况1：服务端无画像 → 迁入访客数据
  if (!serverProfile) {
    await profileApi.saveProfile(guestProfile);
    return { kind: "migrated", profile: guestProfile };
  }

  // 情况2：服务端有画像 → 检查是否有需要迁入的补充事实
  const guestFacts = supplementFactsService.load();
  const hasGuestFacts =
    guestFacts.birthDate !== undefined ||
    guestFacts.hukouProvinceCode !== undefined ||
    guestFacts.hukouCityCode !== undefined ||
    guestFacts.socialSecurityMonths !== undefined ||
    guestFacts.workExperienceMonths !== undefined ||
    (guestFacts.extraAnswers !== undefined &&
      Object.keys(guestFacts.extraAnswers).length > 0);

  if (!hasGuestFacts) {
    // 访客无补充事实，服务端非空优先
    return { kind: "server_kept", profile: serverProfile };
  }

  // 检查服务端是否已包含这些补充事实
  const serverHasFacts =
    serverProfile.birthDate !== undefined ||
    serverProfile.hukouRegionCode !== undefined ||
    serverProfile.socialSecurityMonths !== undefined ||
    serverProfile.workExperienceMonths !== undefined ||
    (serverProfile.extraAnswers !== undefined &&
      Object.keys(serverProfile.extraAnswers).length > 0);

  if (!serverHasFacts) {
    // 服务端有基础画像但缺补充事实 → 把访客补充事实 PATCH 进服务端
    const patch: ProfilePatch = {};
    if (guestFacts.birthDate !== undefined)
      patch.birthDate = guestFacts.birthDate;
    if (guestFacts.hukouProvinceCode !== undefined)
      patch.hukouProvinceCode = guestFacts.hukouProvinceCode;
    if (guestFacts.hukouCityCode !== undefined)
      patch.hukouCityCode = guestFacts.hukouCityCode;
    if (guestFacts.socialSecurityMonths !== undefined)
      patch.socialSecurityMonths = guestFacts.socialSecurityMonths;
    if (guestFacts.workExperienceMonths !== undefined)
      patch.workExperienceMonths = guestFacts.workExperienceMonths;
    if (guestFacts.extraAnswers !== undefined)
      patch.extraAnswers = guestFacts.extraAnswers;

    try {
      const result = await profileApi.patchProfile(patch, serverResult.updatedAt);
      return { kind: "migrated", profile: result.profile };
    } catch {
      // PATCH 失败时返回冲突，让用户确认
      return {
        kind: "conflict",
        serverProfile,
        guestProfile,
      };
    }
  }

  // 两边都有补充事实 → 冲突，需用户确认
  return {
    kind: "conflict",
    serverProfile,
    guestProfile,
  };
}

// ==================== 工厂 ====================

/**
 * 根据是否已登录选择适配器。
 * - 未登录 / demo 模式：GuestLocalProfileAdapter
 * - 已登录 invited 模式：ServerProfileAdapter
 */
export function createProfileRepository(
  isAuthenticated: boolean,
): ProfileRepository {
  return isAuthenticated
    ? new ServerProfileAdapter()
    : new GuestLocalProfileAdapter();
}
