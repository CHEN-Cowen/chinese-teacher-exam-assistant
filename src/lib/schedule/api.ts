/**
 * 报名日程与站内提醒 API 客户端（模块 6）。
 * demo 使用浏览器本地示例；invited 调同源 /api/schedule/*，不发送客户端身份头。
 */
import { AUTH_MODE } from "@/lib/auth";
import { demoScheduleApi } from "./demoApi";
import type {
  NotificationDTO,
  ScheduleResponse,
} from "./types";

const API_BASE = "/api/schedule";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const scheduleApi = {
  /** 日程：先同步最新公告版本再返回该用户关注机会的全部时间线事件 */
  getSchedule(): Promise<ScheduleResponse> {
    if (AUTH_MODE === "demo") return demoScheduleApi.getSchedule();
    return request<ScheduleResponse>("");
  },

  /** 站内通知列表（按创建时间倒序，最多 50 条） */
  getNotifications(): Promise<NotificationDTO[]> {
    if (AUTH_MODE === "demo") return demoScheduleApi.getNotifications();
    return request<NotificationDTO[]>("/notifications");
  },

  /** 标记单条通知已读 */
  markNotificationRead(id: string): Promise<void> {
    if (AUTH_MODE === "demo") return demoScheduleApi.markNotificationRead(id);
    return request<void>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: "PATCH",
    });
  },

  /** 全部标为已读 */
  markAllRead(): Promise<void> {
    if (AUTH_MODE === "demo") return demoScheduleApi.markAllRead();
    return request<void>("/notifications/read-all", { method: "PATCH" });
  },
};
