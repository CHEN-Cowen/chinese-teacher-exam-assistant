/** 公开演示日程：只根据本机已关注的示例机会派生，不请求服务器、不发送提醒。 */
import {
  demoFollowedUnit,
  demoFollowRecords,
  demoListNotifications,
  demoMarkAllNotificationsRead,
  demoMarkNotificationRead,
  syncDemoOrganizationFollows,
} from "@/lib/opportunities/demoApi";
import type { NotificationDTO, ScheduleResponse, TimelineEventDTO, TimelineEventKind } from "./types";

const DATE_FIELDS: { key: string; kind: TimelineEventKind; label: string }[] = [
  { key: "registrationStart", kind: "registration_start", label: "示例报名开始" },
  { key: "registrationEnd", kind: "registration_end", label: "示例报名截止" },
  { key: "paymentDeadline", kind: "payment", label: "示例缴费截止" },
  { key: "admitTicketStart", kind: "admit_ticket", label: "示例准考证打印" },
  { key: "writtenExamDate", kind: "written_exam", label: "示例笔试" },
  { key: "scoreDate", kind: "score", label: "示例成绩查询" },
  { key: "interviewDate", kind: "interview", label: "示例面试" },
];

function dateText(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00+08:00`);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（演示日期）`;
}

export const demoScheduleApi = {
  async getSchedule(): Promise<ScheduleResponse> {
    // D07：访问日程时顺带做一次单位关注同步（幂等），新公告版本会产生站内通知
    syncDemoOrganizationFollows();
    const follows = demoFollowRecords();
    const now = new Date();
    const events: TimelineEventDTO[] = [];
    const unitTrust: ScheduleResponse["unitTrust"] = {};
    for (const follow of follows) {
      const { version, unit } = demoFollowedUnit(follow.unitId);
      unitTrust[unit.id] = {
        state: "pending_review",
        label: "仅供功能演示",
        detail: "此公告与时间均为示例，不能作为报名依据。",
      };
      const regionText = `${unit.region.province}${unit.region.city ?? ""}`;
      for (const field of DATE_FIELDS) {
        const value = version.timeline[field.key as keyof typeof version.timeline];
        if (typeof value !== "string") continue;
        events.push({
          id: `demo-${unit.id}-${field.kind}`,
          unitId: unit.id,
          unitName: unit.name,
          regionText,
          eventKey: `${version.id}-${unit.id}-${field.kind}`,
          kind: field.kind,
          kindLabel: field.label,
          title: field.label,
          dateIso: value,
          dateText: dateText(value),
          pending: false,
          urgency: "info",
          past: new Date(`${value.slice(0, 10)}T23:59:59+08:00`) < now,
          action: null,
          changedFromPrevious: null,
        });
      }
      for (const pending of version.timeline.pendingItems ?? []) {
        events.push({
          id: `demo-${unit.id}-pending-${pending}`,
          unitId: unit.id,
          unitName: unit.name,
          regionText,
          eventKey: `${version.id}-${unit.id}-pending-${pending}`,
          kind: "pending_notice",
          kindLabel: pending,
          title: pending,
          dateIso: null,
          dateText: "待官方通知（示例）",
          pending: true,
          urgency: "info",
          past: false,
          action: null,
          changedFromPrevious: null,
        });
      }
    }
    return {
      meta: { evaluatedAt: now.toISOString(), syncVersion: "demo-local-1" },
      events,
      mutedUnitIds: follows.filter((follow) => follow.remindersMuted).map((follow) => follow.unitId),
      nextAction: null,
      unitTrust,
    };
  },

  /** D07：演示站内通知由本机单位关注同步派生（无真实公告流入时为空） */
  async getNotifications(): Promise<NotificationDTO[]> {
    syncDemoOrganizationFollows();
    return demoListNotifications();
  },

  async markNotificationRead(id: string): Promise<void> {
    demoMarkNotificationRead(id);
  },
  async markAllRead(): Promise<void> {
    demoMarkAllNotificationsRead();
  },
};
