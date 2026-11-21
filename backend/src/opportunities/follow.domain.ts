import type { MaterialStatus } from '../matching/types.js';

/**
 * 用户关注关系的纯函数规则（PRD 7.5，与前端 opportunities/domain 同构）。
 *
 * - 状态流转只能沿允许的边移动，历史只追加；
 * - “已结束”为终态，用户不能把已结束改回在报；
 * - 主要目标同一时间只允许一个：设置新的 primary 时旧的自动降为 backup；
 * - 关注（收藏）的初始状态恒为 considering，不自动等于“准备报名”。
 */

export type FollowStatus =
  | 'considering'
  | 'preparing'
  | 'registered'
  | 'waiting_exam'
  | 'abandoned'
  | 'closed';

export type StudyTargetRole = 'primary' | 'backup';

export interface FollowStatusEvent {
  status: FollowStatus;
  at: string;
  note?: string;
}

/** 存储无关的关注记录形状（Prisma 行序列化后即该形状） */
export interface FollowRecord {
  id: string;
  userId: string;
  unitId: string;
  announcementId: string;
  versionId: string;
  status: FollowStatus;
  role: StudyTargetRole | null;
  followedAt: string;
  statusHistory: FollowStatusEvent[];
  abandonReason: string | null;
  /** 报名材料完成状态：{ [materialItemId]: MaterialStatus } */
  materialStatuses: Record<string, MaterialStatus> | null;
  /** 用户自行记录的官方咨询结论：{ [dimensionKey]: note } */
  consultationNotes: Record<string, string> | null;
  /** 乐观锁版本号 */
  version: number;
  /** 是否已关闭该机会的站内提醒 */
  remindersMuted: boolean;
}

/** 允许的状态流转图（waiting_exam 为 D07 新增：已报名 → 等待考试 → 已结束/不再考虑） */
const ALLOWED_TRANSITIONS: Record<FollowStatus, readonly FollowStatus[]> = {
  considering: ['preparing', 'abandoned', 'closed'],
  preparing: ['registered', 'abandoned', 'considering', 'closed'],
  registered: ['waiting_exam', 'closed', 'abandoned'],
  waiting_exam: ['closed', 'abandoned'],
  abandoned: ['considering', 'preparing', 'closed'],
  closed: [],
};

export const FOLLOW_STATUSES: readonly FollowStatus[] = [
  'considering',
  'preparing',
  'registered',
  'waiting_exam',
  'abandoned',
  'closed',
];

export function isFollowStatus(value: unknown): value is FollowStatus {
  return (
    typeof value === 'string' &&
    (FOLLOW_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransition(
  from: FollowStatus,
  to: FollowStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * 应用一次状态流转（不可变：返回新对象，不修改入参）。
 * 非法流转抛错，避免静默产生矛盾状态。
 */
export function transitionFollow(
  follow: FollowRecord,
  next: FollowStatus,
  at: string,
  note?: string,
  abandonReason?: string | null,
): FollowRecord {
  if (next === follow.status) return follow;
  if (!canTransition(follow.status, next)) {
    throw new Error(`不允许从 ${follow.status} 流转到 ${next}`);
  }
  const event: FollowStatusEvent = { status: next, at };
  if (note) event.note = note;
  return {
    ...follow,
    status: next,
    // 仅在放弃时保留原因；流转到其他状态时清空历史放弃原因
    abandonReason: next === 'abandoned' ? (abandonReason ?? null) : null,
    statusHistory: [...follow.statusHistory, event],
    version: follow.version + 1,
  };
}

/** 设置某材料项的完成状态（不可变）。同状态不递增版本（幂等）。 */
export function applyMaterialStatus(
  follow: FollowRecord,
  itemId: string,
  status: MaterialStatus,
): FollowRecord {
  const current = follow.materialStatuses?.[itemId];
  if (current === status) return follow;
  return {
    ...follow,
    materialStatuses: { ...follow.materialStatuses, [itemId]: status },
    version: follow.version + 1,
  };
}

/** 记录某维度的官方咨询结论（不可变）。空字符串删除该条。 */
export function applyConsultationNote(
  follow: FollowRecord,
  dimensionKey: string,
  note: string,
): FollowRecord {
  const notes = { ...follow.consultationNotes };
  if (note.trim() === '') {
    if (!(dimensionKey in notes)) return follow;
    delete notes[dimensionKey];
  } else {
    if (notes[dimensionKey] === note) return follow;
    notes[dimensionKey] = note;
  }
  return {
    ...follow,
    consultationNotes: Object.keys(notes).length > 0 ? notes : null,
    version: follow.version + 1,
  };
}

/**
 * 设置备考角色（纯函数）。同一用户的主要目标唯一：
 * 全部关注记录中若已有另一个 primary，自动降为 backup。
 */
export function assignRole(
  follows: FollowRecord[],
  followId: string,
  role: StudyTargetRole,
): FollowRecord[] {
  return follows.map((follow) => {
    if (follow.id === followId) return { ...follow, role };
    if (role === 'primary' && follow.role === 'primary') {
      return { ...follow, role: 'backup' };
    }
    return follow;
  });
}

/** 关注记录指向的版本是否已过时（只检测，不改写记录） */
export function hasNewerVersion(
  follow: FollowRecord,
  currentVersionId: string,
): boolean {
  return follow.versionId !== currentVersionId;
}
