/**
 * 往年参考（D06 / PRD 11.7 U06）纯函数与 DTO 装配。
 *
 * 与前端 src/lib/history/domain.ts 同口径（镜像），差异：
 * - 数据集/审核状态取真实字段（前端 demo 通道硬编码 demo/human_reviewed）；
 * - 对照维度复用 view.ts 的 toDimensions（带公告原文表述与证据锚点，双端同口径）。
 *
 * 口径不变量：
 * - 历史归属不靠标题年份：报名有效期已结束（registrationEnd 早于今日，Asia/Shanghai）
 *   或公告 lifecycle=withdrawn 才进入往年参考；报名日期未定的预告不算历史；
 *   跨年但报名仍有效的岗位留在当前招聘入口，不进入历史。
 * - 批次年 = 报名开始年；缺报名开始日期时回退公告发布年；都没有为 null。
 * - M5 合规：test 样本与 AI 初核待复核真实记录一律不进往年参考（空态如实展示）。
 * - 不制造历史资料：无数据时返回空列表，由前端展示真实空状态。
 * - 日期一律保留公告原文字符串，不臆造未知时间。
 */
import {
  buildCandidates,
  currentVersion,
  isUserVisibleInCatalog,
} from '../matching/engine.js';
import type {
  AnnouncementVersion,
  ApplicationUnit,
  EvidenceAnchor,
  EvidenceReviewState,
  MaterialItem,
  OpportunityMatchStatus,
  RecruitmentAnnouncement,
  RequirementDimension,
  UserRecruitmentProfile,
} from '../matching/types.js';
import {
  buildMeta,
  toDimensions,
  type DimensionDTO,
  type MetaDTO,
} from './view.js';

// ==================== 口径纯函数（与前端 src/lib/history/domain.ts 镜像） ====================

