/**
 * 往年参考（D06 / PRD 11.7 U06）共享纯函数。
 *
 * 口径不变量：
 * - 历史归属不靠标题年份：报名有效期已结束（registrationEnd 早于今日，Asia/Shanghai）
 *   或公告 lifecycle=withdrawn 才进入往年参考；报名日期未定的预告不算历史；
 *   跨年但报名仍有效的岗位留在当前招聘入口，不进入历史。
 * - 批次年 = 报名开始年；缺报名开始日期时回退公告发布年；都没有为 null。
 * - 不制造历史资料：无数据时调用方展示真实空状态。
 * - 日期一律保留公告原文字符串，展示端标注口径，不臆造未知时间。
 */
import { currentVersion } from "@/lib/announcements/domain";
import type {
  AnnouncementVersion,
  ApplicationUnit,
  EvidenceAnchor,
  RecruitmentAnnouncement,
} from "@/lib/announcements/types";

/** 今日日期（Asia/Shanghai，YYYY-MM-DD） */
export function chinaToday(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 是否往年/历史：已撤回，或报名有效期已结束（按北京时间日历日比较） */
export function isHistoricalAnnouncement(
  announcement: RecruitmentAnnouncement,
  now: Date,
): boolean {
  if (announcement.lifecycle === "withdrawn") return true;
  const version = currentVersion(announcement);
  const end = version.timeline.registrationEnd;
  // 报名时间未公布（预告）不算历史，仍属当前入口
  if (!end) return false;
  return end.slice(0, 10) < chinaToday(now);
}

/** 招聘批次年：报名开始年优先，回退公告发布年 */
export function batchYearOf(
  announcement: RecruitmentAnnouncement,
  version: AnnouncementVersion,
): number | null {
  const raw =
    version.timeline.registrationStart ?? announcement.firstPublishedAt ?? null;
  if (!raw) return null;
  const year = Number(raw.slice(0, 4));
  return Number.isFinite(year) && year > 1990 ? year : null;
}

/** 公告发布年 */
export function publishedYearOf(announcement: RecruitmentAnnouncement): number | null {
  const raw = announcement.firstPublishedAt;
  if (!raw) return null;
  const year = Number(raw.slice(0, 4));
  return Number.isFinite(year) && year > 1990 ? year : null;
}

/** 完整程度：日期项完整度（报名起止/笔试/面试 4 项口径）+ 材料数 + 证据审核状态 */
export interface HistoryCompleteness {
  knownDateCount: number;
  totalDateCount: number;
  materialCount: number;
  /** 全部证据已人工核对=official；含 AI 初核/待复核内容时如实标注 */
  evidenceState: EvidenceAnchor["state"];
}

const DATE_KEYS = [
  "registrationStart",
  "registrationEnd",
  "writtenExamDate",
  "interviewDate",
] as const;

export function completenessOf(
  version: AnnouncementVersion,
  unit: ApplicationUnit,
): HistoryCompleteness {
  const knownDateCount = DATE_KEYS.filter(
    (key) => typeof version.timeline[key] === "string" && version.timeline[key],
  ).length;
  const anchors: EvidenceAnchor[] = [
    version.officialSource,
    ...unit.requirements.map((requirement) => requirement.evidence),
  ];
  let evidenceState: EvidenceAnchor["state"] = "official";
  for (const anchor of anchors) {
    if (anchor.state === "pending_review") {
      evidenceState = "pending_review";
      break;
    }
    if (anchor.state === "ai_extracted") evidenceState = "ai_extracted";
  }
  return {
    knownDateCount,
    totalDateCount: DATE_KEYS.length,
    materialCount: unit.materials?.length ?? 0,
    evidenceState,
  };
}

/** 展平后的历史报考单元记录（公告 + 当前版本 + 单元） */
export interface HistoricalUnitRecord {
  announcement: RecruitmentAnnouncement;
  version: AnnouncementVersion;
  unit: ApplicationUnit;
}

/** 收集历史单元：按报名截止日倒序（无截止日的撤回公告按发布日倒序排在同年段内） */
export function collectHistoricalUnits(
  announcements: readonly RecruitmentAnnouncement[],
  now: Date,
): HistoricalUnitRecord[] {
  const records: HistoricalUnitRecord[] = [];
  for (const announcement of announcements) {
    if (!isHistoricalAnnouncement(announcement, now)) continue;
    const version = currentVersion(announcement);
    for (const unit of version.units) {
      records.push({ announcement, version, unit });
    }
  }
  return records.sort((a, b) => {
    const aKey =
      a.version.timeline.registrationEnd ?? a.announcement.firstPublishedAt ?? "";
    const bKey =
      b.version.timeline.registrationEnd ?? b.announcement.firstPublishedAt ?? "";
    return bKey.localeCompare(aKey);
  });
}

/** 可供筛选的批次年（倒序去重） */
export function availableBatchYears(records: readonly HistoricalUnitRecord[]): number[] {
  const years = new Set<number>();
  for (const record of records) {
    const year = batchYearOf(record.announcement, record.version);
    if (year !== null) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export interface HistoryFilterInput {
  year?: number;
  /** 6 位行政区划代码前缀匹配（省 2 位 / 市 4 位 / 区 6 位） */
  regionCode?: string;
  stage?: string;
  /** 用工性质编码 */
  nature?: string;
  /** 单位名 / 公告标题 / 发布主体关键词 */
  keyword?: string;
}

export function filterHistoricalUnits(
  records: readonly HistoricalUnitRecord[],
  filters: HistoryFilterInput,
): HistoricalUnitRecord[] {
  const keyword = filters.keyword?.trim();
  return records.filter((record) => {
    if (filters.year !== undefined) {
      const year = batchYearOf(record.announcement, record.version);
      if (year !== filters.year) return false;
    }
    if (filters.regionCode && !record.unit.region.code.startsWith(filters.regionCode)) {
      return false;
    }
    if (filters.stage && record.unit.stage !== filters.stage) return false;
    if (filters.nature && record.unit.employmentNature.code !== filters.nature) {
      return false;
    }
    if (keyword) {
      const haystack = `${record.unit.name} ${record.announcement.title} ${record.announcement.publisher}`;
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

export interface HistoryPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** 简单分页：page 从 1 开始，越界回退到最后一页 */
export function paginate<T>(
  items: readonly T[],
  page = 1,
  pageSize = 20,
): HistoryPage<T> {
  const safeSize = Math.max(1, Math.min(pageSize, 50));
  const total = items.length;
  const maxPage = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.max(1, Math.min(page, maxPage));
  const start = (safePage - 1) * safeSize;
  return {
    items: items.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total,
  };
}

/**
 * 收录样本范围说明：仅有一年时披露单年样本，多年时披露年份区间；
 * 明确样本外年份不代表当地未招聘，也不推测本年必招时间。
 */
export function historySampleNote(years: readonly number[], total: number): string {
  if (total === 0 || years.length === 0) {
    return "当前没有已收录的往年公告；未收录的年份或地区不代表当地没有招聘。";
  }
  const min = years[years.length - 1]!;
  const max = years[0]!;
  const range =
    years.length === 1 ? `目前仅收录 ${max} 年` : `目前收录 ${min}—${max} 年`;
  return (
    `${range}的 ${total} 个报考单元（均带真实日期与官方依据）。` +
    "样本外的年份或地区不代表当地没有招聘，也不构成对本年招聘时间的推测。"
  );
}
