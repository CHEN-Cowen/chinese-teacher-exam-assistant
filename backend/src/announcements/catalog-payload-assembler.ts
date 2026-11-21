/**
 * WB5：目录载荷构造器（单一事实源，纯函数）。
 *
 * 把「已审核 WorkBuddy 候选 + 明确公告元数据 + 版本上下文」构造成
 * `publication-projector.ts` 接受的 `{ dataset, announcement, version }` 目录载荷。
 *
 * 这是 WB0 规格 §6「两阶段载荷契约」里「候选 → 目录」的唯一转换点：
 * - 只能发生在审核通过、发布动作之后（本模块被 publish service 在门禁后调用）；
 * - 每个目录字段必须能回溯到至少一个已 `adopt`/`edit` 的候选字段及其证据；
 * - `unknown` / `conflict` / `pending` / 缺证据的高影响字段不得进入目录；
 * - 元数据（地区、发布单位、用工性质、报名入口）只来自可信 DB 字段、审核输入或官方
 *   证据，绝不从标题或 URL 猜测。
 *
 * 任何缺失/非法 → 返回结构化错误（`CatalogPayloadError`），绝不返回半成品、绝不编默认值。
 */
import type {
  AnnouncementSourceKind,
  AnnouncementVersion,
  ApplicationUnit,
  EvidenceAnchor,
  RegionRef,
  Requirement,
} from '../matching/types.js';
import { classifyEmploymentNature } from './normalization.js';
import {
  describeStructuredMajor,
  MajorCriterionError,
  parseStructuredMajor,
  type StructuredMajorValue,
} from './major-criterion.js';
import {
  normalizeCandidateField,
  type CandidateField,
  type ExtractionCandidate,
} from './domain.js';

/** 目录载荷的 dataset 取值（与 projector 的 CatalogDataset 对齐） */
export type CatalogDataset = 'test' | 'demo' | 'real';

/** 构造目录载荷所需的受信元数据（来自数据库字段/审核输入/官方证据） */
export interface CatalogMetadata {
  /** 公告 id（run.announcementId 或 run.id；可信，不猜） */
  announcementId: string;
  /** 发布主体官方全称（Source.publisher，可信 DB 字段） */
  publisher: string;
  /** 官方 URL（Source.officialUrl，可信 DB 字段） */
  officialUrl: string;
  /** 地区行政区划代码（Source.regionCode，可信 DB 字段；可选，优先用候选字段） */
  regionCode?: string;
  /** 数据集合：由受信配置/审核输入明确给出，只允许 test/demo/real */
  dataset: CatalogDataset;
  /** 人工复核人（real 发布必须提供；可选） */
  reviewedBy?: string;
  /** 人工复核时间 ISO（real 发布必须提供；可选） */
  reviewedAt?: string;
}

/** 版本上下文（发布时确定，不来自候选字段） */
export interface CatalogVersionContext {
  versionId: string;
  versionNumber: number;
  sourceKind: AnnouncementSourceKind;
  publishedAt: string;
}

/** 结构化构造错误：携带字段路径与原因，绝不静默 */
export class CatalogPayloadError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'CatalogPayloadError';
    this.path = path;
  }
}

/** 目录载荷整体结构 */
export interface CatalogPayload {
  dataset: CatalogDataset;
  announcement: {
    id: string;
    title: string;
    publisher: string;
    organizationType: 'government_unified' | 'institution_unified' | 'other';
    officialUrl: string;
    subjectScope: string[];
    region: RegionRef;
    lifecycle: 'active';
    firstPublishedAt: string;
    reviewStatus?: 'human_reviewed' | 'ai_reviewed_pending';
    reviewedBy?: string;
    reviewedAt?: string;
  };
  version: AnnouncementVersion;
}

