/**
 * 机会 API 视图装配（纯函数）。
 *
 * 职责：把匹配引擎的候选结果与用户关注记录组装成前端直接渲染的 DTO——
 * 逐条件结果必须附带公告原文表述（requirementDescription）与证据锚点，
 * 每条结论同时携带 ruleVersion / 公告版本 id / catalogVersion，
 * 前端不再复制任何判定逻辑（PRD 7.4）。
 */
import { CATALOG_VERSION } from '../matching/catalog.js';
import { REAL_CATALOG_VERSION } from '../matching/real-catalog.js';
import {
  COVERAGE_VERSION,
  REAL_COVERAGE,
  type MonitoredRegion,
  type MonitoringStatus,
  type ProvinceCoverage,
} from '../matching/coverage.js';
import {
  MAJOR_ALIAS_VERSION,
  MATCH_RULE_VERSION,
  currentVersion,
  groupByMissingDimension,
  sortCandidates,
} from '../matching/engine.js';
import type {
  AnnouncementTimeline,
  ApplicationUnit,
  EvidenceAnchor,
  MaterialStatus,
  OpportunityCandidate,
  RequirementDimension,
  UserRecruitmentProfile,
} from '../matching/types.js';
import {
  hasNewerVersion,
  type FollowRecord,
  type StudyTargetRole,
} from './follow.domain.js';

export interface MetaDTO {
  ruleVersion: string;
  majorAliasVersion: string;
  catalogVersion: string;
  /** 真实监测台账数据版本 */
  realCatalogVersion: string;
  evaluatedAt: string;
}

/** 真实监测覆盖说明（前台如实展示覆盖地区/核对时间/在报数量） */
export interface CoverageDTO {
  version: string;
  subject: string;
  subjectLabel: string;
  status: MonitoringStatus;
  /** 逐省覆盖口径：选择省时只能看到该省实际监测城市与来源 */
  provinces: ProvinceCoverage[];
  regions: MonitoredRegion[];
  lastCheckedAt: string;
  openOpportunityCount: number;
  nextWindowNote: string;
  scopeNote: string;
}

export interface FollowDTO {
  id: string;
  unitId: string;
  announcementId: string;
  versionId: string;
  status: FollowRecord['status'];
  role: StudyTargetRole | null;
  followedAt: string;
  statusHistory: FollowRecord['statusHistory'];
  abandonReason: string | null;
  /** 关注时的公告版本是否已被新版本取代 */
  newerVersion: boolean;
  /** 是否已关闭该机会的站内提醒 */
  remindersMuted: boolean;
  /** 乐观锁版本号：每次状态/材料/咨询变更递增 */
  version: number;
  /** 报名材料完成状态：{ [materialItemId]: MaterialStatus }，空视为全部未开始 */
  materialStatuses: Record<string, MaterialStatus> | null;
  /** 用户自行记录的官方咨询结论：{ [dimensionKey]: note }，不参与匹配 */
  consultationNotes: Record<string, string> | null;
}

export interface DimensionDTO {
  requirementId: string;
  dimension: RequirementDimension;
  value: 'PASS' | 'FAIL' | 'UNKNOWN' | 'MANUAL_REVIEW';
  reason: string;
  hard: boolean;
  /** 公告原文表述（地区维度为用户偏好约束，无公告原文） */
  requirementDescription?: string;
  evidence?: EvidenceAnchor;
}

