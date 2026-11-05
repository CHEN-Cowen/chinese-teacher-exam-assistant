/**
 * W5：政策检索覆盖投影。
 *
 * 只统计已发布材料；`queryable` 额外要求索引已生效（可被问答真正检索到）。
 * - 全国选择：单独统计全国性材料；
 * - 省/市选择：本地区材料与全国性材料分开统计；
 * - 省级选择下，城市/区县材料只计入 descendants，不能算作全省完成；
 * - 未标年份的材料单独计数，不冒充指定年份覆盖；
 * - 查询失败抛错，与“无覆盖”明确区分。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import {
  NATIONAL_REGION_CODE,
  isNationalRegion,
  isProvinceRegion,
  provinceCodeOf,
  regionLabel,
} from './policy-domain.js';

export type PolicyCoverageStatus = 'covered' | 'partial' | 'no_coverage';

export interface CoverageBucket {
  documents: number;
  policy: number;
  announcement: number;
  queryable: number;
  publishedNotIndexed: number;
  undated: number;
  /** 已过期材料：计入已发布但不计入可问答覆盖 */
  expired: number;
}

export interface PolicyCoverageSource {
  publisher: string;
  documents: number;
  queryable: number;
  documentTypes: string[];
}

export interface PolicyCoverageYear {
  year: number | null;
  documents: number;
  queryable: number;
}

export interface PolicyCoverageResult {
  status: PolicyCoverageStatus;
  regionCode: string;
  regionLabel: string;
  year: number;
  exact: CoverageBucket;
  national: CoverageBucket;
  descendants: Array<CoverageBucket & { regionCode: string; regionLabel: string }>;
  sources: PolicyCoverageSource[];
  years: PolicyCoverageYear[];
  subjectExcluded: number;
  note: string;
  generatedAt: string;
}

interface DocumentRow {
  id: string;
  title: string;
  documentType: string;
  status: string;
  regionCode: string | null;
  year: number | null;
  publisher: string | null;
  officialUrl: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  applicableAudience: string | null;
  applicableSubjects: unknown;
  applicableStages: unknown;
  activeIndexVersion: number | null;
  updatedAt: Date;
}

export interface PolicyCoverageInput {
  regionCode: string;
  year: number;
  subjects?: string[];
  subject?: string;
}

@Injectable()
export class PolicyCoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async coverage(input: PolicyCoverageInput): Promise<PolicyCoverageResult> {
    const rows = (await this.prisma.knowledgeDocument.findMany({
      where: { status: 'published' },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    })) as unknown as DocumentRow[];