/**
 * 显式载荷类型守卫：判断一个已发布版本 payload 是目录载荷（WB5 新契约）
 * 还是 legacy `ExtractionCandidate`（旧契约）。
 *
 * 禁止用 `as unknown as` 掩盖两种契约的差异；读取/差异/撤回代码必须先经此守卫
 * 分支处理，legacy 行按「不可投影 → 记录失败/回退」处理，绝不伪装成合法目录。
 */
export function isCatalogPayload(value: unknown): value is CatalogPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record['dataset'] === 'test' ||
      record['dataset'] === 'demo' ||
      record['dataset'] === 'real') &&
    typeof record['announcement'] === 'object' &&
    record['announcement'] !== null &&
    typeof record['version'] === 'object' &&
    record['version'] !== null
  );
}

// ==================== 纯函数辅助 ====================

function isExtracted(field: CandidateField): boolean {
  return normalizeCandidateField(field).status === 'extracted';
}

/** 字段裁决必须已被人工采纳（adopt/edit）才可进入目录 */
function isAdopted(field: CandidateField): boolean {
  const action = field.decision?.action;
  return action === 'adopt' || action === 'edit';
}

/**
 * 取公告公共范围里已采纳的字段值（按 field 名查第一个）。
 * 未找到或未采纳返回 undefined（由调用方决定是否报缺失）。
 */
function adoptedValue(
  fields: CandidateField[],
  fieldName: string,
  scope: 'announcement' | 'job',
): CandidateField | undefined {
  return fields.find(
    (f) =>
      f.field === fieldName &&
      normalizeCandidateField(f).scope === scope &&
      isExtracted(f) &&
      isAdopted(f),
  );
}

/**
 * 取岗位范围（jobKey）内已采纳的字段值。
 */
function adoptedJobValue(
  fields: CandidateField[],
  jobKey: string,
  fieldName: string,
): CandidateField | undefined {
  return fields.find(
    (f) =>
      f.field === fieldName &&
      normalizeCandidateField(f).scope === 'job' &&
      (f.jobScope?.key ?? '') === jobKey &&
      isExtracted(f) &&
      isAdopted(f),
  );
}

/** 公共条件只在没有岗位级同名槽位时继承，未裁决岗位字段不得被公共值掩盖。 */
function effectiveValue(fields: CandidateField[], jobKey: string, name: string) {
  const hasJobSlot = fields.some((f) => f.field === name &&
    normalizeCandidateField(f).scope === 'job' && f.jobScope?.key === jobKey);
  return hasJobSlot ? adoptedJobValue(fields, jobKey, name)
    : adoptedValue(fields, name, 'announcement');
}

function manualRequirement(field: CandidateField, path: string, id: string, checkedAt: string,
  dimension: Requirement['dimension'] = 'other'): Requirement {
  return { id, dimension, description: field.value, hard: true,
    criterion: { kind: 'other', manualReview: true },
    evidence: toEvidenceAnchor(field, path, id, checkedAt) };
}

/**
 * 把候选字段的证据锚点转换为匹配领域的 `EvidenceAnchor`。
 * 候选字段必须带 anchor（高影响字段由门禁保证），否则视为缺证据失败。
 */
function toEvidenceAnchor(
  field: CandidateField,
  path: string,
  idPrefix: string,
  checkedAt: string,
): EvidenceAnchor {
  if (!field.anchor || !field.anchor.locator) {
    throw new CatalogPayloadError(`${path}.evidence`, '字段缺少证据锚点，不能进入目录');
  }
  // state：规则来源且有锚点视为 official；ai/ocr 已人工确认也视为 official
  const state: EvidenceAnchor['state'] = 'official';

  // 构造匹配领域 EvidenceLocator（domain 与 matching 的 locator 结构一致，
  // 逐 kind 显式映射，避免宽类型散对象）
  const src = field.anchor.locator;
  let locator: EvidenceAnchor['locator'];
  switch (src.kind) {
    case 'url':
      locator = { kind: 'url', url: src.url, ...(src.anchor ? { anchor: src.anchor } : {}) };
      break;
    case 'excerpt':
      locator = { kind: 'excerpt', excerpt: src.excerpt };
      break;
    case 'file':
      locator = {
        kind: 'file',
        fileId: src.fileId,
        fileName: src.fileName,
        ...(src.page !== undefined ? { page: src.page } : {}),
      };
      break;
    case 'worksheet':
      locator = {
        kind: 'worksheet',
        fileId: src.fileId,
        fileName: src.fileName,
        sheet: src.sheet,
        ...(src.cell !== undefined ? { cell: src.cell } : {}),
      };
      break;
    default: {
      const exhaustive: never = src;
      throw new CatalogPayloadError(`${path}.evidence`, `未知证据定位类型：${String(exhaustive)}`);
    }
  }

  return {
    id: `${idPrefix}-${field.field}-evidence`,
    locator,
    ...(field.anchor.excerpt ? { excerpt: field.anchor.excerpt } : {}),
    state,
    checkedAt,
    ...(field.anchor.locatorData ? { locatorData: field.anchor.locatorData } : {}),
  };
}