export interface UnitMatchDTO {
  unit: Pick<
    ApplicationUnit,
    | 'id'
    | 'code'
    | 'name'
    | 'region'
    | 'subject'
    | 'stage'
    | 'headcount'
    | 'organizationType'
    | 'employmentNature'
    | 'allocation'
    | 'teachingScope'
    | 'schoolPlacement'
    | 'registerUrl'
    | 'sourceRow'
    | 'materials'
  >;
  announcement: {
    id: string;
    title: string;
    publisher: string;
    organizationType: string;
    officialUrl: string;
    /** demo=演示数据；real=真实监测台账数据 */
    dataset: 'demo' | 'real';
    reviewStatus: 'ai_reviewed_pending' | 'human_reviewed';
    reviewedBy: string | null;
    reviewedAt: string | null;
    /** 官方联系信息 */
    contactInfo: string | null;
  };
  version: {
    id: string;
    versionNumber: number;
    sourceKind: string;
    publishedAt: string;
    changeNote?: string;
    timeline: OpportunityCandidate['version']['timeline'];
    officialSource: EvidenceAnchor;
  };
  gates: OpportunityCandidate['match']['gates'];
  dimensions: DimensionDTO[];
  overall: OpportunityCandidate['match']['overall'];
  summary: string;
  follow: FollowDTO | null;
  /** 需官方确认维度的咨询问题模板 */
  consultationTemplates: ConsultationTemplateDTO[];
}

/** 可复制的官方咨询问题模板（针对需官方确认的维度） */
export interface ConsultationTemplateDTO {
  dimensionKey: string;
  dimensionLabel: string;
  question: string;
}

export interface MatchGroupsDTO {
  preliminary: UnitMatchDTO[];
  needInfo: { dimension: string; count: number; units: UnitMatchDTO[] }[];
  manualReview: UnitMatchDTO[];
  notEligible: UnitMatchDTO[];
  /** 闸门未通过（已截止/失效/非收录），不进有效推荐，只在二级入口可见 */
  closed: UnitMatchDTO[];
}

export interface MatchResponse {
  meta: MetaDTO;
  /** 真实监测覆盖说明（地区、最近核对时间、当前在报数） */
  coverage: CoverageDTO;
  primaryTargetUnitId: string | null;
  groups: MatchGroupsDTO;
  follows: FollowDTO[];
}

export interface UnitDetailResponse {
  meta: MetaDTO;
  unit: UnitMatchDTO;
  /** 被取代的历史版本链（详情第三层版本追溯） */
  previousVersions: {
    id: string;
    versionNumber: number;
    sourceKind: string;
    publishedAt: string;
    supersededAt?: string;
    changeNote?: string;
  }[];
}

export function buildMeta(now: Date): MetaDTO {
  return {
    ruleVersion: MATCH_RULE_VERSION,
    majorAliasVersion: MAJOR_ALIAS_VERSION,
    catalogVersion: CATALOG_VERSION,
    realCatalogVersion: REAL_CATALOG_VERSION,
    evaluatedAt: now.toISOString(),
  };
}

export function buildCoverage(): CoverageDTO {
  return {
    version: COVERAGE_VERSION,
    subject: REAL_COVERAGE.subject,
    subjectLabel: REAL_COVERAGE.subjectLabel,
    status: REAL_COVERAGE.status,
    provinces: REAL_COVERAGE.provinces,
    regions: REAL_COVERAGE.regions,
    lastCheckedAt: REAL_COVERAGE.lastCheckedAt,
    openOpportunityCount: REAL_COVERAGE.openOpportunityCount,
    nextWindowNote: REAL_COVERAGE.nextWindowNote,
    scopeNote: REAL_COVERAGE.scopeNote,
  };
}

function toFollowDTO(
  follow: FollowRecord,
  currentVersionId: string,
): FollowDTO {
  return {
    id: follow.id,
    unitId: follow.unitId,
    announcementId: follow.announcementId,
    versionId: follow.versionId,
    status: follow.status,
    role: follow.role,
    followedAt: follow.followedAt,
    statusHistory: follow.statusHistory,
    abandonReason: follow.abandonReason,
    newerVersion: hasNewerVersion(follow, currentVersionId),
    remindersMuted: follow.remindersMuted,
    version: follow.version,
    materialStatuses: follow.materialStatuses,
    consultationNotes: follow.consultationNotes,
  };
}

