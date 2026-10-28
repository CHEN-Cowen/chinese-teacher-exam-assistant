/**
 * v6.1 资格匹配领域类型（后端，模块 5）。
 *
 * 与前端模块 1 的 lib/announcements/types、lib/matching/types、lib/profile/types
 * 保持同一套 JSON 结构：匹配规则只在后端实现，前端只消费结果（PRD 7.4：
 * “后端返回逐条件结果、规则版本、公告版本和 EvidenceAnchor；前端不自行复制判断逻辑”）。
 *
 * 本文件只定义类型，不含存储与框架代码；纯规则见 engine.ts。
 */

// ==================== 公告与报考单元 ====================

export type SubjectCode = string;
export type StageCode = 'primary' | 'middle' | 'high' | (string & {});

export const OPEN_SUBJECTS = ['chinese'] as const;

export type EmploymentNatureCode =
  | 'public_institution_staff'
  | 'record_filing'
  | 'post_quota'
  | 'headcount_control'
  | 'other';

export const IN_SCOPE_EMPLOYMENT_NATURES: readonly EmploymentNatureCode[] = [
  'public_institution_staff',
  'record_filing',
  'post_quota',
  'headcount_control',
  'other',
];

export interface EmploymentNature {
  code: EmploymentNatureCode;
  /** 公告中的官方名称 */
  officialName: string;
}

export type AllocationMethodCode =
  | 'direct_school'
  | 'score_based_choice'
  | 'unified_assignment'
  | 'other';

export interface AllocationMethod {
  code: AllocationMethodCode;
  description: string;
}

/**
 * 具体任教学校定岗状态。
 * 招聘单位（如区教育局）或岗位组名称不得自动当作最终任教学校：
 * - specified：官方岗位表已逐校列明定岗学校，才可展示具体校名；
 * - unspecified：统一调配/按分择岗/官方尚未公布，只保留官方口径说明，禁止虚构校名。
 */
export type SchoolPlacement =
  | { status: 'specified'; schoolName: string }
  | { status: 'unspecified'; note: string };

export interface RegionRef {
  code: string;
  province: string;
  city?: string;
  district?: string;
}

export type EvidenceLocator =
  | { kind: 'url'; url: string; anchor?: string }
  | { kind: 'file'; fileId: string; fileName: string; page?: number }
  | {
      kind: 'worksheet';
      fileId: string;
      fileName: string;
      sheet: string;
      cell?: string;
    }
  | { kind: 'excerpt'; excerpt: string };

export type EvidenceReviewState =
  | 'official'
  | 'ai_extracted'
  | 'pending_review';

export interface EvidenceAnchor {
  id: string;
  locator: EvidenceLocator;
  excerpt?: string;
  state: EvidenceReviewState;
  checkedAt: string;
  locatorData?: Record<string, unknown>;
}

export type RequirementDimension =
  | 'region'
  | 'education'
  | 'degree'
  | 'major'
  | 'graduate_status'
  | 'teacher_cert'
  | 'age'
  | 'hukou'
  | 'social_security'
  | 'work_experience'
  | 'other';

export type CredentialLevel =
  | 'secondary'
  | 'college'
  | 'bachelor'
  | 'master'
  | 'doctorate';

export type DegreeCode = 'none' | 'bachelor' | 'master' | 'doctorate';

export type RequirementCriterion =
  | { kind: 'education'; minLevel: CredentialLevel }
  | { kind: 'degree'; requiredDegree: Exclude<DegreeCode, 'none'> }
  | {
      kind: 'major';
      majorNames: string[];
      catalogGroups?: string[];
      /** 目录表述存在解释空间（“相关专业”等），精确不中时转人工确认 */
      ambiguous?: boolean;
    }
  | { kind: 'graduate_status'; requireFresh: boolean }
  | {
      kind: 'teacher_cert';
      subject: SubjectCode;
      stage: StageCode;
      acceptInProgress: boolean;
    }
  | { kind: 'age'; maxAgeYears: number; referenceDate?: string }
  | { kind: 'hukou'; allowedRegionCodes: string[]; label: string }
  | { kind: 'social_security'; requireNone: boolean }
  | { kind: 'work_experience'; minMonths: number }
  | { kind: 'other'; manualReview: boolean };

export interface Requirement {
  id: string;
  dimension: RequirementDimension;
  /** 公告原文表述（详情页第三层字段出处） */
  description: string;
  hard: boolean;
  criterion: RequirementCriterion;
  evidence: EvidenceAnchor;
}

export type OrganizationType =
  | 'government_unified'
  | 'institution_unified'
  | 'other';

