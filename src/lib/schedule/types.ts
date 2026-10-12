/**
 * 报名日程与站内提醒 —— 前后端共享类型（模块 6）。
 * 与后端 backend/src/schedule/schedule.service.ts 的 DTO 一一对应。
 */

export type TimelineEventKind =
  | "registration_start"
  | "registration_end"
  | "preliminary_review"
  | "review_result"
  | "payment"
  | "amendment_deadline"
  | "admit_ticket"
  | "admit_ticket_end"
  | "written_exam"
  | "score"
  | "score_review"
  | "qualification_review"
  | "interview_confirm"
  | "interview"
  | "medical_exam"
  | "inspection"
  | "position_selection"
  | "publication"
  | "pending_notice";

/** 通知强度三档（docs IA 第 5 节） */
export type ScheduleUrgency = "must" | "suggest" | "info";

export interface TimelineEventDTO {
  id: string;
  unitId: string;
  unitName: string;
  regionText: string;
  registerUrl?: string;
  eventKey: string;
  kind: TimelineEventKind;
  kindLabel: string;
  /** 事件标题（pending_notice 时为具体待定事项描述） */
  title: string;
  /** ISO 日期；待官方通知时为 null */
  dateIso: string | null;
  dateText: string;
  /** 待官方通知（时间未定，不显示任何推测日期） */
  pending: boolean;
  urgency: ScheduleUrgency;
  past: boolean;
  action: { label: string; href: string; external?: boolean } | null;
  /** 相比上一版本是否有变更（前端可高亮差异） */
  changedFromPrevious: {
    field: "dateIso" | "title";
    oldValue: string;
    newValue: string;
    /** 对当前用户的影响（模块 7） */
    impact?: string;
    /** 下一步建议动作（模块 7） */
    nextStep?: string;
  } | null;
}

/** 机会可信状态（模块 7）：来源失效/公告取消/待人工复核时降级为可理解状态 */
export interface UnitTrustDTO {
  state: "ok" | "source_unavailable" | "withdrawn" | "pending_review";
  label: string;
  detail: string;
  checkedAt?: string;
}

export interface ScheduleResponse {
  meta: { evaluatedAt: string; syncVersion: string };
  events: TimelineEventDTO[];
  /** 已关闭提醒的机会 */
  mutedUnitIds: string[];
  /** 首屏「当前最重要的一个动作」 */
  nextAction: NextActionDTO | null;
  /** 各机会的可信状态（模块 7） */
  unitTrust: Record<string, UnitTrustDTO>;
}

export interface NextActionDTO {
  unitId: string;
  unitName: string;
  kind: "register" | "materials" | "review" | "timeline";
  label: string;
  href: string;
}

export type NotificationSeverity = "must_handle" | "suggest_handle" | "info";

export interface NotificationDTO {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  relatedUnitId: string | null;
  readAt: string | null;
  createdAt: string;
}