/** 逐条件结果关联公告原文表述与证据锚点；地区维度无对应公告条件 */
function toDimensions(candidate: OpportunityCandidate): DimensionDTO[] {
  const requirementsById = new Map(
    candidate.unit.requirements.map((req) => [req.id, req]),
  );
  return candidate.match.dimensions.map((dim) => {
    if (dim.dimension === 'region') {
      return {
        ...dim,
        requirementDescription: '岗位所在地区需在你填写的可接受就业地区范围内',
      };
    }
    const req = requirementsById.get(dim.requirementId);
    return req
      ? {
          ...dim,
          requirementDescription: req.description,
          evidence: req.evidence,
        }
      : dim;
  });
}

/**
 * 关注记录是否关联指定候选单元（模块 7）。
 * 关注时的单元 id 可能属于旧版本（新版本同岗位 id 变、code 不变），
 * 除精确 id 外按「公告 + 单元 code」跨版本对齐。
 */
function followMatchesUnit(
  follow: FollowRecord,
  candidate: OpportunityCandidate,
): boolean {
  if (follow.unitId === candidate.unit.id) return true;
  if (follow.announcementId !== candidate.announcement.id) return false;
  for (const v of candidate.announcement.versions) {
    const u = v.units.find((x) => x.id === follow.unitId);
    if (u) return u.code === candidate.unit.code;
  }
  return false;
}

export function toUnitMatchDTO(
  candidate: OpportunityCandidate,
  follow: FollowRecord | null,
): UnitMatchDTO {
  const { announcement, version, unit, match } = candidate;
  const dimensions = toDimensions(candidate);
  return {
    unit: {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      region: unit.region,
      subject: unit.subject,
      stage: unit.stage,
      headcount: unit.headcount,
      organizationType: unit.organizationType,
      employmentNature: unit.employmentNature,
      allocation: unit.allocation,
      teachingScope: unit.teachingScope,
      schoolPlacement: unit.schoolPlacement,
      registerUrl: unit.registerUrl,
      sourceRow: unit.sourceRow,
      materials: unit.materials ?? [],
    },
    announcement: {
      id: announcement.id,
      title: announcement.title,
      publisher: announcement.publisher,
      organizationType: announcement.organizationType,
      officialUrl: announcement.officialUrl,
      dataset: announcement.dataset ?? 'demo',
      reviewStatus: announcement.reviewStatus ?? 'human_reviewed',
      reviewedBy: announcement.reviewedBy ?? null,
      reviewedAt: announcement.reviewedAt ?? null,
      contactInfo: announcement.contactInfo ?? null,
    },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      sourceKind: version.sourceKind,
      publishedAt: version.publishedAt,
      changeNote: version.changeNote,
      timeline: version.timeline,
      officialSource: version.officialSource,
    },
    gates: match.gates,
    dimensions,
    overall: match.overall,
    summary: match.summary,
    follow: follow ? toFollowDTO(follow, version.id) : null,
    consultationTemplates: buildConsultationTemplates(announcement, unit, dimensions),
  };
}

const DIMENSION_LABELS: Record<string, string> = {
  region: '地区范围',
  education: '学历学位',
  major: '专业',
  graduation_status: '毕业状态',
  employment_status: '就业状态',
  teacher_cert: '教师资格',
  hukou: '户籍',
  age: '年龄',
  other: '其他条件',
};

/** 针对需官方确认（MANUAL_REVIEW）的维度生成可复制的咨询问题模板 */
function buildConsultationTemplates(
  announcement: { title: string },
  unit: { name: string },
  dimensions: DimensionDTO[],
): ConsultationTemplateDTO[] {
  return dimensions
    .filter((d) => d.value === 'MANUAL_REVIEW')
    .map((d) => {
      const label = DIMENSION_LABELS[d.dimension] ?? d.dimension;
      const excerpt = d.requirementDescription
        ? `公告原文表述：${d.requirementDescription}`
        : '';
      const question =
        `您好，我想咨询《${announcement.title}》中「${unit.name}」岗位关于「${label}」的要求。` +
        (excerpt ? `${excerpt}。` : '') +
        `请问该条件的具体认定标准是什么？`;
      return { dimensionKey: d.dimension, dimensionLabel: label, question };
    });
}

