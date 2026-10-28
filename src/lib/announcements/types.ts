/**
 * v6.1 招聘公告领域类型（模块 1）。
 *
 * 概念对应 PRD 7.1：
 * - RecruitmentAnnouncement：一次官方公开招聘活动及其总体规则；
 * - AnnouncementVersion：公告不可变版本（补充公告产生新版本，不覆盖旧版本）；
 * - ApplicationUnit：用户报名时实际选择的报考单元（区县 / 岗位组 / 具体学校）。
 *
 * 本文件只定义类型，不包含存储、React 与网络；判定规则在 domain.ts。
 * 与 v5.2 的 ExamTarget/EvidenceItem 并存，暂不修改旧类型。
 */

/**
 * 学科编码。当前只开放语文（chinese），但类型不把语文写成长期唯一枚举：
 * `(string & {})` 让后续学科可以在不改既有代码的情况下进入模型，
 * 而 OPEN_SUBJECTS 才是“当前已开放”的运行时白名单（匹配闸门使用）。
 */
export type SubjectCode = "chinese" | (string & {});

/** 学段编码（与 v5.2 EducationLevel 取值保持一致，便于后续兼容层映射） */
export type StageCode = "primary" | "middle" | "high" | (string & {});

/** 当前产品已开放的学科白名单；后续开放其他学科时在此追加 */
export const OPEN_SUBJECTS = ["chinese"] as const;

/** 用工性质编码（官方名称另存，展示时优先用 officialName） */
export type EmploymentNatureCode =
  | "public_institution_staff" // 事业编
  | "record_filing" // 备案制
  | "post_quota" // 员额制
  | "headcount_control" // 控制数（控制总量备案管理）
  | "other";

/** 产品收录范围内的用工性质（PRD 7.2；民办、劳务派遣等不在此列） */
export const IN_SCOPE_EMPLOYMENT_NATURES: readonly EmploymentNatureCode[] = [
  "public_institution_staff",
  "record_filing",
  "post_quota",
  "headcount_control",
  "other",
];

/** 用工性质：编码用于规则，officialName 保留公告原文称谓 */
export interface EmploymentNature {
  code: EmploymentNatureCode;
  /** 公告中的官方名称，如“事业编制工作人员”“员额池管理” */
  officialName: string;
}

/** 分配方式（PRD 7.1：报考单元不等于最终任教学校） */
export type AllocationMethodCode =
  | "direct_school" // 直接报学校
  | "score_based_choice" // 按成绩择校
  | "unified_assignment" // 统一调配
  | "other";

export interface AllocationMethod {
  code: AllocationMethodCode;
  /** 公告原文说明，如“按总成绩从高到低依次择岗” */
  description: string;
}

/**
 * 具体任教学校定岗状态：招聘单位/岗位组名不得自动当作最终学校。
 * specified=官方岗位表逐校列明；unspecified=统一调配/按分择岗/未公布。
 */
export type SchoolPlacement =
  | { status: "specified"; schoolName: string }
  | { status: "unspecified"; note: string };

/** 行政区域引用（code 使用统计用区划代码，6 位） */
export interface RegionRef {
  code: string;
  province: string;
  city?: string;
  district?: string;
}

/**
 * 证据锚点：每个高影响字段必须能定位到官方来源的具体位置。
 * 定位类型覆盖 PRD 7.10：URL、文件、页码、工作表、单元格、原文片段。
 */
export type EvidenceLocator =
  | { kind: "url"; url: string; anchor?: string }
  | { kind: "file"; fileId: string; fileName: string; page?: number }
  | {
      kind: "worksheet";
      fileId: string;
      fileName: string;
      sheet: string;
      /** 例如 "B12" 或 "B12:D12" */
      cell?: string;
    }
  | { kind: "excerpt"; excerpt: string };

/** 单条证据的核对状态（公告事实 / AI 候选 / 人工核对三分离） */
export type EvidenceReviewState =
  | "official" // 已从官方公告人工核对
  | "ai_extracted" // AI 提取候选，未经审核不得参与正式匹配
  | "pending_review"; // 待人工审核

export interface EvidenceAnchor {
  id: string;
  locator: EvidenceLocator;
  /** 原文摘录（展示“依据”用，不复制整篇公告） */
  excerpt?: string;
  state: EvidenceReviewState;
  /** 最后核对时间 ISO 字符串 */
  checkedAt: string;
  locatorData?: Record<string, unknown>;
}

