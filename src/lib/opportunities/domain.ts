/**
 * 用户关注关系的纯函数规则（PRD 6.5 / 7.5）。
 *
 * - 状态流转只能沿允许的边移动，历史只追加；
 * - “已结束”由系统在公告截止/失效后设置，用户不能把已结束改回在报；
 * - 主要目标同一时间只允许一个：设置新的 primary 时旧的降为 backup；
 * - 公告版本更新不改写用户记录里的 versionId，由服务层产生“有更新版本”提示。
 */
import type { FollowStatus, FollowStatusEvent, FollowedOpportunity, StudyTargetRole } from "./types";

/** 允许的状态流转图（waiting_exam 为 D07 新增：已报名 → 等待考试 → 已结束/已放弃） */
const ALLOWED_TRANSITIONS: Record<FollowStatus, FollowStatus[]> = {
  considering: ["preparing", "abandoned", "closed"],
  preparing: ["registered", "abandoned", "considering", "closed"],
  registered: ["waiting_exam", "closed", "abandoned"],
  waiting_exam: ["closed", "abandoned"],
  abandoned: ["considering", "preparing", "closed"],
  closed: [],
};

export function canTransition(from: FollowStatus, to: FollowStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * 应用一次状态流转（不可变：返回新对象，不修改入参）。
 * 非法流转抛错，避免静默产生矛盾状态。
 */
export function transitionFollow(
  follow: FollowedOpportunity,
  next: FollowStatus,
  at: string,
  note?: string,
): FollowedOpportunity {
  if (next === follow.status) return follow;
  if (!canTransition(follow.status, next)) {
    throw new Error(`不允许从 ${follow.status} 流转到 ${next}`);
  }
  const event: FollowStatusEvent = { status: next, at, note };
  return {
    ...follow,
    status: next,
    abandonReason: next === "abandoned" ? follow.abandonReason : undefined,
    statusHistory: [...follow.statusHistory, event],
  };
}

/** 创建关注记录 */
export function createFollow(input: {
  id: string;
  userId: string;
  unitId: string;
  announcementId: string;
  versionId: string;
  at: string;
}): FollowedOpportunity {
  return {
    id: input.id,
    userId: input.userId,
    unitId: input.unitId,
    announcementId: input.announcementId,
    versionId: input.versionId,
    status: "considering",
    followedAt: input.at,
    statusHistory: [{ status: "considering", at: input.at }],
  };
}

/**
 * 设置备考角色。同一用户的主要目标唯一：
 * 传入的全部关注记录中若已有另一个 primary，自动降为 backup。
 */
export function assignRole(
  follows: FollowedOpportunity[],
  followId: string,
  role: StudyTargetRole,
): FollowedOpportunity[] {
  return follows.map((follow) => {
    if (follow.id === followId) return { ...follow, role };
    if (role === "primary" && follow.role === "primary") return { ...follow, role: "backup" };
    return follow;
  });
}

/**
 * 检测关注记录指向的公告版本是否已过时：
 * 仅返回“是否有更新”，不覆盖用户记录。
 */
export function hasNewerVersion(follow: FollowedOpportunity, currentVersionId: string): boolean {
  return follow.versionId !== currentVersionId;
}
