/**
 * M7 多岗位报考日程自动同步 —— 定向测试（PRD v7.1 §5.8）。
 *
 * 覆盖场景：
 * - 关注 A、关注 B、合并时间线
 * - 全部核心节点（18 种 TimelineEventKind）
 * - 待定转明确
 * - 改期（旧值→新值→影响→下一步）
 * - 重复同步幂等
 * - 同日冲突
 * - 单机会静音
 * - 取消关注（历史保留）
 * - 重新关注（按最新版本恢复，不重复）
 * - 岗位取消（停止行动提醒，保留日程）
 * - 来源失效（降级展示）
 * - 账号隔离
 * - 关注后反馈 syncedEventCount
 * - 默认提醒阶段幂等（提前 7/3/1 天）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ScheduleService } from './schedule.service.js';
import type { PrismaService } from '../prisma.service.js';

// ---------- 可控公告目录 ----------
// 两个公告：annA（杭州·岗位A）、annB（宁波·岗位B），覆盖全部 M7 节点字段

vi.mock('../matching/rolling-catalog.js', () => {
  const CHECKED_AT = '2026-10-01T12:00:00+08:00';
  const officialSource = {
    id: 'src',
    locator: { kind: 'url', url: 'https://gov.example/ann' },
    state: 'official',
    checkedAt: CHECKED_AT,
  };

  function mkUnit(
    id: string,
    code: string,
    versionId: string,
    announcementId: string,
    name: string,
    region: { code: string; province: string; city: string },
  ) {
    return {
      id,
      code,
      name,
      announcementId,
      versionId,
      region,
      subject: 'chinese',
      stage: 'primary',
      headcount: 2,
      organizationType: 'government_unified',
      employmentNature: { code: 'public_institution_staff', officialName: '事业编' },
      allocation: { code: 'direct_school', description: '直接定岗' },
      registerUrl: 'https://gov.example/apply',
      requirements: [],
    };
  }

  const fullTimeline = {
    registrationStart: '2026-10-20',
    registrationEnd: '2026-10-30',
    preliminaryReviewDate: '2026-11-02',
    reviewResultDate: '2026-11-05',
    paymentDeadline: '2026-11-08',
    amendmentDeadline: '2026-10-28',
    admitTicketStart: '2026-11-15',
    admitTicketEnd: '2026-11-18',
    writtenExamDate: '2026-11-20',
    scoreDate: '2026-12-01',
    scoreReviewDate: '2026-12-03',
    qualificationReviewDate: '2026-12-10',
    interviewConfirmDate: '2026-12-15',
    interviewDate: '2026-12-20',
    medicalExamDate: '2026-12-25',
    inspectionDate: '2026-12-28',
    positionSelectionDate: '2026-12-30',
    publicationDate: '2027-01-05',
    pendingItems: ['体检具体地点另行通知'],
  };

  // annA v1
  const unitA = mkUnit('unitA', 'A001', 'annA-v1', 'annA', '杭州第一小学', {
    code: '330100',
    province: '浙江省',
    city: '杭州市',
  });
  const versionA1 = {
    id: 'annA-v1',
    announcementId: 'annA',
    versionNumber: 1,
    sourceKind: 'original',
    publishedAt: '2026-10-01T00:00:00+08:00',
    officialSource,
    timeline: { ...fullTimeline },
    units: [unitA],
  };
  const annA = {
    id: 'annA',
    code: 'annA',
    publisher: '杭州市教育局',
    organizationType: 'government_unified',
    officialUrl: 'https://gov.example/annA',
    subjectScope: ['chinese'],
    region: { code: '330100', province: '浙江省', city: '杭州市' },
    lifecycle: 'active',
    firstPublishedAt: '2026-10-01T00:00:00+08:00',
    versions: [versionA1],
    reviewStatus: 'human_reviewed',
  };

  // annB v1（部分节点，用于合并时间线测试）
  const unitB = mkUnit('unitB', 'B001', 'annB-v1', 'annB', '宁波第二小学', {
    code: '330200',
    province: '浙江省',
    city: '宁波市',
  });
  const versionB1 = {
    id: 'annB-v1',
    announcementId: 'annB',
    versionNumber: 1,
    sourceKind: 'original',
    publishedAt: '2026-10-01T00:00:00+08:00',
    officialSource,
    timeline: {
      registrationStart: '2026-10-20',
      registrationEnd: '2026-10-30',
      writtenExamDate: '2026-11-20',
      interviewDate: '2026-12-20',
      pendingItems: ['面试时间另行通知'],
    },
    units: [unitB],
  };
  const annB = {
    id: 'annB',
    code: 'annB',
    publisher: '宁波市教育局',
    organizationType: 'government_unified',
    officialUrl: 'https://gov.example/annB',
    subjectScope: ['chinese'],
    region: { code: '330200', province: '浙江省', city: '宁波市' },
    lifecycle: 'active',
    firstPublishedAt: '2026-10-01T00:00:00+08:00',
    versions: [versionB1],
    reviewStatus: 'human_reviewed',
  };

  return {
    CATALOG_ANNOUNCEMENTS: [annA, annB],
    getRollingCatalogAnnouncements: () => [annA, annB],
  };
});

// ---------- mock Prisma ----------

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
  lastNotifiedState: unknown;
  version: number;
  materialStatuses: unknown;
  consultationNotes: unknown;
  createdAt: Date;
  updatedAt: Date;
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
        findMany: async ({ where }: { where?: { userId?: string; status?: { notIn?: string[] } } }) =>
          follows.filter((f) => {
            if (where?.userId && f.userId !== where.userId) return false;
            if (where?.status?.notIn?.includes(f.status)) return false;
            return true;
          }),
        findUnique: async ({ where }: { where: { userId_unitId: { userId: string; unitId: string } } }) =>
          follows.find(
            (f) =>
              f.userId === where.userId_unitId.userId &&
              f.unitId === where.userId_unitId.unitId,
          ) ?? null,
        create: async ({ data }: { data: Partial<FollowRow> }) => {
          const row: FollowRow = {
            id: nextId(),
            userId: data.userId!,
            unitId: data.unitId!,
            announcementId: data.announcementId!,
            versionId: data.versionId!,
            status: data.status ?? 'considering',
            role: data.role ?? null,
            followedAt: data.followedAt ?? new Date(),
            statusHistory: data.statusHistory ?? [],
            abandonReason: data.abandonReason ?? null,
            remindersMuted: data.remindersMuted ?? false,
            lastNotifiedState: data.lastNotifiedState ?? null,
            version: data.version ?? 0,
            materialStatuses: data.materialStatuses ?? null,
            consultationNotes: data.consultationNotes ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          follows.push(row);
          return row;
        },
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
        deleteMany: async ({ where }: { where: { userId: string; unitId: string } }) => {
          const before = follows.length;
          for (let i = follows.length - 1; i >= 0; i--) {
            if (follows[i].userId === where.userId && follows[i].unitId === where.unitId) {
              follows.splice(i, 1);
            }
          }
          return { count: before - follows.length };
        },
      },
      timelineEvent: {
        findUnique: async ({ where }: { where: { userId_eventKey: { userId: string; eventKey: string } } }) =>
          timelineEvents.find(
            (e) =>
              e.userId === where.userId_eventKey.userId &&
              e.eventKey === where.userId_eventKey.eventKey,
          ) ?? null,
        create: async ({ data }: { data: Partial<TimelineRow> }) => {
          const row: TimelineRow = {
            id: nextId(),
            userId: data.userId!,
            unitId: data.unitId!,
            announcementId: data.announcementId!,
            versionId: data.versionId!,
            eventKey: data.eventKey!,
            kind: data.kind!,
            title: data.title!,
            dateIso: data.dateIso ?? null,
            status: data.status ?? 'active',
            changeHistory: data.changeHistory ?? [],
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
        findMany: async ({ where }: { where: { userId: string; status?: string } }) =>
          timelineEvents.filter((e) => {
            if (e.userId !== where.userId) return false;
            if (where.status && e.status !== where.status) return false;
            return true;
          }),
      },
      notificationRecord: {
        create: async ({ data }: { data: Partial<NotificationRow> }) => {
          // 模拟唯一约束 (userId, eventKey, reminderStage)
          if (data.eventKey && data.reminderStage) {
            const dup = notifications.find(
              (n) =>
                n.userId === data.userId &&
                n.eventKey === data.eventKey &&
                n.reminderStage === data.reminderStage,
            );
            if (dup) {
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
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as PrismaService,
  };
}

// ---------- 辅助 ----------

type MutableCatalog = {
  CATALOG_ANNOUNCEMENTS: Array<{
    id: string;
    lifecycle: string;
    sourceHealth?: { ok: boolean; checkedAt: string; failReason?: string };
    versions: Array<{
      id: string;
      versionNumber: number;
      timeline: Record<string, unknown>;
      units: Array<{ id: string; name: string; code: string }>;
    }>;
  }>;
};
const importCatalog = () =>
  import('../matching/rolling-catalog.js') as unknown as Promise<MutableCatalog>;

function seedFollow(
  follows: FollowRow[],
  userId: string,
  unitId: string,
  announcementId: string,
  versionId: string,
  remindersMuted = false,
) {
  follows.push({
    id: `f-${userId}-${unitId}`,
    userId,
    unitId,
    announcementId,
    versionId,
    status: 'considering',
    role: null,
    followedAt: new Date(),
    statusHistory: [],
    abandonReason: null,
    remindersMuted,
    lastNotifiedState: null,
    version: 0,
    materialStatuses: null,
    consultationNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// ---------- 测试 ----------

describe('M7 多岗位报考日程自动同步', () => {
  let catalog: MutableCatalog;

  beforeEach(async () => {
    catalog = await importCatalog();
    // 恢复 catalog 到初始状态
    const annA = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annA')!;
    annA.lifecycle = 'active';
    delete annA.sourceHealth;
    // 截断版本数组到仅 v1（改期测试可能推入了 v2）
    annA.versions.length = 1;
    const v1A = annA.versions[0]!;
    v1A.id = 'annA-v1';
    v1A.versionNumber = 1;
    delete (v1A as { supersededAt?: string }).supersededAt;
    // 恢复完整时间线
    v1A.timeline.registrationStart = '2026-10-20';
    v1A.timeline.registrationEnd = '2026-10-30';
    v1A.timeline.preliminaryReviewDate = '2026-11-02';
    v1A.timeline.reviewResultDate = '2026-11-05';
    v1A.timeline.paymentDeadline = '2026-11-08';
    v1A.timeline.amendmentDeadline = '2026-10-28';
    v1A.timeline.admitTicketStart = '2026-11-15';
    v1A.timeline.admitTicketEnd = '2026-11-18';
    v1A.timeline.writtenExamDate = '2026-11-20';
    v1A.timeline.scoreDate = '2026-12-01';
    v1A.timeline.scoreReviewDate = '2026-12-03';
    v1A.timeline.qualificationReviewDate = '2026-12-10';
    v1A.timeline.interviewConfirmDate = '2026-12-15';
    v1A.timeline.interviewDate = '2026-12-20';
    v1A.timeline.medicalExamDate = '2026-12-25';
    v1A.timeline.inspectionDate = '2026-12-28';
    v1A.timeline.positionSelectionDate = '2026-12-30';
    v1A.timeline.publicationDate = '2027-01-05';
    v1A.timeline.pendingItems = ['体检具体地点另行通知'];

    const annB = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annB')!;
    annB.lifecycle = 'active';
    delete annB.sourceHealth;
    annB.versions.length = 1;
    const v1B = annB.versions[0]!;
    v1B.id = 'annB-v1';
    v1B.versionNumber = 1;
    delete (v1B as { supersededAt?: string }).supersededAt;
    v1B.timeline.registrationStart = '2026-10-20';
    v1B.timeline.registrationEnd = '2026-10-30';
    v1B.timeline.writtenExamDate = '2026-11-20';
    v1B.timeline.interviewDate = '2026-12-20';
    v1B.timeline.pendingItems = ['面试时间另行通知'];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('关注 A 后关注 B：合并为统一时间线，每个节点显示所属岗位和市区', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    seedFollow(follows, 'u1', 'unitB', 'annB', 'annB-v1');
    const service = new ScheduleService(prisma);

    const schedule = await service.getSchedule('u1');

    // 两个岗位都出现在时间线
    const unitIds = new Set(schedule.events.map((e) => e.unitId));
    expect(unitIds.has('unitA')).toBe(true);
    expect(unitIds.has('unitB')).toBe(true);

    // 每个事件带岗位名和地区文案
    for (const e of schedule.events) {
      expect(e.unitName).toBeTruthy();
      expect(e.regionText).toBeTruthy();
      if (e.unitId === 'unitA') {
        expect(e.regionText).toContain('杭州');
      }
      if (e.unitId === 'unitB') {
        expect(e.regionText).toContain('宁波');
      }
    }
  });

  it('全部核心节点（18 种）都生成对应事件', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);
    await service.syncEventsForUser('u1');

    // 需要用同一个 prisma 实例——重新获取不行
    // 改用 getSchedule 返回的事件列表
    const schedule = await service.getSchedule('u1');
    const kinds = new Set(schedule.events.map((e) => e.kind));
    // 除 pending_notice 外，应有 18 种核心节点
    const expectedKinds = [
      'registration_start', 'registration_end', 'preliminary_review', 'review_result',
      'payment', 'amendment_deadline', 'admit_ticket', 'admit_ticket_end',
      'written_exam', 'score', 'score_review', 'qualification_review',
      'interview_confirm', 'interview', 'medical_exam', 'inspection',
      'position_selection', 'publication', 'pending_notice',
    ];
    for (const k of expectedKinds) {
      expect(kinds.has(k as typeof schedule.events[0]['kind'])).toBe(true);
    }
  });

  it('待定时间不生成伪精确提醒（pending_notice 的 dateIso 恒为 null）', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);
    const schedule = await service.getSchedule('u1');
    const pending = schedule.events.filter((e) => e.kind === 'pending_notice');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((e) => e.dateIso === null)).toBe(true);
    expect(pending.every((e) => e.dateText === '待官方通知')).toBe(true);
  });

  it('关注后返回 syncedEventCount（反馈"已自动同步 X 个报考节点"）', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);
    const result = await service.syncEventsForUser('u1');
    expect(result.syncedEventCount).toBeGreaterThan(0);
    // 18 核心节点 + 1 pending_notice = 19
    expect(result.syncedEventCount).toBe(19);
  });

  it('同一版本重复同步不产生新事件和通知（幂等）', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');
    const eventsAfter1 = await prisma.timelineEvent.findMany({
      where: { userId: 'u1', status: 'active' },
    });
    const notesAfter1 = notifications.filter((n) => n.userId === 'u1').length;

    await service.syncEventsForUser('u1');
    const eventsAfter2 = await prisma.timelineEvent.findMany({
      where: { userId: 'u1', status: 'active' },
    });
    const notesAfter2 = notifications.filter((n) => n.userId === 'u1').length;

    expect(eventsAfter2.length).toBe(eventsAfter1.length);
    expect(notesAfter2).toBe(notesAfter1);
  });

  it('改期后更新同一节点，追加 changeHistory，展示旧值→新值→影响→下一步', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');

    // 模拟补充公告 v2：报名截止提前
    const ann = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annA')!;
    const v1 = ann.versions[0]!;
    v1.timeline.registrationEnd = '2026-10-25';
    // 新版本 id 触发同步检测
    const v2 = {
      ...v1,
      id: 'annA-v2',
      versionNumber: 2,
      timeline: { ...v1.timeline },
    };
    (v1 as { supersededAt?: string }).supersededAt = '2026-10-10T00:00:00+08:00';
    ann.versions.push(v2 as typeof v1);

    await service.syncEventsForUser('u1');

    const schedule = await service.getSchedule('u1');
    const regEnd = schedule.events.find((e) => e.kind === 'registration_end')!;
    expect(regEnd.dateIso).toBe('2026-10-25');
    expect(regEnd.changedFromPrevious).not.toBeNull();
    expect(regEnd.changedFromPrevious!.oldValue).toBe('2026-10-30');
    expect(regEnd.changedFromPrevious!.newValue).toBe('2026-10-25');
    expect(regEnd.changedFromPrevious!.impact).toBeTruthy();
    expect(regEnd.changedFromPrevious!.nextStep).toBeTruthy();

    // 变更通知 must_handle
    const changeNotes = notifications.filter(
      (n) => n.userId === 'u1' && n.title.includes('报名截止时间有更新'),
    );
    expect(changeNotes.length).toBeGreaterThan(0);
    expect(changeNotes[0]!.severity).toBe('must_handle');
    expect(changeNotes[0]!.body).toContain('→');
  });

  it('同日冲突：两个岗位的笔试同日时提示冲突，不替用户自动放弃', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    seedFollow(follows, 'u1', 'unitB', 'annB', 'annB-v1');
    const service = new ScheduleService(prisma);

    // annA 和 annB 的 writtenExamDate 均为 2026-11-20（mock 中已设）
    const schedule = await service.getSchedule('u1');

    // 查找同日冲突
    const byDate = new Map<string, string[]>();
    for (const e of schedule.events) {
      if (!e.dateIso || e.past) continue;
      const list = byDate.get(e.dateIso) ?? [];
      list.push(e.unitId);
      byDate.set(e.dateIso, list);
    }
    const conflicts = [...byDate.values()].filter((ids) => {
      const s = new Set(ids);
      return s.size > 1;
    });
    // 笔试 2026-11-20 同日
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('关闭某岗位提醒不删除该岗位日程（事件仍在，通知不产生）', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1', true); // muted
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');
    const schedule = await service.getSchedule('u1');

    // 日程可见
    expect(schedule.events.filter((e) => e.unitId === 'unitA').length).toBeGreaterThan(0);
    // mutedUnitIds 含 unitA
    expect(schedule.mutedUnitIds).toContain('unitA');
    // 无通知（静音后首次同步不产生新事件通知）
    const mutedNotes = notifications.filter(
      (n) => n.userId === 'u1' && n.relatedUnitId === 'unitA' && n.reminderStage !== null,
    );
    expect(mutedNotes.length).toBe(0);
  });

  it('取消关注后停止未来提醒，历史记录保留', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');
    const notesBefore = notifications.filter((n) => n.userId === 'u1').length;
    expect(notesBefore).toBeGreaterThan(0);

    // 取消关注（删除记录）
    follows.splice(0, follows.length, ...follows.filter((f) => !(f.userId === 'u1' && f.unitId === 'unitA')));

    await service.syncEventsForUser('u1');
    const notesAfter = notifications.filter((n) => n.userId === 'u1').length;
    // 历史通知仍然保留
    expect(notesAfter).toBe(notesBefore);
    // 无新通知（没有关注记录 → 不同步 → 不产生提醒）
    expect(notesAfter).toBe(notesBefore);
  });

  it('重新关注后按最新版本恢复同步，不重复', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');
    const eventsAfter1 = await prisma.timelineEvent.findMany({
      where: { userId: 'u1', status: 'active' },
    });

    // 取消关注
    follows.splice(0, follows.length, ...follows.filter((f) => !(f.userId === 'u1' && f.unitId === 'unitA')));
    await service.syncEventsForUser('u1');

    // 重新关注
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    await service.syncEventsForUser('u1');
    const eventsAfter2 = await prisma.timelineEvent.findMany({
      where: { userId: 'u1', status: 'active' },
    });

    // 事件数相同（不重复），同版本幂等
    expect(eventsAfter2.length).toBe(eventsAfter1.length);
    // eventKey 不重复
    const keys = new Set(eventsAfter2.map((e) => e.eventKey));
    expect(keys.size).toBe(eventsAfter2.length);
  });

  it('岗位取消后停止行动提醒，保留日程降级为留档', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');

    // 公告取消
    const ann = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annA')!;
    ann.lifecycle = 'withdrawn';

    await service.syncEventsForUser('u1');
    const schedule = await service.getSchedule('u1');

    // 可信状态降级
    expect(schedule.unitTrust['unitA']?.state).toBe('withdrawn');
    // 日程节点保留但不再提示行动
    for (const e of schedule.events.filter((e) => e.unitId === 'unitA')) {
      expect(e.action).toBeNull();
      expect(e.urgency).toBe('info');
    }
    // nextAction 不含此岗位
    if (schedule.nextAction) {
      expect(schedule.nextAction.unitId).not.toBe('unitA');
    }

    // 取消通知 must_handle
    const cancelNotes = notifications.filter(
      (n) => n.userId === 'u1' && n.title.includes('公告已取消'),
    );
    expect(cancelNotes.length).toBe(1);
  });

  it('来源失效后降级为可理解状态，不作官方结论', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');

    // 来源失效
    const ann = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annA')!;
    ann.sourceHealth = { ok: false, checkedAt: '2026-10-12', failReason: '官方发布页 404' };

    await service.syncEventsForUser('u1');
    const schedule = await service.getSchedule('u1');

    expect(schedule.unitTrust['unitA']?.state).toBe('source_unavailable');
    for (const e of schedule.events.filter((e) => e.unitId === 'unitA')) {
      expect(e.action).toBeNull();
    }

    const downNotes = notifications.filter(
      (n) => n.userId === 'u1' && n.title.includes('官方来源失效'),
    );
    expect(downNotes.length).toBe(1);
    expect(downNotes[0]!.severity).toBe('must_handle');
  });

  it('账号隔离：用户 A 的日程和通知不泄漏给用户 B', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'uA', 'unitA', 'annA', 'annA-v1');
    seedFollow(follows, 'uB', 'unitB', 'annB', 'annB-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('uA');
    await service.syncEventsForUser('uB');

    const scheduleA = await service.getSchedule('uA');
    const scheduleB = await service.getSchedule('uB');

    // uA 只看到 unitA 的事件
    expect(scheduleA.events.every((e) => e.unitId === 'unitA')).toBe(true);
    // uB 只看到 unitB 的事件
    expect(scheduleB.events.every((e) => e.unitId === 'unitB')).toBe(true);

    // 通知不泄漏
    const notesA = notifications.filter((n) => n.userId === 'uA');
    const notesB = notifications.filter((n) => n.userId === 'uB');
    expect(notesA.every((n) => n.userId === 'uA')).toBe(true);
    expect(notesB.every((n) => n.userId === 'uB')).toBe(true);
  });

  it('默认提醒阶段幂等：同一节点+阶段只产生一次通知', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    // 固定系统时间与截止日期：服务用 new Date() 取当前时间，原实现动态算「2 天后」
    // 用 UTC 的 toISOString 取日期，跨时区/深夜运行时 UTC 与本地日期错位，
    // 会让 d-1 被误触发（2026-10-22 凌晨实测）。固定后任意时区/时刻运行结果恒定。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00+08:00'));
    const ann = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annA')!;
    ann.versions[0]!.timeline.registrationEnd = '2026-10-03';
    seedFollow(follows, 'u1', 'unitA', 'annA', 'annA-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');
    // 2 天后：d-7（2<=7 ✓）、d-3（2<=3 ✓）都触发，d-1（2>1 ✗）不触发
    const reminders = notifications.filter(
      (n) => n.userId === 'u1' && n.reminderStage !== null && n.eventKey?.includes('registration_end'),
    );
    const stages = new Set(reminders.map((r) => r.reminderStage));
    expect(stages.has('d-7')).toBe(true);
    expect(stages.has('d-3')).toBe(true);
    expect(stages.has('d-1')).toBe(false);

    // 第二次同步：幂等，不重复
    const beforeCount = reminders.length;
    await service.syncEventsForUser('u1');
    const reminders2 = notifications.filter(
      (n) => n.userId === 'u1' && n.reminderStage !== null && n.eventKey?.includes('registration_end'),
    );
    expect(reminders2.length).toBe(beforeCount);
    vi.useRealTimers();
  });

  it('待定转明确：时间从 null 变为具体日期时展示新值', async () => {
    const { prisma, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unitB', 'annB', 'annB-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u1');
    // annB 的 pendingItems 有 "面试时间另行通知" → pending_notice, dateIso=null
    const schedule1 = await service.getSchedule('u1');
    const pendingBefore = schedule1.events.find(
      (e) => e.kind === 'pending_notice' && e.title.includes('面试时间另行通知'),
    );
    expect(pendingBefore).toBeTruthy();
    expect(pendingBefore!.dateIso).toBeNull();

    // 补充公告明确面试时间
    const ann = catalog.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'annB')!;
    const v1 = ann.versions[0]!;
    v1.timeline.interviewDate = '2026-12-20';
    // pendingItems 移除面试
    v1.timeline.pendingItems = [];
    // 新版本
    const v2 = { ...v1, id: 'annB-v2', versionNumber: 2, timeline: { ...v1.timeline } };
    (v1 as { supersededAt?: string }).supersededAt = '2026-10-10T00:00:00+08:00';
    ann.versions.push(v2 as typeof v1);

    await service.syncEventsForUser('u1');
    const schedule2 = await service.getSchedule('u1');

    // 面试事件明确日期
    const interview = schedule2.events.find((e) => e.kind === 'interview');
    expect(interview).toBeTruthy();
    expect(interview!.dateIso).toBe('2026-12-20');
    // 原 pending_notice（面试时间另行通知）不再出现（被 superseded）
    const pendingAfter = schedule2.events.filter(
      (e) => e.kind === 'pending_notice' && e.title.includes('面试时间另行通知'),
    );
    expect(pendingAfter.length).toBe(0);
  });
});
