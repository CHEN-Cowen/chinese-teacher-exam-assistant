/**
 * v7.2 工作包 0：链路③（后台发布→DB 已发布→用户匹配）与
 * 链路④（保存→一个下一步）的回归保护。
 *
 * 测试分两类：
 * - 「现状固化」：锁定当前真实行为，后续工作包改动导致行为变化时必须先更新本文件；
 * - it.fails「失败测试」：断言 v7.2 目标行为，当前必然失败，
 *   对应工作包（WP3/WP5）完成后转绿——这是工作包 0 完成门要求的
 *   「新需求有失败测试或明确验收脚本」，不是缺陷，不允许删除或改断言放水。
 *
 * 落地进度：
 * - 链路③ 的目标用例已随 WP3 落地转绿（FF_DB_CATALOG=on 时读 DB 已发布版本）；
 *   链路③ 的「现状固化」用例仍保留，固化缺省（关）时的静态目录现状。
 * - 链路④ 目标用例仍为 it.fails，待 WP5 落地后同样反转。
 */
import { describe, expect, it } from 'vitest';
import type { UserRecruitmentProfile } from '../matching/types.js';
import { OpportunitiesService } from './opportunities.service.js';

const PROFILE: UserRecruitmentProfile = {
  regions: [{ code: '330000', province: '浙江省', level: 'required' }],
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

/** DB 中一条已发布公告版本（对齐 Prisma PublishedAnnouncementVersion 结构） */
const DB_PUBLISHED_ROW = {
  id: 'fx-pav-0001',
  announcementId: 'fx-ann-db-priority',
  runId: 'fx-run-0001',
  versionNumber: 1,
  status: 'published',
  payload: {
    dataset: 'real',
    announcement: {
      id: 'fx-ann-db-priority',
      title: '数据库已发布公告（人工复核）',
      publisher: '测试市教育局',
      organizationType: 'government_unified',
      officialUrl: 'https://www.example.gov.cn/test/db-notice',
      subjectScope: ['chinese'],
      region: { code: '330100', province: '浙江省', city: '杭州市' },
      lifecycle: 'active',
      firstPublishedAt: '2026-10-10T00:00:00.000Z',
      // M5：已发布进用户端的正确语义是「真实数据 + 已人工复核」，
      // 而非 test 样本（test 按 M5-05 不得进入用户端目录）。
      reviewStatus: 'human_reviewed',
      reviewedBy: 'fx-reviewer',
      reviewedAt: '2026-10-10T01:00:00.000Z',
    },
    version: {
      id: 'fx-ann-db-priority-v1',
      announcementId: 'fx-ann-db-priority',
      versionNumber: 1,
      sourceKind: 'original',
      publishedAt: '2026-10-10T02:00:00.000Z',
      officialSource: {
        id: 'fx-db-evidence-official',
        locator: { kind: 'url', url: 'https://www.example.gov.cn/test/db-notice' },
        state: 'official',
        checkedAt: '2026-10-10T00:00:00.000Z',
      },
      timeline: { registrationStart: '2026-10-10', registrationEnd: '2026-11-20' },
      units: [
        {
          id: 'fx-unit-db-priority',
          code: 'FX-DB-01',
          name: '测试市第五中学（初中语文）',
          announcementId: 'fx-ann-db-priority',
          versionId: 'fx-ann-db-priority-v1',
          region: { code: '330107', province: '浙江省', city: '杭州市', district: '测试区' },
          subject: 'chinese',
          stage: 'middle',
          headcount: 2,
          organizationType: 'government_unified',
          employmentNature: { code: 'public_institution_staff', officialName: '事业编制（测试）' },
          allocation: { code: 'unified_assignment', description: '测试分配方式' },
          requirements: [
            {
              id: 'fx-db-edu',
              dimension: 'education',
              description: '本科及以上学历',
              hard: true,
              criterion: { kind: 'education', minLevel: 'bachelor' },
              evidence: {
                id: 'fx-db-evidence-edu',
                locator: { kind: 'excerpt', excerpt: '具有国家承认的本科及以上学历' },
                state: 'official',
                checkedAt: '2026-10-10T00:00:00.000Z',
              },
            },
          ],
        },
      ],
    },
  },
  publishedAt: new Date('2026-10-10T02:00:00.000Z'),
  previousVersionId: null,
  supersededAt: null,
};

function createService(rows = [DB_PUBLISHED_ROW]) {
  const followRows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  let dbReads = 0;
  const prisma = {
    followedOpportunity: {
      findUnique: async ({
        where,
      }: {
        where: { userId_unitId: { userId: string; unitId: string } };
      }) =>
        followRows.get(`${where.userId_unitId.userId}::${where.userId_unitId.unitId}`) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...followRows.values()].filter((r) => r.userId === where.userId),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `gen-${++seq}` };
        followRows.set(`${row.userId}::${row.unitId}`, row);
        return row;
      },
    },
    // WP3 的目标读取点；当前 service 不调用，调用计数用于固化现状
    publishedAnnouncementVersion: {
      findMany: async () => {
        dbReads += 1;
        return rows;
      },
    },
  };
  const profileService = { getProfile: async () => null } as never;
  const scheduleService = {
    syncEventsForUser: async () => ({ syncedEventCount: 0 }),
  } as never;
  const service = new OpportunitiesService(prisma as never, profileService, scheduleService);
  return { service, dbReads: () => dbReads };
}

