/**
 * WB3：字段注册表（单一事实源）。
 *
 * 本文件是公告/岗位候选字段的唯一字段清单定义，任何其它文件都不得再复制
 * 字段清单（高影响清单、必需字段清单、允许 unknown 清单、标准化策略等均从
 * 这里派生）。`domain.ts` 的 `HIGH_IMPACT_FIELDS` / `isHighImpactField` 改为
 * 从本表派生，避免多份清单漂移。
 *
 * 只包含无副作用、无存储、无网络的纯数据与查询函数。
 */
import type { FieldScope } from './domain.js';

/** 字段身份（候选字段名，取值与 field-catalog.md 对齐） */
export type FieldName = string;

/** 高影响字段的证据要求强度 */
export type EvidenceRequirement = 'required' | 'optional' | 'none';

/**
 * 标准化策略：仅允许不改变含义的机械清洗。
 * - `identity`：只做 Unicode/空白/全半角/首尾清理，不做任何语义归一；
 * - `preserve-major`：专业字段，禁止剥离「（师范）」等限定词；
 * - `education`：学历枚举，禁止把「本科」与「本科及以上」合并；
 * - `employment-nature`：编制/用工性质，禁止凭近义词归一，只保留官方原文，
 *   仅在规则明确命中时附加分类码；
 * - `date`：日期，精确到日，缺失即 unknown，禁止从当前日期推算；
 * - `url`：报名入口 URL，禁止从搜索结果或相似公告猜测。
 */
export type NormalizationStrategy =
  | 'identity'
  | 'preserve-major'
  | 'education'
  | 'employment-nature'
  | 'date'
  | 'url';

/** 单条字段注册项 */
export interface FieldRegistration {
  /** 候选字段名（唯一键） */
  field: FieldName;
  /** 归属范围：announcement=公告公共 / job=岗位 / both=视原文结构 */
  scope: FieldScope | 'both';
  /** 高影响：无证据锚点不得过审 */
  highImpact: boolean;
  /** 必需：发布载荷中必须存在（可为 unknown，但不可缺失键） */
  required: boolean;
  /** 允许未知：原文未写时置 unknown，不算不符合 */
  allowUnknown: boolean;
  /** 证据要求强度 */
  evidence: EvidenceRequirement;
  /** 标准化策略 */
  normalization: NormalizationStrategy;
  /** 展示名称（供审核/报告界面使用，不含业务判定） */
  displayName: string;
}

/**
 * 字段注册表（唯一事实源）。
 *
 * 字段名与 `docs/specs/workbuddy-pipeline/field-catalog.md` 一致；新增字段必须先
 * 在这里登记，再在抽取器使用。字段名的语义：
 * - 岗位编号 job_code、地区 region、单位 unit_name、学段 stage、学科 subject、
 *   人数 headcount、学历 education、学位 degree、专业 major、教师资格 teacher_cert、
 *   年龄 age、年龄基准日 age_basis_date、年龄例外 age_exception、户籍 hukou、
 *   工作经历 work_experience、编制/用工性质 employment_nature、报名时间
 *   registration_time、截止时点 registration_end_time、材料 materials、
 *   官方入口 official_entry、适用批次 batch。
 */