/** 从候选的 education 字段构造 requirement（学历要求） */
function educationRequirement(
  field: CandidateField,
  path: string,
  idPrefix: string,
  checkedAt: string,
): Requirement {
  const text = field.value;
  // 只有单一、无附加限定的最低学历可安全使用 minLevel；精确学历/组合/例外转人工。
  if (!/^(本科|硕士(?:研究生)?|博士(?:研究生)?|大专|专科)(及以上|以上)$/.test(text)) {
    return manualRequirement(field, path, `${idPrefix}-edu`, checkedAt, 'education');
  }
  let minLevel: 'secondary' | 'college' | 'bachelor' | 'master' | 'doctorate';
  if (text.includes('博士')) minLevel = 'doctorate';
  else if (text.includes('硕士')) minLevel = 'master';
  else if (text.includes('本科')) minLevel = 'bachelor';
  else if (text.includes('大专') || text.includes('专科')) minLevel = 'college';
  else throw new CatalogPayloadError(path, `学历值无法映射到枚举：${text}`);
  return {
    id: `${idPrefix}-edu`,
    dimension: 'education',
    description: text,
    hard: true,
    criterion: { kind: 'education', minLevel },
    evidence: toEvidenceAnchor(field, path, idPrefix, checkedAt),
  };
}

/** 从候选的 major 字段构造 requirement（专业要求） */
function majorRequirement(
  field: CandidateField,
  path: string,
  idPrefix: string,
  checkedAt: string,
): Requirement {
  const text = field.value;
  let structured: StructuredMajorValue | null;
  try {
    structured = parseStructuredMajor(text, path);
  } catch (e) {
    if (e instanceof MajorCriterionError) {
      throw new CatalogPayloadError(e.path, e.message.replace(`${e.path}: `, ''));
    }
    throw e;
  }
  if (structured) {
    return {
      id: `${idPrefix}-major`,
      dimension: 'major',
      description: describeStructuredMajor(structured),
      hard: true,
      criterion: {
        kind: 'major',
        majorNames: structured.names,
        ...(structured.stages ? { stages: structured.stages } : {}),
        ...(structured.stageMode ? { stageMode: structured.stageMode } : {}),
        ...(structured.ambiguous ? { ambiguous: true } : {}),
      },
      evidence: toEvidenceAnchor(field, path, idPrefix, checkedAt),
    };
  }
  if (/^(不限|专业不限|不限专业)$/.test(text)) {
    return {
      id: `${idPrefix}-major`,
      dimension: 'major',
      description: text,
      hard: false,
      criterion: { kind: 'major', majorNames: [] },
      evidence: toEvidenceAnchor(field, path, idPrefix, checkedAt),
    };
  }
  return {
    id: `${idPrefix}-major`,
    dimension: 'major',
    description: text,
    hard: true,
    criterion: { kind: 'major', majorNames: [text] },
    evidence: toEvidenceAnchor(field, path, idPrefix, checkedAt),
  };
}