/**
 * 列表分组：默认只展示“初步符合”；需要补充（按缺失维度分组）、
 * 建议人工确认、明确不符合与闸门失败（已截止等）分别进入二级分组。
 */
export function buildMatchResponse(
  candidates: readonly OpportunityCandidate[],
  profile: UserRecruitmentProfile,
  follows: readonly FollowRecord[],
  now: Date,
): MatchResponse {
  // 模块 7.5 合规过滤：普通用户端不返回 AI 初核待人工复核记录（dataset === 'real'）。
  // 管理端复核界面使用独立 API，不受影响。
  const publishedCandidates = candidates.filter(
    (c) => c.announcement.dataset !== 'real',
  );
  const sorted = sortCandidates([...publishedCandidates], profile);
  const dtoOf = (c: OpportunityCandidate) =>
    toUnitMatchDTO(c, follows.find((f) => followMatchesUnit(f, c)) ?? null);

  const groups: MatchGroupsDTO = {
    preliminary: [],
    needInfo: groupByMissingDimension([...sorted]).map((g) => ({
      dimension: g.dimension,
      count: g.count,
      units: g.candidates.map(dtoOf),
    })),
    manualReview: [],
    notEligible: [],
    closed: [],
  };

  for (const candidate of sorted) {
    const dto = dtoOf(candidate);
    if (!candidate.match.gates.every((g) => g.passed)) {
      groups.closed.push(dto);
      continue;
    }
    switch (candidate.match.overall) {
      case 'preliminary_eligible':
        groups.preliminary.push(dto);
        break;
      case 'need_more_info':
        // 已在 needInfo 分组中
        break;
      case 'manual_review':
        groups.manualReview.push(dto);
        break;
      case 'not_eligible':
        groups.notEligible.push(dto);
        break;
    }
  }

  const followsDTO = follows.map((f) => {
    const candidate = sorted.find((c) => followMatchesUnit(f, c));
    const currentVersionId =
      candidate?.version.id ?? findCurrentVersionId(candidates, f);
    return toFollowDTO(f, currentVersionId);
  });
  const primary = follows.find((f) => f.role === 'primary');

  return {
    meta: buildMeta(now),
    coverage: buildCoverage(),
    primaryTargetUnitId: primary?.unitId ?? null,
    groups,
    follows: followsDTO,
  };
}

function findCurrentVersionId(
  candidates: readonly OpportunityCandidate[],
  follow: FollowRecord,
): string {
  const ann = candidates.find((c) => c.announcement.id === follow.announcementId);
  return ann ? currentVersion(ann.announcement).id : follow.versionId;
}

export function buildUnitDetail(
  candidates: readonly OpportunityCandidate[],
  unitId: string,
  follows: readonly FollowRecord[],
  now: Date,
): UnitDetailResponse | null {
  // 模块 7.5 合规过滤：普通用户端不返回 AI 初核待人工复核记录（dataset === 'real'）。
  const candidate = candidates.find(
    (c) => c.unit.id === unitId && c.announcement.dataset !== 'real',
  );
  if (!candidate) return null;
  const follow = follows.find((f) => followMatchesUnit(f, candidate)) ?? null;
  const previousVersions = candidate.announcement.versions
    .filter((v) => v.id !== candidate.version.id)
    .map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      sourceKind: v.sourceKind,
      publishedAt: v.publishedAt,
      supersededAt: v.supersededAt,
      changeNote: v.changeNote,
    }));
  return {
    meta: buildMeta(now),
    unit: toUnitMatchDTO(candidate, follow),
    previousVersions,
  };
}

// ==================== 备考目标（模块 7：主要目标 → 备考闭环） ====================

/** 当前目录下公告与版本的聚合快照（供目标视图装配） */
export interface CatalogSnapshot {
  announcementId: string;
  title: string;
  publisher: string;
  officialUrl: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  timeline: AnnouncementTimeline;
  unit: {
    id: string;
    code: string;
    name: string;
    region: ApplicationUnit['region'];
    subject: ApplicationUnit['subject'];
    stage: ApplicationUnit['stage'];
    headcount: number;
  } | null;
  /** 旧版本中同 code 单元的 id 列表（关注记录可能指向旧版本单元 id） */
  legacyUnitIds: string[];
}

