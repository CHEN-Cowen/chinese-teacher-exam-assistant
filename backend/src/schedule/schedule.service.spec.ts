import { describe, expect, it, vi, afterEach } from 'vitest';
import { ScheduleService } from './schedule.service.js';
import type { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';

// 用可控的公告目录替代真实 catalog，避免依赖场景数据
// （schedule.service 运行时读滚动时间轴 rolling-catalog，mock 直接拦截该模块）

vi.mock('../matching/rolling-catalog.js', () => {
  const timeline = {
    registrationStart: '2026-03-01',
    registrationEnd: '2026-03-15',
    paymentDeadline: '2026-03-18',
    writtenExamDate: '2026-04-10',
    pendingItems: ['面试时间另行通知'],
  };
  const unit = {
    id: 'ann-test-unit',
    code: 'U001',
    name: 'ann-test 第一小学',
    announcementId: 'ann-test',
    versionId: 'ann-test-v1',
    region: { code: 'cn-hz', province: '浙江', city: '杭州' },
    subject: 'chinese',
    stage: 'primary',
    headcount: 1,
    organizationType: 'institution_unified',
    employmentNature: 'permanent',
    allocation: 'direct_appointment',
    registerUrl: 'https://example.com/register',
    requirements: [],
  };
  const version = {
    id: 'ann-test-v1',
    announcementId: 'ann-test',
    versionNumber: 1,
    sourceKind: 'official_portal',
    publishedAt: '2026-01-01T00:00:00+08:00',
    officialSource: { kind: 'url', url: 'https://example.com' },
    timeline,
    units: [unit],
  };
  const announcement = {
    id: 'ann-test',
    code: 'ann-test',
    publisher: 'ann-test 教育局',
    region: { code: 'cn-hz', province: '浙江', city: '杭州' },
    title: 'ann-test 招聘公告',
    status: 'active',
    versions: [version],
  };
  return {
    CATALOG_ANNOUNCEMENTS: [announcement],
    getRollingCatalogAnnouncements: () => [announcement],
  };
});

type TimelineRow = {
  id: string;
  userId: string;
  unitId: string;
  announcementId: string;
  versionId: string;
  eventKey: string;
  kind: string;
  title: string;
  dateIso: string | null;
  status: string;
  changeHistory: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type NotificationRow = {
  id: string;
  userId: string;
  severity: string;
  title: string;
  body: string;
  eventKey: string | null;
  reminderStage: string | null;
  relatedUnitId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

type FollowRow = {
  id: string;
  userId: string;
  unitId: string;
  announcementId: string;
  versionId: string;
  status: string;
  role: string | null;
  followedAt: Date;
  statusHistory: unknown;
  abandonReason: string | null;
  remindersMuted: boolean;
};

function createFakePrisma() {
  const timelineEvents: TimelineRow[] = [];
  const notifications: NotificationRow[] = [];
  const follows: FollowRow[] = [];
  let idSeq = 1;
  const nextId = () => `id-${idSeq++}`;

  return {
    timelineEvents,
    notifications,
    follows,
    prisma: {
      followedOpportunity: {
        findMany: async ({ where }: { where?: { userId?: string; status?: { notIn?: string[] } } }) => {
          return follows.filter((f) => {
            if (where?.userId && f.userId !== where.userId) return false;
            if (where?.status?.notIn?.includes(f.status)) return false;
            return true;
          });
        },
        findUnique: async ({ where }: { where: { userId_unitId: { userId: string; unitId: string } } }) =>
          follows.find(
            (f) =>
              f.userId === where.userId_unitId.userId &&
              f.unitId === where.userId_unitId.unitId,
          ) ?? null,
        update: async ({ where, data }: { where: { id?: string; userId_unitId?: { userId: string; unitId: string } }; data: Record<string, unknown> }) => {
          const idx = follows.findIndex((f) =>
            where.id !== undefined
              ? f.id === where.id
              : f.userId === where.userId_unitId!.userId &&
                f.unitId === where.userId_unitId!.unitId,
          );
          Object.assign(follows[idx], data);
          return follows[idx];
        },
      },
      timelineEvent: {
        findUnique: async ({ where }: { where: { userId_eventKey: { userId: string; eventKey: string } } }) =>
          timelineEvents.find(
            (e) =>
              e.userId === where.userId_eventKey.userId &&
              e.eventKey === where.userId_eventKey.eventKey,
          ) ?? null,
        create: async ({ data }: { data: Omit<TimelineRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
          const row: TimelineRow = {
            ...data,
            id: nextId(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          timelineEvents.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<TimelineRow> }) => {
          const idx = timelineEvents.findIndex((e) => e.id === where.id);
          Object.assign(timelineEvents[idx], data, { updatedAt: new Date() });
          return timelineEvents[idx];
        },
        updateMany: async ({ where, data }: { where: { userId: string; status?: string; eventKey?: { notIn: string[] } }; data: Partial<TimelineRow> }) => {
          let count = 0;
          for (const e of timelineEvents) {
            if (e.userId !== where.userId) continue;
            if (where.status && e.status !== where.status) continue;
            if (where.eventKey?.notIn?.includes(e.eventKey)) continue;
            Object.assign(e, data);
            count++;
          }
          return { count };
        },
        findMany: async ({ where }: { where: { userId: string; status: string } }) =>
          timelineEvents.filter((e) => e.userId === where.userId && e.status === where.status),
      },
      notificationRecord: {
        create: async ({ data }: { data: Partial<NotificationRow> }) => {
          // 模拟唯一约束 (userId, eventKey, reminderStage)：三者都有值时检查重复
          if (data.eventKey && data.reminderStage) {
            const dup = notifications.find(
              (n) =>
                n.userId === data.userId &&
                n.eventKey === data.eventKey &&
                n.reminderStage === data.reminderStage,
            );
            if (dup) {
              // 抛出 P2002 唯一约束冲突
              throw new Prisma.PrismaClientKnownRequestError(
                'Unique constraint failed',
                { code: 'P2002', clientVersion: '6.19.3' },
              );
            }
          }
          const row: NotificationRow = {
            id: nextId(),
            userId: data.userId!,
            severity: data.severity!,
            title: data.title!,
            body: data.body!,
            eventKey: data.eventKey ?? null,
            reminderStage: data.reminderStage ?? null,
            relatedUnitId: data.relatedUnitId ?? null,
            readAt: null,
            createdAt: new Date(),
          };
          notifications.push(row);
          return row;
        },
        findMany: async ({ where }: { where: { userId: string } }) =>
          notifications
            .filter((n) => n.userId === where.userId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        updateMany: async ({ where, data }: { where: { userId: string; id?: string; readAt?: null }; data: Partial<NotificationRow> }) => {
          let count = 0;
          for (const n of notifications) {
            if (n.userId !== where.userId) continue;
            if (where.id && n.id !== where.id) continue;
            if (where.readAt === null && n.readAt !== null) continue;
            Object.assign(n, data);
            count++;
          }
          return { count };
        },
      },
    } as unknown as PrismaService,
  };
}

describe('ScheduleService', () => {
  // mock 的 rolling-catalog 在运行时带有可变 CATALOG_ANNOUNCEMENTS（见上方 vi.mock），
  // 但静态类型上没有该导出，这里用结构类型收窄以便恢复/篡改测试数据
  type MutableCatalog = {
    CATALOG_ANNOUNCEMENTS: Array<{
      versions: Array<{
        id: string;
        versionNumber: number;
        timeline: { registrationEnd?: string };
      }>;
    }>;
  };
  const importCatalog = () =>
    import('../matching/rolling-catalog.js') as unknown as Promise<MutableCatalog>;

  // 恢复被测试篡改的 catalog（公告时间变更测试会修改版本号与时间）
  afterEach(async () => {
    const { CATALOG_ANNOUNCEMENTS } = await importCatalog();
    const ann = CATALOG_ANNOUNCEMENTS[0]!;
    ann.versions[0]!.id = 'ann-test-v1';
    ann.versions[0]!.versionNumber = 1;
    ann.versions[0]!.timeline.registrationEnd = '2026-03-15';
  });

  const seedFollow = (
    follows: FollowRow[],
    userId = 'u1',
    remindersMuted = false,
  ) => {
    follows.push({
      id: `f-${userId}`,
      userId,
      unitId: 'ann-test-unit',
      announcementId: 'ann-test',
      versionId: 'ann-test-v1',
      status: 'considering',
      role: null,
      followedAt: new Date(),
      statusHistory: [],
      abandonReason: null,
      remindersMuted,
    });
  };

  it('同一事件重复同步只产生一条有效记录（幂等）', async () => {
    const { prisma, timelineEvents, follows } = createFakePrisma();
    seedFollow(follows, 'u1');
    const service = new ScheduleService(prisma);
    const userId = 'u1';

    // 第一次同步
    await service.syncEventsForUser(userId);
    const afterFirst = timelineEvents.filter((e) => e.userId === userId);
    expect(afterFirst.length).toBeGreaterThan(0);

    // 第二次同步：同一版本，不应新增
    await service.syncEventsForUser(userId);
    const afterSecond = timelineEvents.filter((e) => e.userId === userId);
    expect(afterSecond.length).toBe(afterFirst.length);

    // 每个 eventKey 只有一条
    const keys = new Map<string, number>();
    for (const e of afterSecond) keys.set(e.eventKey, (keys.get(e.eventKey) ?? 0) + 1);
    expect([...keys.values()].every((c) => c === 1)).toBe(true);
  });

  it('公告时间变化后更新同一记录并追加 changeHistory，且产生通知', async () => {
    const { prisma, timelineEvents, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1');
    const userId = 'u1';
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser(userId);
    const regEnd = timelineEvents.find((e) => e.kind === 'registration_end');
    expect(regEnd).toBeDefined();
    expect(regEnd!.dateIso).toBe('2026-03-15');
    expect((regEnd!.changeHistory as unknown[]).length).toBe(0);

    // 模拟新版本变更：直接改 catalog 里的 timeline
    // 这里重新 mock 较复杂，改为直接修改已落库记录的 versionId，再同步时版本变化触发更新
    // 更简单：手动把 catalog 时间改了再同步
    // 由于 vi.mock 是模块级常量，我们直接修改 timelineEvents 的 versionId 模拟旧版本
    // 然后让 sync 检测到 versionId 不同（catalog 的 versionId 仍是 v1）
    // —— 这不会触发变更。改为：通过修改 catalog 模拟。
    // 此处采用直接 mutate 公告对象（因为 mock 返回的是数组引用）
    const { CATALOG_ANNOUNCEMENTS } = await importCatalog();
    const ann = CATALOG_ANNOUNCEMENTS[0]!;
    ann.versions[0]!.timeline.registrationEnd = '2026-03-10';
    ann.versions[0]!.id = 'ann-test-v2';
    ann.versions[0]!.versionNumber = 2;

    await service.syncEventsForUser(userId);
    const updated = timelineEvents.find((e) => e.kind === 'registration_end');
    expect(updated).toBeDefined();
    expect(updated!.dateIso).toBe('2026-03-10');
    expect(updated!.versionId).toBe('ann-test-v2');
    const history = updated!.changeHistory as { dateIso: string | null }[];
    expect(history.length).toBe(1);
    expect(history[0].dateIso).toBe('2026-03-15');

    // 截止日期变化产生 must_handle 通知（取该事件最近一条通知）
    const notes = notifications.filter((n) => n.eventKey === updated!.eventKey);
    const latest = notes[notes.length - 1];
    expect(latest?.severity).toBe('must_handle');
  });

  it('待定时间不生成伪精确提醒（pending_notice 的 dateIso 恒为 null）', async () => {
    const { prisma, timelineEvents, follows } = createFakePrisma();
    seedFollow(follows, 'u1');
    const service = new ScheduleService(prisma);
    await service.syncEventsForUser('u1');
    const pending = timelineEvents.filter((e) => e.kind === 'pending_notice');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((e) => e.dateIso === null)).toBe(true);
  });

  it('关闭单个机会提醒不影响其他机会（mute 单元不产生通知但事件仍在）', async () => {
    const { prisma, follows, timelineEvents, notifications } = createFakePrisma();
    // 两个用户关注同一机会，一个静音一个不静音
    follows.push({
      id: 'f1', userId: 'muted-user', unitId: 'ann-test-unit',
      announcementId: 'ann-test', versionId: 'ann-test-v1',
      status: 'considering', role: null, followedAt: new Date(),
      statusHistory: [], abandonReason: null, remindersMuted: true,
    });
    follows.push({
      id: 'f2', userId: 'normal-user', unitId: 'ann-test-unit',
      announcementId: 'ann-test', versionId: 'ann-test-v1',
      status: 'considering', role: null, followedAt: new Date(),
      statusHistory: [], abandonReason: null, remindersMuted: false,
    });
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('muted-user');
    await service.syncEventsForUser('normal-user');

    // 两个用户都有事件
    expect(timelineEvents.filter((e) => e.userId === 'muted-user').length).toBeGreaterThan(0);
    expect(timelineEvents.filter((e) => e.userId === 'normal-user').length).toBeGreaterThan(0);

    // 静音用户无通知，正常用户有通知
    expect(notifications.filter((n) => n.userId === 'muted-user').length).toBe(0);
    expect(notifications.filter((n) => n.userId === 'normal-user').length).toBeGreaterThan(0);
  });

  it('无关注记录时返回空日程（空态可恢复）', async () => {
    const { prisma, timelineEvents } = createFakePrisma();
    const service = new ScheduleService(prisma);
    const schedule = await service.getSchedule('lonely-user');
    expect(schedule.events).toHaveLength(0);
    expect(schedule.mutedUnitIds).toHaveLength(0);
    expect(timelineEvents.filter((e) => e.userId === 'lonely-user')).toHaveLength(0);
  });

  it('已不在当前版本的事件标记为 superseded（保留记录不删除）', async () => {
    const { prisma, timelineEvents, follows } = createFakePrisma();
    seedFollow(follows, 'u1');
    const service = new ScheduleService(prisma);
    const userId = 'u1';
    await service.syncEventsForUser(userId);

    // 手动塞入一个不存在于 catalog 的事件
    timelineEvents.push({
      id: 'orphan', userId, unitId: 'ann-test-unit', announcementId: 'ann-test',
      versionId: 'ann-test-v1', eventKey: 'ann-test-unit-ghost', kind: 'score',
      title: '已取消的成绩发布', dateIso: '2026-05-01', status: 'active',
      changeHistory: [], createdAt: new Date(), updatedAt: new Date(),
    });

    await service.syncEventsForUser(userId);
    const orphan = timelineEvents.find((e) => e.id === 'orphan');
    expect(orphan?.status).toBe('superseded');
  });
});
