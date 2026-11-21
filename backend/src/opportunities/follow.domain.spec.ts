import { describe, expect, it } from 'vitest';
import {
  assignRole,
  canTransition,
  hasNewerVersion,
  transitionFollow,
  type FollowRecord,
} from './follow.domain.js';

const NOW = '2026-10-04T12:30:00+08:00';

function makeFollow(overrides: Partial<FollowRecord> = {}): FollowRecord {
  return {
    id: 'follow-1',
    userId: 'user-1',
    unitId: 'unit-hangzhou-01',
    announcementId: 'ann-hangzhou',
    versionId: 'ann-hangzhou-v1',
    status: 'considering',
    role: null,
    followedAt: NOW,
    statusHistory: [{ status: 'considering', at: NOW }],
    abandonReason: null,
    materialStatuses: null,
    consultationNotes: null,
    version: 0,
    remindersMuted: false,
    ...overrides,
  };
}

describe('关注状态机', () => {
  it('允许沿合法边流转，且历史只追加', () => {
    const next = transitionFollow(makeFollow(), 'preparing', NOW, '用户手动');
    expect(next.status).toBe('preparing');
    expect(next.statusHistory).toHaveLength(2);
    expect(next.statusHistory[1]).toEqual({
      status: 'preparing',
      at: NOW,
      note: '用户手动',
    });
    // 不可变：原对象未被修改
    expect(makeFollow().status).toBe('considering');
  });

  it('收藏初始为 considering，不能直接跳到 registered', () => {
    expect(canTransition('considering', 'preparing')).toBe(true);
    expect(canTransition('considering', 'registered')).toBe(false);
    expect(() =>
      transitionFollow(makeFollow(), 'registered', NOW),
    ).toThrow(/不允许/);
  });

  it('closed 是终态，不能改回在报状态', () => {
    expect(canTransition('closed', 'considering')).toBe(false);
    expect(canTransition('closed', 'preparing')).toBe(false);
  });

  it('等待考试（D07）：只能从已报名进入，只能去向已结束/不再考虑', () => {
    expect(canTransition('registered', 'waiting_exam')).toBe(true);
    expect(canTransition('waiting_exam', 'closed')).toBe(true);
    expect(canTransition('waiting_exam', 'abandoned')).toBe(true);
    // 不允许跳过报名直接等待考试，也不允许从等待考试退回在报状态
    expect(canTransition('considering', 'waiting_exam')).toBe(false);
    expect(canTransition('preparing', 'waiting_exam')).toBe(false);
    expect(canTransition('waiting_exam', 'considering')).toBe(false);
    expect(canTransition('waiting_exam', 'preparing')).toBe(false);
    const waiting = transitionFollow(
      makeFollow({ status: 'registered' }),
      'waiting_exam',
      NOW,
    );
    expect(waiting.status).toBe('waiting_exam');
    expect(waiting.statusHistory).toHaveLength(2);
  });

  it('放弃时记录原因，再恢复关注时清空原因', () => {
    const abandoned = transitionFollow(
      makeFollow(),
      'abandoned',
      NOW,
      undefined,
      '时间冲突',
    );
    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.abandonReason).toBe('时间冲突');
    const reconsidered = transitionFollow(abandoned, 'considering', NOW);
    expect(reconsidered.abandonReason).toBeNull();
  });

  it('相同状态流转返回同一对象（无事件噪音）', () => {
    const follow = makeFollow();
    expect(transitionFollow(follow, 'considering', NOW)).toBe(follow);
  });
});

describe('主要备考目标唯一性', () => {
  it('设置新 primary 时原 primary 自动降为 backup，其余记录不动', () => {
    const follows = [
      makeFollow({ id: 'a', unitId: 'unit-a', role: 'primary' }),
      makeFollow({ id: 'b', unitId: 'unit-b', role: null }),
      makeFollow({ id: 'c', unitId: 'unit-c', role: 'backup' }),
    ];
    const next = assignRole(follows, 'b', 'primary');
    expect(next.find((f) => f.id === 'a')?.role).toBe('backup');
    expect(next.find((f) => f.id === 'b')?.role).toBe('primary');
    expect(next.find((f) => f.id === 'c')?.role).toBe('backup');
  });

  it('设置 backup 不影响现有 primary', () => {
    const follows = [
      makeFollow({ id: 'a', unitId: 'unit-a', role: 'primary' }),
      makeFollow({ id: 'b', unitId: 'unit-b', role: null }),
    ];
    const next = assignRole(follows, 'b', 'backup');
    expect(next.find((f) => f.id === 'a')?.role).toBe('primary');
    expect(next.find((f) => f.id === 'b')?.role).toBe('backup');
  });
});

describe('版本过时提示', () => {
  it('关注版本与当前版本不一致时提示有更新，但不改写记录', () => {
    const follow = makeFollow({ versionId: 'ann-hefei-v1' });
    expect(hasNewerVersion(follow, 'ann-hefei-v2')).toBe(true);
    expect(follow.versionId).toBe('ann-hefei-v1');
  });
});