/** 把学段中文映射到 StageCode */
function toStageCode(value: string, path: string): string {
  if (value.includes('小学')) return 'primary';
  if (value.includes('初中')) return 'middle';
  if (value.includes('高中')) return 'high';
  if (value === '幼儿园' || value === '幼教') return 'preschool';
  if (value === '中职') return 'vocational';
  throw new CatalogPayloadError(path, `学段值无法映射：${value}`);
}

/** 把学科中文映射到 SubjectCode（语文 → chinese） */
function toSubjectCode(value: string, path: string): string {
  if (value.includes('语文')) return 'chinese';
  throw new CatalogPayloadError(path, `学科值不在开放范围：${value}（当前仅开放语文）`);
}

/** 从 region 候选字段解析 RegionRef；regionCode 形如 330100，province/city 从字段值文本取 */
function buildRegion(
  field: CandidateField | undefined,
  regionCode: string | undefined,
  path: string,
): RegionRef {
  if (field) {
    const text = field.value.trim();
    // 审核可显式给出结构化地区；代码不由地名/机构名猜测。
    if (text.startsWith('{')) {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new CatalogPayloadError(path, '地区 JSON 非法'); }
      if (typeof parsed !== 'object' || parsed === null) throw new CatalogPayloadError(path, '地区必须为对象');
      const r = parsed as Record<string, unknown>;
      if (typeof r.code !== 'string' || !/^\d{6}$/.test(r.code) ||
        typeof r.province !== 'string' || !r.province.trim()) {
        throw new CatalogPayloadError(path, '结构化地区需六位代码和省级名称');
      }
      for (const key of ['city', 'district']) {
        if (r[key] !== undefined && (typeof r[key] !== 'string' || !r[key].trim())) {
          throw new CatalogPayloadError(path, `${key} 必须为非空名称`);
        }
      }
      return { code: r.code, province: r.province,
        ...(r.city ? { city: r.city as string } : {}),
        ...(r.district ? { district: r.district as string } : {}) };
    }
    const match = text.match(/^(.+?(?:省|自治区)|北京市|天津市|上海市|重庆市)(.*)$/);
    if (match && regionCode && /^\d{6}$/.test(regionCode)) {
      const rest = match[2]!;
      const cityMatch = rest.match(/^(.+?(?:市|自治州|地区|盟))(.*)$/);
      const district = cityMatch ? cityMatch[2] : rest;
      return { code: regionCode, province: match[1]!,
        ...(cityMatch ? { city: cityMatch[1]! } : {}),
        ...(district ? { district } : {}) };
    }
    throw new CatalogPayloadError(path, '地区名称或代码不完整，请人工确认结构化地区');
  }
  throw new CatalogPayloadError(path, '缺少地区（region）信息，不得从标题或 URL 猜测');
}

/** 构造岗位单元的 requirements（仅包含已采纳且已确认的字段） */
function buildRequirements(
  fields: CandidateField[],
  jobKey: string,
  path: string,
  idPrefix: string,
  checkedAt: string,
): Requirement[] {
  const requirements: Requirement[] = [];
  const education = effectiveValue(fields, jobKey, 'education');
  if (education) requirements.push(educationRequirement(education, `${path}.education`, idPrefix, checkedAt));
  const major = effectiveValue(fields, jobKey, 'major');
  if (major) requirements.push(majorRequirement(major, `${path}.major`, idPrefix, checkedAt));
  const dimensions = {
    degree: 'degree', teacher_cert: 'teacher_cert', age: 'age',
    age_basis_date: 'age', age_exception: 'age', hukou: 'hukou',
    work_experience: 'work_experience', graduate_status: 'graduate_status',
    social_security: 'social_security',
  } as const;
  for (const [name, dimension] of Object.entries(dimensions)) {
    const field = effectiveValue(fields, jobKey, name);
    if (field) requirements.push(manualRequirement(field, `${path}.${name}`,
      `${idPrefix}-${name}`, checkedAt, dimension));
  }
  return requirements;
}

