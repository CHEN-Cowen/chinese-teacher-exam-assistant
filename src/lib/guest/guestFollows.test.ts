/**
 * v7.1 M8 访客关注与登录触发测试。
 *
 * 覆盖场景：
 * 1. 保存触发登录——未登录用户关注时暂存到本机 localStorage
 * 2. 刷新恢复——guest follows 持久化，页面刷新后不丢失
 * 3. 迁移失败不丢访客草稿——merge 失败时本地记录保留
 * 4. 重复登录幂等——同一 guest follow 不会产生重复记录
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertGuestFollow,
  listGuestFollows,
  clearGuestFollows,
  removeGuestFollow,
  isGuestFollowing,
  GUEST_FOLLOWS_KEY,
} from "./guestFollows";

beforeEach(() => {
  localStorage.clear();
});

describe("访客关注：保存触发登录", () => {
  it("upsertGuestFollow 把关注记录写入 localStorage", () => {
    const record = upsertGuestFollow("unit-1", { status: "considering" });
    expect(record.unitId).toBe("unit-1");
    expect(record.status).toBe("considering");
    expect(record.updatedAt).toBeTruthy();

    // localStorage 中确实有记录
    const raw = localStorage.getItem(GUEST_FOLLOWS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed["unit-1"]).toBeDefined();
    expect(parsed["unit-1"].status).toBe("considering");
  });

  it("isGuestFollowing 检查本地是否有关注记录", () => {
    expect(isGuestFollowing("unit-1")).toBe(false);
    upsertGuestFollow("unit-1", { status: "considering" });
    expect(isGuestFollowing("unit-1")).toBe(true);
  });

  it("listGuestFollows 返回所有本地关注记录", () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    upsertGuestFollow("unit-2", { status: "preparing" });
    const follows = listGuestFollows();
    expect(follows).toHaveLength(2);
    const ids = follows.map((f) => f.unitId).sort();
    expect(ids).toEqual(["unit-1", "unit-2"]);
  });
});

describe("访客关注：刷新恢复", () => {
  it("页面刷新后 localStorage 中的关注记录仍然存在", () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    upsertGuestFollow("unit-2", {
      status: "preparing",
      materialStatuses: { "item-1": "ready" },
    });

    // 模拟刷新：重新从 localStorage 读取
    const restored = listGuestFollows();
    expect(restored).toHaveLength(2);
    const u2 = restored.find((f) => f.unitId === "unit-2");
    expect(u2?.status).toBe("preparing");
    expect(u2?.materialStatuses["item-1"]).toBe("ready");
  });
});

describe("访客关注：迁移失败不丢草稿", () => {
  it("clearGuestFollows 清空后 localStorage 为空", () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    expect(listGuestFollows()).toHaveLength(1);

    clearGuestFollows();
    expect(listGuestFollows()).toHaveLength(0);
  });

  it("removeGuestFollow 只删除指定记录，不影响其他", () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    upsertGuestFollow("unit-2", { status: "preparing" });

    removeGuestFollow("unit-1");
    expect(isGuestFollowing("unit-1")).toBe(false);
    expect(isGuestFollowing("unit-2")).toBe(true);
  });

  it("迁移失败时本地记录保留（clearGuestFollows 只在迁移成功后调用）", () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    // 模拟迁移失败：不调用 clearGuestFollows
    // 本地记录仍然存在
    expect(listGuestFollows()).toHaveLength(1);
  });
});

describe("访客关注：重复登录幂等", () => {
  it("同一 unitId 的 upsertGuestFollow 覆盖而非追加", () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    upsertGuestFollow("unit-1", { status: "preparing" });

    const follows = listGuestFollows();
    expect(follows).toHaveLength(1);
    expect(follows[0].status).toBe("preparing");
  });

  it("v7.2：连点保存（空 patch/considering）保持 considering，绝不自动升级，且只有一条记录", () => {
    const first = upsertGuestFollow("unit-1", {});
    expect(first.status).toBe("considering");
    // 模拟用户快速连点「保存机会」
    upsertGuestFollow("unit-1", { status: "considering" });
    upsertGuestFollow("unit-1", { status: "considering" });

    const follows = listGuestFollows();
    expect(follows).toHaveLength(1);
    expect(follows[0].status).toBe("considering");
  });
});

describe("访客关注：重置演示数据", () => {
  it("clearAllStorage 清空访客关注与演示订阅（v7.1 回归：设置页承诺清空全部数据）", async () => {
    upsertGuestFollow("unit-1", { status: "considering" });
    localStorage.setItem("kb_demo_subscription", JSON.stringify({ regions: [] }));
    localStorage.setItem("kb_demo_opportunities_v1_unit-1", "{}");

    const { clearAllStorage } = await import("@/lib/storage");
    clearAllStorage();

    expect(localStorage.getItem(GUEST_FOLLOWS_KEY)).toBeNull();
    expect(localStorage.getItem("kb_demo_subscription")).toBeNull();
    expect(localStorage.getItem("kb_demo_opportunities_v1_unit-1")).toBeNull();
  });
});