export interface ApplicationUnit {
  id: string;
  code: string;
  name: string;
  announcementId: string;
  versionId: string;
  region: RegionRef;
  teachingScope?: string;
  subject: SubjectCode;
  stage: StageCode;
  headcount: number;
  organizationType: OrganizationType;
  employmentNature: EmploymentNature;
  allocation: AllocationMethod;
  /**
   * 具体任教学校定岗状态。缺省视为 unspecified 并按 allocation 派生保守说明，
   * 绝不把 unit.name（可能是招聘单位或岗位组名）当作最终学校展示。
   */
  schoolPlacement?: SchoolPlacement;
  registerUrl?: string;
  requirements: Requirement[];
  /**
   * 岗位表行级证据锚点（附件文件名 + 工作表/序号/行 + 原文摘录）。
   * 真实台账中人数、学历、专业等结构化字段以此定位到官方岗位表具体行。
   */
  sourceRow?: EvidenceAnchor;
  /** 招聘机构原文，不等同于最终任教学校。 */
  recruitmentOrganization?: string;
  /** 公共/岗位字段的完整官方证据链。 */
  fieldEvidence?: Record<string, EvidenceAnchor[]>;
  /**
   * 报名材料清单（模块 6）：按公告要求生成的最小材料项。
   * 每项必须有可追溯来源（EvidenceAnchor）；无法从公告确定的不列为必填。
   */
  materials?: MaterialItem[];
}

/** 报名材料完成状态（只存进度，不存证件内容） */
export type MaterialStatus = 'not_started' | 'in_progress' | 'done' | 'not_applicable';

/**
 * 报名材料项（模块 6）。
 * - source：官方来源锚点（公告原文摘录或岗位表行定位），必填以保证可追溯；
 * - applicableAudience：适用人群文本（如「所有报考者」「应届毕业生」）；
 * - required：是否公告明确要求的必交材料；无法确认时为 false。
 */
export interface MaterialItem {
  id: string;
  label: string;
  source: EvidenceAnchor;
  applicableAudience: string;
  required: boolean;
}

export type AnnouncementSourceKind = 'original' | 'supplement' | 'correction';

export interface AnnouncementTimeline {
  /**
   * 报名起止日期 YYYY-MM-DD。
   * 官方公告只给「初定 X 月，具体时间另行通知」而未给具体日期时必须留空，
   * 并在 pendingItems 中登记待明确事项——绝不臆造具体日期。
   *
   * M7 扩展节点：资格初审、审核结果、改报截止、准考证截止、成绩复核、
   * 资格复审、面试确认、体检、考察、选岗、拟聘用公示。
   */
  registrationStart?: string;
  registrationEnd?: string;
  preliminaryReviewDate?: string;
  reviewResultDate?: string;
  paymentDeadline?: string;
  amendmentDeadline?: string;
  admitTicketStart?: string;
  admitTicketEnd?: string;
  writtenExamDate?: string;
  scoreDate?: string;
  scoreReviewDate?: string;
  qualificationReviewDate?: string;
  interviewConfirmDate?: string;
  interviewDate?: string;
  medicalExamDate?: string;
  inspectionDate?: string;
  positionSelectionDate?: string;
  publicationDate?: string;
  pendingItems?: string[];
}

export interface AnnouncementVersion {
  id: string;
  announcementId: string;
  versionNumber: number;
  sourceKind: AnnouncementSourceKind;
  publishedAt: string;
  officialSource: EvidenceAnchor;
  timeline: AnnouncementTimeline;
  units: ApplicationUnit[];
  changeNote?: string;
  supersededAt?: string;
}

export type AnnouncementLifecycle = 'active' | 'withdrawn';

/** 人工复核状态：真实台账记录未人工复核前一律为 ai_reviewed_pending */
export type AnnouncementReviewStatus =
  | 'ai_reviewed_pending'
  | 'human_reviewed';

/**
 * 官方来源健康度（人工巡检登记）。
 * ok=false 表示最近一次巡检确认来源失效（404/撤稿/域名失效等），
 * failReason 记录现象；不记录「暂时打不开」的网络抖动。
 */
export interface SourceHealth {
  ok: boolean;
  checkedAt: string;
  failReason?: string | null;
}

export interface RecruitmentAnnouncement {
  id: string;
  title: string;
  publisher: string;
  organizationType: OrganizationType;
  officialUrl: string;
  subjectScope: SubjectCode[];
  region: RegionRef;
  lifecycle: AnnouncementLifecycle;
  firstPublishedAt: string;
  versions: AnnouncementVersion[];
  /**
   * 数据集合：demo=演示数据（example.gov.cn 占位来源）；
   * real=真实监测台账数据（人工维护，附官方锚点）；
   * test=自动化测试样本（永不进入用户端目录，M5-05）。缺省视为 demo。
   */
  dataset?: 'demo' | 'real' | 'test';
  /** 人工复核状态与复核人；real 记录未复核不进入主要推荐 */
  reviewStatus?: AnnouncementReviewStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  /** 官方来源巡检健康度；缺省视为正常（未登记异常） */
  sourceHealth?: SourceHealth;
  /** 官方联系信息（咨询电话/邮箱/地址等），缺省为 null */
  contactInfo?: string | null;
}

// ==================== 用户画像 ====================

export type RegionPreferenceLevel = 'required' | 'preferred' | 'consider';

