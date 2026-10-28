/**
 * 用户与报考机会的关系域（PRD 6.5 / 7.4）。
 *
 * FollowStatus 是用户的报考跟进状态；StudyTargetRole 标记备考主目标/备选目标。
 * 这些是用户关系数据，与公告本身的版本数据分离。
 */
import type { AnnouncementVersion, ApplicationUnit } from "@/lib/announcements/types";

/** 关注/跟进状态：考虑中 → 准备报名 → 已报名 → 等待考试；另含已放弃、已结束 */
export type FollowStatus =
  | "considering" // 考虑中
  | "preparing" // 准备报名
  | "registered" // 已报名
  | "waiting_exam" // 等待考试（D07：报名完成后、考试结束前）
  | "abandoned" // 已放弃
  | "closed"; // 已结束（录取结束、公告失效等）

/** 备考目标角色：主要目标 / 备选目标 */
export type StudyTargetRole = "primary" | "backup";

export interface FollowStatusEvent {
  status: FollowStatus;
  at: string;
  /** 状态变更原因（用户手动 / 系统按截止日流转等） */
  note?: string;
}

/** 用户关注的一个报考单元（关注的是具体单元，不是抽象公告） */
export interface FollowedOpportunity {
  id: string;
  userId: string;
  unitId: string;
  announcementId: string;
  /** 关注时对应的公告版本 id（保留历史快照指针） */
  versionId: string;
  status: FollowStatus;
  /** 备考角色；未纳入备考计划时为空 */
  role?: StudyTargetRole;
  followedAt: string;
  statusHistory: FollowStatusEvent[];
  /** 放弃时记录的原因标签（如专业不符、地区太远、时间冲突） */
  abandonReason?: string;
}

/** 推荐列表中的单条卡片数据（匹配结果 + 快照信息，页面不直接算规则） */
export interface RecommendationCard {
  unit: ApplicationUnit;
  version: AnnouncementVersion;
  match: import("@/lib/matching/types").OpportunityMatchResult;
  follow?: FollowedOpportunity;
}

export const FOLLOW_STATUS_LABELS: Record<FollowStatus, string> = {
  considering: "考虑中",
  preparing: "准备报名",
  registered: "已报名",
  waiting_exam: "等待考试",
  abandoned: "已放弃",
  closed: "已结束",
};

export const STUDY_TARGET_ROLE_LABELS: Record<StudyTargetRole, string> = {
  primary: "重点准备",
  backup: "备选机会",
};