/** 资格条件维度（PRD 7.3 / 7.4：硬性条件逐项判断） */
export type RequirementDimension =
  | "region" // 地区硬边界（由报考单元地区参与，不写进单元 requirements）
  | "education" // 学历
  | "degree" // 学位
  | "major" // 专业
  | "graduate_status" // 毕业身份（应届等，按公告口径逐次判断）
  | "teacher_cert" // 教师资格
  | "age" // 年龄
  | "hukou" // 户籍
  | "social_security" // 社保
  | "work_experience" // 工作经历
  | "other"; // 公告特有其他条件

/** 学历层次（用于高低比较） */
export type CredentialLevel =
  | "secondary" // 中专/高中
  | "college" // 大专
  | "bachelor" // 本科
  | "master" // 硕士研究生
  | "doctorate"; // 博士研究生

export type DegreeCode = "none" | "bachelor" | "master" | "doctorate";

/**
 * 结构化条件判定值（判别联合）。
 * 匹配引擎只认这一层；description 保留公告原文用于解释。
 * 无法结构化的条件进入 other 并标记是否需要人工确认。
 */
export type RequirementCriterion =
  | { kind: "education"; minLevel: CredentialLevel }
  | { kind: "degree"; requiredDegree: Exclude<DegreeCode, "none"> }
  | {
      kind: "major";
      /** 公告列出的可接受专业全称（归一化后精确匹配） */
      majorNames: string[];
      /** 公告列出的专业目录类名，如“中国语言文学类” */
      catalogGroups?: string[];
      /**
       * 目录表述存在解释空间（如“相关专业”“师范类专业方向”），
       * 精确匹配不中时不得自动判定，转人工确认。
       */
      ambiguous?: boolean;
      /**
       * 公告明确指定的教育阶段（D03）。
       * 缺省按最高学历阶段专业判断；多阶段可要求任一命中（any）或同时命中（all）。
       */
      stages?: CredentialLevel[];
      stageMode?: "any" | "all";
    }
  | { kind: "graduate_status"; requireFresh: boolean }
  | {
      kind: "teacher_cert";
      subject: SubjectCode;
      stage: StageCode;
      /** 是否接受“已通过考试、领证中”的在途状态 */
      acceptInProgress: boolean;
      /** 公告原文明确允许高学段教师资格报考低学段岗位（D03） */
      acceptHigherStage?: boolean;
    }
  | { kind: "age"; maxAgeYears: number; referenceDate?: string }
  | { kind: "hukou"; allowedRegionCodes: string[]; label: string }
  | { kind: "social_security"; requireNone: boolean }
  | { kind: "work_experience"; minMonths: number }
  | { kind: "other"; manualReview: boolean };

/** 一条报考资格条件（原文 + 结构化判定值 + 证据） */
export interface Requirement {
  id: string;
  dimension: RequirementDimension;
  /** 公告原文表述，如“具有国家承认的本科及以上学历” */
  description: string;
  /** 是否硬性条件；软性偏好不满足不直接判明确不符合 */
  hard: boolean;
  criterion: RequirementCriterion;
  evidence: EvidenceAnchor;
}

/** 招聘组织方式 */
export type OrganizationType =
  | "government_unified" // 政府/人社/教育部门统一招聘
  | "institution_unified" // 事业单位统一招聘
  | "other";

/**
 * 报考单元版本：挂在公告版本之下。
 * 用户报名时选择的是单元（区县/岗位组/学校），不是抽象“公告”。
 */
export interface ApplicationUnit {
  id: string;
  /** 岗位表中的单元/岗位代码 */
  code: string;
  name: string;
  announcementId: string;
  versionId: string;
  region: RegionRef;
  /** 大致任教范围（录取后调配时用于说明，不等于最终学校） */
  teachingScope?: string;
  subject: SubjectCode;
  stage: StageCode;
  headcount: number;
  organizationType: OrganizationType;
  employmentNature: EmploymentNature;
  allocation: AllocationMethod;
  /** 具体任教学校定岗状态；缺省按 allocation 保守派生为未知，禁止从 name 推断校名 */
  schoolPlacement?: SchoolPlacement;
  /** 官方报名入口（版本级或单元级） */
  registerUrl?: string;
  recruitmentOrganization?: string;
  fieldEvidence?: Record<string, EvidenceAnchor[]>;
  requirements: Requirement[];
  /** 报名材料清单（按公告要求，每项必须有可追溯来源） */
  materials?: MaterialItem[];
}