export const FIELD_REGISTRY: ReadonlyArray<FieldRegistration> = [
  {
    field: 'job_code',
    scope: 'job',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '岗位编号',
  },
  {
    field: 'region',
    scope: 'announcement',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '地区',
  },
  {
    field: 'unit_name',
    scope: 'job',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '招聘单位',
  },
  {
    field: 'stage',
    scope: 'job',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '学段',
  },
  {
    field: 'subject',
    scope: 'job',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '学科',
  },
  {
    field: 'headcount',
    scope: 'job',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '招聘人数',
  },
  {
    field: 'education',
    scope: 'both',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'education',
    displayName: '学历',
  },
  {
    field: 'degree',
    scope: 'both',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '学位',
  },
  {
    field: 'major',
    scope: 'both',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'preserve-major',
    displayName: '专业',
  },
  {
    field: 'teacher_cert',
    scope: 'both',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '教师资格',
  },
  {
    field: 'age',
    scope: 'both',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '年龄',
  },
  {
    field: 'age_basis_date',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'date',
    displayName: '年龄计算基准日',
  },
  {
    field: 'age_exception',
    scope: 'both',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '年龄例外',
  },
  {
    field: 'hukou',
    scope: 'both',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '户籍',
  },
  {
    field: 'work_experience',
    scope: 'both',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '工作经历',
  },
  {
    field: 'employment_nature',
    scope: 'both',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'employment-nature',
    displayName: '编制/用工性质',
  },
  {
    field: 'registration_time',
    scope: 'announcement',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '报名时间',
  },
  {
    field: 'registration_end_time',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '报名截止时点',
  },
  {
    field: 'materials',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '报名材料',
  },
  {
    field: 'official_entry',
    scope: 'announcement',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'url',
    displayName: '官方报名入口',
  },
  {
    field: 'batch',
    scope: 'announcement',
    highImpact: true,
    required: true,
    allowUnknown: false,
    evidence: 'required',
    normalization: 'identity',
    displayName: '适用批次',
  },
  // ---- 以下为 v6.1 遗留高影响字段（保持既有 domain.spec.ts 断言与向后兼容）----
  {
    field: 'exam_time',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '笔试/面试时间',
  },
  {
    field: 'subjects',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '考试科目',
  },
  {
    field: 'score',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '分值',
  },
  {
    field: 'qualification',
    scope: 'announcement',
    highImpact: true,
    required: false,
    allowUnknown: true,
    evidence: 'optional',
    normalization: 'identity',
    displayName: '资格条件',
  },
];

const REGISTRY_MAP: ReadonlyMap<FieldName, FieldRegistration> = new Map(
  FIELD_REGISTRY.map((r) => [r.field, r]),
);

/** 按字段名查询注册项；未登记字段返回 undefined（调用方须显式处理） */
export function getFieldRegistration(field: FieldName): FieldRegistration | undefined {
  return REGISTRY_MAP.get(field);
}

/** 全部字段名 */
export function allFieldNames(): FieldName[] {
  return FIELD_REGISTRY.map((r) => r.field);
}

/** 高影响字段集合（从注册表派生，供 domain.ts 使用） */
export const HIGH_IMPACT_FIELD_SET: ReadonlySet<FieldName> = new Set(
  FIELD_REGISTRY.filter((r) => r.highImpact).map((r) => r.field),
);

/** 必需字段名集合（发布载荷必须存在键，可为 unknown） */
export const REQUIRED_FIELD_SET: ReadonlySet<FieldName> = new Set(
  FIELD_REGISTRY.filter((r) => r.required).map((r) => r.field),
);

/** 允许 unknown 的字段名集合 */
export const UNKNOWN_ALLOWED_FIELD_SET: ReadonlySet<FieldName> = new Set(
  FIELD_REGISTRY.filter((r) => r.allowUnknown).map((r) => r.field),
);

/** 是否高影响字段 */
export function isHighImpactField(field: FieldName): boolean {
  return HIGH_IMPACT_FIELD_SET.has(field);
}

/** 是否必需字段 */
export function isRequiredField(field: FieldName): boolean {
  return REQUIRED_FIELD_SET.has(field);
}

/** 是否允许 unknown（原文未写不算不符合） */
export function isUnknownAllowed(field: FieldName): boolean {
  return UNKNOWN_ALLOWED_FIELD_SET.has(field);
}

/** 字段标准化策略；未登记字段默认 identity（只做机械清洗，不做语义归一） */
export function normalizationStrategyOf(field: FieldName): NormalizationStrategy {
  return REGISTRY_MAP.get(field)?.normalization ?? 'identity';
}

/** 字段展示名称；未登记字段回退到字段名本身 */
export function displayNameOf(field: FieldName): string {
  return REGISTRY_MAP.get(field)?.displayName ?? field;
}