    const subjects = [
      ...new Set(
        [...(input.subjects ?? []), ...(input.subject ? [input.subject] : [])]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    let subjectExcluded = 0;
    const applicable = rows.filter((row) => {
      if (subjects.length === 0) return true;
      const declared = stringArray(row.applicableSubjects);
      // 未标注学科视为通用材料；明确标注其他学科才排除
      if (declared.length > 0 && !declared.some((item) => subjects.includes(item))) {
        subjectExcluded += 1;
        return false;
      }
      return true;
    });

    const exact = applicable.filter((row) => row.regionCode === input.regionCode);
    const national =
      input.regionCode === NATIONAL_REGION_CODE
        ? exact
        : applicable.filter(
            (row) => !row.regionCode || row.regionCode === NATIONAL_REGION_CODE,
          );
    const descendants = new Map<string, DocumentRow[]>();
    if (isProvinceRegion(input.regionCode)) {
      const prefix = input.regionCode.slice(0, 2);
      for (const row of applicable) {
        if (
          row.regionCode &&
          row.regionCode !== input.regionCode &&
          row.regionCode.startsWith(prefix)
        ) {
          const list = descendants.get(row.regionCode) ?? [];
          list.push(row);
          descendants.set(row.regionCode, list);
        }
      }
    }

    const exactScope = inYear(exact, input.year);
    const nationalScope =
      input.regionCode === NATIONAL_REGION_CODE ? [] : inYear(national, input.year);
    const exactBucket = bucket(exactScope);
    const nationalBucket = bucket(nationalScope);
    const descendantBuckets = [...descendants.entries()].map(([code, list]) => ({
      ...bucket(inYear(list, input.year)),
      regionCode: code,
      regionLabel: regionLabel(code),
    }));

    // 覆盖状态：只有本地区/全国当年有可检索材料才算 covered；
    // 省级选择只有城市材料、或仅有全国性政策，一律标 partial。
    let status: PolicyCoverageStatus = 'no_coverage';
    if (exactBucket.queryable > 0) {
      status = 'covered';
    } else if (
      nationalBucket.queryable > 0 ||
      descendantBuckets.some((item) => item.queryable > 0)
    ) {
      status = 'partial';
    }

    const sources = summarizeSources(exactScope, nationalScope);
    const years = summarizeYears(dedupeById([...exact, ...national]));

    return {
      status,
      regionCode: input.regionCode,
      regionLabel: regionLabel(input.regionCode),
      year: input.year,
      exact: exactBucket,
      national: nationalBucket,
      descendants: descendantBuckets,
      sources,
      years,
      subjectExcluded,
      note: coverageNote(input.regionCode, status),
      generatedAt: new Date().toISOString(),
    };
  }
}

function inYear(rows: readonly DocumentRow[], year: number): DocumentRow[] {
  return rows.filter((row) => row.year === year);
}

function bucket(rows: readonly DocumentRow[]): CoverageBucket {
  const now = Date.now();
  const notExpired = rows.filter(
    (row) => !(row.effectiveTo && row.effectiveTo.getTime() < now),
  );
  const queryable = notExpired.filter((row) => row.activeIndexVersion !== null);
  return {
    documents: rows.length,
    policy: rows.filter((row) => row.documentType === 'policy').length,
    announcement: rows.filter((row) => row.documentType === 'announcement').length,
    queryable: queryable.length,
    publishedNotIndexed: notExpired.filter((row) => row.activeIndexVersion === null).length,
    undated: rows.filter((row) => row.year === null).length,
    expired: rows.length - notExpired.length,
  };
}

function summarizeSources(
  exact: readonly DocumentRow[],
  national: readonly DocumentRow[],
): PolicyCoverageSource[] {
  const byPublisher = new Map<string, DocumentRow[]>();
  for (const row of [...exact, ...national]) {
    const key = row.publisher?.trim() || '未标注发布单位';
    const list = byPublisher.get(key) ?? [];
    list.push(row);
    byPublisher.set(key, list);
  }
  return [...byPublisher.entries()].map(([publisher, rows]) => ({
    publisher,
    documents: rows.length,
    queryable: rows.filter((row) => row.activeIndexVersion !== null).length,
    documentTypes: [...new Set(rows.map((row) => row.documentType))].sort(),
  }));
}

function summarizeYears(rows: readonly DocumentRow[]): PolicyCoverageYear[] {
  const byYear = new Map<number | null, DocumentRow[]>();
  for (const row of rows) {
    const list = byYear.get(row.year) ?? [];
    list.push(row);
    byYear.set(row.year, list);
  }
  return [...byYear.entries()]
    .map(([year, list]) => ({
      year,
      documents: list.length,
      queryable: list.filter((row) => row.activeIndexVersion !== null).length,
    }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function dedupeById(rows: readonly DocumentRow[]): DocumentRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function coverageNote(regionCode: string, status: PolicyCoverageStatus): string {
  const base = `覆盖只统计已发布且索引可检索的材料；已发布未索引的材料单列，不计入可问答覆盖。当前判定：${
    status === 'covered'
      ? '本地区当年有可检索材料'
      : status === 'partial'
        ? '仅有全国性政策或其他地区材料，不能算作本地区完成覆盖'
        : '本地区当年暂无可检索材料'
  }。`;
  if (isNationalRegion(regionCode)) {
    return `全国选择仅汇总标注为全国适用的材料，不代表全国所有地区均有招聘材料。${base}`;
  }
  if (isProvinceRegion(regionCode)) {
    return `省级选择下，本省省级材料与城市/区县材料分开统计；城市材料不计为全省完成，未列出的城市一律视为暂未收录。${base}`;
  }
  return `市级/区县选择只统计本地区材料与全国性政策；不能据此推断所属省份其他地区已覆盖。${base}`;
}

export function provinceOf(code: string): string | null {
  return provinceCodeOf(code);
}
