/**
 * 变更与纠错回放（v6.1 模块 7 交付脚本，vitest 可执行）。
 *
 * 运行：npx vitest run src/changes/replay-changes.spec.ts
 *
 * 回放四类官方变更场景，端到端验证：
 *   ① 延期（补充公告 v2 取代 v1）——旧值→新值→影响→下一步，旧版本保留，不重复通知；
 *   ② 取消（lifecycle → withdrawn）——只通知受影响用户，日程降级为留档；
 *   ③ 资格条件变化（新版新增年龄限制）——重算资格，通知受影响用户；
 *   ④ 官方来源失效与恢复——降级为可理解的可信状态，未核实字段不写成官方结论。
 * 每个场景打印一行可读报告（[回放] 前缀），并附硬断言。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ScheduleService } from '../schedule/schedule.service.js';
import { evaluateOpportunity } from '../matching/engine.js';
import type { PrismaService } from '../prisma.service.js';
import type {
  AnnouncementVersion,
  ApplicationUnit,
  RecruitmentAnnouncement,
  UserRecruitmentProfile,
} from '../matching/types.js';

const NOW = '2026-10-06T12:00:00+08:00';

// ---------- 可控公告目录 ----------

vi.mock('../matching/catalog.js', () => {
  const NOW_ISO = '2026-10-06T12:00:00+08:00';
  const CHECKED_AT = '2026-10-04T12:00:00+08:00';
  const officialSource = (id: string) => ({
    id,
    locator: { kind: 'url', url: 'https://gov.example/ann' },
    state: 'official',
    checkedAt: CHECKED_AT,
  });

  function req(
    id: string,
    dimension: string,
    description: string,
    criterion: unknown,
  ) {
    return {
      id,
      dimension,
      description,
      hard: true,
      criterion,
      evidence: {
        id: `${id}-ev`,
        locator: { kind: 'url', url: 'https://gov.example/ann' },
        state: 'official',
        checkedAt: '2026-10-04T12:00:00+08:00',
      },
    };
  }

  const eduReq = () =>
    req('edu', 'education', '本科及以上学历', {
      kind: 'education',
      minLevel: 'bachelor',
    });
  const ageReq = (maxAgeYears: number) =>
    req('age', 'age', `年龄不超过 ${maxAgeYears} 周岁`, {
      kind: 'age',
      maxAgeYears,
    });

  function unit(
    id: string,
    code: string,
    versionId: string,
    announcementId: string,
    name: string,
    requirements: unknown[] = [eduReq()],
    headcount = 2,
  ) {
    return {
      id,
      code,
      name,
      announcementId,
      versionId,
      region: { code: '330100', province: '浙江省', city: '杭州市' },
      subject: 'chinese',
      stage: 'middle',
      headcount,
      organizationType: 'government_unified',
      employmentNature: {
        code: 'public_institution_staff',
        officialName: '事业编制',
      },
      allocation: { code: 'direct_school', description: '直接定岗' },
      registerUrl: 'https://gov.example/apply',
      requirements,
    };
  }

  function version(
    announcementId: string,
    n: number,
    timeline: Record<string, unknown>,
    units: unknown[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: `${announcementId}-v${n}`,
      announcementId,
      versionNumber: n,
      sourceKind: n === 1 ? 'original' : 'supplement',
      publishedAt: NOW_ISO,
      officialSource: officialSource(`${announcementId}-v${n}-src`),
      timeline,
      units,
      ...extra,
    };
  }

  function ann(
    id: string,
    title: string,
    versions: unknown[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      id,
      title,
      publisher: '测试教育局',
      organizationType: 'government_unified',
      officialUrl: 'https://gov.example/ann',
      subjectScope: ['chinese'],
      region: { code: '330000', province: '浙江省' },
      lifecycle: 'active',
      firstPublishedAt: NOW_ISO,
      reviewStatus: 'human_reviewed',
      versions,
      ...extra,
    };
  }

  function buildCatalog() {
    // ① 延期：v1 报名截止 10-12，笔试 11-02；v2（稍后发布）延期
    const delayV1 = version(
      'ann-delay',
      1,
      {
        registrationStart: '2026-10-01',
        registrationEnd: '2026-10-12',
        writtenExamDate: '2026-11-02',
        pendingItems: ['面试时间待官方通知'],
      },
      [unit('unit-delay-v1', 'D-1', 'ann-delay-v1', 'ann-delay', '延期初中语文岗')],
    );
    // ② 取消：单版本，稍后 lifecycle → withdrawn
    const cancelV1 = version(
      'ann-cancel',
      1,
      { registrationStart: '2026-10-01', registrationEnd: '2026-10-20' },
      [unit('unit-cancel', 'C-1', 'ann-cancel-v1', 'ann-cancel', '取消初中语文岗')],
    );
    // ③ 条件变化：v1 仅学历；v2（稍后发布）新增年龄限制
    const reqV1 = version(
      'ann-req',
      1,
      { registrationStart: '2026-10-01', registrationEnd: '2026-10-20' },
      [unit('unit-req-v1', 'R-1', 'ann-req-v1', 'ann-req', '条件变化语文岗')],
    );
    // ④ 来源失效：单版本，稍后 sourceHealth.ok → false
    const sourceV1 = version(
      'ann-source',
      1,
      { registrationStart: '2026-10-01', registrationEnd: '2026-10-20' },
      [unit('unit-source', 'S-1', 'ann-source-v1', 'ann-source', '来源失效语文岗')],
    );
    // ⑤ 稳定公告（不受影响用户对照组）
    const stableV1 = version(
      'ann-stable',
      1,
      { registrationStart: '2026-10-01', registrationEnd: '2026-10-25' },
      [unit('unit-stable', 'T-1', 'ann-stable-v1', 'ann-stable', '稳定语文岗')],
    );

    return [
      ann('ann-delay', '延期公告', [delayV1]),
      ann('ann-cancel', '取消公告', [cancelV1]),
      ann('ann-req', '条件变化公告', [reqV1]),
      ann('ann-source', '来源失效公告', [sourceV1]),
      ann('ann-stable', '稳定公告', [stableV1]),
    ];
  }

  const CATALOG_ANNOUNCEMENTS = buildCatalog();
  return {
    CATALOG_ANNOUNCEMENTS,
    __resetCatalog: () => {
      CATALOG_ANNOUNCEMENTS.splice(0, CATALOG_ANNOUNCEMENTS.length, ...buildCatalog());
    },
    __buildV2Delay: () =>
      version(
        'ann-delay',
        2,
        {
          registrationStart: '2026-10-01',
          registrationEnd: '2026-11-15',
          writtenExamDate: '2026-12-06',
          pendingItems: ['面试时间待官方通知'],
        },
        [unit('unit-delay-v2', 'D-1', 'ann-delay-v2', 'ann-delay', '延期初中语文岗')],
        { changeNote: '补充公告：报名截止延至 11 月 15 日，笔试调整为 12 月 6 日。' },
      ),
    __buildV2Req: () =>
      version(
        'ann-req',
        2,
        { registrationStart: '2026-10-01', registrationEnd: '2026-10-20' },
        [
          unit(
            'unit-req-v2',
            'R-1',
            'ann-req-v2',
            'ann-req',
            '条件变化语文岗',
            [eduReq(), ageReq(30)],
          ),
        ],
        { changeNote: '补充公告：新增年龄条件（不超过 30 周岁）。' },
      ),
  };
});

// schedule.service 运行时读滚动时间轴 rolling-catalog：透传上面可控目录（不平移日期），
// 保证测试对数组的 push/splice 修改直接可见
vi.mock('../matching/rolling-catalog.js', async () => {
  const catalogMod = (await import('../matching/catalog.js')) as unknown as {
    CATALOG_ANNOUNCEMENTS: unknown[];
  };
  return {
    getRollingCatalogAnnouncements: () => catalogMod.CATALOG_ANNOUNCEMENTS,
  };
});

// ---------- 内存 Prisma ----------

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
  materialStatuses: unknown;
  consultationNotes: unknown;
  remindersMuted: boolean;
  lastNotifiedState: unknown;
  version: number;
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
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = follows.findIndex((f) => f.id === where.id);
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
          const row: TimelineRow = { ...data, id: nextId(), createdAt: new Date(), updatedAt: new Date() };
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
        findMany: async () => notifications,
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as PrismaService,
  };
}

function seedFollow(
  follows: FollowRow[],
  userId: string,
  unitId: string,
  announcementId: string,
  versionId: string,
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
    statusHistory: [{ status: 'considering', at: NOW }],
    abandonReason: null,
    materialStatuses: null,
    consultationNotes: null,
    remindersMuted: false,
    lastNotifiedState: null,
    version: 0,
  });
}

async function catalogMod() {
  return (await import('../matching/catalog.js')) as unknown as {
    CATALOG_ANNOUNCEMENTS: RecruitmentAnnouncement[];
    __resetCatalog: () => void;
    __buildV2Delay: () => AnnouncementVersion;
    __buildV2Req: () => AnnouncementVersion;
  };
}

const report: string[] = [];
function log(line: string) {
  report.push(line);
  console.log(line);
}

beforeEach(async () => {
  const mod = await catalogMod();
  mod.__resetCatalog();
  report.length = 0;
});

// ==================== 场景①：延期 ====================

describe('回放① 延期（补充公告 v2 取代 v1）', () => {
  it('旧值→新值→影响→下一步；旧版本保留；重复同步不重复通知', async () => {
    const { prisma, timelineEvents, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u1', 'unit-delay-v1', 'ann-delay', 'ann-delay-v1');
    const service = new ScheduleService(prisma);

    // 第一次同步：关注时版本 v1，落基线 + 生成 v1 事件
    await service.syncEventsForUser('u1');
    const regEndV1 = timelineEvents.find(
      (e) => e.userId === 'u1' && e.kind === 'registration_end',
    );
    expect(regEndV1!.dateIso).toBe('2026-10-12');
    const baselineAfterFirst = follows.find((f) => f.userId === 'u1')!.lastNotifiedState as { versionId: string };
    expect(baselineAfterFirst.versionId).toBe('ann-delay-v1');
    const notesAfterFirst = notifications.filter((n) => n.userId === 'u1').length;

    // 官方发布补充公告 v2：报名截止延至 11-15，笔试 12-06；v1 保留并标记 supersededAt
    const mod = await catalogMod();
    const ann = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-delay')!;
    const v1 = ann.versions[0]!;
    const v2 = mod.__buildV2Delay();
    (v1 as { supersededAt?: string }).supersededAt = v2.publishedAt;
    ann.versions.push(v2);

    // 第二次同步：延期生效
    await service.syncEventsForUser('u1');

    const regEnd = timelineEvents.find(
      (e) => e.userId === 'u1' && e.kind === 'registration_end',
    )!;
    expect(regEnd.dateIso).toBe('2026-11-15');
    expect(regEnd.versionId).toBe('ann-delay-v2');
    const history = regEnd.changeHistory as { dateIso: string | null }[];
    expect(history).toHaveLength(1);
    expect(history[0]!.dateIso).toBe('2026-10-12');

    // 事件级变更通知：must_handle，含 旧值 → 新值 → 影响 → 下一步
    const changeNotes = notifications.filter(
      (n) => n.userId === 'u1' && n.eventKey === regEnd.eventKey && n.severity === 'must_handle',
    );
    expect(changeNotes).toHaveLength(1);
    expect(changeNotes[0]!.body).toContain('→');
    expect(changeNotes[0]!.body).toContain('影响');
    expect(changeNotes[0]!.body).toContain('下一步');

    // 旧版本保留可查
    expect(ann.versions.map((v) => v.id)).toEqual(['ann-delay-v1', 'ann-delay-v2']);
    expect((ann.versions[0] as { supersededAt?: string }).supersededAt).toBe(v2.publishedAt);

    // 日程 DTO：changedFromPrevious 带影响与下一步
    const schedule = await service.getSchedule('u1');
    const dto = schedule.events.find((e) => e.kind === 'registration_end')!;
    expect(dto.changedFromPrevious?.oldValue).toBe('2026-10-12');
    expect(dto.changedFromPrevious?.newValue).toBe('2026-11-15');
    expect(dto.changedFromPrevious?.impact).toContain('延长');
    expect(dto.changedFromPrevious?.nextStep).toBeTruthy();

    // 时间未定：pending_notice 恒为「待官方通知」
    const pending = schedule.events.find((e) => e.kind === 'pending_notice')!;
    expect(pending.dateIso).toBeNull();
    expect(pending.dateText).toBe('待官方通知');

    // 第三次同步：同一版本幂等，不产生任何新通知
    const countBefore = notifications.filter((n) => n.userId === 'u1').length;
    await service.syncEventsForUser('u1');
    expect(notifications.filter((n) => n.userId === 'u1').length).toBe(countBefore);
    expect(countBefore).toBeGreaterThan(notesAfterFirst);

    log(
      `[回放] ①延期：报名截止 ${history[0]!.dateIso} → ${regEnd.dateIso}；` +
        `通知=${changeNotes[0]!.severity}「${changeNotes[0]!.title}」；` +
        `旧版本=v1 保留(supersededAt=${(ann.versions[0] as { supersededAt?: string }).supersededAt})；重复同步新增通知=0`,
    );
  });
});

// ==================== 场景②：取消 ====================

describe('回放② 公告取消（lifecycle → withdrawn）', () => {
  it('产生 must_handle 取消通知；日程降级为留档；不进入下一步动作；不重复通知', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u2', 'unit-cancel', 'ann-cancel', 'ann-cancel-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u2');
    const before = notifications.filter((n) => n.userId === 'u2').length;

    // 官方取消公告
    const mod = await catalogMod();
    const ann = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-cancel')!;
    (ann as { lifecycle: string }).lifecycle = 'withdrawn';

    await service.syncEventsForUser('u2');

    const cancelNotes = notifications.filter(
      (n) => n.userId === 'u2' && n.eventKey === null && n.title.includes('公告已取消'),
    );
    expect(cancelNotes).toHaveLength(1);
    expect(cancelNotes[0]!.severity).toBe('must_handle');
    expect(cancelNotes[0]!.body).toContain('公告有效');
    expect(cancelNotes[0]!.body).toContain('已取消');
    expect(cancelNotes[0]!.body).toContain('影响：');
    expect(cancelNotes[0]!.body).toContain('下一步');
    expect(notifications.filter((n) => n.userId === 'u2').length).toBe(before + 1);

    // 日程降级：可信状态=公告已取消；节点保留但不再提示行动
    const schedule = await service.getSchedule('u2');
    expect(schedule.unitTrust['unit-cancel']?.state).toBe('withdrawn');
    expect(schedule.unitTrust['unit-cancel']?.label).toBe('公告已取消');
    for (const e of schedule.events) {
      expect(e.urgency).toBe('info');
      expect(e.action).toBeNull();
    }
    expect(schedule.nextAction).toBeNull();

    // 重复同步不重复通知
    await service.syncEventsForUser('u2');
    expect(
      notifications.filter(
        (n) => n.userId === 'u2' && n.eventKey === null && n.title.includes('公告已取消'),
      ),
    ).toHaveLength(1);

    log(
      `[回放] ②取消：公告状态 公告有效 → 已取消；通知=must_handle「${cancelNotes[0]!.title}」；` +
        `日程可信状态=${schedule.unitTrust['unit-cancel']?.label}；下一步动作=无；重复同步新增通知=0`,
    );
  });
});

// ==================== 场景③：资格条件变化 ====================

describe('回放③ 资格条件变化（新版新增年龄限制）', () => {
  it('产生条件变化通知并重算资格：旧版符合、新版不符合', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u3', 'unit-req-v1', 'ann-req', 'ann-req-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u3');

    const mod = await catalogMod();
    const ann = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-req')!;
    const v1 = ann.versions[0]!;
    const v2 = mod.__buildV2Req();
    (v1 as { supersededAt?: string }).supersededAt = v2.publishedAt;
    ann.versions.push(v2);

    await service.syncEventsForUser('u3');

    const reqNotes = notifications.filter(
      (n) => n.userId === 'u3' && n.title.includes('公告有更新'),
    );
    expect(reqNotes).toHaveLength(1);
    expect(reqNotes[0]!.severity).toBe('must_handle');
    expect(reqNotes[0]!.body).toContain('【年龄】');
    expect(reqNotes[0]!.body).toContain('原公告无此条件');
    expect(reqNotes[0]!.body).toContain('匹配结论可能变化');
    expect(reqNotes[0]!.body).toContain('下一步');

    // 资格重算（匹配按当前版本即时计算）：36 岁画像
    const profile: UserRecruitmentProfile = {
      regions: [{ code: '330000', province: '浙江省', level: 'required' }],
      educationLevel: 'bachelor',
      degree: 'bachelor',
      majorFullName: '汉语言文学',
      birthDate: '1990-01-01',
      employmentStatus: 'employed_fulltime',
      teacherCert: { status: 'obtained', subject: 'chinese', stage: 'middle' },
      acceptedEmploymentNatures: ['public_institution_staff'],
    };
    const v1Unit = v1.units[0]! as ApplicationUnit;
    const v2Unit = v2.units[0]! as ApplicationUnit;
    const beforeMatch = evaluateOpportunity(ann, v1, v1Unit, profile, NOW);
    const afterMatch = evaluateOpportunity(ann, v2, v2Unit, profile, NOW);
    expect(beforeMatch.dimensions.every((d) => d.dimension !== 'age')).toBe(true);
    const ageAfter = afterMatch.dimensions.find((d) => d.dimension === 'age');
    expect(ageAfter?.value).toBe('FAIL');
    expect(afterMatch.overall).toBe('not_eligible');

    log(
      `[回放] ③条件变化：年龄 （原公告无此条件） → 不超过 30 周岁；` +
        `通知=must_handle；资格重算：v1 无年龄维度 → v2 年龄 FAIL（总体=${afterMatch.overall}）`,
    );
  });
});

// ==================== 场景④：官方来源失效与恢复 ====================

describe('回放④ 官方来源失效与恢复', () => {
  it('失效 → must_handle 降级通知（不作官方结论）；恢复 → info；日程展示可信状态', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u4', 'unit-source', 'ann-source', 'ann-source-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u4');

    // 人工巡检确认官方发布页 404
    const mod = await catalogMod();
    const ann = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-source')!;
    (ann as { sourceHealth?: unknown }).sourceHealth = {
      ok: false,
      checkedAt: NOW,
      failReason: '官方发布页返回 404，疑似撤稿或链接调整',
    };

    await service.syncEventsForUser('u4');

    const downNotes = notifications.filter(
      (n) => n.userId === 'u4' && n.eventKey === null && n.title.includes('官方来源失效'),
    );
    expect(downNotes).toHaveLength(1);
    expect(downNotes[0]!.severity).toBe('must_handle');
    expect(downNotes[0]!.body).toContain('官方来源');
    expect(downNotes[0]!.body).toContain('404');
    expect(downNotes[0]!.body).toContain('不作为官方结论');
    expect(downNotes[0]!.body).toContain('下一步');

    const scheduleDown = await service.getSchedule('u4');
    expect(scheduleDown.unitTrust['unit-source']?.state).toBe('source_unavailable');
    expect(scheduleDown.unitTrust['unit-source']?.label).toBe('官方来源失效');
    for (const e of scheduleDown.events) {
      expect(e.action).toBeNull();
    }
    expect(scheduleDown.nextAction).toBeNull();

    // 来源恢复：再产生一条 info 通知（说明可重新核验）
    (ann as { sourceHealth?: unknown }).sourceHealth = {
      ok: true,
      checkedAt: NOW,
    };
    await service.syncEventsForUser('u4');
    const recoverNotes = notifications.filter(
      (n) => n.userId === 'u4' && n.body.includes('恢复可访问'),
    );
    expect(recoverNotes).toHaveLength(1);
    expect(recoverNotes[0]!.severity).toBe('info');

    const scheduleUp = await service.getSchedule('u4');
    expect(scheduleUp.unitTrust['unit-source']?.state).toBe('ok');

    log(
      `[回放] ④来源失效：官方来源 可访问 → 失效(404)；通知=must_handle（不作官方结论）；` +
        `恢复后通知=info；可信状态=${scheduleUp.unitTrust['unit-source']?.label}`,
    );
  });
});

// ==================== 只通知受影响用户 ====================

describe('回放⑤ 只通知受影响用户', () => {
  it('关注其他公告的用户在四类变更期间不产生任何变更通知', async () => {
    const { prisma, notifications, follows } = createFakePrisma();
    seedFollow(follows, 'u5', 'unit-stable', 'ann-stable', 'ann-stable-v1');
    seedFollow(follows, 'u6', 'unit-delay-v1', 'ann-delay', 'ann-delay-v1');
    const service = new ScheduleService(prisma);

    await service.syncEventsForUser('u5');
    await service.syncEventsForUser('u6');
    const stableBaseline = notifications.filter((n) => n.userId === 'u5').length;

    // 其他公告全部发生变更
    const mod = await catalogMod();
    const delay = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-delay')!;
    delay.versions.push(mod.__buildV2Delay());
    const cancel = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-cancel')!;
    (cancel as { lifecycle: string }).lifecycle = 'withdrawn';
    const source = mod.CATALOG_ANNOUNCEMENTS.find((a) => a.id === 'ann-source')!;
    (source as { sourceHealth?: unknown }).sourceHealth = {
      ok: false,
      checkedAt: NOW,
      failReason: '404',
    };

    await service.syncEventsForUser('u5');
    await service.syncEventsForUser('u6');

    // 稳定公告的关注者：零变更通知（其他公告的变更不波及此用户）
    const stableAfter = notifications.filter((n) => n.userId === 'u5');
    expect(stableAfter.length).toBe(stableBaseline);
    // 变更通知（reminderStage=null 的非提醒通知）全部为 info
    const stableChangeNotes = stableAfter.filter((n) => n.reminderStage === null);
    expect(stableChangeNotes.every((n) => n.severity === 'info')).toBe(true);

    // 受影响用户：收到延期相关 must_handle
    const affected = notifications.filter(
      (n) => n.userId === 'u6' && n.severity === 'must_handle',
    );
    expect(affected.length).toBeGreaterThan(0);

    log(
      `[回放] ⑤影响面：稳定公告关注者新增变更通知=0；受影响关注者 must_handle=${affected.length} 条`,
    );
  });
});
