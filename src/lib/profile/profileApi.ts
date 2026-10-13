import { guestSessionService, draftToProfile } from "@/lib/guest/guestSession";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import type { ProfilePatch } from "@/lib/profile/profileRepository";
import type { SupplementFacts } from "@/lib/profile/activeProfile";

/** v7.2 登录迁移结果；conflict 时携带访客补充事实供 UI 确认解决 */
export interface MigrationOutcome {
  kind: "migrated" | "server_kept" | "conflict" | "nothing_to_migrate";
  guestFacts?: SupplementFacts;
}

const API_BASE = "/api/profile";

/**
 * 用户画像 API（模块 8 + v7.2 PATCH）。
 * invited 模式下画像持久化在服务端，跨浏览器恢复；
 * demo 模式下本模块不被使用（画像仍走本地 + 请求体）。
 *
 * 注意：本模块不得 import @/lib/auth —— HttpAuthProvider 依赖本模块做画像迁移，
 * 反向引入会形成模块循环（TDZ: Cannot access 'HttpAuthProvider'）。
 * 模式判断由调用方负责（唯一迁移调用方是 invited 模式的 HttpAuthProvider）。
 */
export const profileApi = {
  async getProfile(): Promise<UserRecruitmentProfile | null> {
    const res = await fetch(API_BASE, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { profile?: UserRecruitmentProfile | null };
    return data.profile ?? null;
  },

  /**
   * 读取画像含 updatedAt（v7.2 乐观锁用）。
   * 返回 null 画像和可能存在的 updatedAt。
   */
  async getProfileWithMeta(): Promise<{
    profile: UserRecruitmentProfile | null;
    updatedAt?: string;
  }> {
    const res = await fetch(API_BASE, { credentials: "include" });
    if (!res.ok) return { profile: null };
    const data = (await res.json()) as {
      profile?: UserRecruitmentProfile | null;
      updatedAt?: string;
    };
    return {
      profile: data.profile ?? null,
      updatedAt: data.updatedAt,
    };
  },

  async saveProfile(profile: UserRecruitmentProfile): Promise<void> {
    const res = await fetch(API_BASE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ profile }),
    });
    if (!res.ok) throw new Error("保存画像失败");
  },

  /**
   * v7.2 部分更新画像（白名单字段 + 乐观锁）。
   * 只合并本次变化，不做客户端读出全部画像后全量覆盖。
   * 冲突（409）时抛错，错误对象携带 status=409 和 body。
   */
  async patchProfile(
    changes: ProfilePatch,
    expectedUpdatedAt?: string,
  ): Promise<{ profile: UserRecruitmentProfile; updatedAt?: string }> {
    const res = await fetch(API_BASE, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ changes, expectedUpdatedAt }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const err = new Error(body.message || body.error || `请求失败 (${res.status})`);
      (err as Error & { status?: number; body?: unknown }).status = res.status;
      (err as Error & { status?: number; body?: unknown }).body = body;
      throw err;
    }
    const data = (await res.json()) as {
      profile?: UserRecruitmentProfile;
      updatedAt?: string;
    };
    return {
      profile: data.profile!,
      updatedAt: data.updatedAt,
    };
  },

  /**
   * 登录后迁移访客画像到服务端（v7.2 增强版）。
   * - 服务端非空优先：已有服务端画像时不覆盖；
   * - 服务端缺失而访客已补充则迁入：用 PATCH 把补充事实合并进服务端；
   * - 两边冲突要求用户确认：服务端已有补充事实且与访客不同时返回 conflict；
   * - 不静默覆盖：绝不直接用访客画像覆盖服务端已有画像。
   *
   * 返回迁移结果（conflict 时携带 guestFacts），调用方据此决定是否需要引导用户确认。
   */
  async migrateGuestProfileIfNeeded(): Promise<MigrationOutcome> {
    const session = guestSessionService.load();
    if (!session) return { kind: "nothing_to_migrate" };
    const profile = draftToProfile(session.draft);
    if (!profile) return { kind: "nothing_to_migrate" };

    const existing = await this.getProfileWithMeta();
    // 情况1：服务端无画像 → 迁入
    if (!existing.profile) {
      await this.saveProfile(profile);
      return { kind: "migrated" };
    }

    // 情况2：服务端有画像 → 检查访客是否有补充事实需要合并
    const { supplementFactsService } = await import("@/lib/profile/activeProfile");
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
      return { kind: "server_kept" };
    }

    // 检查服务端是否已有补充事实
    const serverProfile = existing.profile;
    const serverHasFacts =
      serverProfile.birthDate !== undefined ||
      serverProfile.hukouRegionCode !== undefined ||
      serverProfile.socialSecurityMonths !== undefined ||
      serverProfile.workExperienceMonths !== undefined ||
      (serverProfile.extraAnswers !== undefined &&
        Object.keys(serverProfile.extraAnswers).length > 0);

    if (!serverHasFacts) {
      // 服务端有基础画像但缺补充事实 → PATCH 合并
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
        await this.patchProfile(patch, existing.updatedAt);
        return { kind: "migrated" };
      } catch {
        // PATCH 失败（可能是冲突）→ 返回冲突让用户确认
        return { kind: "conflict", guestFacts };
      }
    }

    // 两边都有补充事实 → 冲突
    return { kind: "conflict", guestFacts };
  },
};
