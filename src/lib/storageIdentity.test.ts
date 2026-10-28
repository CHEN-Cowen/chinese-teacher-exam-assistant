/**
 * R01 本机存储身份隔离测试。
 *
 * 覆盖：
 * - 访客数据不与账号 A / 账号 B 串联；
 * - 登录时访客数据搬迁到该账号作用域，访客原键清空；
 * - 撤销快照等一次性状态按身份隔离，切换账号清理其他身份的快照；
 * - 退出登录后回到访客键，不残留账号数据。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/lib/mock-data";
import { guestSessionService } from "@/lib/guest/guestSession";
import { supplementFactsService } from "@/lib/profile/activeProfile";
import { educationExperiencesService } from "@/lib/profile/educationStore";
import {
  GUEST_IDENTITY,
  adoptGuestDataToIdentity,
  getActiveIdentity,
  identityScopedKey,
  readIdentityScopedRaw,
  setActiveIdentity,
} from "@/lib/storageIdentity";

const BASE = "kb_profile_supplement_v61";

function seedGuestDraft(major: string) {
  guestSessionService.save({ draft: { majorFullName: major, regions: [] } });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("身份作用域", () => {
  it("未登录时使用原始键，不写账号后缀", () => {
    expect(getActiveIdentity()).toBe(GUEST_IDENTITY);
    expect(identityScopedKey(BASE)).toBe(BASE);
  });

  it("已登录时使用账号作用域键", () => {
    setActiveIdentity("user-a");
    expect(identityScopedKey(BASE)).toBe(`${BASE}::user:user-a`);
  });

  it("账号 A 与账号 B 的补充资料互不可见", () => {
    setActiveIdentity("a");
    supplementFactsService.save({ birthDate: "1995-01-01" });
    setActiveIdentity("b");
    expect(supplementFactsService.load()).toEqual({});
    supplementFactsService.save({ birthDate: "1990-02-02" });
    setActiveIdentity("a");
    expect(supplementFactsService.load().birthDate).toBe("1995-01-01");
    setActiveIdentity("b");
    expect(supplementFactsService.load().birthDate).toBe("1990-02-02");
  });

  it("账号 A 与账号 B 的教育经历互不可见", () => {
    setActiveIdentity("a");
    educationExperiencesService.save([
      { id: "a-1", stage: "bachelor", majorFullName: "汉语言文学", teacherTraining: "yes", majorConfirmed: true, source: "user" },
    ]);
    setActiveIdentity("b");
    expect(educationExperiencesService.load()).toEqual([]);
    setActiveIdentity("a");
    expect(educationExperiencesService.load().map((item) => item.id)).toEqual(["a-1"]);
  });

  it("退出登录后访客看到的是访客键，不是账号数据", () => {
    setActiveIdentity("a");
    supplementFactsService.save({ birthDate: "1995-01-01" });
    setActiveIdentity(null);
    expect(supplementFactsService.load()).toEqual({});
  });
});

describe("登录时访客数据搬迁", () => {
  it("访客草稿搬到账号名下，访客原键清空，账号 B 读不到", () => {
    seedGuestDraft("汉语言文学（师范）");
    expect(readIdentityScopedRaw(STORAGE_KEYS.GUEST_PROFILE_V61)).toBeTruthy();

    setActiveIdentity("a");
    // 搬迁后账号 A 能读到
    expect(guestSessionService.load()?.draft.majorFullName).toBe("汉语言文学（师范）");
    // 访客原键已清空
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_PROFILE_V61)).toBeNull();

    setActiveIdentity("b");
    expect(guestSessionService.load()).toBeNull();
  });

  it("账号作用域已有数据时不覆盖，访客键仍被清理", () => {
    setActiveIdentity("a");
    supplementFactsService.save({ birthDate: "1990-01-01" });
    setActiveIdentity(null);
    supplementFactsService.save({ birthDate: "1999-09-09" });
    setActiveIdentity("a");
    expect(supplementFactsService.load().birthDate).toBe("1990-01-01");
    expect(localStorage.getItem(STORAGE_KEYS.PROFILE_SUPPLEMENT_V61)).toBeNull();
  });

  it("adoptGuestDataToIdentity 可单独调用且幂等", () => {
    seedGuestDraft("小学教育");
    adoptGuestDataToIdentity("a");
    adoptGuestDataToIdentity("a");
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_PROFILE_V61)).toBeNull();
    setActiveIdentity("a");
    expect(guestSessionService.load()?.draft.majorFullName).toBe("小学教育");
  });
});

describe("撤销快照按身份隔离", () => {
  const UNDO = "kb_preference_undo_v1";

  it("切换账号时清理其他身份的撤销快照，保留当前身份的", () => {
    setActiveIdentity("a");
    const aKey = identityScopedKey(UNDO);
    localStorage.setItem(aKey, "{}");
    // 模拟访客身份下遗留的快照
    localStorage.setItem(UNDO, "{}");

    setActiveIdentity("b");
    expect(localStorage.getItem(aKey)).toBeNull();
    expect(localStorage.getItem(UNDO)).toBeNull();
  });

  it("切换账号时清理迁移提示等一次性会话状态", () => {
    setActiveIdentity("a");
    sessionStorage.setItem("kb_profile_migration_conflict", "1");
    sessionStorage.setItem("kb_education_import_pending", "1");
    setActiveIdentity("b");
    expect(sessionStorage.getItem("kb_profile_migration_conflict")).toBeNull();
    expect(sessionStorage.getItem("kb_education_import_pending")).toBeNull();
  });
});