/** 报名材料完成状态 */
export type MaterialStatus =
  | "not_started"
  | "in_progress"
  | "done"
  | "not_applicable";

/** 报名材料项（来源必须可追溯到官方公告） */
export interface MaterialItem {
  id: string;
  label: string;
  source: EvidenceAnchor;
  applicableAudience: string;
  required: boolean;
}

/** 公告版本来源类型：原始公告 / 补充公告 / 更正公告 */
export type AnnouncementSourceKind = "original" | "supplement" | "correction";

export interface AnnouncementTimeline {
  /** 报名开始 ISO 日期（必填，缺失不得发布） */
  registrationStart: string;
  /** 报名截止 ISO 日期（必填） */
  registrationEnd: string;
  /** 资格初审（M7） */
  preliminaryReviewDate?: string;
  /** 审核结果公布（M7） */
  reviewResultDate?: string;
  paymentDeadline?: string;
  /** 改报截止（M7） */
  amendmentDeadline?: string;
  admitTicketStart?: string;
  /** 准考证打印截止（M7） */
  admitTicketEnd?: string;
  writtenExamDate?: string;
  scoreDate?: string;
  /** 成绩复核（M7） */
  scoreReviewDate?: string;
  /** 资格复审（M7） */
  qualificationReviewDate?: string;
  /** 面试确认（M7） */
  interviewConfirmDate?: string;
  interviewDate?: string;
  /** 体检（M7） */
  medicalExamDate?: string;
  /** 考察（M7） */
  inspectionDate?: string;
  /** 选岗（M7） */
  positionSelectionDate?: string;
  /** 拟聘用公示（M7） */
  publicationDate?: string;
  /** 时间未定时显示“待官方通知”，不写推测日期；true 表示官方明确待定 */
  pendingItems?: string[];
}

/**
 * 公告不可变版本。发布后任何修改都产生新版本：
 * 旧版本保留（supersededAt 标记），内容不被原地覆盖。
 */
export interface AnnouncementVersion {
  id: string;
  announcementId: string;
  /** 从 1 开始，严格递增 */
  versionNumber: number;
  sourceKind: AnnouncementSourceKind;
  /** 发布时间 ISO 字符串 */
  publishedAt: string;
  /** 本版本依据的官方来源（必须有官方链接或留档文件） */
  officialSource: EvidenceAnchor;
  timeline: AnnouncementTimeline;
  units: ApplicationUnit[];
  /** 相比上一版本的变化说明（原始公告为空） */
  changeNote?: string;
  /** 被更新版本取代的时间；当前版本为 undefined */
  supersededAt?: string;
  /** 版本内容指纹（SHA-256），同指纹不增殖新版本 */
  fingerprint?: string;
}

/** 公告整体状态 */
export type AnnouncementLifecycle =
  | "active" // 在招或后续节点未结束
  | "withdrawn"; // 取消/失效（经官方确认）

/**
 * 官方来源巡检健康度（镜像后端 SourceHealth）。
 * 只记录人工巡检确认的故障（404/撤稿/域名失效）；网络抖动不登记。
 * 缺省视为正常；ok=false 时 source_unavailable 闸门失败、不进推荐，历史留档保留。
 */
export interface SourceHealth {
  ok: boolean;
  /** 巡检时间 ISO */
  checkedAt: string;
  /** 故障现象（如「官方发布页返回 404」） */
  failReason?: string | null;
}

/** 一次官方公开招聘活动 */
export interface RecruitmentAnnouncement {
  id: string;
  title: string;
  /** 发布主体，如“杭州市教育局”“宁波市鄞州区人力资源和社会保障局” */
  publisher: string;
  organizationType: OrganizationType;
  /** 官方公告入口 URL */
  officialUrl: string;
  /** 覆盖学科（首版数据均含 chinese；模型保留多学科） */
  subjectScope: SubjectCode[];
  /** 本公告覆盖地区（省级/市级） */
  region: RegionRef;
  lifecycle: AnnouncementLifecycle;
  /** 原始公告发布日期 ISO */
  firstPublishedAt: string;
  /**
   * 补充公告关系：指向被补充的原公告 id。
   * 同一招聘活动的补充/更正不新建孤立公告，复用同一 id 链。
   */
  supplementOfAnnouncementId?: string;
  /** 版本链（按 versionNumber 升序，不可变追加） */
  versions: AnnouncementVersion[];
  /** 官方来源巡检健康度；缺省视为正常（未登记异常） */
  sourceHealth?: SourceHealth;
}
