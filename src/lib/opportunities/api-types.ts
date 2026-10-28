/**
 * 机会模块后端响应类型（模块 5）。
 *
 * 这些类型是后端 src/opportunities/view.ts DTO 的镜像：匹配结论、逐条件结果、
 * 证据锚点与版本信息全部由后端产出，前端只渲染、不复制判断逻辑。
 */
import type { UserRecruitmentProfile } from "@/lib/profile/types";

export type MatchValue = "PASS" | "FAIL" | "UNKNOWN" | "MANUAL_REVIEW";
export type OpportunityMatchStatus =
  | "preliminary_eligible"
  | "need_more_info"
  | "manual_review"
  | "not_eligible";

export type FollowStatus =
  | "considering"
  | "preparing"
  | "registered"
  /** D07：报名完成、等待考试（只能由 registered 进入，只能去 closed/abandoned） */
  | "waiting_exam"
  | "abandoned"
  | "closed";

/** 报名材料完成状态（只存进度，不存证件内容） */
export type MaterialStatus =
  | "not_started"
  | "in_progress"
  | "done"
  | "not_applicable";

export type StudyTargetRole = "primary" | "backup";

export interface EvidenceLocatorDTO {
  kind: "url" | "file" | "worksheet" | "excerpt";
  url?: string;
  anchor?: string;
  fileName?: string;
  page?: number;
  sheet?: string;
  cell?: string;
  excerpt?: string;
}

export interface EvidenceAnchorDTO {
  id: string;
  locator: EvidenceLocatorDTO;
  excerpt?: string;
  /** official=官方已核对；ai_extracted/pending_review 不得当作正式依据 */
  state: "official" | "ai_extracted" | "pending_review";
  checkedAt: string;
}

export interface RegionRefDTO {
  code: string;
  province: string;
  city?: string;
  district?: string;
}

export interface GateDTO {
  code:
    | "subject_not_open"
    | "registration_unconfirmed"
    | "registration_closed"
    | "out_of_scope_nature"
    | "announcement_withdrawn"
    | "source_unavailable"
    | "no_official_source"
    | "evidence_not_reviewed"
    | "evidence_stale";
  passed: boolean;
  reason: string;
}

export interface DimensionDTO {
  requirementId: string;
  dimension:
    | "region"
    | "education"
    | "degree"
    | "major"
    | "graduate_status"
    | "teacher_cert"
    | "age"
    | "hukou"
    | "social_security"
    | "work_experience"
    | "other";
  value: MatchValue;
  reason: string;
  hard: boolean;
  requirementDescription?: string;
  evidence?: EvidenceAnchorDTO;
  /** 用户事实摘要（采用哪条资料/哪一阶段） */
  userFact?: string;
  /** 专业条件实际采用的教育经历 */
  adoptedEducation?: {
    experienceId: string;
    stage?: string;
    majorFullName: string;
  }[];
  /** 该条件下一步动作 */
  nextStep?: string;
}

export interface FollowStatusEventDTO {
  status: FollowStatus;
  at: string;
  note?: string;
}

export interface FollowDTO {
  id: string;
  unitId: string;
  announcementId: string;
  versionId: string;
  status: FollowStatus;
  role: StudyTargetRole | null;
  followedAt: string;
  statusHistory: FollowStatusEventDTO[];
  abandonReason: string | null;
  newerVersion: boolean;
  /** 乐观锁版本号：每次状态/材料/咨询变更递增 */
  version: number;
  /** 报名材料完成状态：{ [materialItemId]: MaterialStatus } */
  materialStatuses: Record<string, MaterialStatus> | null;
  /** 用户自行记录的官方咨询结论：{ [dimensionKey]: note } */
  consultationNotes: Record<string, string> | null;
  /** M7：关注后自动同步的报考节点数（仅 follow 响应中有值） */
  syncedEventCount?: number;
}

/** 报名材料项（来源必须可追溯到官方公告） */
export interface MaterialItemDTO {
  id: string;
  label: string;
  source: EvidenceAnchorDTO;
  applicableAudience: string;
  required: boolean;
}

/** 可复制的官方咨询问题模板（针对需官方确认的维度） */
export interface ConsultationTemplateDTO {
  dimensionKey: string;
  dimensionLabel: string;
  question: string;
}

/** 官方联系信息（优先取来源登记，其次发布主体+公告链接） */
export interface ContactInfoDTO {
  publisher: string;
  officialUrl: string;
  contactInfo?: string | null;
}

