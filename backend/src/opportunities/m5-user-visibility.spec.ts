/**
 * M5：同一审核成果进入用户用途（合规可见性 + 已审核真实数据被用户端读取）。
 *
 * 覆盖可离线测项：
 * - M5-02：DB 已发布且 human_reviewed 的真实岗位，经正式 match 服务被用户端读到
 *   （不是另一份静态 JSON，而是 PublishedCatalogRepository 读回的投影结果）；
 * - M5-03：AI 初核待复核（ai_reviewed_pending）的真实记录不误导为可读/可关注；
 * - M5-05：test 样本不进入用户端目录（历史/demo/test 不计入当前真实可报）。
 *
 * 真实 PostgreSQL 落库 / 浏览器端到端 / 真实 S1 导入：见 M5-report 未验证项。
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

function makePublishedRow(opts: {
  dataset: 'test' | 'demo' | 'real';
  reviewStatus?: 'ai_reviewed_pending' | 'human_reviewed';
  unitId: string;
  announcementId: string;
  title: string;
}) {
  return {
    id: `pav-${opts.announcementId}`,
    announcementId: opts.announcementId,
    runId: `run-${opts.announcementId}`,
    versionNumber: 1,
    status: 'published',
    payload: {
      dataset: opts.dataset,
      announcement: {
        id: opts.announcementId,
        title: opts.title,
        publisher: '测试市教育局',
        organizationType: 'government_unified',
        officialUrl: 'https://www.example.gov.cn/test/notice',
        subjectScope: ['chinese'],
        region: { code: '330100', province: '浙江省', city: '杭州市' },
        lifecycle: 'active',
        firstPublishedAt: '2026-10-10T00:00:00.000Z',
        ...(opts.reviewStatus ? { reviewStatus: opts.reviewStatus } : {}),
      },
      version: {
        id: `${opts.announcementId}-v1`,
        announcementId: opts.announcementId,
        versionNumber: 1,
        sourceKind: 'original',
        publishedAt: '2026-10-10T02:00:00.000Z',
        officialSource: {
          id: `${opts.announcementId}-src`,
          locator: { kind: 'url', url: 'https://www.example.gov.cn/test/notice' },
          state: 'official',
          checkedAt: '2026-10-10T00:00:00.000Z',
        },
        timeline: { registrationStart: '2026-10-10', registrationEnd: '2026-11-20' },
        units: [
          {
            id: opts.unitId,
            code: `${opts.announcementId}-01`,
            name: `${opts.title}（初中语文）`,
            announcementId: opts.announcementId,
            versionId: `${opts.announcementId}-v1`,
            region: { code: '330107', province: '浙江省', city: '杭州市', district: '测试区' },
            subject: 'chinese',
            stage: 'middle',
            headcount: 2,
            organizationType: 'government_unified',
            employmentNature: { code: 'public_institution_staff', officialName: '事业编制' },
            allocation: { code: 'unified_assignment', description: '统一调配' },
            requirements: [
              {
                id: `${opts.announcementId}-edu`,
                dimension: 'education',
                description: '本科及以上学历',
                hard: true,
                criterion: { kind: 'education', minLevel: 'bachelor' },
                evidence: {
                  id: `${opts.announcementId}-edu-ev`,
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
}

function createService(rows: unknown[]) {
  const followRows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const prisma = {
    followedOpportunity: {
      findUnique: async ({ where }: { where: { userId_unitId: { userId: string; unitId: string } } }) =>
        followRows.get(`${where.userId_unitId.userId}::${where.userId_unitId.unitId}`) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...followRows.values()].filter((r) => r.userId === where.userId),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `gen-${++seq}` };
        followRows.set(`${row.userId}::${row.unitId}`, row);
        return row;
      },
    },
    publishedAnnouncementVersion: {
      findMany: async () => rows,
    },
  };
  const profileService = { getProfile: async () => null } as never;
  const scheduleService = { syncEventsForUser: async () => ({ syncedEventCount: 0 }) } as never;
  const service = new OpportunitiesService(prisma as never, profileService, scheduleService);
  return { service };
}

describe('M5：已审核成果进入用户端', () => {
  it('M5-02：DB 已发布 human_reviewed 真实岗位经正式 match 被用户端读到', async () => {
    const rows = [
      makePublishedRow({
        dataset: 'real',
        reviewStatus: 'human_reviewed',
        unitId: 'fx-real-reviewed-unit',
        announcementId: 'fx-ann-real-reviewed',
        title: '已人工复核的真实公告',
      }),
    ];
    const { service } = createService(rows);
    const prev = process.env.FF_DB_CATALOG;
    try {
      process.env.FF_DB_CATALOG = 'on';
      const res = await service.match(PROFILE);
      // 已复核真实岗位出现在匹配结果（preliminary 或 needInfo 等分组之一）
      const all = [
        ...res.groups.preliminary,
        ...res.groups.needInfo.flatMap((g) => g.units),
        ...res.groups.manualReview,
        ...res.groups.notEligible,
        ...res.groups.closed,
      ];
      expect(all.map((u) => u.unit.id)).toContain('fx-real-reviewed-unit');
    } finally {
      if (prev === undefined) delete process.env.FF_DB_CATALOG;
      else process.env.FF_DB_CATALOG = prev;
    }
  });

  it('M5-03：AI 初核待复核（ai_reviewed_pending）真实记录不进入用户端', async () => {
    const rows = [
      makePublishedRow({
        dataset: 'real',
        reviewStatus: 'ai_reviewed_pending',
        unitId: 'fx-ai-pending-unit',
        announcementId: 'fx-ann-ai-pending',
        title: 'AI 初核待复核公告',
      }),
    ];
    const { service } = createService(rows);
    const prev = process.env.FF_DB_CATALOG;
    try {
      process.env.FF_DB_CATALOG = 'on';
      const res = await service.match(PROFILE);
      const all = [
        ...res.groups.preliminary,
        ...res.groups.needInfo.flatMap((g) => g.units),
        ...res.groups.manualReview,
        ...res.groups.notEligible,
        ...res.groups.closed,
      ];
      expect(all.map((u) => u.unit.id)).not.toContain('fx-ai-pending-unit');
    } finally {
      if (prev === undefined) delete process.env.FF_DB_CATALOG;
      else process.env.FF_DB_CATALOG = prev;
    }
  });

  it('M5-05：test 样本不进入用户端目录（即便被标记 human_reviewed）', async () => {
    const rows = [
      makePublishedRow({
        dataset: 'test',
        reviewStatus: 'human_reviewed',
        unitId: 'fx-test-unit',
        announcementId: 'fx-ann-test',
        title: '自动化测试样本',
      }),
    ];
    const { service } = createService(rows);
    const prev = process.env.FF_DB_CATALOG;
    try {
      process.env.FF_DB_CATALOG = 'on';
      const res = await service.match(PROFILE);
      const all = [
        ...res.groups.preliminary,
        ...res.groups.needInfo.flatMap((g) => g.units),
        ...res.groups.manualReview,
        ...res.groups.notEligible,
        ...res.groups.closed,
      ];
      expect(all.map((u) => u.unit.id)).not.toContain('fx-test-unit');
    } finally {
      if (prev === undefined) delete process.env.FF_DB_CATALOG;
      else process.env.FF_DB_CATALOG = prev;
    }
  });

  it('M5-03b：human_reviewed real 岗位可关注（findCatalogUnit 不再因 dataset=real 被挡）', async () => {
    const rows = [
      makePublishedRow({
        dataset: 'real',
        reviewStatus: 'human_reviewed',
        unitId: 'fx-real-follow-unit',
        announcementId: 'fx-ann-real-follow',
        title: '可关注的真实公告',
      }),
    ];
    const { service } = createService(rows);
    const prev = process.env.FF_DB_CATALOG;
    try {
      process.env.FF_DB_CATALOG = 'on';
      // follow 会调用 findCatalogUnit → 之前 dataset==='real' 会被挡，现在 human_reviewed 应能关注
      const dto = await service.follow('user-1', 'fx-real-follow-unit');
      expect(dto.unitId).toBe('fx-real-follow-unit');
      expect(dto.status).toBe('considering');
    } finally {
      if (prev === undefined) delete process.env.FF_DB_CATALOG;
      else process.env.FF_DB_CATALOG = prev;
    }
  });
});
