import { describe, expect, it } from "vitest";
import { buildScheduleView } from "./schedule-view";
import type { TimelineEventDTO } from "@/lib/schedule/types";

function makeEvent(overrides: Partial<TimelineEventDTO>): TimelineEventDTO {
  return {
    id: "evt-1",
    unitId: "unit-1",
    unitName: "杭州第一小学",
    regionText: "浙江·杭州",
    eventKey: "unit-1-registration_end",
    kind: "registration_end",
    kindLabel: "报名截止",
    title: "报名截止",
    dateIso: "2026-10-20",
    dateText: "10月20日 周二",
    pending: false,
    urgency: "must",
    past: false,
    action: { label: "去报名入口", href: "https://example.com", external: true },
    changedFromPrevious: null,
    ...overrides,
  };
}

describe("日程页视图模型", () => {
  it("按机会分组，事件按类型顺序排列", () => {
    const events: TimelineEventDTO[] = [
      makeEvent({ id: "e1", eventKey: "unit-1-written_exam", kind: "written_exam", kindLabel: "笔试", dateIso: "2026-11-10", urgency: "suggest", action: { label: "去备考", href: "/study" } }),
      makeEvent({ id: "e2", eventKey: "unit-1-registration_start", kind: "registration_start", kindLabel: "报名开始", dateIso: "2026-10-10", urgency: "info", action: null }),
      makeEvent({ id: "e3", eventKey: "unit-1-registration_end", kind: "registration_end", kindLabel: "报名截止", dateIso: "2026-10-20", urgency: "must" }),
    ];
    const view = buildScheduleView(events);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].events.map((e) => e.kind)).toEqual([
      "registration_start",
      "registration_end",
      "written_exam",
    ]);
  });

  it("下一件不能错过的事 = 必须处理且带行动的最早事件", () => {
    const events: TimelineEventDTO[] = [
      makeEvent({ id: "e1", eventKey: "unit-1-registration_start", kind: "registration_start", dateIso: "2026-10-10", urgency: "info", action: null }),
      makeEvent({ id: "e2", eventKey: "unit-1-registration_end", kind: "registration_end", dateIso: "2026-10-20", urgency: "must" }),
      makeEvent({ id: "e3", eventKey: "unit-1-written_exam", kind: "written_exam", dateIso: "2026-11-10", urgency: "suggest", action: { label: "去备考", href: "/study" } }),
    ];
    const view = buildScheduleView(events);
    expect(view.next?.event.kind).toBe("registration_end");
    expect(view.next?.event.urgency).toBe("must");
    expect(view.next?.event.action?.label).toBe("去报名入口");
  });

  it("待定事项不显示推测日期（dateIso 为 null、dateText 为待官方通知）", () => {
    const events: TimelineEventDTO[] = [
      makeEvent({ id: "e1", eventKey: "unit-1-pending_notice-0", kind: "pending_notice", kindLabel: "面试时间待公告", dateIso: null, dateText: "待官方通知", pending: true, urgency: "info", action: null }),
    ];
    const view = buildScheduleView(events);
    const pending = view.groups[0].events[0];
    expect(pending.pending).toBe(true);
    expect(pending.dateIso).toBeNull();
    expect(pending.dateText).toBe("待官方通知");
  });

  it("同一天跨多个机会的节点被识别为冲突（不自动放弃）", () => {
    const events: TimelineEventDTO[] = [
      makeEvent({ id: "e1", unitId: "unit-1", unitName: "杭州一小", eventKey: "unit-1-written_exam", kind: "written_exam", dateIso: "2026-11-10", urgency: "suggest", action: { label: "去备考", href: "/study" } }),
      makeEvent({ id: "e2", unitId: "unit-2", unitName: "宁波二小", eventKey: "unit-2-written_exam", kind: "written_exam", dateIso: "2026-11-10", urgency: "suggest", action: { label: "去备考", href: "/study" } }),
    ];
    const view = buildScheduleView(events);
    expect(view.conflicts).toHaveLength(1);
    expect(view.conflicts[0].items).toHaveLength(2);
    expect(view.conflicts[0].items.map((i) => i.unitName)).toEqual(["杭州一小", "宁波二小"]);
  });

  it("没有事件时给空态：next 为 null、分组为空、无冲突", () => {
    const view = buildScheduleView([]);
    expect(view.next).toBeNull();
    expect(view.groups).toEqual([]);
    expect(view.conflicts).toEqual([]);
  });

  it("已过去的事件不参与下一件选择", () => {
    const events: TimelineEventDTO[] = [
      makeEvent({ id: "e1", eventKey: "unit-1-registration_end", kind: "registration_end", dateIso: "2026-09-01", past: true, urgency: "must", action: null }),
      makeEvent({ id: "e2", eventKey: "unit-1-written_exam", kind: "written_exam", dateIso: "2026-11-10", urgency: "suggest", action: { label: "去备考", href: "/study" } }),
    ];
    const view = buildScheduleView(events);
    expect(view.next?.event.kind).toBe("written_exam");
  });
});