/** 构造单个岗位单元 */
function buildUnit(
  fields: CandidateField[],
  jobKey: string,
  announcementId: string,
  versionId: string,
  announcementRegion: RegionRef,
  index: number,
  checkedAt: string,
): ApplicationUnit {
  const path = `version.units[${index}]`;
  const idPrefix = `${announcementId}-u${index}`;

  const jobCode = adoptedJobValue(fields, jobKey, 'job_code');
  const unitName = adoptedJobValue(fields, jobKey, 'unit_name');
  const stage = adoptedJobValue(fields, jobKey, 'stage');
  const subject = adoptedJobValue(fields, jobKey, 'subject');
  const headcount = adoptedJobValue(fields, jobKey, 'headcount');
  const employmentNature = effectiveValue(fields, jobKey, 'employment_nature');

  // 高影响岗位字段缺失 → 失败，不编默认值
  if (!jobCode) throw new CatalogPayloadError(`${path}.job_code`, '岗位编号缺失，不能发布');
  if (!unitName) throw new CatalogPayloadError(`${path}.unit_name`, '招聘单位缺失，不能发布');
  if (!stage) throw new CatalogPayloadError(`${path}.stage`, '学段缺失，不能发布');
  if (!subject) throw new CatalogPayloadError(`${path}.subject`, '学科缺失，不能发布');
  if (!headcount) throw new CatalogPayloadError(`${path}.headcount`, '招聘人数缺失，不能发布');

  const headcountNum = Number(headcount.value);
  if (!Number.isInteger(headcountNum) || headcountNum <= 0) {
    throw new CatalogPayloadError(`${path}.headcount`, `招聘人数不是正整数：${headcount.value}`);
  }

  // 用工性质：必需；官方原文 + 分类码（只在精确命中时附加）
  const natureText = employmentNature?.value;
  if (!natureText) {
    throw new CatalogPayloadError(`${path}.employment_nature`, '编制/用工性质缺失，请审核标记“未说明”，不得猜测');
  }
  const natureCode = /不|非|未|无|不含/.test(natureText) ? undefined : classifyEmploymentNature(natureText);
  const employmentNatureCode: ApplicationUnit['employmentNature']['code'] =
    natureCode === 'public_institution_staff' || natureCode === 'record_filing' ||
    natureCode === 'post_quota' || natureCode === 'headcount_control' ? natureCode : 'other';

  const jobRegion = adoptedJobValue(fields, jobKey, 'region');
  // 发布机构的区县不是岗位区县：未说明时最多保留公告省市层级。
  const unitRegion = jobRegion
    ? buildRegion(jobRegion, undefined, `${path}.region`)
    : { code: `${announcementRegion.code.slice(0, 4)}00`,
        province: announcementRegion.province,
        ...(announcementRegion.city ? { city: announcementRegion.city } : {}) };
  const entry = effectiveValue(fields, jobKey, 'official_entry');
  if (entry && !/^https?:\/\//i.test(entry.value)) {
    throw new CatalogPayloadError(`${path}.official_entry`, '报名入口必须为官方明确的 HTTP(S) 地址');
  }

  return {
    id: `${announcementId}-unit-${jobCode.value}`,
    code: jobCode.value,
    name: `${unitName.value}（${stage.value}${subject.value}）`,
    announcementId,
    versionId,
    region: unitRegion,
    subject: toSubjectCode(subject.value, `${path}.subject`),
    stage: toStageCode(stage.value, `${path}.stage`),
    headcount: headcountNum,
    organizationType: 'other',
    recruitmentOrganization: unitName.value,
    fieldEvidence: Object.fromEntries(fields.filter((f) => isExtracted(f) && isAdopted(f) && f.anchor &&
      (normalizeCandidateField(f).scope === 'announcement' || f.jobScope?.key === jobKey))
      .map((f, i) => [`${normalizeCandidateField(f).scope}:${f.field}:${i}`,
        [f.anchor!, ...(f.anchors ?? []).filter((a) => a !== f.anchor)].map((anchor, j) =>
          toEvidenceAnchor({ ...f, anchor }, `${path}.${f.field}`, `${idPrefix}-${i}-${j}`, checkedAt))])),
    ...(entry ? { registerUrl: entry.value } : {}),
    employmentNature: {
      code: employmentNatureCode as ApplicationUnit['employmentNature']['code'],
      officialName: natureText,
    },
    allocation: {
      code: 'other',
      description: '原文未说明定岗方式，请向招聘单位确认',
    },
    requirements: buildRequirements(fields, jobKey, path, idPrefix, checkedAt),
    sourceRow: toEvidenceAnchor(headcount, `${path}.headcount`, idPrefix, checkedAt),
  };
}

