/**
 * v7.2 工作包 3：已发布目录仓库（PublishedCatalogRepository）单元测试。
 *
 * 用内存 prisma 假对象驱动；输入数据内联，不 import tests/fixtures。
 */
import { describe, expect, it, vi } from 'vitest';
import { currentVersion } from '../matching/engine.js';
import { PublishedCatalogRepository } from './published-catalog.repository.js';

const NOW = new Date('2026-10-13T00:00:00.000Z');

/** 一条合法载荷（结构对齐 DB_PUBLISHED_ROW.payload） */
function basePayload(): any {
  return {
    dataset: 'test',
    announcement: {
      id: 'fx-ann-db-priority',
      title: '【测试】数据库已发布公告',
      publisher: '测试市教育局',
      organizationType: 'government_unified',
      officialUrl: 'https://www.example.gov.cn/test/db-notice',
      subjectScope: ['chinese'],
      region: { code: '330100', province: '浙江省', city: '杭州市' },
      lifecycle: 'active',
      firstPublishedAt: '2026-10-10T00:00:00.000Z',
    },
    version: {
      id: 'fx-ann-db-priority-v1',
      announcementId: 'fx-ann-db-priority',
      versionNumber: 1,
      sourceKind: 'original',
      publishedAt: '2026-10-10T02:00:00.000Z',
      officialSource: {
        id: 'fx-db-evidence-official',
        locator: {
          kind: 'url',
          url: 'https://www.example.gov.cn/test/db-notice',
        },
        state: 'official',
        checkedAt: '2026-10-10T00:00:00.000Z',
      },
      timeline: {
        registrationStart: '2026-10-10',
        registrationEnd: '2026-11-20',
      },
      units: [
        {
          id: 'fx-unit-db-priority',
          code: 'FX-DB-01',
          name: '测试市第五中学（初中语文）',
          announcementId: 'fx-ann-db-priority',
          versionId: 'fx-ann-db-priority-v1',
          region: {
            code: '330107',
            province: '浙江省',
            city: '杭州市',
            district: '测试区',
          },
          subject: 'chinese',
          stage: 'middle',
          headcount: 2,
          organizationType: 'government_unified',
          employmentNature: {
            code: 'public_institution_staff',
            officialName: '事业编制（测试）',
          },
          allocation: {
            code: 'unified_assignment',
            description: '测试分配方式',
          },
          requirements: [
            {
              id: 'fx-db-edu',
              dimension: 'education',
              description: '本科及以上学历',
              hard: true,
              criterion: { kind: 'education', minLevel: 'bachelor' },
              evidence: {
                id: 'fx-db-evidence-edu',
                locator: {
                  kind: 'excerpt',
                  excerpt: '具有国家承认的本科及以上学历',
                },
                state: 'official',
                checkedAt: '2026-10-10T00:00:00.000Z',
              },
            },
          ],
        },
      ],
    },
  };
}

/** v2 载荷：结构损坏（unit 缺 headcount），用于验证跳过后回退上一版 */
function corruptedV2Payload(): any {
  const payload = basePayload();
  payload.version.id = 'fx-ann-db-priority-v2';
  payload.version.versionNumber = 2;
  payload.version.publishedAt = '2026-10-12T02:00:00.000Z';
  delete payload.version.units[0].headcount;
  return payload;
}

function makeRow(
  params: {
    id?: string;
    announcementId?: string;
    versionNumber?: number;
    status?: string;
    payload?: unknown;
    publishedAt?: Date;
  } = {},
) {
  const {
    id = 'fx-pav-0001',
    announcementId = 'fx-ann-db-priority',
    versionNumber = 1,
    status = 'published',
    payload = basePayload(),
    publishedAt = new Date('2026-10-10T02:00:00.000Z'),
  } = params;
  return {
    id,
    announcementId,
    runId: 'fx-run-0001',
    versionNumber,
    status,
    payload,
    publishedAt,
    previousVersionId: null,
    supersededAt: null,
  };
}

function makeRepo(rows: unknown[]) {
  const findMany = vi.fn(async () => rows);
  const prisma = { publishedAnnouncementVersion: { findMany } };
  const repo = new PublishedCatalogRepository(prisma as never);
  return { repo, findMany };
}

describe('PublishedCatalogRepository.listPublished', () => {
  it('发布可见：合法 published 行投影出 1 条公告，current 版本正确', async () => {
    const { repo } = makeRepo([makeRow()]);

    const catalog = await repo.listPublished(NOW);

    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('fx-ann-db-priority');
    expect(catalog[0].versions[0].id).toBe('fx-ann-db-priority-v1');
    expect(catalog[0].versions[0].units[0].id).toBe('fx-unit-db-priority');
  });

  it('草稿/无行不可见：findMany 返回空 → 目录为空', async () => {
    const { repo } = makeRepo([]);

    const catalog = await repo.listPublished(NOW);

    expect(catalog).toEqual([]);
  });

  it('撤回标记：withdrawn 行仍出现在目录，但 lifecycle=withdrawn（审计保留）', async () => {
    const { repo } = makeRepo([makeRow({ status: 'withdrawn' })]);

    const catalog = await repo.listPublished(NOW);

    expect(catalog).toHaveLength(1);
    expect(catalog[0].lifecycle).toBe('withdrawn');
  });

  it('投影失败保留上一版：v2 结构损坏被跳过，current 回退到 v1', async () => {
    const { repo } = makeRepo([
      makeRow({
        id: 'fx-pav-0002',
        versionNumber: 2,
        payload: corruptedV2Payload(),
      }),
      makeRow({ id: 'fx-pav-0001', versionNumber: 1 }),
    ]);

    const catalog = await repo.listPublished(NOW);

    expect(catalog).toHaveLength(1);
    expect(catalog[0].versions.map((v) => v.id)).toEqual([
      'fx-ann-db-priority-v1',
    ]);
    expect(currentVersion(catalog[0]).versionNumber).toBe(1);
  });

  it('全部失败则整体跳过：仅有损坏行 → 该公告不出现在目录', async () => {
    const { repo } = makeRepo([
      makeRow({ versionNumber: 2, payload: corruptedV2Payload() }),
    ]);

    const catalog = await repo.listPublished(NOW);

    expect(catalog).toEqual([]);
  });

  it('只读 DB、不读静态目录：结果 id 集合等于 DB 行 announcementId 集合', async () => {
    const rows = [makeRow()];
    const { repo, findMany } = makeRepo(rows);

    const catalog = await repo.listPublished(NOW);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(new Set(catalog.map((a) => a.id))).toEqual(
      new Set(rows.map((r) => r.announcementId)),
    );
    // 不含任何静态演示单元 id
    expect(JSON.stringify(catalog)).not.toContain('unit-hangzhou-01');
  });
});

describe('PublishedCatalogRepository.getUnit', () => {
  it('命中 DB 单元 id 时返回非 null 且 unit.id 正确', async () => {
    const { repo } = makeRepo([makeRow()]);

    const ref = await repo.getUnit('fx-unit-db-priority', NOW);

    expect(ref).not.toBeNull();
    expect(ref!.unit.id).toBe('fx-unit-db-priority');
    expect(ref!.announcement.id).toBe('fx-ann-db-priority');
  });

  it('不存在的 id 返回 null', async () => {
    const { repo } = makeRepo([makeRow()]);

    const ref = await repo.getUnit('unit-not-in-db', NOW);

    expect(ref).toBeNull();
  });
});
