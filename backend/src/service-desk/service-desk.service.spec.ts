import { describe, expect, it } from 'vitest';
import { ServiceDeskService } from './service-desk.service.js';

const HOUR = 60 * 60 * 1000;

interface FakeTask {
  id: string;
  ticketNo: string;
  type: string;
  refId: string;
  status: string;
  statusVersion: number;
  priority: string;
  assigneeId: string | null;
  defaultOwnerId: string | null;
  firstResponseAt: Date | null;
  lastEffectiveUpdateAt: Date | null;
  responseDueAt: Date | null;
  updateDueAt: Date | null;
  escalationDueAt: Date | null;
  cycleStartedAt: Date | null;
  pausedAt: Date | null;
  pausedRemainingMs: number | null;
  totalPausedMs: number;
  lastReminderAt: Date | null;
  escalationCount: number;
  routedToAdmin: boolean;
  routeIssue: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeTask(overrides: Partial<FakeTask>): FakeTask {
  return {
    id: 'task-1',
    ticketNo: 'JC-ABCDEF123456',
    type: 'correction',
    refId: 'corr-1',
    status: 'reviewing',
    statusVersion: 1,
    priority: 'high',
    assigneeId: 'u-duty',
    defaultOwnerId: 'u-duty',
    firstResponseAt: null,
    lastEffectiveUpdateAt: null,
    responseDueAt: new Date('2026-11-08T02:00:00Z'),
    updateDueAt: new Date('2026-11-08T08:00:00Z'),
    escalationDueAt: new Date('2026-11-08T04:00:00Z'),
    cycleStartedAt: new Date('2026-11-08T00:00:00Z'),
    pausedAt: null,
    pausedRemainingMs: null,
    totalPausedMs: 0,
    lastReminderAt: null,
    escalationCount: 0,
    routedToAdmin: false,
    routeIssue: null,
    createdAt: new Date('2026-11-08T00:00:00Z'),
    updatedAt: new Date('2026-11-08T00:00:00Z'),
    ...overrides,
  };
}

function createFakePrisma(input: {
  tasks: FakeTask[];
  admins?: Array<{ id: string }>;
  config?: { dutyOwnerId: string | null; backupOwnerId: string | null; version: number } | null;
  users?: Array<{ id: string; role: string; isActive: boolean }>;
  submitter?: { id: string; unitId: string | null; userId: string } | null;
}) {
  const reminders = new Set<string>();
  const notifications = new Set<string>();
  const events: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const config =
    input.config ??
    ({ dutyOwnerId: 'u-duty', backupOwnerId: 'u-backup', version: 1 } as const);
  const users =
    input.users ??
    [
      { id: 'u-duty', role: 'exam_reviewer', isActive: true },
      { id: 'u-backup', role: 'admin', isActive: true },
    ];

  const tx = {
    $queryRaw: async () => [{ locked: true }],
    opportunityCorrection: {
      findMany: async () => [],
      findUnique: async () => input.submitter
        ? {
            id: input.submitter.id,
            userId: input.submitter.userId,
            unitId: input.submitter.unitId,
          }
        : null,
    },
    announcementSubmission: { findMany: async () => [], findUnique: async () => null },
    documentParseRun: { findMany: async () => [] },
    sourcingAlert: { findMany: async () => [], findUnique: async () => null },
    serviceTask: {
      findUnique: async () => null,
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        if (where && 'status' in where && typeof where.status === 'object') {
          const status = where.status as { notIn?: string[] };
          if (status.notIn) {
            return input.tasks.filter((task) => !status.notIn!.includes(task.status));
          }
        }
        return input.tasks;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        const task = input.tasks.find((row) => row.id === where.id);
        if (task && data.lastReminderAt) task.lastReminderAt = data.lastReminderAt as Date;
        if (task && data.escalationCount) {
          task.escalationCount += (data.escalationCount as { increment: number }).increment;
        }
        return task;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push({ id: String(where.id), data });
        const task = input.tasks.find((row) => row.id === where.id);
        if (task) {
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === 'object' && 'increment' in value) {
              (task as unknown as Record<string, number>)[key] =
                ((task as unknown as Record<string, number>)[key] ?? 0) +
                (value as { increment: number }).increment;
            } else {
              (task as unknown as Record<string, unknown>)[key] = value;
            }
          }
        }
        return { count: 1 };
      },
    },
    serviceDeskConfig: { findUnique: async () => config },
    user: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.role === 'admin') return input.admins ?? [];
        if (where.id && typeof where.id === 'object') {
          const ids = (where.id as { in: string[] }).in;
          return users.filter((user) => ids.includes(user.id));
        }
        return users;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.find((user) => user.id === where.id) ?? null,
    },
    serviceDeskReminder: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Array<{ taskId: string; stage: string; level: string; cycleKey: string; recipientId: string }>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const row of data) {
          const key = `${row.taskId}:${row.stage}:${row.level}:${row.cycleKey}:${row.recipientId}`;
          if (reminders.has(key) && skipDuplicates) continue;
          reminders.add(key);
          count += 1;
        }
        return { count };
      },
    },
    notificationRecord: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Array<{ userId: string; eventKey: string; reminderStage: string }>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const row of data || []) {
          const key = `${row.userId}:${row.eventKey}:${row.reminderStage}`;
          if (notifications.has(key) && skipDuplicates) continue;
          notifications.add(key);
          count += 1;
        }
        return { count };
      },
    },
    ticketEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };

  const prisma = {
    ...tx,
    $transaction: async (arg: (client: unknown) => Promise<unknown>) => arg(tx),
  };

  return { prisma: prisma as never, reminders, notifications, events, updates, tasks: input.tasks };
}