/**
 * 构造目录载荷（唯一转换点）。
 *
 * @param candidate 已审核候选（fields 含 scope/status/decision）
 * @param metadata 受信元数据
 * @param ctx 版本上下文
 * @returns 目录载荷；任何缺失/非法抛 `CatalogPayloadError`
 */
export function buildCatalogPayload(
  candidate: ExtractionCandidate,
  metadata: CatalogMetadata,
  ctx: CatalogVersionContext,
): CatalogPayload {
  const fields = candidate.fields;
  if (metadata.dataset === 'real' && (!metadata.reviewedBy?.trim() ||
    !metadata.reviewedAt || Number.isNaN(Date.parse(metadata.reviewedAt)))) {
    throw new CatalogPayloadError('announcement.reviewedBy', '正式发布必须有有效复核人和复核时间');
  }

  // 1. 公告级必需元数据（可信，不猜）
  if (!metadata.publisher || !metadata.publisher.trim()) {
    throw new CatalogPayloadError('announcement.publisher', '发布主体缺失');
  }
  if (!metadata.officialUrl || !/^https?:\/\//i.test(metadata.officialUrl)) {
    throw new CatalogPayloadError('announcement.officialUrl', '官方 URL 缺失或非法');
  }

  // 2. 公告标题：来自已审核候选（title / announcement_title）
  const titleField =
    adoptedValue(fields, 'announcement_title', 'announcement') ??
    adoptedValue(fields, 'title', 'announcement');
  if (!titleField) {
    throw new CatalogPayloadError('announcement.title', '公告标题缺失，不得从 URL 猜测');
  }

  // 3. 地区：优先已审核 region 字段，否则 Source.regionCode
  const regionField = adoptedValue(fields, 'region', 'announcement');
  const region = buildRegion(regionField, metadata.regionCode, 'announcement.region');

  // 4. 报名时间 → timeline
  const regTime = adoptedValue(fields, 'registration_time', 'announcement');
  if (metadata.dataset === 'real' && !regTime?.anchor) {
    throw new CatalogPayloadError('version.timeline', '正式发布需要已审核报名时间及证据');
  }
  const timeline = buildTimeline(regTime);

  // 6. 岗位单元：每个已审核 job scope 一个 unit
  const jobKeys = collectJobKeys(fields);
  if (jobKeys.length === 0) {
    throw new CatalogPayloadError('version.units', '没有已审核岗位，无法发布目录');
  }
  const includedKeys = jobKeys.filter((jobKey) => {
    const subject = adoptedJobValue(fields, jobKey, 'subject');
    if (!subject || !subject.value.trim()) throw new CatalogPayloadError('version.units.subject', '学科待确认');
    if (/^(语文|小学语文|初中语文|高中语文)$/.test(subject.value)) return true;
    if (/^(数学|英语|物理|化学|生物|历史|地理|政治|体育|音乐|美术|信息技术|科学)$/.test(subject.value)) return false;
    throw new CatalogPayloadError('version.units.subject', `学科无法明确分流：${subject.value}`);
  });
  if (!includedKeys.length) throw new CatalogPayloadError('version.units', '没有已确认语文岗位；其他学科仅归档');
  if (metadata.dataset === 'real') {
    for (const jobKey of includedKeys) {
      for (const name of ['education', 'major', 'teacher_cert', 'age']) {
        if (!effectiveValue(fields, jobKey, name)) {
          throw new CatalogPayloadError(`version.units.${jobKey}.${name}`, '正式发布缺少已审核资格条件，不得静默省略');
        }
      }
    }
  }
  const units = includedKeys.map((jobKey, index) =>
    buildUnit(fields, jobKey, metadata.announcementId, ctx.versionId, region, index, ctx.publishedAt),
  );

  // 7. 官方来源证据（公告级）：用官方 URL 作为 officialSource
  const officialSource: EvidenceAnchor = {
    id: `${metadata.announcementId}-official-source`,
    locator: { kind: 'url', url: metadata.officialUrl },
    state: 'official',
    checkedAt: ctx.publishedAt,
  };

  const version: AnnouncementVersion = {
    id: ctx.versionId,
    announcementId: metadata.announcementId,
    versionNumber: ctx.versionNumber,
    sourceKind: ctx.sourceKind,
    publishedAt: ctx.publishedAt,
    officialSource,
    timeline,
    units,
  };

  const announcement: CatalogPayload['announcement'] = {
    id: metadata.announcementId,
    title: titleField.value,
    publisher: metadata.publisher,
    organizationType: 'government_unified',
    officialUrl: metadata.officialUrl,
    subjectScope: ['chinese'],
    region,
    lifecycle: 'active',
    firstPublishedAt: ctx.publishedAt,
    ...(metadata.dataset === 'real'
      ? {
          reviewStatus: 'human_reviewed' as const,
          ...(metadata.reviewedBy ? { reviewedBy: metadata.reviewedBy } : {}),
          ...(metadata.reviewedAt ? { reviewedAt: metadata.reviewedAt } : {}),
        }
      : {}),
  };

  return { dataset: metadata.dataset, announcement, version };
}

