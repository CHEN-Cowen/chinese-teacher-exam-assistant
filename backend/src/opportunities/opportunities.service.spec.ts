import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAJOR_ALIAS_VERSION,
  MATCH_RULE_VERSION,
  isUserVisibleInCatalog,
} from '../matching/engine.js';
import { CATALOG_VERSION } from '../matching/catalog.js';
import { COVERAGE_PROJECTION_VERSION } from './coverage-projection.js';
import {
  REAL_ANNOUNCEMENT_IDS,
  REAL_CATALOG_VERSION,
} from '../matching/real-catalog.js';
import type {
  RecruitmentAnnouncement,
  UserRecruitmentProfile,
} from '../matching/types.js';
import { OpportunitiesService } from './opportunities.service.js';
import { buildGoals, type CatalogSnapshot } from './view.js';
import type { FollowRecord } from './follow.domain.js';

const PROFILE: UserRecruitmentProfile = {
  regions: [
    { code: '330000', province: '浙江省', level: 'required' },
    { code: '320000', province: '江苏省', level: 'consider' },
    { code: '340000', province: '安徽省', level: 'consider' },
  ],
  educationLevel: 'bachelor',
  degree: 'bachelor',
  majorFullName: '汉语言文学（师范）',
  graduationDate: '2026-06-30',
  employmentStatus: 'fresh_unemployed',
  socialSecurityMonths: 0,
  teacherCert: { status: 'obtained', subject: 'chinese', stage: 'middle' },
  acceptedEmploymentNatures: [
    'public_institution_staff',
    'record_filing',
    'post_quota',
    'headcount_control',
    'other',
  ],
};

interface FollowRow {
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
  materialStatuses?: unknown;
  consultationNotes?: unknown;
  version?: number;
}