export interface GoalDTO {
  unitId: string;
  unitName: string;
  unitCode: string;
  region: ApplicationUnit['region'];
  stage: ApplicationUnit['stage'];
  subject: ApplicationUnit['subject'];
  headcount: number;
  announcement: {
    id: string;
    title: string;
    publisher: string;
    officialUrl: string;
  };
  version: {
    id: string;
    versionNumber: number;
    publishedAt: string;
    timeline: AnnouncementTimeline;
  };
  role: StudyTargetRole;
  followStatus: FollowRecord['status'];
  followedAt: string;
  /** 关注时的公告版本是否已被新版本取代（考试内容确认随之失效） */
  newerVersion: boolean;
}

export interface GoalsResponse {
  goals: GoalDTO[];
  primaryTargetUnitId: string | null;
}

// ==================== 新机会订阅（v7.1 M6） ====================

/** 订阅地区引用（与画像地区同一 JSON 结构，去掉 level 等匹配专用字段） */
export interface SubscriptionRegionDTO {
  code: string;
  province: string;
  city?: string;
  district?: string;
}

/** 新机会订阅（每用户一条；enabled=false 关闭后停止新提醒，历史通知保留） */
export interface SubscriptionDTO {
  regions: SubscriptionRegionDTO[];
  subject: string;
  naturePreference: 'public_only' | 'official_open' | 'undecided';
  /** 必要资格条件快照（透明展示用）：{ degree?, graduationDate?, cert? } */
  qualification: {
    degree?: string;
    graduationDate?: string;
    certSubject?: string;
    certStage?: string;
  } | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 订阅同步结果（幂等；newNotices 为本次新产生的站内提醒数） */
export interface SubscriptionSyncDTO {
  enabled: boolean;
  /** 订阅不存在时为 false（前端据此引导开启） */
  subscribed: boolean;
  newNotices: number;
  backfilled: number;
}

/** 资格条件快照：只取必要枚举与日期，不存证件号等敏感信息 */
export function buildQualificationSnapshot(profile: UserRecruitmentProfile) {
  return {
    degree: profile.degree,
    graduationDate: profile.graduationDate,
    certSubject: profile.teacherCert?.subject,
    certStage: profile.teacherCert?.stage,
  };
}

/**
 * 从活跃关注记录（considering/preparing/registered）装配备考目标视图。
 * 已放弃/已关闭的机会不再作为备考目标；目录中找不到的单元跳过。
 */
export function buildGoals(
  follows: readonly FollowRecord[],
  catalog: readonly CatalogSnapshot[],
): GoalsResponse {
  const goals: GoalDTO[] = [];
  for (const follow of follows) {
    if (follow.status === 'abandoned' || follow.status === 'closed') continue;
    const snap = catalog.find(
      (c) =>
        c.unit !== null &&
        (c.unit.id === follow.unitId || c.legacyUnitIds.includes(follow.unitId)),
    );
    if (!snap || !snap.unit) continue;
    const { unit } = snap;
    goals.push({
      unitId: unit.id,
      unitName: unit.name,
      unitCode: unit.code,
      region: unit.region,
      stage: unit.stage,
      subject: unit.subject,
      headcount: unit.headcount,
      announcement: {
        id: snap.announcementId,
        title: snap.title,
        publisher: snap.publisher,
        officialUrl: snap.officialUrl,
      },
      version: {
        id: snap.versionId,
        versionNumber: snap.versionNumber,
        publishedAt: snap.publishedAt,
        timeline: snap.timeline,
      },
      role: follow.role ?? 'backup',
      followStatus: follow.status,
      followedAt: follow.followedAt,
      newerVersion: follow.versionId !== snap.versionId,
    });
  }
  const primary = goals.find((g) => g.role === 'primary');
  return { goals, primaryTargetUnitId: primary?.unitId ?? null };
}