export interface UnitMatchDTO {
  unit: {
    id: string;
    code: string;
    name: string;
    region: RegionRefDTO;
    /** 学科（v7.1 M4 卡片第一层：学段和学科） */
    subject: string;
    stage: string;
    headcount: number;
    organizationType: string;
    employmentNature: { code: string; officialName: string };
    allocation: { code: string; description: string };
    teachingScope?: string;
    /**
     * 具体任教学校定岗状态。缺省视为未知；任何情况下都不得把
     * unit.name（可能是招聘单位或岗位组名）直接当作最终任教学校。
     */
    schoolPlacement?: SchoolPlacementDTO;
    registerUrl?: string;
    /** 岗位表行级证据锚点（附件 + 工作表/序号/行 + 摘录） */
    sourceRow?: EvidenceAnchorDTO;
    /** 报名材料清单（按公告要求，每项带来源） */
    materials?: MaterialItemDTO[];
  };
  announcement: {
    id: string;
    title: string;
    publisher: string;
    organizationType: string;
    officialUrl: string;
    /** 公告级地区（单位关注身份键匹配用，D07） */
    region: RegionRefDTO;
    /** demo=演示数据；real=真实监测台账数据 */
    dataset: "demo" | "real";
    reviewStatus: "ai_reviewed_pending" | "human_reviewed";
    reviewedBy: string | null;
    reviewedAt: string | null;
    /** 官方联系信息 */
    contactInfo?: string | null;
  };
  version: {
    id: string;
    versionNumber: number;
    sourceKind: "original" | "supplement" | "correction" | string;
    publishedAt: string;
    changeNote?: string;
    timeline: {
      /** 官方未公布具体日期时留空（预告批次），绝不臆造日期 */
      registrationStart?: string;
      registrationEnd?: string;
      paymentDeadline?: string;
      admitTicketStart?: string;
      writtenExamDate?: string;
      scoreDate?: string;
      interviewDate?: string;
      pendingItems?: string[];
    };
    officialSource: EvidenceAnchorDTO;
  };
  gates: GateDTO[];
  dimensions: DimensionDTO[];
  overall: OpportunityMatchStatus;
  /** 资格初步符合但不在“必须接受”的地区范围内（偏好范围外，不是不符合） */
  preferenceOutOfScope?: boolean;
  summary: string;
  follow: FollowDTO | null;
  /** 需官方确认维度的咨询问题模板 */
  consultationTemplates?: ConsultationTemplateDTO[];
}

export interface MetaDTO {
  ruleVersion: string;
  majorAliasVersion: string;
  catalogVersion: string;
  realCatalogVersion: string;
  evaluatedAt: string;
}

/**
 * M01/F1-F2 统一覆盖投影（与后端 coverage-projection.ts 同构）。
 *
 * 访客与登录用户共用同一接口、同一事实来源：
 * - 来源级状态区分已登记/核验通过/近期检查正常/检查失败/暂停/核验不可用；
 * - 省级状态区分未收录/已登记/已核验/监测中无在报/监测中在报/暂停；
 * - caliber 携带统计口径、生成时间与非实时回退标注。
 */
export type CoverageSourceStateDTO =
  | "registered"
  | "verified"
  | "recently_healthy"
  | "check_failed"
  | "paused"
  | "blocked";

export interface CoverageSourceDTO {
  /** 台账 sourceKey */
  id: string;
  name: string;
  url: string;
  /** 6 位行政区划代码 */
  regionCode: string;
  authorityLevel: string;
  state: CoverageSourceStateDTO;
  /** 最近一次来源级检查时间；无检查记录为 null */
  lastCheckedAt: string | null;
  /** 人类可读的判定依据 */
  note: string;
}

export interface CoverageRegionDTO {
  code: string;
  label: string;
  authority: string;
  sources: CoverageSourceDTO[];
}

export type CoverageStatusDTO =
  | "not_started"
  /** 已登记官方入口，等待核验 */
  | "registered"
  /** 已核验通过，但近期检查未运行/未达阈值/已超窗 */
  | "verified"
  | "monitoring_no_open"
  | "open_batch_exists"
  | "paused";

/** 逐省覆盖口径：用户选择省时只能看到该省实际监测的城市 */
export interface ProvinceScopeDTO {
  code: string;
  label: string;
  status: CoverageStatusDTO;
  /** 该省已登记市/区县级来源的地区代码；省级候选不计入 */
  monitoredRegionCodes: string[];
  scopeNote: string;
}