/** 从已审核候选收集所有 jobKey（去重，保持出现顺序） */
function collectJobKeys(fields: CandidateField[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (normalizeCandidateField(f).scope !== 'job') continue;
    const key = f.jobScope?.key ?? '';
    if (!key) continue;
    // 只收集「该岗位下存在已采纳岗位字段」的 key（避免空岗位）
    if (!isExtracted(f) || !isAdopted(f)) continue;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** 从 registration_time 候选字段构造 timeline（只取明确日期，不臆造） */
function buildTimeline(
  regField: CandidateField | undefined,
): AnnouncementVersion['timeline'] {
  const timeline: AnnouncementVersion['timeline'] = {};
  if (!regField) return timeline;

  const text = regField.value;
  // 形如「2026-10-20 至 2026-11-05 17:00」或「2026年10月20日…2026年11月5日」
  const dates = text.match(/\d{4}[-年]\d{1,2}[-月]\d{1,2}日?/g) ?? [];
  if (dates.length >= 2) {
    timeline.registrationStart = normalizeDateIso(dates[0]!);
    timeline.registrationEnd = normalizeDateIso(dates[1]!);
  } else if (dates.length === 1) {
    // 只有一个明确日期时按上下文分类，不臆造另一端：
    // 「…至2026年7月16日 / 7月16日截止」是截止日；否则视为开始日。
    const idx = text.indexOf(dates[0]!);
    const prev = text.slice(Math.max(0, idx - 4), idx);
    if (/至|截止/.test(prev)) {
      timeline.registrationEnd = normalizeDateIso(dates[0]!);
    } else {
      timeline.registrationStart = normalizeDateIso(dates[0]!);
    }
  }
  return timeline;
}

/** 把「2026年10月20日」或「2026-10-20」归一为 YYYY-MM-DD */
function normalizeDateIso(raw: string): string {
  const m = raw.match(/(\d{4})[年-](\d{1,2})[月-](\d{1,2})/);
  if (!m) return raw;
  const year = m[1]!;
  const month = m[2]!.padStart(2, '0');
  const day = m[3]!.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