describe('S2 正式目录隔离', () => {
  it.each(['demo', 'test'])('数据库中的 %s 不进入正式机会', async (dataset) => {
    const row = structuredClone(DB_PUBLISHED_ROW);
    row.payload.dataset = dataset;
    const { service } = createService([row]);
    const previous = process.env.FF_DB_CATALOG;
    try {
      process.env.FF_DB_CATALOG = 'on';
      expect(JSON.stringify(await service.match(PROFILE))).not.toContain('fx-unit-db-priority');
    } finally {
      if (previous === undefined) delete process.env.FF_DB_CATALOG;
      else process.env.FF_DB_CATALOG = previous;
    }
  });
});

describe('链路③：后台发布 → DB 已发布版本 → 用户匹配结果', () => {
  it('现状固化：匹配目录不读数据库，DB 中的已发布单元不出现在结果里（WP3 落地时必须反转本测试）', async () => {
    const { service, dbReads } = createService();
    const res = await service.match(PROFILE);
    expect(dbReads()).toBe(0);
    expect(JSON.stringify(res)).not.toContain('fx-unit-db-priority');
  });

  // WP3 目标行为（R-WP3-01/05）：PublishedCatalogRepository 读 DB，
  // 发布无需重部署即进入用户匹配。已随 WP3 落地转绿。
  it('目标行为（WP3）：DB 已发布单元出现在匹配结果中，且无需改静态目录', async () => {
    const { service, dbReads } = createService();
    const prev = process.env.FF_DB_CATALOG;
    try {
      process.env.FF_DB_CATALOG = 'on';
      const res = await service.match(PROFILE);
      expect(JSON.stringify(res)).toContain('fx-unit-db-priority');
      expect(dbReads()).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) {
        delete process.env.FF_DB_CATALOG;
      } else {
        process.env.FF_DB_CATALOG = prev;
      }
    }
  });
});

describe('链路④：保存机会 → 显示一个下一步', () => {
  it('现状固化：保存返回关注 DTO（含日程同步计数），无下一步结构（WP5 落地时必须更新本测试）', async () => {
    const { service } = createService();
    const dto = await service.follow('user-1', 'unit-hangzhou-01');
    expect(dto.status).toBe('considering');
    expect(dto.syncedEventCount).toBe(0);
    expect((dto as unknown as Record<string, unknown>).nextStep).toBeUndefined();
  });

  // WP5 目标行为（R-WP5-01 / PRD 7.4.5）：保存成功后返回恰好一个下一步，
  // 取值限定五类：阻塞条件 / 72 小时节点 / 缺失材料 / 普通日程 / 待官方通知。
  it.fails('目标行为（WP5）：保存响应携带恰好一个下一步，且类型属于五类之一', async () => {
    const { service } = createService();
    const dto = await service.follow('user-1', 'unit-hangzhou-01');
    const nextStep = (dto as unknown as { nextStep?: { kind: string } }).nextStep;
    expect(nextStep).toBeDefined();
    expect([
      'blocking_requirement',
      'deadline_within_72h',
      'missing_material',
      'schedule',
      'pending_official_notice',
    ]).toContain(nextStep!.kind);
  });
});
