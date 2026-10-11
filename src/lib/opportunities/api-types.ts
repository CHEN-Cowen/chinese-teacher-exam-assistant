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

/** 真实监测覆盖说明（覆盖地区/核对时间/当前在报数） */
export interface CoverageSourceDTO {
  id: string;
  name: string;
  url: string;
  lastCheckedAt: string;
  ok: boolean;
  failReason?: string | null;
}

export interface CoverageRegionDTO {
  code: string;
  label: string;
  authority: string;
  sources: CoverageSourceDTO[];
}

export type CoverageStatusDTO =
  | "monitoring_no_open"
  | "open_batch_exists"
  | "paused"
  /** 尚未开始监测的省份：只允许表达「暂未收录·待接入」，无城市无来源 */
  | "not_started";

/** 逐省覆盖口径：用户选择省时只能看到该省实际监测的城市 */
export interface ProvinceScopeDTO {
  code: string;
  label: string;
  status: CoverageStatusDTO;
  /** 该省已实际监测的市级代码；not_started 省份为空数组 */
  monitoredRegionCodes: string[];
  scopeNote: string;
}

export interface CoverageDTO {
  version: string;
  subject: string;
  subjectLabel: string;
  status: CoverageStatusDTO;
  provinces: ProvinceScopeDTO[];
  regions: CoverageRegionDTO[];
  lastCheckedAt: string;
  openOpportunityCount: number;
  nextWindowNote: string;
  scopeNote: string;
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

/** 机会纠错处理状态（P0-F）：与后端 corrections.domain 对齐 */
export type OpportunityCorrectionStatus =
  | "submitted"
  | "reviewing"
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

/** POST 请求体：前端只提交画像与补问答案，判定在后端完成 */
export type ProfilePayload = { profile: UserRecruitmentProfile };