/** 今日日期（Asia/Shanghai，YYYY-MM-DD） */
export function chinaToday(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** 是否往年/历史：已撤回，或报名有效期已结束（按北京时间日历日比较） */
export function isHistoricalAnnouncement(
  announcement: RecruitmentAnnouncement,
  now: Date,
): boolean {
  if (announcement.lifecycle === 'withdrawn') return true;
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

/** 完整程度：日期项完整度（报名起止/笔试/面试 4 项口径）+ 材料数 + 证据审核状态 */
export interface HistoryCompleteness {
  knownDateCount: number;
  totalDateCount: number;
  materialCount: number;
  /** 全部证据已人工核对=official；含 AI 初核/待复核内容时如实标注 */
  evidenceState: EvidenceReviewState;
}

const DATE_KEYS = [
  'registrationStart',
  'registrationEnd',
  'writtenExamDate',
  'interviewDate',
] as const;

export function completenessOf(
  version: AnnouncementVersion,
  unit: ApplicationUnit,
): HistoryCompleteness {
  const knownDateCount = DATE_KEYS.filter(
    (key) => typeof version.timeline[key] === 'string' && version.timeline[key],
  ).length;
  const anchors: EvidenceAnchor[] = [
    version.officialSource,
    ...unit.requirements.map((requirement) => requirement.evidence),
  ];
  let evidenceState: EvidenceReviewState = 'official';
  for (const anchor of anchors) {
    if (anchor.state === 'pending_review') {
      evidenceState = 'pending_review';
      break;
    }
    if (anchor.state === 'ai_extracted') evidenceState = 'ai_extracted';
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

/**
 * 收集历史单元：先套 M5 用户端可见性，再按历史口径过滤；
 * 按报名截止日倒序（无截止日的撤回公告按发布日倒序排在同年段内）。
 */
export function collectHistoricalUnits(
  announcements: readonly RecruitmentAnnouncement[],
  now: Date,
): HistoricalUnitRecord[] {
  const records: HistoricalUnitRecord[] = [];
  for (const announcement of announcements) {
    // M5 合规过滤：test 样本与 AI 初核待复核真实记录不进往年参考
    if (!isUserVisibleInCatalog(announcement)) continue;
    if (!isHistoricalAnnouncement(announcement, now)) continue;
    const version = currentVersion(announcement);
    for (const unit of version.units) {
      records.push({ announcement, version, unit });
    }
  }
  return records.sort((a, b) => {
    const aKey =
      a.version.timeline.registrationEnd ?? a.announcement.firstPublishedAt ?? '';
    const bKey =
      b.version.timeline.registrationEnd ?? b.announcement.firstPublishedAt ?? '';
    return bKey.localeCompare(aKey);
  });
}

/** 可供筛选的批次年（倒序去重） */
export function availableBatchYears(
  records: readonly HistoricalUnitRecord[],
): number[] {
  const years = new Set<number>();
  for (const record of records) {
    const year = batchYearOf(record.announcement, record.version);
    if (year !== null) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export interface HistoryFiltersInput {
  year?: number;
  /** 6 位行政区划代码前缀匹配（省 2 位 / 市 4 位 / 区 6 位） */
  regionCode?: string;
  stage?: string;
  /** 用工性质编码 */
  nature?: string;
  /** 单位名 / 公告标题 / 发布主体关键词 */
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function filterHistoricalUnits(
  records: readonly HistoricalUnitRecord[],
  filters: HistoryFiltersInput,
): HistoricalUnitRecord[] {
  const keyword = filters.keyword?.trim();
  return records.filter((record) => {
    if (filters.year !== undefined) {
      const year = batchYearOf(record.announcement, record.version);
      if (year !== filters.year) return false;
    }
    if (
      filters.regionCode &&
      !record.unit.region.code.startsWith(filters.regionCode)
    ) {
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

/** 简单分页：page 从 1 开始，越界回退到最后一页，pageSize 上限 50（防全量扫描） */
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
export function historySampleNote(
  years: readonly number[],
  total: number,
): string {
  if (total === 0 || years.length === 0) {
    return '当前没有已收录的往年公告；未收录的年份或地区不代表当地没有招聘。';
  }
  const min = years[years.length - 1]!;
  const max = years[0]!;
  const range =
    years.length === 1 ? `目前仅收录 ${max} 年` : `目前收录 ${min}—${max} 年`;
  return (
    `${range}的 ${total} 个报考单元（均带真实日期与官方依据）。` +
    '样本外的年份或地区不代表当地没有招聘，也不构成对本年招聘时间的推测。'
  );
}

// ==================== 查询串校验（边界：非法值 400，不静默猜测） ====================

export interface HistoryQueryRaw {
  year?: string;
  regionCode?: string;
  stage?: string;
  nature?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
}

export type ParsedHistoryQuery =
  | { ok: true; filters: HistoryFiltersInput }
  | { ok: false; message: string };

export function parseHistoryQuery(query: HistoryQueryRaw): ParsedHistoryQuery {
  const filters: HistoryFiltersInput = {};
  if (query.year !== undefined && query.year !== '') {
    if (!/^\d{4}$/.test(query.year)) {
      return { ok: false, message: 'year 必须是 4 位年份' };
    }
    const year = Number(query.year);
    if (year < 1990 || year > 2100) {
      return { ok: false, message: 'year 超出可查询范围（1990—2100）' };
    }
    filters.year = year;
  }
  if (query.regionCode !== undefined && query.regionCode !== '') {
    if (!/^\d{2,6}$/.test(query.regionCode)) {
      return { ok: false, message: 'regionCode 必须是 2—6 位行政区划代码前缀' };
    }
    filters.regionCode = query.regionCode;
  }
  if (typeof query.stage === 'string' && query.stage.trim()) {
    filters.stage = query.stage.trim();
  }
  if (typeof query.nature === 'string' && query.nature.trim()) {
    filters.nature = query.nature.trim();
  }
  if (typeof query.keyword === 'string' && query.keyword.trim()) {
    const keyword = query.keyword.trim();
    if (keyword.length > 100) {
      return { ok: false, message: '关键词不能超过 100 字' };
    }
    filters.keyword = keyword;
  }
  for (const key of ['page', 'pageSize'] as const) {
    const raw = query[key];
    if (raw === undefined || raw === '') continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      return { ok: false, message: `${key} 必须是正整数` };
    }
    filters[key] = Number(raw);
  }
  return { ok: true, filters };
}

// ==================== DTO 装配 ====================

/** 往年参考列表项（只读历史事实，无报名/关注动作） */
export interface HistoryUnitDTO {
  unitId: string;
  unitCode: string;
  unitName: string;
  region: ApplicationUnit['region'];
  subject: string;
  stage: string;
  headcount: number;
  organizationType: string;
  employmentNature: { code: string; officialName: string };
  allocation: { code: string; description: string };
  teachingScope?: string;
  schoolPlacement?: ApplicationUnit['schoolPlacement'];
  announcement: {
    id: string;
    title: string;
    publisher: string;
    officialUrl: string;
    /** 可见性已过滤 test；这里只可能是 demo 或 real */
    dataset: 'demo' | 'real';
    reviewStatus: 'ai_reviewed_pending' | 'human_reviewed';
  };
  /** 招聘批次年（报名开始年，缺报名日期回退公告发布年；无法确定为 null） */
  batchYear: number | null;
  /** 公告发布时间 ISO 原文 */
  publishedAt: string;
  /** 公告原文日期（不臆造；缺省表示公告未公布该节点） */
  registrationStart?: string;
  registrationEnd?: string;
  writtenExamDate?: string;
  interviewDate?: string;
  /** 官方明确待定的日程项 */
  pendingItems: string[];
  completeness: HistoryCompleteness;
  /** 官方来源失效时的存档说明（链接失效仍显示留档） */
  archiveNote: string | null;
}

export interface HistoryListResponse {
  meta: MetaDTO;
  /** 收录样本范围说明（单年样本/年份区间，不推测本年必招时间） */
  sampleNote: string;
  /** 全部历史数据（未筛选）中的可筛选批次年，倒序 */
  years: number[];
  /** 全部历史数据（未筛选）中的可选地区 */
  availableRegions: { code: string; label: string }[];
  total: number;
  page: number;
  pageSize: number;
  items: HistoryUnitDTO[];
}

/** 往年参考详情：历史事实 + 版本链 + 用当前资料的可选对照 */
export interface HistoryDetailResponse {
  meta: MetaDTO;
  item: HistoryUnitDTO;
  requirements: {
    id: string;
    dimension: RequirementDimension;
    description: string;
    hard: boolean;
    evidence: EvidenceAnchor;
  }[];
  materials: MaterialItem[];
  previousVersions: {
    id: string;
    versionNumber: number;
    sourceKind: string;
    publishedAt: string;
    supersededAt?: string;
    changeNote?: string;
  }[];
  /**
   * 用当前填写的资料对照当年条件（无画像时为 null）。
   * 不等同用户当年身份，也不等同今年新公告的资格要求。
   */
  comparison: {
    computedAt: string;
    overall: OpportunityMatchStatus;
    summary: string;
    dimensions: DimensionDTO[];
  } | null;
}

export function toHistoryUnitDTO(record: HistoricalUnitRecord): HistoryUnitDTO {
  const { announcement, version, unit } = record;
  const timeline = version.timeline;
  const archiveNote =
    announcement.sourceHealth && announcement.sourceHealth.ok === false
      ? `官方链接已失效（${announcement.sourceHealth.failReason ?? '来源异常'}），` +
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
    ...(unit.teachingScope ? { teachingScope: unit.teachingScope } : {}),
    ...(unit.schoolPlacement ? { schoolPlacement: unit.schoolPlacement } : {}),
    announcement: {
      id: announcement.id,
      title: announcement.title,
      publisher: announcement.publisher,
      officialUrl: announcement.officialUrl,
      dataset: announcement.dataset === 'real' ? 'real' : 'demo',
      reviewStatus: announcement.reviewStatus ?? 'human_reviewed',
    },
    batchYear: batchYearOf(announcement, version),
    publishedAt: version.publishedAt,
    ...(timeline.registrationStart
      ? { registrationStart: timeline.registrationStart }
      : {}),
    ...(timeline.registrationEnd
      ? { registrationEnd: timeline.registrationEnd }
      : {}),
    ...(timeline.writtenExamDate
      ? { writtenExamDate: timeline.writtenExamDate }
      : {}),
    ...(timeline.interviewDate ? { interviewDate: timeline.interviewDate } : {}),
    pendingItems: timeline.pendingItems ?? [],
    completeness: completenessOf(version, unit),
    archiveNote,
  };
}

/** 地区标签：省 + 市 + 区 */
function historyRegionLabel(record: HistoricalUnitRecord): string {
  const region = record.unit.region;
  return [region.province, region.city, region.district]
    .filter(Boolean)
    .join('');
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

/** 往年参考列表：目录 → 历史口径 → 筛选 → 分页（样本说明与可选项来自未筛选全集） */
export function buildHistoryList(
  catalog: readonly RecruitmentAnnouncement[],
  filters: HistoryFiltersInput,
  now: Date,
): HistoryListResponse {
  const all = collectHistoricalUnits(catalog, now);
  const filtered = filterHistoricalUnits(all, filters);
  const page = paginate(
    filtered.map(toHistoryUnitDTO),
    filters.page ?? 1,
    filters.pageSize ?? 20,
  );
  const years = availableBatchYears(all);
  return {
    meta: buildMeta(now),
    sampleNote: historySampleNote(years, all.length),
    years,
    availableRegions: availableHistoryRegions(all),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    items: page.items,
  };
}

/**
 * 往年参考详情：历史事实 + 版本链 + 用当前资料对照当年条件。
 * 无画像时 comparison 为 null（前端引导先填资料，不编造对照）；
 * 找不到记录返回 null，由服务层转 404。
 */
export function buildHistoryDetail(
  catalog: readonly RecruitmentAnnouncement[],
  unitId: string,
  profile: UserRecruitmentProfile | null,
  now: Date,
): HistoryDetailResponse | null {
  const records = collectHistoricalUnits(catalog, now);
  const record = records.find((item) => item.unit.id === unitId);
  if (!record) return null;
  const { announcement, version, unit } = record;

  let comparison: HistoryDetailResponse['comparison'] = null;
  if (profile) {
    const candidate = buildCandidates(
      [announcement],
      profile,
      now.toISOString(),
    ).find((item) => item.unit.id === unitId);
    if (candidate) {
      comparison = {
        computedAt: now.toISOString(),
        overall: candidate.match.overall,
        summary: candidate.match.summary,
        dimensions: toDimensions(candidate),
      };
    }
  }

  return {
    meta: buildMeta(now),
    item: toHistoryUnitDTO(record),
    requirements: unit.requirements.map((requirement) => ({
      id: requirement.id,
      dimension: requirement.dimension,
      description: requirement.description,
      hard: requirement.hard,
      evidence: requirement.evidence,
    })),
    materials: unit.materials ?? [],
    previousVersions: announcement.versions
      .filter((item) => item.id !== version.id)
      .map((item) => ({
        id: item.id,
        versionNumber: item.versionNumber,
        sourceKind: item.sourceKind,
        publishedAt: item.publishedAt,
        supersededAt: item.supersededAt,
        changeNote: item.changeNote,
      })),
    comparison,
  };
}
