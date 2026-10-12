/**
 * 分析事件写入测试：seed/live 分离、访客暂存与登录归属、去重。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/lib/mock-data";
import { loadFromStorage, saveToStorage } from "@/lib/storage";
import { authService } from "@/lib/auth";
import type { AnalyticsEvent } from "./types";
import {
  listEvents,
  reseedEvents,
  track,
  trackOncePerUser,
  trackView,
} from "./eventService";

const pending = () =>
  loadFromStorage<Array<Omit<AnalyticsEvent, "userId" | "userRole" | "source">>>(
    STORAGE_KEYS.GUEST_ANALYTICS_PENDING,
    [],
  );

async function loginStudent(): Promise<void> {
  await authService.login({
    account: "student@demo.app",
    password: "demo1234",
  });
}

describe("分析事件：seed/live 分离与访客迁移", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // 以“清空后的事件流”为起点，避免与其他测试的播种状态串扰
    saveToStorage(STORAGE_KEYS.ANALYTICS_EVENTS, []);
  });

  it("未登录事件进入访客暂存队列，登录后归属为真实账号的 live 事件", async () => {
    track("opportunity_followed", "opportunity", { targetId: "unit-1" });
    expect(pending()).toHaveLength(1);
    expect(listEvents().filter((e) => e.type === "opportunity_followed")).toHaveLength(0);

    await loginStudent();

    expect(pending()).toHaveLength(0);
    const mine = listEvents().filter((e) => e.type === "opportunity_followed");
    expect(mine).toHaveLength(1);
    expect(mine[0].source).toBe("live");
    expect(mine[0].userId).toBe("u-001");
  });

  it("种子事件一律 source=seed，真实事件一律 source=live，二者不混淆", () => {
    reseedEvents();
    const seeded = listEvents();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((e) => e.source === "seed")).toBe(true);
    // 访客事件还未归属，不能污染 seed 统计
    track("profile_completed", "profile", { props: { stepCount: 5 } });
    expect(listEvents().every((e) => e.source === "seed")).toBe(true);
  });

  it("trackOncePerUser：同一用户画像完成只记一次（访客阶段+登录后不重复）", async () => {
    trackOncePerUser("profile_completed", "profile");
    trackOncePerUser("profile_completed", "profile");
    expect(pending().filter((e) => e.type === "profile_completed")).toHaveLength(1);

    await loginStudent();
    trackOncePerUser("profile_completed", "profile");
    const mine = listEvents().filter((e) => e.type === "profile_completed");
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe("u-001");
  });

  it("trackView：同一会话内同一对象只记一次", () => {
    trackView("unit-9", "match_basis_viewed", "opportunity", { targetId: "unit-9" });
    trackView("unit-9", "match_basis_viewed", "opportunity", { targetId: "unit-9" });
    expect(pending().filter((e) => e.type === "match_basis_viewed")).toHaveLength(1);
  });
});

describe("M9 分析事件：新类型写入与去重", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    saveToStorage(STORAGE_KEYS.ANALYTICS_EVENTS, []);
  });

  it("M9 事件类型可正确写入并携带枚举维度", () => {
    track("region_preference_selected", "profile", { props: { level: "determined" } });
    track("schedule_sync_completed", "schedule", { props: { status: "success", nodeCount: 3 } });
    track("subscription_changed", "subscription", { props: { action: "created" } });
    track("opportunity_notification_clicked", "notification", { props: { notificationId: "abc123" } });

    const events = pending();
    expect(events.filter((e) => e.type === "region_preference_selected")).toHaveLength(1);
    expect(events.filter((e) => e.type === "schedule_sync_completed")).toHaveLength(1);
    expect(events.filter((e) => e.type === "subscription_changed")).toHaveLength(1);
    expect(events.filter((e) => e.type === "opportunity_notification_clicked")).toHaveLength(1);

    const region = events.find((e) => e.type === "region_preference_selected");
    expect(region?.props).toEqual({ level: "determined" });
    expect(region?.module).toBe("profile");

    const sync = events.find((e) => e.type === "schedule_sync_completed");
    expect(sync?.props).toEqual({ status: "success", nodeCount: 3 });
    expect(sync?.module).toBe("schedule");
  });

  it("trackView 对 schedule_conflict_viewed 会话内去重", () => {
    trackView("schedule_conflicts", "schedule_conflict_viewed", "schedule", {
      props: { conflictCount: 2 },
    });
    trackView("schedule_conflicts", "schedule_conflict_viewed", "schedule", {
      props: { conflictCount: 2 },
    });
    expect(pending().filter((e) => e.type === "schedule_conflict_viewed")).toHaveLength(1);
  });

  it("trackView 对 opportunity_notification_viewed 按通知ID去重", () => {
    trackView("notif_001", "opportunity_notification_viewed", "notification", {
      props: { notificationId: "notif-001" },
    });
    trackView("notif_001", "opportunity_notification_viewed", "notification", {
      props: { notificationId: "notif-001" },
    });
    trackView("notif_002", "opportunity_notification_viewed", "notification", {
      props: { notificationId: "notif-002" },
    });
    const viewEvents = pending().filter((e) => e.type === "opportunity_notification_viewed");
    expect(viewEvents).toHaveLength(2);
  });

  it("schedule_sync_completed 不去重：多次同步都记录", () => {
    track("schedule_sync_completed", "schedule", { props: { status: "success", nodeCount: 3 } });
    track("schedule_sync_completed", "schedule", { props: { status: "success", nodeCount: 3 } });
    track("schedule_sync_completed", "schedule", { props: { status: "failure", reasonCode: "network_error" } });
    const syncEvents = pending().filter((e) => e.type === "schedule_sync_completed");
    expect(syncEvents).toHaveLength(3);
  });
});

describe("事件字典守卫：M9 事件全部在字典中登记", () => {
  it("M9 新增 9 类事件在 EVENT_DICTIONARY 中且仅出现一次", async () => {
    const { EVENT_DICTIONARY } = await import("./dictionary");
    const m9Types = [
      "region_preference_selected",
      "no_result_reason_viewed",
      "subscription_changed",
      "opportunity_notification_viewed",
      "opportunity_notification_clicked",
      "schedule_sync_completed",
      "schedule_node_viewed",
      "schedule_conflict_viewed",
      "announcement_reschedule_viewed",
    ];
    for (const t of m9Types) {
      const entries = EVENT_DICTIONARY.filter((e) => e.type === t);
      expect(entries).toHaveLength(1);
      // 字典条目有 label/trigger/properties
      expect(entries[0].label).toBeTruthy();
      expect(entries[0].trigger).toBeTruthy();
      expect(entries[0].properties).toBeTruthy();
    }
  });

  it("字典中无重复类型", async () => {
    const { EVENT_DICTIONARY } = await import("./dictionary");
    const seen = new Set<string>();
    for (const entry of EVENT_DICTIONARY) {
      expect(seen.has(entry.type)).toBe(false);
      seen.add(entry.type);
    }
  });
});
