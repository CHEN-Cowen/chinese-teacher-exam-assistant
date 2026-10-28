/**
 * 往年参考 DTO 装配（D06）：把领域记录转成 api-types 的 HistoryUnitDTO。
 * demo 通道与页面共用；后端在 backend/src/opportunities/history.ts 有同口径实现。
 */
import type { HistoryUnitDTO } from "@/lib/opportunities/api-types";
import {
  batchYearOf,
  completenessOf,
  type HistoricalUnitRecord,
} from "./domain";

export function toHistoryUnitDTO(record: HistoricalUnitRecord): HistoryUnitDTO {
  const { announcement, version, unit } = record;
  const timeline = version.timeline;
  const archiveNote =
    announcement.sourceHealth && announcement.sourceHealth.ok === false
      ? `官方链接已失效（${announcement.sourceHealth.failReason ?? "来源异常"}），` +
        `本页为 ${announcement.sourceHealth.checkedAt.slice(0, 10)} 核对时的存档内容。`
      : null;
  return {
    unitId: unit.id,
    unitCode: unit.code,
    unitName: unit.name,
    region: unit.region,
    subject: unit.subject,
    stage: unit.stage,
    headcount: unit.headcount,
    organizationType: unit.organizationType,
    employmentNature: unit.employmentNature,
    allocation: unit.allocation,
    teachingScope: unit.teachingScope,
    schoolPlacement: unit.schoolPlacement,
    announcement: {
      id: announcement.id,
      title: announcement.title,
      publisher: announcement.publisher,
      officialUrl: announcement.officialUrl,
      dataset: "demo",
      reviewStatus: "human_reviewed",
    },
    batchYear: batchYearOf(announcement, version),
    publishedAt: version.publishedAt,
    registrationStart: timeline.registrationStart,
    registrationEnd: timeline.registrationEnd,
    writtenExamDate: timeline.writtenExamDate,
    interviewDate: timeline.interviewDate,
    pendingItems: timeline.pendingItems ?? [],
    completeness: completenessOf(version, unit),
    archiveNote,
  };
}

/** 地区标签：省 + 市 + 区 */
export function historyRegionLabel(record: HistoricalUnitRecord): string {
  const region = record.unit.region;
  return [region.province, region.city, region.district].filter(Boolean).join("");
}

/** 全部历史记录（未筛选）中的可选地区（去重，按代码排序） */
export function availableHistoryRegions(
  records: readonly HistoricalUnitRecord[],
): { code: string; label: string }[] {
  const map = new Map<string, string>();
  for (const record of records) {
    if (!map.has(record.unit.region.code)) {
      map.set(record.unit.region.code, historyRegionLabel(record));
    }
  }
  return [...map.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
