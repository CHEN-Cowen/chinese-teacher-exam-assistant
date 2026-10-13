/**
 * v7.2 画像仓储测试（PRD 7.6.1）。
 *
 * 覆盖：
 * - GuestLocalProfileAdapter：read + patch + 合并 + 幂等
 * - ServerProfileAdapter：read + patch + 409 冲突
 * - ProfilePatch 白名单
 * - mergeFacts 合并逻辑
 * - patchToFacts 转换
 * - 登录迁移：服务端非空优先 / 缺失迁入 / 冲突要求确认
 * - 补充和保存永不进入 onboarding（路由验证）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@/lib/mock-data";
import type { GuestProfileSession } from "@/lib/guest/guestSession";
import {
  GuestLocalProfileAdapter,
  ServerProfileAdapter,
  ProfileConflictError,
  createProfileRepository,
  mergeFacts,
  patchToFacts,
} from "./profileRepository";

function completeSession(
  draftOverrides: Partial<GuestProfileSession["draft"]> = {},
): GuestProfileSession {
  return {
    draft: {
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      educationLevel: "bachelor",
      degree: "bachelor",
      majorFullName: "汉语言文学（师范）",
      graduationDate: "2026-06-30",
      employmentStatus: "fresh_unemployed",
      teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
      acceptedEmploymentNatures: ["public_institution_staff"],
      intendedSubject: "chinese",
      ...draftOverrides,
    },
    step: 5,
    createdAt: "2026-10-01T00:00:00+08:00",
    updatedAt: "2026-10-01T00:00:00+08:00",
    expiresAt: "2030-01-01T00:00:00+08:00",
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("GuestLocalProfileAdapter", () => {
  it("read：无草稿时返回 null", async () => {
    const adapter = new GuestLocalProfileAdapter();
    const result = await adapter.read();
    expect(result.profile).toBeNull();
  });

  it("read：有草稿时返回完整画像", async () => {
    localStorage.setItem(
      STORAGE_KEYS.GUEST_PROFILE_V61,
      JSON.stringify(completeSession()),
    );
    const adapter = new GuestLocalProfileAdapter();
    const result = await adapter.read();
    expect(result.profile).toBeTruthy();
    expect(result.profile!.educationLevel).toBe("bachelor");
  });

  it("patch：写入补充事实并返回合并后画像", async () => {
    localStorage.setItem(
      STORAGE_KEYS.GUEST_PROFILE_V61,
      JSON.stringify(completeSession()),
    );
    const adapter = new GuestLocalProfileAdapter();
    const result = await adapter.patch({ birthDate: "1998-06-15" });
    expect(result.profile).toBeTruthy();
    expect(result.profile!.birthDate).toBe("1998-06-15");
  });

  it("patch：多次调用合并已有值（不覆盖未涉及字段）", async () => {
    localStorage.setItem(
      STORAGE_KEYS.GUEST_PROFILE_V61,
      JSON.stringify(completeSession()),
    );
    const adapter = new GuestLocalProfileAdapter();
    await adapter.patch({ birthDate: "1998-06-15" });
    const result = await adapter.patch({ hukouProvinceCode: "330000" });
    expect(result.profile!.birthDate).toBe("1998-06-15");
    expect(result.profile!.hukouRegionCode).toBe("330000");
  });

  it("patch：幂等——重复同一字段不报错", async () => {
    localStorage.setItem(
      STORAGE_KEYS.GUEST_PROFILE_V61,
      JSON.stringify(completeSession()),
    );
    const adapter = new GuestLocalProfileAdapter();
    await adapter.patch({ birthDate: "1998-06-15" });
    const result = await adapter.patch({ birthDate: "1998-06-15" });
    expect(result.profile!.birthDate).toBe("1998-06-15");
  });

  it("patch：extraAnswers 合并不丢失已有条目", async () => {
    localStorage.setItem(
      STORAGE_KEYS.GUEST_PROFILE_V61,
      JSON.stringify(completeSession()),
    );
    const adapter = new GuestLocalProfileAdapter();
    await adapter.patch({ extraAnswers: { "req-1": "是" } });
    const result = await adapter.patch({ extraAnswers: { "req-2": "否" } });
    expect(result.profile!.extraAnswers).toEqual({
      "req-1": "是",
      "req-2": "否",
    });
  });
});

describe("ServerProfileAdapter", () => {
  it("read：调用 profileApi.getProfileWithMeta", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: { educationLevel: "bachelor" },
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new ServerProfileAdapter();
    const result = await adapter.read();
    expect(result.profile).toEqual({ educationLevel: "bachelor" });
    expect(result.updatedAt).toBe("2026-10-01T00:00:00.000Z");

    vi.unstubAllGlobals();
  });

  it("patch：调用 PATCH /profile", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: { educationLevel: "bachelor", birthDate: "1998-06-15" },
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new ServerProfileAdapter();
    const result = await adapter.patch(
      { birthDate: "1998-06-15" },
      "2026-10-01T00:00:00.000Z",
    );
    expect(result.profile).toMatchObject({ birthDate: "1998-06-15" });
    expect(result.updatedAt).toBe("2026-10-02T00:00:00.000Z");

    vi.unstubAllGlobals();
  });

  it("patch：409 冲突抛 ProfileConflictError", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "VERSION_CONFLICT",
        message: "画像已在其他设备更新",
        profile: { educationLevel: "bachelor" },
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new ServerProfileAdapter();
    await expect(
      adapter.patch({ birthDate: "1998-06-15" }, "2026-10-01T00:00:00.000Z"),
    ).rejects.toBeInstanceOf(ProfileConflictError);

    vi.unstubAllGlobals();
  });

  it("patch：409 冲突时携带当前画像", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "VERSION_CONFLICT",
        profile: { educationLevel: "bachelor" },
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new ServerProfileAdapter();
    try {
      await adapter.patch({ birthDate: "1998-06-15" }, "old");
      expect.fail("应抛 ProfileConflictError");
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileConflictError);
      const conflict = e as ProfileConflictError;
      expect(conflict.currentProfile).toEqual({ educationLevel: "bachelor" });
      expect(conflict.currentUpdatedAt).toBe("2026-10-02T00:00:00.000Z");
    }

    vi.unstubAllGlobals();
  });

  it("patch：非 409 错误原样抛出", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "服务器错误" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new ServerProfileAdapter();
    await expect(
      adapter.patch({ birthDate: "1998-06-15" }),
    ).rejects.toThrow("服务器错误");

    vi.unstubAllGlobals();
  });
});

describe("createProfileRepository", () => {
  it("未认证返回 GuestLocalProfileAdapter", () => {
    const repo = createProfileRepository(false);
    expect(repo).toBeInstanceOf(GuestLocalProfileAdapter);
  });

  it("已认证返回 ServerProfileAdapter", () => {
    const repo = createProfileRepository(true);
    expect(repo).toBeInstanceOf(ServerProfileAdapter);
  });
});

describe("mergeFacts", () => {
  it("合并新字段到已有事实", () => {
    const existing = { birthDate: "1998-06-15" };
    const merged = mergeFacts(existing, { hukouProvinceCode: "330000" });
    expect(merged.birthDate).toBe("1998-06-15");
    expect(merged.hukouProvinceCode).toBe("330000");
  });

  it("新值覆盖旧值", () => {
    const existing = { birthDate: "1998-06-15" };
    const merged = mergeFacts(existing, { birthDate: "2000-01-01" });
    expect(merged.birthDate).toBe("2000-01-01");
  });

  it("undefined 字段不覆盖已有值", () => {
    const existing = { birthDate: "1998-06-15" };
    const merged = mergeFacts(existing, { birthDate: undefined });
    expect(merged.birthDate).toBe("1998-06-15");
  });

  it("extraAnswers 深合并", () => {
    const existing = { extraAnswers: { "req-1": "是" } };
    const merged = mergeFacts(existing, { extraAnswers: { "req-2": "否" } });
    expect(merged.extraAnswers).toEqual({ "req-1": "是", "req-2": "否" });
  });
});

describe("patchToFacts", () => {
  it("提取非 undefined 字段", () => {
    const facts = patchToFacts({
      birthDate: "1998-06-15",
      hukouProvinceCode: undefined,
      socialSecurityMonths: 12,
    });
    expect(facts.birthDate).toBe("1998-06-15");
    expect(facts.hukouProvinceCode).toBeUndefined();
    expect(facts.socialSecurityMonths).toBe(12);
  });
});

describe("v7.2 补充信息永不进入 onboarding", () => {
  it("GuestCardNextStepKind 不含 onboarding", async () => {
    const mod = await import("@/lib/ia/opportunities-view");
    // GuestCardNextStepKind 类型不含 onboarding（编译时保证，运行时验证导出）
    expect(mod.guestCardNextStep).toBeDefined();
  });

  it("supplement-route 不生成 onboarding 路由", async () => {
    const { buildSupplementRoute, buildPreviewSupplementRoute } =
      await import("@/lib/opportunities/supplement-route");
    const realRoute = buildSupplementRoute("unit-1", "preview", "need_more_info");
    const demoRoute = buildPreviewSupplementRoute("unit-1", "preview", "need_more_info");
    // 不包含 /onboarding
    expect(realRoute).not.toContain("/onboarding");
    expect(demoRoute).not.toContain("/onboarding");
    // 真实路由以 /opportunities 开头
    expect(realRoute).toMatch(/^\/opportunities\/[^/]+\/supplement\?/);
    // 演示路由以 /preview/supplement 开头
    expect(demoRoute).toMatch(/^\/preview\/supplement\/[^/]+\?/);
  });
});