export interface RegionPreference {
  code: string;
  province: string;
  city?: string;
  level: RegionPreferenceLevel;
}

export type TeacherCertStatus = 'obtained' | 'in_progress' | 'none';

export interface TeacherCertInfo {
  status: TeacherCertStatus;
  subject?: SubjectCode;
  stage?: StageCode;
  expectedDate?: string;
}

export type EmploymentStatus =
  | 'student'
  | 'fresh_unemployed'
  | 'employed_fulltime'
  | 'employed_parttime'
  | 'other';

/**
 * v7.2 用工偏好（三选一，只影响展示、排序和偏好范围外分类）。
 * 不进入资格判定（evaluateOpportunity 不读取本字段）。
 * 旧画像无此字段时按 undefined 处理，行为等同 undecided（不筛选）。
 */
export type EmploymentNaturePreference =
  | 'public_only'
  | 'official_open'
  | 'undecided';

/**
 * 分阶段教育经历（D01）。
 * 与前端 lib/profile/types 同结构；缺省时按旧单一字段兼容。
 */
export type EducationStatus = 'in_progress' | 'graduated';
export type EducationDegreeStatus = 'none' | 'in_progress' | 'obtained';
export type EducationStudyMode = 'full_time' | 'part_time' | 'other';
export type TeacherTraining = 'yes' | 'no' | 'unknown';

export interface EducationExperience {
  id: string;
  stage?: CredentialLevel;
  schoolName?: string;
  majorFullName: string;
  majorCode?: string;
  majorCatalogVersion?: string;
  status?: EducationStatus;
  graduationDate?: string;
  degree?: DegreeCode;
  degreeStatus?: EducationDegreeStatus;
  studyMode?: EducationStudyMode;
  teacherTraining: TeacherTraining;
  teacherTrainingNote?: string;
  majorConfirmed: boolean;
  source: 'user' | 'legacy';
  stageNeedsConfirmation?: boolean;
}

/** 旧单一字段迁移后的确认状态；旧原值始终保留 */
export interface LegacyEducationConfirmation {
  confirmed: boolean;
  confirmedAt?: string;
}

/** 匹配接口入参：五组基础画像 + 按需补充的条件事实（未提供即 UNKNOWN） */
export interface UserRecruitmentProfile {
  regions: RegionPreference[];
  educationLevel?: CredentialLevel;
  degree?: DegreeCode;
  majorFullName?: string;
  graduationDate?: string;
  /** 分阶段教育经历（D01）；缺省时按旧单一字段兼容 */
  educationExperiences?: EducationExperience[];
  /** 旧单一字段的确认状态；不改变旧原值 */
  legacyEducation?: LegacyEducationConfirmation;
  employmentStatus?: EmploymentStatus;
  teacherCert?: TeacherCertInfo;
  acceptedEmploymentNatures: EmploymentNatureCode[];
  /**
   * v7.2 用工偏好。只影响展示、排序和偏好范围外分类，不进入资格判定。
   * 与前端 profile/types 同名同语义，访客草稿与服务端画像共用。
   */
  employmentNaturePreference?: EmploymentNaturePreference;
  // 条件画像：缺省只能得到 UNKNOWN，绝不转 FAIL
  birthDate?: string;
  hukouRegionCode?: string;
  socialSecurityMonths?: number;
  workExperienceMonths?: number;
  extraAnswers?: Record<string, string>;
}

// ==================== 匹配结果 ====================

export type MatchValue = 'PASS' | 'FAIL' | 'UNKNOWN' | 'MANUAL_REVIEW';

export type OpportunityMatchStatus =
  | 'preliminary_eligible'
  | 'need_more_info'
  | 'manual_review'
  | 'not_eligible';

export interface MatchDimensionResult {
  requirementId: string;
  dimension: RequirementDimension;
  value: MatchValue;
  reason: string;
  hard: boolean;
}

export type GateCode =
  | 'subject_not_open'
  | 'registration_unconfirmed'
  | 'registration_closed'
  | 'out_of_scope_nature'
  | 'announcement_withdrawn'
  | 'source_unavailable'
  | 'no_official_source'
  | 'evidence_not_reviewed'
  | 'evidence_stale';

export interface GateResult {
  code: GateCode;
  passed: boolean;
  reason: string;
}

export interface OpportunityMatchResult {
  unitId: string;
  announcementId: string;
  versionId: string;
  gates: GateResult[];
  dimensions: MatchDimensionResult[];
  overall: OpportunityMatchStatus;
  summary: string;
}

export interface OpportunityCandidate {
  announcement: RecruitmentAnnouncement;
  version: AnnouncementVersion;
  unit: ApplicationUnit;
  match: OpportunityMatchResult;
}

export const MATCH_STATUS_LABELS: Record<OpportunityMatchStatus, string> = {
  preliminary_eligible: '初步符合',
  need_more_info: '补充信息后判断',
  manual_review: '建议人工确认',
  not_eligible: '明确不符合',
};
