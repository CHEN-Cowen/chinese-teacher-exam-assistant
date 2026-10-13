/**
 * v6.1 渐进式个人画像（PRD 7.3）。
 *
 * 五组基础画像：可接受地区 / 学历学位 / 专业全称 / 毕业与就业状态 / 教师资格。
 * 年龄、户籍、社保、工作经历属于“条件画像”，只在具体机会需要时补问；
 * 缺省即“未提供”，匹配时只能得到 UNKNOWN，永远不能自动转成 FAIL。
 *
 * 画像记录事实（毕业时间、就业、社保），不提供“我是应届生”这种永久自我标签，
 * 应届身份按每个公告的口径逐次判断（规则在 matching/domain.ts）。
 */
import type {
  CredentialLevel,
  DegreeCode,
  EmploymentNatureCode,
  StageCode,
  SubjectCode,
} from "@/lib/announcements/types";

/** 地区接受程度（PRD：必须接受 / 优先 / 可以考虑） */
export type RegionPreferenceLevel = "required" | "preferred" | "consider";

export interface RegionPreference {
  /** 6 位区划码；省级填前 2 位补 0（如 330000），市级填前 4 位 */
  code: string;
  province: string;
  city?: string;
  district?: string;
  level: RegionPreferenceLevel;
}

/** 教师资格状态：已取得 / 在途（已通过待认定）/ 未取得 */
export type TeacherCertStatus = "obtained" | "in_progress" | "none";

export interface TeacherCertInfo {
  status: TeacherCertStatus;
  /** 资格证学科；在途/已取得时填写 */
  subject?: SubjectCode;
  /** 资格证学段 */
  stage?: StageCode;
  /** 预计取得时间 ISO 日期（在途时填写） */
  expectedDate?: string;
}

/** 毕业与当前就业状态（事实，不做永久应届标签） */
export type EmploymentStatus =
  | "student" // 在读，尚未毕业
  | "fresh_unemployed" // 已毕业、暂未落实工作
  | "employed_fulltime" // 已落实全职工作
  | "employed_parttime" // 灵活/兼职就业
  | "other";

/**
 * v7.2 用工偏好（三选一，只影响展示、排序和偏好范围外分类）。
 * - public_only：只看事业编；
 * - official_open：事业编优先，也看其他官方岗位；
 * - undecided：暂不确定，先全部看看。
 *
 * 不变量：偏好绝不进入资格判定（matching/domain.ts 不读取本字段），
 * 被偏好筛除的岗位只进“偏好范围外”分组，绝不变为 PASS/FAIL/UNKNOWN/MANUAL_REVIEW。
 * 旧画像无此字段时按 undefined 处理，行为等同 undecided（不筛选）。
 */
export type EmploymentNaturePreference =
  | "public_only"
  | "official_open"
  | "undecided";

/** 五组基础画像（必填组在采集流程中分步完成） */
export interface BaseRecruitmentProfile {
  /** 1. 可接受就业地区 */
  regions: RegionPreference[];
  /** 2. 最高学历；暂不提供时缺省，匹配只能得到 UNKNOWN */
  educationLevel?: CredentialLevel;
  /** 2. 最高学位（无学位可为 none）；暂不提供时缺省 */
  degree?: DegreeCode;
  /** 3. 毕业证上的专业全称；暂不提供时缺省 */
  majorFullName?: string;
  /** 4. 毕业（或预计毕业）时间 ISO 日期 */
  graduationDate?: string;
  /** 4. 当前就业状态 */
  employmentStatus?: EmploymentStatus;
  /** 5. 教师资格情况；暂不提供时缺省 */
  teacherCert?: TeacherCertInfo;
  /** 对事业编及其他官方用工形式的接受程度（白名单） */
  acceptedEmploymentNatures: EmploymentNatureCode[];
  /**
   * v7.2 用工偏好（三选一）。只影响展示、排序和偏好范围外分类，
   * 不进入资格判定。旧画像无此字段时按 undefined 处理（行为等同 undecided）。
   * 访客草稿与服务端画像共用同一字段，保证语义一致。
   */
  employmentNaturePreference?: EmploymentNaturePreference;
}

/**
 * 条件画像（按需补问）。
 * 所有字段缺省=未提供，不使用 null 以外的哨兵值伪造“不符合”。
 */
export interface ConditionalProfileFacts {
  /** 出生日期 ISO（用于按公告参考日计算年龄） */
  birthDate?: string;
  /** 户籍所在地区划码 */
  hukouRegionCode?: string;
  /** 已缴纳社保月数（按公告口径，以实际记录为准） */
  socialSecurityMonths?: number;
  /** 与岗位相关的工作经历月数 */
  workExperienceMonths?: number;
  /** 公告特有条件的补充回答：键为条件 id，值为用户提供的事实文本 */
  extraAnswers?: Record<string, string>;
}

/** 完整用户招聘画像 = 基础画像 + 条件画像 */
export interface UserRecruitmentProfile
  extends BaseRecruitmentProfile,
    ConditionalProfileFacts {}

/** 画像补问来源（解释“为什么要补这条信息”） */
export interface ProfileFollowUpQuestion {
  /** 对应 RequirementDimension */
  dimension: keyof ConditionalProfileFacts | string;
  /** 关联的条件 id（公告特有问题时使用） */
  requirementId?: string;
  /** 会影响多少个机会 */
  affectsOpportunityCount: number;
  reason: string;
}
