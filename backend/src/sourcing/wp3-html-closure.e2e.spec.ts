/**
 * v7.2 工作包 3：真实端到端 HTML 数据闭环（无网络，注入 fetch/DNS）。
 *
 * 链路：黄金样本 → SafeFetcher 快照 → HangzhouEducationAdapter 解析
 *       → 目录载荷 → PublishedAnnouncementVersion 已发布行 → PublishedCatalogRepository
 *       → OpportunitiesService.match 命中。
 *
 * 断言用 JSON.stringify(res)：闸门/时效可能把单元放进 groups.closed，
 * 但该单元 id 仍应出现在响应中。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';
import { SafeFetcher } from './fetch/safe-fetcher.js';
import type { DownloadedSnapshot } from './official-site-adapter.js';
import { PublishedCatalogRepository } from '../catalog/published-catalog.repository.js';
import type { UserRecruitmentProfile } from '../matching/types.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';

const LIST_URL = 'https://edu.hangzhou.gov.cn/col/col123/index.html';
const DETAIL_URL =
  'https://edu.hangzhou.gov.cn/art/2026/10/9/art_1229391906_59012345.html';

const PROFILE: UserRecruitmentProfile = {
  regions: [{ code: '330000', province: '浙江省', level: 'required' }],
  educationLevel: 'bachelor',
  degree: 'bachelor',
  majorFullName: '汉语言文学（师范）',
  graduationDate: '2026-06-30',
  employmentStatus: 'fresh_unemployed',
  socialSecurityMonths: 0,
  teacherCert: { status: 'obtained', subject: 'chinese', stage: 'high' },
  acceptedEmploymentNatures: [
    'public_institution_staff',
    'record_filing',
    'post_quota',
    'headcount_control',
    'other',
  ],
};

function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'hangzhou',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/hangzhou 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const readSample = (name: string): string =>
  readFileSync(path.join(GOLDEN_DIR, name), 'utf8');

function toSnapshot(url: string, body: string, mimeType: string): DownloadedSnapshot {
  return { url, mimeType, content: body, fetchedAt: new Date().toISOString() };
}

/** 构造无网络闭环：样本 → 快照 → Adapter → 载荷 → 内存 prisma → service */
async function buildClosure() {
  const listHtml = readSample('list.html');
  const detailHtml = readSample('detail.html');
  const htmlByUrl: Record<string, string> = {
    [LIST_URL]: listHtml,
    [DETAIL_URL]: detailHtml,
  };
  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const html = htmlByUrl[url];
    if (!html) {
      return new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const fetcher = new SafeFetcher({
    allowedHosts: ['edu.hangzhou.gov.cn'],
    resolveDns: async () => ['203.0.113.10'],
    fetchImpl,
    sleep: async () => {},
  });
  const adapter = new HangzhouEducationAdapter();

  const listResult = await fetcher.fetch(LIST_URL);
  expect(listResult.mimeType).toBe('text/html');
  const items = adapter.listItems(
    toSnapshot(listResult.finalUrl, listResult.body, listResult.mimeType),
  );
  expect(items).toHaveLength(1);
  const item = items[0];

  const detailResult = await fetcher.fetch(item.detailUrl);
  const detail = adapter.parseDetail(
    toSnapshot(detailResult.finalUrl, detailResult.body, detailResult.mimeType),
  );

  // 目录载荷：最小元数据，显式标注 dataset:'test'；核对时间用当前时间避免 evidence_stale
  const reviewedAt = new Date().toISOString();
  const announcement = {
    id: 'hz-closure-ann',
    title: detail.title,
    publisher: '杭州市教育局',
    organizationType: 'government_unified',
    officialUrl: detail.canonicalUrl,
    subjectScope: ['chinese'],
    region: { code: '330100', province: '浙江省', city: '杭州市' },
    lifecycle: 'active',
    firstPublishedAt: detail.publishedAt,
  };
  const version = {
    id: 'hz-closure-ann-v1',
    announcementId: 'hz-closure-ann',
    versionNumber: 1,
    sourceKind: 'original',
    publishedAt: reviewedAt,
    officialSource: {
      id: 'hz-closure-official',
      locator: { kind: 'url', url: detail.canonicalUrl },
      state: 'official',
      checkedAt: reviewedAt,
    },
    timeline: { registrationStart: '2026-10-10', registrationEnd: '2026-10-20' },
    units: [
      {
        id: 'hz-closure-unit-01',
        code: 'HZ-01',
        name: '杭州市教育局所属学校（高中语文）',
        announcementId: 'hz-closure-ann',
        versionId: 'hz-closure-ann-v1',
        region: { code: '330100', province: '浙江省', city: '杭州市' },
        subject: 'chinese',
        stage: 'high',
        headcount: 2,
        organizationType: 'government_unified',
        employmentNature: {
          code: 'public_institution_staff',
          officialName: '事业编制',
        },
        allocation: { code: 'unified_assignment', description: '统一调配' },
        requirements: [
          {
            id: 'hz-closure-edu',
            dimension: 'education',
            description: '本科及以上学历',
            hard: true,
            criterion: { kind: 'education', minLevel: 'bachelor' },
            evidence: {
              id: 'hz-closure-edu-ev',
              locator: {
                kind: 'excerpt',
                excerpt: '具有国家承认的本科及以上学历',
              },
              state: 'official',
              checkedAt: reviewedAt,
            },
          },
        ],
      },
    ],
  };

  let dbReads = 0;
  const prisma = {
    publishedAnnouncementVersion: {
      findMany: async () => {
        dbReads += 1;
        return [
          {
            id: 'hz-pav-1',
            announcementId: 'hz-closure-ann',
            versionNumber: 1,
            status: 'published',
            payload: { dataset: 'test', announcement, version },
            publishedAt: new Date(),
            previousVersionId: null,
            supersededAt: null,
          },
        ];
      },
    },
    followedOpportunity: { findMany: async () => [] },
  } as never;

  const repo = new PublishedCatalogRepository(prisma);
  const profileService = { getProfile: async () => null } as never;
  const scheduleService = {
    syncEventsForUser: async () => ({ syncedEventCount: 0 }),
  } as never;
  const service = new OpportunitiesService(
    prisma,
    profileService,
    scheduleService,
    repo,
  );

  return {
    service,
    repo,
    detail,
    dbReads: () => dbReads,
  };
}

describe('WP3 端到端闭环：HTML 样本 → 快照 → Adapter → published 行 → 匹配', () => {
  let prevFlag: string | undefined;

  beforeEach(() => {
    prevFlag = process.env.FF_DB_CATALOG;
    process.env.FF_DB_CATALOG = 'on';
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.FF_DB_CATALOG;
    else process.env.FF_DB_CATALOG = prevFlag;
  });

  it('flag 开：DB 已发布单元出现在匹配结果中，且只读 DB 不合并静态目录', async () => {
    const { service, dbReads } = await buildClosure();

    const res = await service.match(PROFILE);

    expect(dbReads()).toBeGreaterThan(0);
    expect(JSON.stringify(res)).toContain('hz-closure-unit-01');
    // 证明生产 flag 开时不合并静态演示目录
    expect(JSON.stringify(res)).not.toContain('unit-hangzhou-01');
    expect(res.meta.catalogVersion).toBeTruthy();
  });

  it('无进程内缓存：重复 match 每次重新读 DB，单元 id 持续命中', async () => {
    const { service, dbReads } = await buildClosure();

    const first = await service.match(PROFILE);
    const second = await service.match(PROFILE);

    expect(JSON.stringify(first)).toContain('hz-closure-unit-01');
    expect(JSON.stringify(second)).toContain('hz-closure-unit-01');
    expect(dbReads()).toBeGreaterThanOrEqual(2);
  });

  it('repo.getUnit：按单元 id 取到目录当前有效版本', async () => {
    const { repo } = await buildClosure();

    const ref = await repo.getUnit('hz-closure-unit-01', new Date());

    expect(ref).not.toBeNull();
    expect(JSON.stringify(ref)).toContain('hz-closure-unit-01');
  });
});