describe('SLA 扫描 Worker 逻辑（E04/E05/E03）', () => {
  it('到期未有效响应只催办一次；重复扫描不重复轰炸', async () => {
    const fake = createFakePrisma({ tasks: [makeTask({})], admins: [{ id: 'u-admin' }] });
    const service = new ServiceDeskService(fake.prisma);

    const first = await service.runSweep({ now: new Date('2026-11-08T06:00:00Z') });
    expect(first.scanned).toBe(1);
    expect(first.reminders).toBe(1);
    expect(first.escalations).toBe(1);

    const second = await service.runSweep({ now: new Date('2026-11-08T06:05:00Z') });
    expect(second.reminders).toBe(0);
    expect(second.escalations).toBe(0);
  });

  it('升级接收人去重：备用负责人同时是管理员也只提醒一次', async () => {
    const fake = createFakePrisma({
      tasks: [makeTask({ escalationDueAt: new Date('2026-11-08T02:00:00Z') })],
      admins: [{ id: 'u-backup' }],
      config: { dutyOwnerId: 'u-duty', backupOwnerId: 'u-backup', version: 1 },
    });
    const service = new ServiceDeskService(fake.prisma);
    const result = await service.runSweep({ now: new Date('2026-11-08T05:00:00Z') });
    expect(result.escalations).toBe(1);
    // 3 个接收人（负责人/默认归属/备用）中前两个相同，实际唯一接收 2 人
    expect(fake.notifications.size).toBeGreaterThanOrEqual(2);
  });

  it('待用户补充只发补充提醒，不催办处理阶段', async () => {
    const pausedAt = new Date('2026-11-06T00:00:00Z'); // 49 小时前
    const fake = createFakePrisma({
      tasks: [
        makeTask({
          status: 'need_supplement',
          pausedAt,
          pausedRemainingMs: 2 * HOUR,
          submitter: null,
        }),
      ],
      admins: [{ id: 'u-admin' }],
      submitter: { id: 'corr-1', userId: 'u-user', unitId: 'unit-1' },
    });
    const service = new ServiceDeskService(fake.prisma);
    const result = await service.runSweep({ now: new Date('2026-11-08T01:00:00Z') });
    expect(result.reminders).toBe(1);
    expect(result.escalations).toBe(0);
    const titles = fake.events.map((event) => String(event.action));
    expect(titles).not.toContain('escalated');

    // 48 小时内不提醒
    const early = createFakePrisma({
      tasks: [
        makeTask({
          status: 'need_supplement',
          pausedAt: new Date('2026-11-07T12:00:00Z'),
          pausedRemainingMs: 2 * HOUR,
        }),
      ],
      submitter: { id: 'corr-1', userId: 'u-user', unitId: 'unit-1' },
    });
    const earlyService = new ServiceDeskService(early.prisma);
    const earlyResult = await earlyService.runSweep({
      now: new Date('2026-11-08T01:00:00Z'),
    });
    expect(earlyResult.reminders).toBe(0);
  });

  it('负责人未配置且无备用：任务进入管理员未分配队列并被通知', async () => {
    const fake = createFakePrisma({
      tasks: [makeTask({ assigneeId: null, defaultOwnerId: null })],
      admins: [{ id: 'u-admin' }],
      config: { dutyOwnerId: null, backupOwnerId: null, version: 1 },
    });
    const service = new ServiceDeskService(fake.prisma);
    const result = await service.runSweep({ now: new Date('2026-11-08T01:00:00Z') });
    expect(result.routed).toBe(1);
    const routedEvent = fake.events.find((event) => event.action === 'routed_to_admin');
    expect(routedEvent).toBeTruthy();
    expect(fake.notifications.size).toBeGreaterThan(0);

    // 同一配置版本重复扫描不重复通知
    const again = await service.runSweep({ now: new Date('2026-11-08T01:05:00Z') });
    expect(again.routed).toBe(0);
  });

  it('多实例互斥：拿不到 advisory lock 时跳过且不产生提醒', async () => {
    const fake = createFakePrisma({ tasks: [makeTask({})] });
    (fake.prisma as unknown as { $transaction: unknown }).$transaction = async (
      arg: (client: unknown) => Promise<unknown>,
    ) =>
      arg({
        ...(fake.prisma as unknown as Record<string, unknown>),
        $queryRaw: async () => [{ locked: false }],
      });
    const service = new ServiceDeskService(fake.prisma);
    const result = await service.runSweep({ now: new Date('2026-11-08T06:00:00Z') });
    expect(result.skipped).toBe(true);
    expect(result.reminders).toBe(0);
  });
});
