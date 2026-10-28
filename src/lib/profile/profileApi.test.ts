/**
 * profileApi.migrateGuestProfileIfNeeded 测试（v7.2 登录迁移 + 冲突携带 guestFacts）。
 *
 * 覆盖：
 * - 无访客会话 → nothing_to_migrate；
 * - 服务端已有补充事实且访客也有 → conflict 且携带 guestFacts（供 UI 确认）；
 * - 服务端缺补充事实 + PATCH 成功 → migrated；
 * - 服务端缺补充事实 + PATCH 冲突失败 → conflict 且携带 guestFacts。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileApi } from "./profileApi";

const GUEST_KEY = "kb_guest_profile_v61";
const SUPPLEMENT_KEY = "kb_profile_supplement_v61";

function seedGuestSession() {
  const now = Date.now();
  localStorage.setItem(
    GUEST_KEY,
    JSON.stringify({
      draft: {
        regions: [
          { code: "330100", province: "浙江省", city: "杭州市", level: "required" },
        ],
        educationLevel: "bachelor",
        degree: "bachelor",
        majorFullName: "汉语言文学",
        graduationDate: "2020-06-30",
        teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
        intendedSubject: "chinese",
        acceptedEmploymentNatures: [],
      },
      step: 2,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    }),
  );
}

function seedGuestFacts() {
  localStorage.setItem(
    SUPPLEMENT_KEY,
    JSON.stringify({ birthDate: "1995-06-15", socialSecurityMonths: 12 }),
  );
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as Response;
}

describe("migrateGuestProfileIfNeeded", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("无访客会话 → nothing_to_migrate，不发任何请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("nothing_to_migrate");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("双方都有补充事实 → conflict 并携带 guestFacts", async () => {
    seedGuestSession();
    seedGuestFacts();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        profile: { regions: [], birthDate: "1990-01-01" },
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("conflict");
    expect(outcome.guestFacts?.birthDate).toBe("1995-06-15");
    expect(outcome.guestFacts?.socialSecurityMonths).toBe(12);
    // 冲突时绝不发起 PATCH（不静默覆盖）
    expect(
      fetchMock.mock.calls.every(([, init]) => (init as RequestInit)?.method !== "PATCH"),
    ).toBe(true);
  });

  it("服务端缺补充事实 + PATCH 成功 → migrated", async () => {
    seedGuestSession();
    seedGuestFacts();
    const fetchMock = vi
      .fn()
      // GET /profile（getProfileWithMeta）
      .mockResolvedValueOnce(
        jsonResponse({
          profile: { regions: [] },
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
      )
      // PATCH /profile
      .mockResolvedValueOnce(
        jsonResponse({
          profile: { regions: [], birthDate: "1995-06-15" },
          updatedAt: "2026-10-02T00:00:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("migrated");
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body.expectedUpdatedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(body.changes.birthDate).toBe("1995-06-15");
  });

  it("服务端缺补充事实但 PATCH 冲突失败 → conflict 并携带 guestFacts", async () => {
    seedGuestSession();
    seedGuestFacts();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          profile: { regions: [] },
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "VERSION_CONFLICT", message: "画像已在其他设备更新" },
          { ok: false, status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("conflict");
    expect(outcome.guestFacts?.birthDate).toBe("1995-06-15");
  });
});

describe("R01 登录迁移涵盖分阶段教育经历", () => {
  const EDUCATION_KEY = "kb_profile_education_v1";
  const bachelor = {
    id: "bachelor-1",
    stage: "bachelor",
    majorFullName: "汉语言文学（师范）",
    teacherTraining: "yes",
    majorConfirmed: true,
    source: "user",
  };

  function seedLocalEducation() {
    localStorage.setItem(EDUCATION_KEY, JSON.stringify([bachelor]));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("服务端无画像：迁移请求包含本机分阶段经历", async () => {
    seedGuestSession();
    seedLocalEducation();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("migrated");
    expect(outcome.educationImported).toBe(true);
    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body.profile.educationExperiences).toEqual([bachelor]);
  });

  it("服务端已有画像但没有经历：不静默写入，返回 pendingEducationImport", async () => {
    seedGuestSession();
    seedLocalEducation();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        profile: { regions: [], educationLevel: "bachelor" },
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("server_kept");
    expect(outcome.pendingEducationImport).toBe(true);
    // 不带教育经历：必须由用户在页面上明确确认后才导入
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit)?.method === "PATCH" || (init as RequestInit)?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("双方都有经历：服务端优先、不覆盖，标记待确认导入", async () => {
    seedGuestSession();
    seedLocalEducation();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        profile: {
          regions: [],
          educationExperiences: [
            { ...bachelor, id: "server-1", majorFullName: "小学教育" },
          ],
        },
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await profileApi.migrateGuestProfileIfNeeded();
    expect(outcome.kind).toBe("server_kept");
    expect(
      fetchMock.mock.calls.every(
        ([, init]) =>
          (init as RequestInit)?.method !== "PATCH" &&
          (init as RequestInit)?.method !== "PUT",
      ),
    ).toBe(true);
  });
});

describe("R01 读取失败不伪装成无画像", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("getProfile 读取失败抛错（带状态），不返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })),
    );
    await expect(profileApi.getProfile()).rejects.toMatchObject({ status: 500 });
  });

  it("读取失败时迁移绝不 PUT 覆盖服务端", async () => {
    seedGuestSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { ok: false, status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(profileApi.migrateGuestProfileIfNeeded()).rejects.toBeTruthy();
    expect(
      fetchMock.mock.calls.every(
        ([, init]) =>
          (init as RequestInit)?.method !== "PUT" &&
          (init as RequestInit)?.method !== "PATCH",
      ),
    ).toBe(true);
  });
});