/** 统计口径：说明「按什么口径统计、何时生成、是否为非实时回退」。 */
export interface CoverageCaliberDTO {
  generatedAt: string;
  version: string;
  registeredSources: number;
  verifiedSources: number;
  recentlyHealthySources: number;
  failedSources: number;
  pausedSources: number;
  blockedSources: number;
  publishedOpenUnits: number;
  /** 运行状态不可用、使用台账静态投影回退（非实时） */
  isFallback: boolean;
  fallbackNote: string | null;
}

export interface CoverageDTO {
  version: string;
  subject: string;
  subjectLabel: string;
  status: CoverageStatusDTO;
  provinces: ProvinceScopeDTO[];
  regions: CoverageRegionDTO[];
  /** 扁平来源列表（含状态与判定依据），与 regions 内 sources 同构 */
  sources: CoverageSourceDTO[];
  lastCheckedAt: string;
  openOpportunityCount: number;
  nextWindowNote: string;
  scopeNote: string;
  caliber: CoverageCaliberDTO;
}

/**
 * 具体任教学校定岗状态（与后端 types.ts SchoolPlacement 对齐）：
 * specified=官方岗位表逐校列明；unspecified=统一调配/按分择岗/未公布。
 */
export type SchoolPlacementDTO =
  | { status: "specified"; schoolName: string }
  | { status: "unspecified"; note: string };

export interface MatchResponse {
  meta: MetaDTO;
  coverage: CoverageDTO;
  primaryTargetUnitId: string | null;
  groups: {
    preliminary: UnitMatchDTO[];
    needInfo: { dimension: string; count: number; units: UnitMatchDTO[] }[];
    manualReview: UnitMatchDTO[];
    notEligible: UnitMatchDTO[];
    closed: UnitMatchDTO[];
  };
  follows: FollowDTO[];
}

export interface UnitDetailResponse {
  meta: MetaDTO;
  unit: UnitMatchDTO;
  previousVersions: {
    id: string;
    versionNumber: number;
    sourceKind: string;
    publishedAt: string;
    supersededAt?: string;
    changeNote?: string;
  }[];
}

/** 备考目标（模块 7）：活跃关注 + 公告版本聚合，主要目标选择与 /study 页数据源 */
export interface GoalDTO {
  unitId: string;
  unitName: string;
  unitCode: string;
  region: RegionRefDTO;
  stage: string;
  subject: string;
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
    timeline: {
      registrationStart?: string;
      registrationEnd?: string;
      paymentDeadline?: string;
      admitTicketStart?: string;
      writtenExamDate?: string;
      scoreDate?: string;
      interviewDate?: string;
      pendingItems?: string[];
    };
  };
  role: StudyTargetRole;
  followStatus: FollowStatus;
  followedAt: string;
  /** 关注时的公告版本已被新版本取代（考试内容确认随之失效） */
  newerVersion: boolean;
}

export interface GoalsResponse {
  goals: GoalDTO[];
  primaryTargetUnitId: string | null;
}

/** 机会纠错处理状态（P0-F / D08 扩展）：与后端 corrections.domain 对齐 */
export type OpportunityCorrectionStatus =
  | "submitted"
  | "reviewing"
  | "need_supplement"
  | "resolved"
  | "rejected";

/** 用户视角的纠错记录（GET /opportunities/corrections/mine） */
export interface OpportunityCorrectionDTO {
  id: string;
  unitId: string;
  unitName: string | null;
  announcementId: string;
  announcementTitle: string | null;
  versionId: string;
  fieldPath: string;
  fieldLabel: string;
  content: string;
  contact: string | null;
  status: OpportunityCorrectionStatus;
  reviewNote: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  /** D08：已采纳修正时登记的已发布版本 id（可空，供回详情核对） */
  resolvedVersionId: string | null;
  createdAt: string;
}

