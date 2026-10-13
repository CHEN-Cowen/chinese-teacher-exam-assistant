/**
 * v7.2 工作包 3：目录载荷投影纯函数（publication-projector）单元测试。
 *
 * 输入数据全部内联在本文件（隔离约束：src/ 不得 import tests/fixtures）。
 */
import { describe, expect, it } from 'vitest';
import { ProjectionError, projectCatalogVersion } from './publication-projector.js';

const NOW = new Date('2026-10-13T00:00:00.000Z');

/** 一条合法载荷（结构对齐 DB_PUBLISHED_ROW.payload，dataset='test'） */
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

function makeRow(
  payload: unknown = basePayload(),
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'fx-pav-0001',
    announcementId: 'fx-ann-db-priority',
    versionNumber: 1,
    status: 'published',
    payload,
    ...overrides,
  };
}

/** 捕获投影抛出的 ProjectionError（未抛出或被其它错误替换则失败） */
function capture(fn: () => unknown): ProjectionError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProjectionError) return error;
    throw error;
  }
  throw new Error('预期抛出 ProjectionError，但未抛出');
}

describe('projectCatalogVersion：合法投影', () => {
  it('把 DB 行载荷映射为公告与版本领域对象', () => {
    const { announcement, version } = projectCatalogVersion(makeRow(), NOW);

    expect(version.id).toBe('fx-ann-db-priority-v1');
    expect(version.versionNumber).toBe(1);
    expect(version.publishedAt).toBe('2026-10-10T02:00:00.000Z');
    expect(version.announcementId).toBe('fx-ann-db-priority');
    expect(version.units[0].id).toBe('fx-unit-db-priority');
    expect(version.units[0].headcount).toBe(2);

    expect(announcement.id).toBe('fx-ann-db-priority');
    expect(announcement.lifecycle).toBe('active');
    expect(announcement.dataset).toBe('test');
    expect(announcement.versions[0].id).toBe('fx-ann-db-priority-v1');
  });
});

describe('projectCatalogVersion：结构异常必须抛 ProjectionError（携带字段路径）', () => {
  it('payload.version.units 缺失', () => {
    const payload = basePayload();
    delete payload.version.units;

    const row = makeRow(payload);
    expect(() => projectCatalogVersion(row, NOW)).toThrow(ProjectionError);

    const err = capture(() => projectCatalogVersion(row, NOW));
    expect(err.fieldPath).toBe('payload.version.units');
    expect(err.message).toContain('payload.version.units');
  });

  it('unit.headcount 缺失', () => {
    const payload = basePayload();
    delete payload.version.units[0].headcount;

    const err = capture(() => projectCatalogVersion(makeRow(payload), NOW));
    expect(err.fieldPath).toBe('payload.version.units[0].headcount');
    expect(err.message).toContain('payload.version.units[0].headcount');
  });

  it('unit.headcount 类型错误（字符串而非整数）', () => {
    const payload = basePayload();
    payload.version.units[0].headcount = '2';

    const err = capture(() => projectCatalogVersion(makeRow(payload), NOW));
    expect(err.fieldPath).toBe('payload.version.units[0].headcount');
  });

  it('payload.dataset 非法枚举', () => {
    const payload = basePayload();
    payload.dataset = 'production';

    const err = capture(() => projectCatalogVersion(makeRow(payload), NOW));
    expect(err.fieldPath).toBe('payload.dataset');
    expect(err.message).toContain('payload.dataset');
  });
});

describe('projectCatalogVersion：announcementId 一致性校验', () => {
  it('payload.version.announcementId 与数据库行不一致时抛错', () => {
    const payload = basePayload();
    payload.version.announcementId = 'fx-ann-other';

    const err = capture(() => projectCatalogVersion(makeRow(payload), NOW));
    expect(err.fieldPath).toBe('payload.version.announcementId');
    expect(err.message).toContain('fx-ann-db-priority');
  });
});

describe('projectCatalogVersion：withdrawn 派生 lifecycle', () => {
  it('row.status=withdrawn 时投影 lifecycle=withdrawn（即便载荷自述 active）', () => {
    const { announcement } = projectCatalogVersion(
      makeRow(basePayload(), { status: 'withdrawn' }),
      NOW,
    );
    expect(announcement.lifecycle).toBe('withdrawn');
  });

  it('payload.announcement.lifecycle=withdrawn 时同样派生 withdrawn', () => {
    const payload = basePayload();
    payload.announcement.lifecycle = 'withdrawn';
    const { announcement } = projectCatalogVersion(makeRow(payload), NOW);
    expect(announcement.lifecycle).toBe('withdrawn');
  });
});
