import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  detectAnnouncementPolicyConflicts,
  normalizeRegionCode,
  regionLabel,
  validityOf,
  type PolicyCitationView,
} from './policy-domain.js';
import { PolicyCoverageService } from './policy-coverage.service.js';

describe('政策范围与有效期纯函数', () => {
  it('地区只接受全国或 6 位行政区划代码', () => {
    expect(normalizeRegionCode('000000')).toBe('000000');
    expect(normalizeRegionCode('320100')).toBe('320100');
    expect(normalizeRegionCode('Nanjing')).toBeNull();
    expect(normalizeRegionCode('32010')).toBeNull();
  });

  it('地区名称不把未知城市猜成具体城市，省级选择能识别省份', () => {
    expect(regionLabel('000000')).toBe('全国');
    expect(regionLabel('320000')).toBe('江苏省');
    expect(regionLabel('320100')).toBe('江苏省（320100）');
  });

  it('有效期区分生效、失效、未生效和未标注，不推断无限有效', () => {
    const asOf = new Date('2026-11-05T00:00:00.000Z');
    expect(validityOf('2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', asOf)).toBe('effective');
    expect(validityOf('2020-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', asOf)).toBe('expired');
    expect(validityOf('2027-01-01T00:00:00.000Z', null, asOf)).toBe('not_yet_effective');
    expect(validityOf(null, null, asOf)).toBe('unknown');
  });

  it('公告与政策同时出现时并列候选，不自动认定覆盖关系', () => {
    const citation = (index: number, documentType: string): PolicyCitationView => ({
      index,
      documentId: `${documentType}-${index}`,
      documentTitle: documentType,
      documentType,
      officialUrl: null,
      snippet: '',
      regionCode: '320100',
      year: 2026,
      effectiveFrom: null,
      effectiveTo: null,
      validity: 'unknown',
    });
    const conflicts = detectAnnouncementPolicyConflicts([
      citation(1, 'policy'),
      citation(2, 'announcement'),
      citation(3, 'policy'),
    ]);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]!.reason).toContain('不自动判定');
    expect(conflicts[0]!.suggestion).toContain('招聘单位');
  });
});

interface CoverageRowOptions {
  id?: string;
  regionCode?: string | null;
  year?: number | null;
  documentType?: string;
  status?: string;
  activeIndexVersion?: number | null;
  publisher?: string;
  applicableSubjects?: string[];
  effectiveTo?: Date | null;
}

function coverageRow(options: CoverageRowOptions = {}) {
  return {
    id: options.id ?? 'doc-1',
    title: options.id ?? 'doc-1',
    documentType: options.documentType ?? 'policy',
    status: options.status ?? 'published',
    regionCode: options.regionCode === undefined ? '320100' : options.regionCode,
    year: options.year === undefined ? 2026 : options.year,
    publisher: options.publisher ?? '南京市教育局',
    officialUrl: null,
    effectiveFrom: null,
    effectiveTo: options.effectiveTo ?? null,
    applicableAudience: null,
    applicableSubjects: options.applicableSubjects ?? [],
    applicableStages: [],
    activeIndexVersion:
      options.activeIndexVersion === undefined ? 1 : options.activeIndexVersion,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

function createService(rows: ReturnType<typeof coverageRow>[]) {
  const prisma = {
    knowledgeDocument: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaService;
  return { service: new PolicyCoverageService(prisma), prisma };
}

describe('PolicyCoverageService 覆盖投影', () => {
  it('本地区当年有可检索材料才算 covered；其他年份单列', async () => {
    const { service } = createService([
      coverageRow({ id: 'a' }),
      coverageRow({ id: 'b', year: 2025 }),
    ]);

    const result = await service.coverage({ regionCode: '320100', year: 2026 });

    expect(result.status).toBe('covered');
    expect(result.exact.documents).toBe(1);
    expect(result.years).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ year: 2026, documents: 1 }),
        expect.objectContaining({ year: 2025, documents: 1 }),
      ]),
    );
  });

  it('省级选择下只有城市材料时标 partial，不把城市算作全省完成', async () => {
    const { service } = createService([
      coverageRow({ id: 'city', regionCode: '320100' }),
    ]);

    const result = await service.coverage({ regionCode: '320000', year: 2026 });

    expect(result.status).toBe('partial');
    expect(result.exact.queryable).toBe(0);
    expect(result.descendants).toEqual([
      expect.objectContaining({ regionCode: '320100', queryable: 1 }),
    ]);
    expect(result.note).toContain('城市材料不计为全省完成');
  });

  it('全国选择只统计标注全国适用的材料，不冒充各地区覆盖', async () => {
    const { service } = createService([
      coverageRow({ id: 'national', regionCode: '000000' }),
      coverageRow({ id: 'city', regionCode: '320100' }),
    ]);

    const result = await service.coverage({ regionCode: '000000', year: 2026 });

    expect(result.exact.documents).toBe(1);
    expect(result.note).toContain('不代表全国所有地区均有招聘材料');
  });

  it('已发布但索引未完成的材料不计入可问答覆盖', async () => {
    const { service } = createService([
      coverageRow({ id: 'pending', activeIndexVersion: null }),
    ]);

    const result = await service.coverage({ regionCode: '320100', year: 2026 });

    expect(result.status).toBe('no_coverage');
    expect(result.exact.documents).toBe(1);
    expect(result.exact.publishedNotIndexed).toBe(1);
  });

  it('已过期材料不计入可问答覆盖，仍如实计入已发布', async () => {
    const { service } = createService([
      coverageRow({ id: 'expired', effectiveTo: new Date('2020-01-01T00:00:00.000Z') }),
    ]);

    const result = await service.coverage({ regionCode: '320100', year: 2026 });

    expect(result.status).toBe('no_coverage');
    expect(result.exact.documents).toBe(1);
    expect(result.exact.expired).toBe(1);
    expect(result.exact.queryable).toBe(0);
  });

  it('学科筛选会排除明确标注其他学科的材料，并如实计数', async () => {
    const { service } = createService([
      coverageRow({ id: 'chinese', applicableSubjects: ['chinese'] }),
      coverageRow({ id: 'math', applicableSubjects: ['mathematics'] }),
      coverageRow({ id: 'general', applicableSubjects: [] }),
    ]);

    const result = await service.coverage({
      regionCode: '320100',
      year: 2026,
      subjects: ['chinese'],
    });

    expect(result.exact.documents).toBe(2);
    expect(result.subjectExcluded).toBe(1);
  });

  it('数据库查询失败抛错，与无覆盖明确区分', async () => {
    const prisma = {
      knowledgeDocument: {
        findMany: vi.fn().mockRejectedValue(new Error('db down')),
      },
    } as unknown as PrismaService;
    const service = new PolicyCoverageService(prisma);

    await expect(
      service.coverage({ regionCode: '320100', year: 2026 }),
    ).rejects.toThrow('db down');
  });
});