/** 员工队列项（GET /opportunities/admin/corrections）：附带提交人账号 */
export interface StaffOpportunityCorrectionDTO
  extends OpportunityCorrectionDTO {
  submitter: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * 公告补录提交（D08 / PRD 11.9 U08）：用户报告未收录的官方公告。
 * 处理状态与纠错共用同一状态机（submitted/reviewing/need_supplement/resolved/rejected）。
 */
export interface AnnouncementSubmissionDTO {
  id: string;
  officialUrl: string;
  publisherName: string;
  regionCode: string;
  note: string | null;
  status: OpportunityCorrectionStatus;
  reviewNote: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** 员工补录队列项（GET /opportunities/admin/announcement-submissions） */
export interface StaffAnnouncementSubmissionDTO
  extends AnnouncementSubmissionDTO {
  submitter: {
    id: string;
    email: string;
    name: string | null;
  };
}

/** POST 请求体：前端只提交画像与补问答案，判定在后端完成 */
export type ProfilePayload = { profile: UserRecruitmentProfile };

// ==================== 往年参考（D06 / PRD 11.7 U06） ====================

/** 往年参考完整程度（日期口径：报名起止/笔试/面试 4 项） */
export interface HistoryCompletenessDTO {
  knownDateCount: number;
  totalDateCount: number;
  materialCount: number;
  /** 全部证据已人工核对=official；含 AI 初核/待复核内容时如实标注 */
  evidenceState: "official" | "ai_extracted" | "pending_review";
}

/** 往年参考列表项（只读历史事实，无报名/关注动作） */
export interface HistoryUnitDTO {
  unitId: string;
  unitCode: string;
  unitName: string;
  region: RegionRefDTO;
  subject: string;
  stage: string;
  headcount: number;
  organizationType: string;
  employmentNature: { code: string; officialName: string };
  allocation: { code: string; description: string };
  teachingScope?: string;
  schoolPlacement?: SchoolPlacementDTO;
  announcement: {
    id: string;
    title: string;
    publisher: string;
    officialUrl: string;
    dataset: "demo" | "real";
    reviewStatus: "ai_reviewed_pending" | "human_reviewed";
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
  completeness: HistoryCompletenessDTO;
  /** 官方来源失效时的存档说明（链接失效仍显示留档） */
  archiveNote: string | null;
}

/** 往年参考列表筛选条件（地区为 6 位区划代码前缀） */
export interface HistoryFilters {
  year?: number;
  regionCode?: string;
  stage?: string;
  nature?: string;
  keyword?: string;
  /** 岗位要求的最低学历（精确匹配该档，不是“可报”推断） */
  educationLevel?: "secondary" | "college" | "bachelor" | "master" | "doctorate";
  /** 岗位专业范围包含该专业名称 */
  major?: string;
  page?: number;
  pageSize?: number;
}

export interface HistoryListResponse {
  meta: MetaDTO;
  /** 收录样本范围说明（单年样本/年份区间，不推测本年必招时间） */
  sampleNote: string;
  /** 全部历史数据（未筛选）中的可筛选批次年，倒序 */
  years: number[];
  /** 全部历史数据（未筛选）中的可选地区 */
  availableRegions: { code: string; label: string }[];
  /** 全部历史数据（未筛选）中出现过的学历档（岗位最低学历） */
  educationLevels: {
    code: "secondary" | "college" | "bachelor" | "master" | "doctorate";
    label: string;
  }[];
  /** 全部历史数据（未筛选）中出现过的专业名 */
  availableMajors: string[];
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
    dimension: DimensionDTO["dimension"];
    description: string;
    hard: boolean;
    evidence: EvidenceAnchorDTO;
  }[];
  materials: MaterialItemDTO[];
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

// ==================== 新机会订阅（v7.1 M6） ====================

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
  naturePreference: "public_only" | "official_open" | "undecided";
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

/** PUT /opportunities/subscription 请求体：部分更新，未传字段保留现值 */
export interface SubscriptionUpdateInput {
  regions?: SubscriptionRegionDTO[];
  naturePreference?: SubscriptionDTO["naturePreference"];
  enabled?: boolean;
}

/** POST /opportunities/subscription/sync 响应（幂等） */
export interface SubscriptionSyncDTO {
  enabled: boolean;
  subscribed: boolean;
  newNotices: number;
  backfilled: number;
  /** D07：本次单位关注新提醒数（无单位关注时为 0） */
  orgNewNotices: number;
  /** D07：本次单位关注基线回填数 */
  orgBackfilled: number;
}

/** 单位关注（D07 / PRD 11.8 U07）：身份键仅精确匹配，展示名原样保存 */
export interface OrganizationFollowDTO {
  id: string;
  identityKey: string;
  publisherName: string;
  regionCode: string;
  followedAt: string;
}