/** 内存版 Prisma：只实现 service 实际用到的模型方法 */
function createFakePrisma() {
  const rows = new Map<string, FollowRow>();
  const corrections: Array<Record<string, unknown>> = [];
  let seq = 0;
  const keyOf = (userId: string, unitId: string) => `${userId}::${unitId}`;

  const followedOpportunity = {
    findUnique: async ({
      where,
    }: {
      where: { userId_unitId: { userId: string; unitId: string } };
    }) => rows.get(keyOf(where.userId_unitId.userId, where.userId_unitId.unitId)) ?? null,
    findUniqueOrThrow: async ({
      where,
    }: {
      where: { userId_unitId: { userId: string; unitId: string } };
    }) => {
      const row = rows.get(
        keyOf(where.userId_unitId.userId, where.userId_unitId.unitId),
      );
      if (!row) throw new Error('not found');
      return row;
    },
    findMany: async ({ where }: { where: { userId: string } }) =>
      [...rows.values()]
        .filter((r) => r.userId === where.userId)
        .sort((a, b) => a.followedAt.getTime() - b.followedAt.getTime()),
    create: async ({ data }: { data: Omit<FollowRow, 'id'> }) => {
      const row: FollowRow = { ...data, id: `gen-${++seq}` };
      rows.set(keyOf(row.userId, row.unitId), row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { userId_unitId: { userId: string; unitId: string } };
      data: Partial<FollowRow>;
    }) => {
      const row = rows.get(
        keyOf(where.userId_unitId.userId, where.userId_unitId.unitId),
      );
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        userId: string;
        role: string;
        NOT: { unitId: string };
      };
      data: Partial<FollowRow>;
    }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (
          row.userId === where.userId &&
          row.role === where.role &&
          row.unitId !== where.NOT.unitId
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    deleteMany: async ({
      where,
    }: {
      where: { userId: string; unitId: string };
    }) => {
      let count = 0;
      if (rows.delete(keyOf(where.userId, where.unitId))) count = 1;
      return { count };
    },
  };

  const opportunityCorrection = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `cor-${++seq}`,
        status: 'submitted',
        reviewNote: null,
        reviewerId: null,
        reviewedAt: null,
        resolvedVersionId: null,
        createdAt: new Date(),
        ...data,
      };
      corrections.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      corrections.find((r) => r.id === where.id) ?? null,
    findMany: async ({
      where,
      take,
    }: {
      where?: {
        userId?: string;
        status?: string;
        createdAt?: { gte?: Date };
      };
      take?: number;
    }) => {
      let list = [...corrections];
      if (where?.userId) list = list.filter((r) => r.userId === where.userId);
      if (where?.status) list = list.filter((r) => r.status === where.status);
      if (where?.createdAt?.gte) {
        list = list.filter(
          (r) => (r.createdAt as Date).getTime() >= where.createdAt!.gte!.getTime(),
        );
      }
      list.sort(
        (a: { createdAt: Date }, b: { createdAt: Date }) =>
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return typeof take === 'number' ? list.slice(0, take) : list;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = corrections.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    /** R05：条件更新（where 带 status）用于并发处理时的状态抢占 */
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: string };
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of corrections) {
        if (row.id !== where.id) continue;
        if (where.status !== undefined && row.status !== where.status) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
  };

  // D08：公告补录（内存版）
  const submissions: Array<Record<string, unknown>> = [];
  const announcementSubmission = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `sub-${++seq}`,
        status: 'submitted',
        reviewNote: null,
        reviewerId: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      submissions.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      submissions.find((r) => r.id === where.id) ?? null,
    findMany: async ({
      where,
      take,
    }: {
      where?: {
        userId?: string;
        status?: string;
        urlHash?: string;
      };
      take?: number;
    }) => {
      let list = [...submissions];
      if (where?.userId) list = list.filter((r) => r.userId === where.userId);
      if (where?.status) list = list.filter((r) => r.status === where.status);
      if (where?.urlHash) list = list.filter((r) => r.urlHash === where.urlHash);
      list.sort(
        (a: { createdAt: Date }, b: { createdAt: Date }) =>
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return typeof take === 'number' ? list.slice(0, take) : list;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = submissions.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  const users = new Map<string, { id: string; email: string; name: string | null }>([
    ['user-1', { id: 'user-1', email: 'u1@example.com', name: '学生一' }],
  ]);
  const notifications: Array<Record<string, unknown>> = [];

  const user = {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => users.get(id)).filter(Boolean),
  };

  const notificationRecord = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `notif-${++seq}`, readAt: null, createdAt: new Date(), ...data };
      notifications.push(row);
      return row;
    },
  };

  // v7.1 M6：订阅与提醒幂等日志（内存版）
  const subscriptions = new Map<string, Record<string, unknown>>();
  const noticeLogs: Array<Record<string, unknown>> = [];
  const opportunitySubscription = {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      subscriptions.get(where.userId) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = subscriptions.get(where.userId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = {
        id: `sub-${++seq}`,
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      subscriptions.set(where.userId, row);
      return row;
    },
  };
  const opportunityNoticeLog = {
    findMany: async ({ where }: { where: { userId: string } }) =>
      noticeLogs.filter((r) => r.userId === where.userId),
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      let count = 0;
      for (const item of data) {
        const dup = noticeLogs.some(
          (r) =>
            r.userId === item.userId &&
            r.dedupKey === item.dedupKey,
        );
        if (dup) continue; // skipDuplicates
        noticeLogs.push({ id: `log-${++seq}`, createdAt: new Date(), ...item });
        count += 1;
      }
      return { count };
    },
  };

  // D07：单位关注（内存版）
  const orgFollows: Array<Record<string, unknown>> = [];
  const followedOrganization = {
    findMany: async ({
      where,
      orderBy,
    }: {
      where: { userId: string };
      orderBy?: { followedAt: 'asc' | 'desc' };
    }) => {
      const list = orgFollows.filter((r) => r.userId === where.userId);
      if (orderBy?.followedAt === 'asc') {
        list.sort(
          (a, b) =>
            (a.followedAt as Date).getTime() - (b.followedAt as Date).getTime(),
        );
      }
      return list;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId_identityKey: { userId: string; identityKey: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const { userId, identityKey } = where.userId_identityKey;
      const existing = orgFollows.find(
        (r) => r.userId === userId && r.identityKey === identityKey,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = {
        id: `org-${++seq}`,
        followedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...create,
      };
      orgFollows.push(row);
      return row;
    },
    deleteMany: async ({
      where,
    }: {
      where: { userId: string; identityKey: string };
    }) => {
      let count = 0;
      for (let i = orgFollows.length - 1; i >= 0; i -= 1) {
        const r = orgFollows[i]!;
        if (r.userId === where.userId && r.identityKey === where.identityKey) {
          orgFollows.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { userId: string; baselineSyncedAt: null };
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const r of orgFollows) {
        if (r.userId !== where.userId) continue;
        if (where.baselineSyncedAt === null && r.baselineSyncedAt != null) continue;
        Object.assign(r, data);
        count += 1;
      }
      return { count };
    },
  };

  return {
    prisma: {
      followedOpportunity,
      opportunityCorrection,
      announcementSubmission,
      notificationRecord,
      opportunitySubscription,
      opportunityNoticeLog,
      followedOrganization,
      user,
      $transaction: async (
        arg: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>),
      ) =>
        typeof arg === 'function'
          ? arg({
              followedOpportunity,
              opportunityCorrection,
              announcementSubmission,
              notificationRecord,
              opportunitySubscription,
              opportunityNoticeLog,
              followedOrganization,
              user,
            })
          : Promise.all(arg),
    } as never,
    rows,
    corrections,
    submissions,
    notifications,
    subscriptions,
    noticeLogs,
    orgFollows,
  };
}

const fakeProfileService = {
  getProfile: async () => null,
  saveProfile: async () => undefined,
} as never;

const fakeScheduleService = {
  syncEventsForUser: async () => ({ syncedEventCount: 0, notificationCount: 0 }),
} as never;

describe('OpportunitiesService：匹配响应', () => {
  it('七场景演示数据全部出现且每条结论携带规则版本、公告版本与证据锚点', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
    const response = await service.match(PROFILE, 'user-1');

    expect(response.meta.ruleVersion).toBe(MATCH_RULE_VERSION);
    expect(response.meta.majorAliasVersion).toBe(MAJOR_ALIAS_VERSION);
    expect(response.meta.catalogVersion).toBe(CATALOG_VERSION);
    expect(response.meta.realCatalogVersion).toBe(REAL_CATALOG_VERSION);
    expect(response.meta.evaluatedAt).toBeTruthy();
    // M01/F2 统一覆盖投影随响应返回：0 在报、口径字段齐备（静态回退口径）
    expect(response.coverage.version).toBe(COVERAGE_PROJECTION_VERSION);
    expect(response.coverage.openOpportunityCount).toBe(0);
    // 台账最近核对时间为 ISO 日期时间；静态模式下显式标注非实时回退
    expect(response.coverage.lastCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(response.coverage.caliber.isFallback).toBe(true);
    expect(response.coverage.caliber.fallbackNote).toContain('非实时');

    const all = [
      ...response.groups.preliminary,
      ...response.groups.needInfo.flatMap((g) => g.units),
      ...response.groups.manualReview,
      ...response.groups.notEligible,
      ...response.groups.closed,
    ];
    // 模块 7.5 合规过滤：用户端不返回 AI 初核待人工复核记录（dataset === 'real'）。
    // 仅 7 个演示报考单元返回，4 个真实监测记录被过滤。
    expect(all).toHaveLength(7);

    const demo = all.filter((u) => u.announcement.dataset === 'demo');
    const real = all.filter((u) => u.announcement.dataset === 'real');
    expect(demo).toHaveLength(7);
    expect(real).toHaveLength(0);

    // 7 条演示公告当前版本各一个报考单元（合肥 v1 被 v2 取代，不出现 v1）
    const demoIds = demo.map((u) => u.unit.id);
    expect(demoIds).toContain('unit-hefei-01-v2');
    expect(demoIds).not.toContain('unit-hefei-01-v1');

    // 来源失效演示单元：报名窗口名义开放但 source_unavailable 闸门失败，
    // 只能落在 closed，不进任何推荐组
    const jiaxing = all.find((u) => u.unit.id === 'unit-jiaxing-01');
    expect(jiaxing).toBeDefined();
    const jxGate = jiaxing!.gates.find((g) => g.code === 'source_unavailable');
    expect(jxGate?.passed).toBe(false);
    expect(jxGate?.reason).toContain('404');
    expect(response.groups.closed.map((u) => u.unit.id)).toContain(
      'unit-jiaxing-01',
    );

    for (const dto of demo) {
      expect(dto.version.id).toMatch(/^ann-.+-v\d+$/);
      expect(dto.version.officialSource.state).toBe('official');
      expect(dto.gates.length).toBeGreaterThan(0);
      for (const dimension of dto.dimensions) {
        // 地区是用户偏好约束；其余条件必须能追溯公告原文与证据
        if (dimension.dimension === 'region') {
          expect(dimension.requirementDescription).toBeTruthy();
          expect(dimension.evidence).toBeUndefined();
        } else {
          expect(dimension.requirementDescription).toBeTruthy();
          expect(dimension.evidence?.state).toBe('official');
          expect(dimension.evidence?.locator).toBeTruthy();
        }
      }
    }

    // 模块 7.5：用户端不再返回 real 记录，以下断言验证过滤行为
    expect(real).toHaveLength(0);
    // 管理端复核界面可通过独立 API 查看 real 记录（见模块 8）
  });

  it('真实公告 id 常量与台账一致（防止台账 id 漂移）', () => {
    expect(REAL_ANNOUNCEMENT_IDS.yinzhouPreview).toBe(
      'real-yinzhou-2026-autumn',
    );
  });

  it('画像结构非法时抛 400，不产出任何结果', async () => {
    const service = new OpportunitiesService(createFakePrisma().prisma, fakeProfileService, fakeScheduleService);
    await expect(
      service.match({ ...PROFILE, regions: 'bad' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('详情返回三层所需的逐条件/版本链数据；未知单元 404', async () => {
    const service = new OpportunitiesService(createFakePrisma().prisma, fakeProfileService, fakeScheduleService);
    const detail = await service.unitDetail(
      PROFILE,
      'user-1',
      'unit-hangzhou-01',
    );
    expect(detail.unit.announcement.title).toContain('杭州');
    expect(detail.unit.version.versionNumber).toBe(1);
    expect(detail.previousVersions).toEqual([]);

    const hefei = await service.unitDetail(
      PROFILE,
      'user-1',
      'unit-hefei-01-v2',
    );
    expect(hefei.previousVersions).toHaveLength(1);
    expect(hefei.previousVersions[0]?.supersededAt).toBeTruthy();
    // 延期与扩招说明挂在当前版本 v2 的 changeNote 上
    expect(hefei.unit.version.changeNote).toContain('延至');
    expect(hefei.unit.version.changeNote).toContain('8人');

    await expect(
      service.unitDetail(PROFILE, 'user-1', 'not-exist'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('v7.1 M8：访客（无 userId）携带画像可匹配，关注列表为空', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
    const response = await service.match(PROFILE, undefined);

    // 匹配结果与登录用户一致（7 个演示单元）
    const all = [
      ...response.groups.preliminary,
      ...response.groups.needInfo.flatMap((g) => g.units),
      ...response.groups.manualReview,
      ...response.groups.notEligible,
      ...response.groups.closed,
    ];
    expect(all).toHaveLength(7);
    // 访客无关注记录
    expect(all.every((u) => u.follow === null)).toBe(true);
  });

  it('v7.1 M8：访客（无 userId）携带画像可查详情，follow 为 null', async () => {
    const service = new OpportunitiesService(createFakePrisma().prisma, fakeProfileService, fakeScheduleService);
    const detail = await service.unitDetail(
      PROFILE,
      undefined,
      'unit-hangzhou-01',
    );
    expect(detail.unit.announcement.title).toContain('杭州');
    expect(detail.unit.follow).toBeNull();
  });

  it('v7.1 M8：访客未携带画像且无 userId 时抛 400', async () => {
    const service = new OpportunitiesService(createFakePrisma().prisma, fakeProfileService, fakeScheduleService);
    await expect(
      service.match(undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OpportunitiesService：关注与状态流转', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: OpportunitiesService;

  beforeEach(() => {
    fake = createFakePrisma();
    service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
  });

  it('关注初始为 considering；重复关注幂等不重置状态', async () => {
    const first = await service.follow('user-1', 'unit-hangzhou-01');
    expect(first.status).toBe('considering');
    expect(first.role).toBeNull();
    expect(first.statusHistory).toHaveLength(1);

    await service.transition('user-1', 'unit-hangzhou-01', 'preparing');
    const second = await service.follow('user-1', 'unit-hangzhou-01');
    expect(second.status).toBe('preparing');
    expect(fake.rows.size).toBe(1);
  });

  it('关注后匹配结果的对应卡片携带 follow；其他卡片不受影响', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    const response = await service.match(PROFILE, 'user-1');
    const all = [
      ...response.groups.preliminary,
      ...response.groups.needInfo.flatMap((g) => g.units),
      ...response.groups.manualReview,
      ...response.groups.notEligible,
      ...response.groups.closed,
    ];
    const followed = all.filter((u) => u.follow !== null);
    expect(followed).toHaveLength(1);
    expect(followed[0]?.unit.id).toBe('unit-hangzhou-01');
  });

  it('非法流转（considering → registered）被拒绝；未关注先流转报 404', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    await expect(
      service.transition('user-1', 'unit-hangzhou-01', 'registered'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.transition('user-1', 'unit-yinzhou-01', 'preparing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('关注状态切换不影响其他机会，也不影响其他用户', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    await service.follow('user-1', 'unit-yinzhou-01');
    await service.follow('user-2', 'unit-hangzhou-01');

    await service.transition('user-1', 'unit-hangzhou-01', 'abandoned', undefined, '时间冲突');
    const followsUser1 = await service.listFollows('user-1');
    const hz = followsUser1.find((f) => f.unitId === 'unit-hangzhou-01');
    const yz = followsUser1.find((f) => f.unitId === 'unit-yinzhou-01');
    expect(hz?.status).toBe('abandoned');
    expect(hz?.abandonReason).toBe('时间冲突');
    expect(yz?.status).toBe('considering');

    const followsUser2 = await service.listFollows('user-2');
    expect(followsUser2[0]?.status).toBe('considering');
  });

  it('取消关注只删除该单元记录', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    await service.follow('user-1', 'unit-yinzhou-01');
    await service.unfollow('user-1', 'unit-hangzhou-01');
    const follows = await service.listFollows('user-1');
    expect(follows.map((f) => f.unitId)).toEqual(['unit-yinzhou-01']);
  });

  it('真实台账单元不可被普通用户关注（模块 7.5 合规过滤）', async () => {
    // 模块 7.5：普通用户端不允许关注 AI 初核待人工复核记录
    await expect(
      service.follow('user-1', 'real-nb-202607-nwsis-chinese'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('设置材料状态：持久化并递增 version；同状态幂等不递增', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    const before = await service.listFollows('user-1');
    expect(before[0]?.version).toBe(0);
    expect(before[0]?.materialStatuses).toEqual({
      'id-card': 'not_started',
      'edu-cert': 'not_started',
      'teacher-cert': 'not_started',
    });

    const after = await service.setMaterialStatus(
      'user-1',
      'unit-hangzhou-01',
      'id-card',
      'done',
    );
    expect(after.materialStatuses).toEqual({
      'id-card': 'done',
      'edu-cert': 'not_started',
      'teacher-cert': 'not_started',
    });
    expect(after.version).toBe(1);

    // 同状态幂等
    const again = await service.setMaterialStatus(
      'user-1',
      'unit-hangzhou-01',
      'id-card',
      'done',
    );
    expect(again.version).toBe(1);
  });

  it('材料状态 version 冲突返回 409，不写入', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    await expect(
      service.setMaterialStatus(
        'user-1',
        'unit-hangzhou-01',
        'id-card',
        'done',
        99, // 与服务端 version=0 冲突
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const follows = await service.listFollows('user-1');
    expect(follows[0]?.materialStatuses).toEqual({
      'id-card': 'not_started',
      'edu-cert': 'not_started',
      'teacher-cert': 'not_started',
    });
    expect(follows[0]?.version).toBe(0);
  });

  it('记录咨询结论：持久化且不影响匹配状态；空字符串删除该条', async () => {
    await service.follow('user-1', 'unit-hangzhou-01');
    const saved = await service.saveConsultationNote(
      'user-1',
      'unit-hangzhou-01',
      'major',
      '已电话确认，汉语言文学师范符合',
    );
    expect(saved.consultationNotes).toEqual({
      major: '已电话确认，汉语言文学师范符合',
    });
    expect(saved.version).toBe(1);

    const cleared = await service.saveConsultationNote(
      'user-1',
      'unit-hangzhou-01',
      'major',
      '',
    );
    expect(cleared.consultationNotes).toBeNull();
  });

  it('v7.2：considering 态重复保存幂等——不自动升级、不重置材料/咨询/版本，并返回日程同步数', async () => {
    const countingSchedule = {
      syncEventsForUser: async () => ({
        syncedEventCount: 3,
        notificationCount: 1,
      }),
    } as never;
    const svc = new OpportunitiesService(
      fake.prisma,
      fakeProfileService,
      countingSchedule,
    );

    const first = await svc.follow('user-1', 'unit-hangzhou-01');
    expect(first.status).toBe('considering');
    expect(first.syncedEventCount).toBe(3);

    await svc.setMaterialStatus(
      'user-1',
      'unit-hangzhou-01',
      'id-card',
      'done',
    );
    await svc.saveConsultationNote(
      'user-1',
      'unit-hangzhou-01',
      'major',
      JSON.stringify({
        v: 1,
        outcome: 'confirmed_match',
        note: '电话确认符合',
        at: '2026-10-13T09:00:00+08:00',
      }),
    );

    // 连点保存：服务端无新写入，状态/材料/咨询/版本全部保持
    const repeat = await svc.follow('user-1', 'unit-hangzhou-01');
    expect(repeat.status).toBe('considering');
    expect(repeat.materialStatuses['id-card']).toBe('done');
    expect(String(repeat.consultationNotes?.major)).toContain(
      'confirmed_match',
    );
    expect(repeat.version).toBe(2);
    expect(repeat.syncedEventCount).toBe(3);
    expect(fake.rows.size).toBe(1);
  });

  it('v7.2：个人咨询答复只挂在本人 follow 上，公共 gates/dimensions/overall 不变，也不影响其他用户', async () => {
    const before = await service.unitDetail(
      PROFILE,
      'user-1',
      'unit-suzhou-01',
    );
    const majorBefore = before.unit.dimensions.find(
      (d) => d.dimension === 'major',
    );
    expect(majorBefore?.value).toBe('MANUAL_REVIEW');
    const gatesSnapshot = JSON.stringify(before.unit.gates);
    const overallBefore = before.unit.overall;

    await service.follow('user-1', 'unit-suzhou-01');
    const saved = await service.saveConsultationNote(
      'user-1',
      'unit-suzhou-01',
      'major',
      JSON.stringify({
        v: 1,
        outcome: 'confirmed_match',
        note: '电话确认我符合该岗位专业口径',
        at: '2026-10-13T09:00:00+08:00',
      }),
    );
    expect(String(saved.consultationNotes?.major)).toContain(
      'confirmed_match',
    );

    // 本人视角：答复挂在 follow DTO，但公共判定原样不变（不进入匹配规则）
    const after = await service.unitDetail(
      PROFILE,
      'user-1',
      'unit-suzhou-01',
    );
    const majorAfter = after.unit.dimensions.find(
      (d) => d.dimension === 'major',
    );
    expect(majorAfter?.value).toBe('MANUAL_REVIEW');
    expect(JSON.stringify(after.unit.gates)).toBe(gatesSnapshot);
    expect(after.unit.overall).toBe(overallBefore);
    expect(String(after.unit.follow?.consultationNotes?.major)).toContain(
      'confirmed_match',
    );

    // 另一用户：看不到该答复，公共维度仍是 MANUAL_REVIEW
    await service.follow('user-2', 'unit-suzhou-01');
    const other = await service.unitDetail(
      PROFILE,
      'user-2',
      'unit-suzhou-01',
    );
    expect(other.unit.follow?.consultationNotes).toBeNull();
    const majorOther = other.unit.dimensions.find(
      (d) => d.dimension === 'major',
    );
    expect(majorOther?.value).toBe('MANUAL_REVIEW');
  });
});

describe('OpportunitiesService：主要备考目标', () => {
  it('设新 primary 时旧 primary 事务内自动降 backup；未关注不能设角色', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
    await service.follow('user-1', 'unit-hangzhou-01');
    await service.follow('user-1', 'unit-yinzhou-01');

    await service.setRole('user-1', 'unit-hangzhou-01', 'primary');
    await service.setRole('user-1', 'unit-yinzhou-01', 'primary');

    const follows = await service.listFollows('user-1');
    expect(follows.find((f) => f.unitId === 'unit-hangzhou-01')?.role).toBe(
      'backup',
    );
    expect(follows.find((f) => f.unitId === 'unit-yinzhou-01')?.role).toBe(
      'primary',
    );

    await expect(
      service.setRole('user-1', 'unit-suzhou-01', 'primary'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setRole('user-1', 'unit-hangzhou-01', 'only' as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('匹配响应返回 primaryTargetUnitId', async () => {
    const service = new OpportunitiesService(createFakePrisma().prisma, fakeProfileService, fakeScheduleService);
    await service.follow('user-1', 'unit-hangzhou-01');
    await service.setRole('user-1', 'unit-hangzhou-01', 'primary');
    const response = await service.match(PROFILE, 'user-1');
    expect(response.primaryTargetUnitId).toBe('unit-hangzhou-01');
  });
});

describe('OpportunitiesService：备考目标（模块 7）', () => {
  it('listGoals 聚合活跃关注与公告版本；abandoned 不出现；返回 primaryTargetUnitId', async () => {
    const service = new OpportunitiesService(createFakePrisma().prisma, fakeProfileService, fakeScheduleService);
    await service.follow('user-1', 'unit-hangzhou-01');
    await service.follow('user-1', 'unit-yinzhou-01');
    await service.setRole('user-1', 'unit-hangzhou-01', 'primary');
    await service.follow('user-1', 'unit-suzhou-01');
    await service.transition('user-1', 'unit-suzhou-01', 'abandoned', undefined, '竞争太大');

    const response = await service.listGoals('user-1');
    expect(response.primaryTargetUnitId).toBe('unit-hangzhou-01');
    expect(response.goals.map((g) => g.unitId)).toEqual([
      'unit-hangzhou-01',
      'unit-yinzhou-01',
    ]);

    const primary = response.goals[0]!;
    expect(primary.role).toBe('primary');
    expect(primary.unitName).toContain('杭州');
    expect(primary.announcement.officialUrl).toBeTruthy();
    expect(primary.version.timeline.registrationStart).toBeTruthy();
    expect(primary.followStatus).toBe('considering');
    expect(primary.newerVersion).toBe(false);

    // 其他用户的目标不受影响
    expect((await service.listGoals('user-2')).goals).toEqual([]);
  });

  it('buildGoals：版本取代标记 newerVersion；closed 被排除；目录缺失单元跳过', () => {
    const snap = (unitId: string, legacyUnitIds: string[] = []): CatalogSnapshot => ({
      announcementId: 'ann-x',
      title: '测试公告',
      publisher: '测试教育局',
      officialUrl: 'https://example.gov.cn/ann',
      versionId: 'ann-x-v2',
      versionNumber: 2,
      publishedAt: '2026-02-01',
      timeline: { registrationStart: '2026-03-01', registrationEnd: '2026-03-10' },
      unit: {
        id: unitId,
        code: 'U1',
        name: '测试单元',
        region: { code: '330100', province: '浙江省', city: '杭州市' },
        subject: 'chinese',
        stage: 'primary',
        headcount: 3,
      },
      legacyUnitIds,
    });
    const follow = (unitId: string, versionId: string, status: FollowRecord['status']): FollowRecord => ({
      id: `f-${unitId}`,
      userId: 'user-1',
      unitId,
      announcementId: 'ann-x',
      versionId,
      status,
      role: unitId === 'unit-a' ? 'primary' : null,
      followedAt: '2026-02-10T00:00:00.000Z',
      statusHistory: [],
      abandonReason: null,
      materialStatuses: null,
      consultationNotes: null,
      version: 0,
      remindersMuted: false,
    });

    const response = buildGoals(
      [
        follow('unit-a', 'ann-x-v1', 'preparing'), // 关注在旧版本 → newerVersion
        follow('unit-b', 'ann-x-v2', 'closed'), // 已关闭 → 不作为目标
        follow('unit-d-v1', 'ann-x-v1', 'considering'), // 关注记录指向旧版本单元 id → 跨版本对齐
      ],
      [snap('unit-a'), snap('unit-b'), snap('unit-c'), snap('unit-d', ['unit-d-v1'])],
    );

    expect(response.goals).toHaveLength(2);
    expect(response.goals[0]?.newerVersion).toBe(true);
    expect(response.goals[1]?.unitId).toBe('unit-d');
    expect(response.goals[1]?.newerVersion).toBe(true);
    expect(response.primaryTargetUnitId).toBe('unit-a');
  });
});

describe('OpportunitiesService：纠错留痕', () => {
  it('纠错绑定当前公告版本；内容过短或缺少位置时拒绝', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    const created = await service.submitCorrection(
      'user-1',
      'unit-hefei-01-v2',
      { fieldPath: 'major', content: '专业目录少列了一个专业名称' },
    );
    expect(created.status).toBe('submitted');
    expect(fake.corrections[0]?.versionId).toBe('ann-hefei-v2');

    await expect(
      service.submitCorrection('user-1', 'unit-hangzhou-01', {
        fieldPath: 'age',
        content: '太短',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitCorrection('user-1', 'unit-hangzhou-01', {
        fieldPath: '',
        content: '这里是足够长的纠错说明文字',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OpportunitiesService：纠错处理闭环（P0-F / 模块 8）', () => {
  const REVIEWER = { id: 'staff-1', role: 'admin' };

  async function seedCorrection(fake: ReturnType<typeof createFakePrisma>) {
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
    const created = await service.submitCorrection(
      'user-1',
      'unit-hefei-01-v2',
      { fieldPath: 'headcount', content: '岗位人数与补充公告不一致' },
    );
    return { service, created };
  }

  it('数据类纠错未发布修正版本时不能以「已修正」结案，也不会发「已更正」通知（R05）', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);

    const reviewing = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'reviewing',
    });
    expect(reviewing.status).toBe('reviewing');
    expect(reviewing.reviewerId).toBe('staff-1');
    expect(reviewing.reviewedAt).toBeTruthy();
    expect(fake.notifications).toHaveLength(0); // 核对中不通知

    // 修正版本还没发布：不能结案，保持处理中
    await expect(
      service.reviewCorrection(REVIEWER, created.id, {
        status: 'resolved',
        reviewNote: '已按补充公告修正为 12 人',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fake.notifications).toHaveLength(0);
    expect((await service.listMyCorrections('user-1'))[0]?.status).toBe(
      'reviewing',
    );
  });

  it('数据类纠错登记已发布的后续版本后结案：通知包含真实版本号与说明', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);
    // 纠错提交时是 v1，之后发布了 v2（补充公告）
    fake.corrections.find((row) => row.id === created.id)!.versionId =
      'ann-hefei-v1';

    const resolved = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'resolved',
      reviewNote: '已按补充公告修正为 12 人',
      resolvedVersionId: 'ann-hefei-v2',
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.reviewNote).toBe('已按补充公告修正为 12 人');
    expect(resolved.resolvedVersionId).toBe('ann-hefei-v2');
    expect(fake.notifications).toHaveLength(1);
    const notice = fake.notifications[0] as Record<string, unknown>;
    expect(notice.userId).toBe('user-1');
    expect(String(notice.title)).toContain('已处理完成');
    expect(String(notice.body)).toContain('第 2 版');
    expect(String(notice.body)).toContain('已按补充公告修正为 12 人');
  });

  it('rejected 必须附处理说明；终态后任何再次处理都被拒绝', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);

    await expect(
      service.reviewCorrection(REVIEWER, created.id, { status: 'rejected' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const rejected = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'rejected',
      reviewNote: '官方原文确为 8 人，补充公告未调整该岗位',
    });
    expect(rejected.status).toBe('rejected');
    expect(fake.notifications).toHaveLength(1);

    await expect(
      service.reviewCorrection(REVIEWER, created.id, { status: 'resolved' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fake.notifications).toHaveLength(1); // 被拒绝的推进不产生新通知
  });

  it('非数据类纠错可直接结案：必须写明实际处理结果，通知不声称发了新版本（R05）', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(
      fake.prisma,
      fakeProfileService,
      fakeScheduleService,
    );
    const created = await service.submitCorrection('user-1', 'unit-hefei-01-v2', {
      fieldPath: 'matching',
      content: '系统判断与官方条件不一致，请看原始公告',
    });

    await expect(
      service.reviewCorrection(REVIEWER, created.id, { status: 'submitted' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reviewCorrection(REVIEWER, created.id, { status: 'unknown' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // 结案必须有真实处理说明
    await expect(
      service.reviewCorrection(REVIEWER, created.id, { status: 'resolved' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // 非数据类问题不允许挂版本号
    await expect(
      service.reviewCorrection(REVIEWER, created.id, {
        status: 'resolved',
        reviewNote: '已复核匹配规则并复测',
        resolvedVersionId: 'ann-hefei-v2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const done = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'resolved',
      reviewNote: '已复核匹配规则并复测，结论已订正',
    });
    expect(done.status).toBe('resolved');
    expect(done.resolvedVersionId).toBeNull();
    const notice = fake.notifications[0] as Record<string, unknown>;
    expect(String(notice.body)).not.toContain('更正版本');
    expect(String(notice.body)).toContain('已复核匹配规则并复测');
  });

  it('终态重复提交同一结论按幂等返回，不重复通知（R05）', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(
      fake.prisma,
      fakeProfileService,
      fakeScheduleService,
    );
    const created = await service.submitCorrection('user-1', 'unit-hefei-01-v2', {
      fieldPath: 'other',
      content: '其他问题的足够长说明文字',
    });
    const rejected = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'rejected',
      reviewNote: '经核对官方原文，该反馈不成立',
    });
    expect(rejected.status).toBe('rejected');
    expect(fake.notifications).toHaveLength(1);

    const retry = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'rejected',
      reviewNote: '经核对官方原文，该反馈不成立',
    });
    expect(retry.status).toBe('rejected');
    expect(fake.notifications).toHaveLength(1);
  });

  it('无处理权限的角色不能处理纠错（服务层权限审计）（R05）', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);
    await expect(
      service.reviewCorrection(
        { id: 'staff-2', role: 'resource_reviewer' },
        created.id,
        { status: 'reviewing' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('处理不存在的纠错返回 404', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
    await expect(
      service.reviewCorrection(REVIEWER, 'cor-missing', { status: 'reviewing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('我的纠错列表只返回本人记录，并带字段中文标签与单元名', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);

    const mine = await service.listMyCorrections('user-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).toBe(created.id);
    expect(mine[0]?.fieldLabel).toBe('招聘人数 / 岗位信息');
    expect(mine[0]?.unitName).toBeTruthy();
    expect(await service.listMyCorrections('user-other')).toHaveLength(0);
  });

  it('员工队列支持按状态过滤并附带提交人账号信息；非法状态值 400', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);
    await service.reviewCorrection(REVIEWER, created.id, { status: 'reviewing' });

    const reviewingList = await service.listCorrectionsForStaff('reviewing');
    expect(reviewingList).toHaveLength(1);
    expect(reviewingList[0]?.submitter.email).toBe('u1@example.com');

    expect(await service.listCorrectionsForStaff('submitted')).toHaveLength(0);
    expect(await service.listCorrectionsForStaff(null)).toHaveLength(1);
    await expect(
      service.listCorrectionsForStaff('not-a-status'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('D08：need_supplement 必须附说明，用户可见理由并可回到核对中', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);

    await expect(
      service.reviewCorrection(REVIEWER, created.id, { status: 'need_supplement' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const need = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'need_supplement',
      reviewNote: '请补充公告原文中该岗位人数所在段落或截图入口',
    });
    expect(need.status).toBe('need_supplement');
    expect(fake.notifications).toHaveLength(1);
    expect(String((fake.notifications[0] as Record<string, unknown>).title)).toContain(
      '需要补充信息',
    );

    // 用户侧可查处理说明（需补充理由可查）
    const mine = await service.listMyCorrections('user-1');
    expect(mine[0]?.reviewNote).toContain('请补充公告原文');
    // 通知给出可执行路径：去哪里、怎么补充
    const needNotice = fake.notifications[0] as Record<string, unknown>;
    expect(String(needNotice.body)).toContain('我的资料');
    expect(String(needNotice.body)).toContain('重新提交');

    // 补充后可继续推进：need_supplement → reviewing → resolved（登记 v2 修正版本）
    fake.corrections.find((row) => row.id === created.id)!.versionId =
      'ann-hefei-v1';
    await service.reviewCorrection(REVIEWER, created.id, { status: 'reviewing' });
    const resolved = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'resolved',
      reviewNote: '已按补充材料修正',
      resolvedVersionId: 'ann-hefei-v2',
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedVersionId).toBe('ann-hefei-v2');
    // 需补充 1 条 + 已修正 1 条（reviewing 不通知）
    expect(fake.notifications).toHaveLength(2);
  });

  it('D08/R05：版本落点必须属于该公告版本链、未取代且晚于提交版本', async () => {
    const fake = createFakePrisma();
    const { service, created } = await seedCorrection(fake);

    await expect(
      service.reviewCorrection(REVIEWER, created.id, {
        status: 'resolved',
        resolvedVersionId: 'ann-unknown-version',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 已取代的旧版本不能作为修正落点
    await expect(
      service.reviewCorrection(REVIEWER, created.id, {
        status: 'resolved',
        reviewNote: '已修正',
        resolvedVersionId: 'ann-hefei-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 提交版本晚于登记版本（顺序不成立）同样拒绝
    fake.corrections.find((row) => row.id === created.id)!.versionId =
      'ann-hefei-v2';
    await expect(
      service.reviewCorrection(REVIEWER, created.id, {
        status: 'resolved',
        reviewNote: '已修正',
        resolvedVersionId: 'ann-hefei-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    fake.corrections.find((row) => row.id === created.id)!.versionId =
      'ann-hefei-v1';
    const resolved = await service.reviewCorrection(REVIEWER, created.id, {
      status: 'resolved',
      reviewNote: '已修正岗位人数为 12 人',
      resolvedVersionId: 'ann-hefei-v2',
    });
    expect(resolved.resolvedVersionId).toBe('ann-hefei-v2');
    const notice = fake.notifications[0] as Record<string, unknown>;
    expect(String(notice.body)).toContain('第 2 版');

    const mine = await service.listMyCorrections('user-1');
    expect(mine[0]?.resolvedVersionId).toBe('ann-hefei-v2');
  });

  it('D08：24 小时内同单元同字段同内容重复提交 409；限流达到上限拒绝', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
    const input = { fieldPath: 'major', content: '专业目录少列了一个专业名称' };
    await service.submitCorrection('user-1', 'unit-hefei-01-v2', input);
    await expect(
      service.submitCorrection('user-1', 'unit-hefei-01-v2', input),
    ).rejects.toBeInstanceOf(ConflictException);

    // 不同内容不受去重影响，但达到限流上限（20）后拒绝
    for (let i = 0; i < 19; i += 1) {
      await service.submitCorrection('user-1', 'unit-hefei-01-v2', {
        fieldPath: 'other',
        content: `第 ${i} 条足够长的其他问题说明`,
      });
    }
    await expect(
      service.submitCorrection('user-1', 'unit-hefei-01-v2', {
        fieldPath: 'other',
        content: '再提交一条足够长的其他问题说明',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 其他用户不受该用户限流影响
    await expect(
      service.submitCorrection('user-2', 'unit-hefei-01-v2', input),
    ).resolves.toBeTruthy();
  });
});

describe('OpportunitiesService：公告补录（D08 / PRD 11.9 U08）', () => {
  const REVIEWER = { id: 'staff-1', role: 'admin' };
  const VALID_INPUT = {
    officialUrl: 'https://example.gov.cn/2026/recruit-notice',
    publisherName: '某市人力资源和社会保障局',
    regionCode: '330100',
    note: '该公告已发布但站内未收录',
  };

  it('合法提交入库（存规范化链接与哈希），本人可查、他人不可见', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    const created = await service.submitAnnouncementSubmission('user-1', VALID_INPUT);
    expect(created.status).toBe('submitted');

    const mine = await service.listMyAnnouncementSubmissions('user-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.officialUrl).toBe('https://example.gov.cn/2026/recruit-notice');
    expect(mine[0]?.publisherName).toBe('某市人力资源和社会保障局');
    // 他人视角看不到
    expect(await service.listMyAnnouncementSubmissions('user-2')).toHaveLength(0);
  });

  it('非法与内网链接被拒：javascript:/ftp:/localhost/127.x/192.168.x/凭据 URL', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    for (const officialUrl of [
      'javascript:alert(1)',
      'ftp://example.gov.cn/a',
      'http://localhost:3000/notice',
      'http://127.0.0.1/notice',
      'http://192.168.1.10/notice',
      'http://10.0.0.5/notice',
      'http://172.16.0.9/notice',
      'http://[::1]/notice',
      'https://user:pass@example.gov.cn/notice',
      'not-a-url',
    ]) {
      await expect(
        service.submitAnnouncementSubmission('user-1', { ...VALID_INPUT, officialUrl }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(fake.submissions).toHaveLength(0);
  });

  it('缺单位、缺地区码、说明超长均 400', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    await expect(
      service.submitAnnouncementSubmission('user-1', { ...VALID_INPUT, publisherName: ' ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAnnouncementSubmission('user-1', { ...VALID_INPUT, regionCode: '33' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAnnouncementSubmission('user-1', { ...VALID_INPUT, note: '超'.repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('重复提交可识别：本人同链接 409；已收录链接任何人提交 409；24h 限流', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    const first = await service.submitAnnouncementSubmission('user-1', VALID_INPUT);
    await expect(
      service.submitAnnouncementSubmission('user-1', {
        ...VALID_INPUT,
        // 规范化后相同（默认端口/结尾斜杠/hash 差异不产生新提交）
        officialUrl: 'https://example.gov.cn:443/2026/recruit-notice/#top',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // 管理员标记已收录后，任何用户再提交同链接都被识别
    await service.reviewAnnouncementSubmission(REVIEWER, first.id, {
      status: 'resolved',
      reviewNote: '已纳入监测',
    });
    await expect(
      service.submitAnnouncementSubmission('user-2', VALID_INPUT),
    ).rejects.toBeInstanceOf(ConflictException);

    // 限流：user-3 连续 10 条后拒绝
    for (let i = 0; i < 10; i += 1) {
      await service.submitAnnouncementSubmission('user-3', {
        ...VALID_INPUT,
        officialUrl: `https://example.gov.cn/notice-${i}`,
      });
    }
    await expect(
      service.submitAnnouncementSubmission('user-3', {
        ...VALID_INPUT,
        officialUrl: 'https://example.gov.cn/notice-overflow',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('员工处理补录：need_supplement/rejected 须附说明并通知；resolved 通知已收录', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    const created = await service.submitAnnouncementSubmission('user-1', VALID_INPUT);

    const need = await service.reviewAnnouncementSubmission(REVIEWER, created.id, {
      status: 'need_supplement',
      reviewNote: '请补充公告标题或发文文号',
    });
    expect(need.status).toBe('need_supplement');
    const mineAfterNeed = await service.listMyAnnouncementSubmissions('user-1');
    expect(mineAfterNeed[0]?.reviewNote).toContain('请补充公告标题');

    const rejected = await service.reviewAnnouncementSubmission(REVIEWER, created.id, {
      status: 'rejected',
    });
    expect(rejected.status).toBe('rejected'); // need_supplement → rejected 允许（说明已在）
    await expect(
      service.reviewAnnouncementSubmission(REVIEWER, created.id, { status: 'resolved' }),
    ).rejects.toBeInstanceOf(ConflictException); // 终态不可改

    const second = await service.submitAnnouncementSubmission('user-2', VALID_INPUT);
    const resolved = await service.reviewAnnouncementSubmission(REVIEWER, second.id, {
      status: 'resolved',
    });
    expect(resolved.status).toBe('resolved');

    const titles = fake.notifications.map((n) => String((n as Record<string, unknown>).title));
    expect(titles.some((t) => t.includes('需要补充信息'))).toBe(true);
    expect(titles.some((t) => t.includes('暂未采纳'))).toBe(true);
    expect(titles.some((t) => t.includes('已收录处理'))).toBe(true);
  });

  it('员工队列支持状态过滤并附带提交人；非法状态 400；处理不存在记录 404', async () => {
    const fake = createFakePrisma();
    const service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);

    await service.submitAnnouncementSubmission('user-1', VALID_INPUT);
    const queue = await service.listAnnouncementSubmissionsForStaff('submitted');
    expect(queue).toHaveLength(1);
    expect(queue[0]?.submitter.email).toBe('u1@example.com');
    await expect(
      service.listAnnouncementSubmissionsForStaff('not-a-status'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reviewAnnouncementSubmission(REVIEWER, 'sub-missing', { status: 'reviewing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OpportunitiesService：新机会订阅（v7.1 M6）', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: OpportunitiesService;

  beforeEach(() => {
    fake = createFakePrisma();
    service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
  });

  it('订阅增改：未传字段用默认值补齐，可修改偏好与关闭', async () => {
    const created = await service.upsertSubscription('user-1', {
      regions: [{ code: '330100', province: '浙江省', city: '杭州市' }],
      naturePreference: 'official_open',
    });
    expect(created.subject).toBe('chinese');
    expect(created.enabled).toBe(true);
    expect(created.naturePreference).toBe('official_open');

    const updated = await service.upsertSubscription('user-1', {
      naturePreference: 'public_only',
      enabled: false,
    });
    expect(updated.naturePreference).toBe('public_only');
    expect(updated.enabled).toBe(false);
    // 地区未被覆盖，保持原值
    expect(updated.regions[0]).toMatchObject({ code: '330100' });
    expect(fake.subscriptions.size).toBe(1);
  });

  it('未开启订阅时同步不产生任何通知', async () => {
    const result = await service.syncSubscription('user-1');
    expect(result.subscribed).toBe(false);
    expect(result.newNotices).toBe(0);
    expect(fake.notifications).toHaveLength(0);
  });

  it('关闭订阅后停止新提醒；重新开启后恢复', async () => {
    await service.upsertSubscription('user-1', {
      regions: [{ code: '330100', province: '浙江省', city: '杭州市' }],
      enabled: false,
    });
    const closed = await service.syncSubscription('user-1');
    expect(closed.enabled).toBe(false);
    expect(fake.notifications).toHaveLength(0);

    await service.upsertSubscription('user-1', { enabled: true });
    const reopened = await service.syncSubscription('user-1');
    expect(reopened.enabled).toBe(true);
  });

  it('首次同步基线回填不产生通知；重复同步幂等；改宽地区后按新条件生效', async () => {
    await service.upsertSubscription('user-1', {
      regions: [{ code: '330100', province: '浙江省', city: '杭州市' }],
    });
    const first = await service.syncSubscription('user-1');
    expect(first.backfilled).toBeGreaterThan(0);
    expect(first.newNotices).toBe(0);
    expect(fake.notifications).toHaveLength(0);
    const logsAfterFirst = fake.noticeLogs.length;

    const repeat = await service.syncSubscription('user-1');
    expect(repeat.newNotices).toBe(0);
    expect(repeat.backfilled).toBe(0);
    expect(fake.noticeLogs.length).toBe(logsAfterFirst);

    // 修改订阅（扩大到省级）：新匹配公告产生一次站内提醒
    await service.upsertSubscription('user-1', {
      regions: [{ code: '330000', province: '浙江省' }],
    });
    const widened = await service.syncSubscription('user-1');
    expect(widened.newNotices).toBeGreaterThan(0);
    expect(fake.notifications).toHaveLength(widened.newNotices);
    expect(fake.notifications[0]).toMatchObject({ severity: 'info' });

    // 再次同步：同一版本不重复
    const again = await service.syncSubscription('user-1');
    expect(again.newNotices).toBe(0);
    expect(fake.notifications).toHaveLength(widened.newNotices);
  });

  it('账号隔离：用户 B 首次同步独立回填，不受用户 A 日志影响', async () => {
    await service.upsertSubscription('user-1', {
      regions: [{ code: '330000', province: '浙江省' }],
    });
    await service.syncSubscription('user-1');
    const aLogs = fake.noticeLogs.length;
    expect(aLogs).toBeGreaterThan(0);

    await service.upsertSubscription('user-2', {
      regions: [{ code: '330000', province: '浙江省' }],
    });
    const b = await service.syncSubscription('user-2');
    expect(b.backfilled).toBe(aLogs);
    expect(b.newNotices).toBe(0);
    // B 的回填不产生通知，A 的状态未被影响
    expect(fake.notifications).toHaveLength(0);
    expect(fake.noticeLogs.filter((r) => r.userId === 'user-2')).toHaveLength(aLogs);
  });
});

describe('OpportunitiesService：单位关注（D07 / PRD 11.8 U07）', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: OpportunitiesService;

  beforeEach(() => {
    fake = createFakePrisma();
    service = new OpportunitiesService(fake.prisma, fakeProfileService, fakeScheduleService);
  });

  it('关注/列表/取消：身份键精确匹配，重复关注幂等，取消费等', async () => {
    const created = await service.followOrganization('user-1', {
      publisherName: '杭州市教育局',
      regionCode: '330000',
    });
    expect(created.identityKey).toBe('杭州市教育局@330000');

    // 首尾空白不影响身份键（NFKC + 折叠空白）
    const again = await service.followOrganization('user-1', {
      publisherName: '  杭州市教育局  ',
      regionCode: '330000',
    });
    expect(again.id).toBe(created.id);
    expect(again.followedAt).toBe(created.followedAt);
    expect(fake.orgFollows).toHaveLength(1);

    const list = await service.listOrganizationFollows('user-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.publisherName).toBe('杭州市教育局');

    await service.unfollowOrganization('user-1', created.identityKey);
    expect(await service.listOrganizationFollows('user-1')).toHaveLength(0);
    // 重复取消幂等
    await expect(
      service.unfollowOrganization('user-1', created.identityKey),
    ).resolves.toEqual({ ok: true });
  });

  it('参数校验：缺发布主体、地区码非法、空身份键均 400', async () => {
    await expect(
      service.followOrganization('user-1', { publisherName: '', regionCode: '330000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.followOrganization('user-1', { publisherName: 'x', regionCode: '330' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.unfollowOrganization('user-1', ''),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('首次同步基线回填不通知；重复同步幂等；无订阅也能同步单位关注', async () => {
    await service.followOrganization('user-1', {
      publisherName: '杭州市教育局',
      regionCode: '330000',
    });
    const first = await service.syncSubscription('user-1');
    expect(first.subscribed).toBe(false); // 未开启订阅
    expect(first.orgBackfilled).toBeGreaterThan(0);
    expect(first.orgNewNotices).toBe(0);
    expect(fake.notifications).toHaveLength(0);
    expect(
      fake.noticeLogs.filter(
        (r) => r.userId === 'user-1' && String(r.dedupKey).startsWith('org:'),
      ).length,
    ).toBe(first.orgBackfilled);

    const again = await service.syncSubscription('user-1');
    expect(again.orgBackfilled).toBe(0);
    expect(again.orgNewNotices).toBe(0);
    expect(fake.notifications).toHaveLength(0);
    // 首次同步写入持久化水位，不再依赖「历史键是否为空」判断
    expect(fake.orgFollows[0]?.baselineSyncedAt).toBeInstanceOf(Date);
  });

  it('关注时没有匹配公告：首次同步仍写入基线水位（R04 漏报回归）', async () => {
    await service.followOrganization('user-1', {
      publisherName: '不存在的单位',
      regionCode: '330000',
    });
    const first = await service.syncSubscription('user-1');
    expect(first.orgNewNotices).toBe(0);
    expect(first.orgBackfilled).toBe(0);
    expect(fake.orgFollows[0]?.baselineSyncedAt).toBeInstanceOf(Date);
  });

  it('首次同步遇到关注后才发布的公告：产生提醒而非静默回填', async () => {
    const loadCatalog = (
      service as unknown as {
        loadCatalog: () => Promise<RecruitmentAnnouncement[]>;
      }
    ).loadCatalog.bind(service);
    const catalog = await loadCatalog();
    const today = new Date().toISOString().slice(0, 10);
    const target = catalog.find((a) => {
      const version = a.versions[a.versions.length - 1]!;
      return (
        a.lifecycle === 'active' &&
        isUserVisibleInCatalog(a) &&
        a.officialUrl.startsWith('https://') &&
        a.sourceHealth?.ok !== false &&
        version.officialSource.state === 'official' &&
        (version.timeline.registrationEnd ?? '') >= today
      );
    });
    expect(target).toBeTruthy();
    const followed = await service.followOrganization('user-1', {
      publisherName: target!.publisher,
      regionCode: target!.region.code,
    });
    // 模拟：关注发生在公告发布之前，且首次同步尚未完成
    const row = fake.orgFollows.find(
      (r) => r.identityKey === followed.identityKey,
    )!;
    row.followedAt = new Date('2020-01-01T00:00:00Z');
    row.baselineSyncedAt = null;

    const result = await service.syncSubscription('user-1');
    expect(result.orgNewNotices).toBeGreaterThan(0);
    expect(fake.notifications.length).toBeGreaterThan(0);
    // 提醒后水位写入，重复同步不重复提醒
    const repeat = await service.syncSubscription('user-1');
    expect(repeat.orgNewNotices).toBe(0);
    expect(fake.notifications.length).toBe(result.orgNewNotices);
  });

  it('订阅关闭只停订阅提醒，单位关注同步照常回填', async () => {
    await service.upsertSubscription('user-1', {
      regions: [{ code: '330000', province: '浙江省' }],
      enabled: false,
    });
    await service.followOrganization('user-1', {
      publisherName: '杭州市教育局',
      regionCode: '330000',
    });
    const result = await service.syncSubscription('user-1');
    expect(result.enabled).toBe(false);
    expect(result.backfilled).toBe(0);
    expect(result.orgBackfilled).toBeGreaterThan(0);
  });

  it('账号隔离：同名单位不同用户各自独立回填', async () => {
    await service.followOrganization('user-1', {
      publisherName: '杭州市教育局',
      regionCode: '330000',
    });
    await service.followOrganization('user-2', {
      publisherName: '杭州市教育局',
      regionCode: '330000',
    });
    const a = await service.syncSubscription('user-1');
    expect(a.orgBackfilled).toBeGreaterThan(0);
    const b = await service.syncSubscription('user-2');
    expect(b.orgBackfilled).toBe(a.orgBackfilled);
    expect(fake.notifications).toHaveLength(0);
  });
});
