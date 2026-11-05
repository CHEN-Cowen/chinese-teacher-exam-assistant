/**
 * 全学科字典（W1）。
 *
 * 目标：
 * - 学科代码稳定、可长期存储；展示名与别名可随官方表述扩充；
 * - 只做“名称 → 代码”的确定性解析，不用相似度猜学科；
 * - 同一名称对应多个学科、或名称无法识别时返回 ambiguous / unknown，
 *   保留原名进入人工审核，绝不臆断成某个已知学科；
 * - 与旧单值 `ApplicationUnit.subject` 兼容：旧代码经 canonicalSubjectCode 归一。
 *
 * 本文件是纯函数字典，不含数据库与框架依赖，可被匹配、订阅、历史筛选复用。
 */
import type { StageCode, SubjectCode } from '../matching/types.js';

export type SubjectCategory =
  | 'language'
  | 'mathematics'
  | 'science'
  | 'humanities'
  | 'arts'
  | 'physical_education'
  | 'technology'
  | 'preschool'
  | 'special_education'
  | 'vocational'
  | 'other';

export interface SubjectAlias {
  /** 官方或用户常见表述 */
  name: string;
  /** true=该表述本身无法唯一确定学科，必须人工确认 */
  ambiguous?: boolean;
  /** 歧义时可能的学科代码（用于提示，不做自动选择） */
  candidates?: readonly SubjectCode[];
}

export interface SubjectDefinition {
  code: SubjectCode;
  name: string;
  category: SubjectCategory;
  /** 该学科可出现的学段；空数组=不限 */
  stages: readonly StageCode[];
  aliases: readonly SubjectAlias[];
  enabled: boolean;
  sortOrder: number;
}

const PRIMARY: StageCode = 'primary';
const MIDDLE: StageCode = 'middle';
const HIGH: StageCode = 'high';

function subject(
  code: SubjectCode,
  name: string,
  category: SubjectCategory,
  stages: readonly StageCode[],
  aliases: readonly SubjectAlias[],
  sortOrder: number,
): SubjectDefinition {
  return {
    code,
    name,
    category,
    stages,
    aliases: [
      { name },
      ...aliases.filter((alias) => normalizeSubjectText(alias.name) !== normalizeSubjectText(name)),
    ],
    enabled: true,
    sortOrder,
  };
}

/**
 * 首批全学科字典。代码沿用前端现有 `pe` / `it` 等短码，避免破坏既有数据；
 * 新增长尾代码只作为别名归一，不作为主码。
 */
export const SUBJECTS: readonly SubjectDefinition[] = [
  subject('chinese', '语文', 'language', [PRIMARY, MIDDLE, HIGH], [
    { name: '语文' },
    { name: '汉语言' },
    { name: '汉语言文学' },
    { name: '语文教育' },
  ], 1),
  subject('mathematics', '数学', 'mathematics', [PRIMARY, MIDDLE, HIGH], [
    { name: '数学' },
    { name: '数学教育' },
    { name: '数学与应用数学' },
  ], 2),
  subject('english', '英语', 'language', [PRIMARY, MIDDLE, HIGH], [
    { name: '英语' },
    { name: '英语教育' },
    { name: '外语' },
  ], 3),
  subject('japanese', '日语', 'language', [MIDDLE, HIGH], [
    { name: '日语' },
    { name: '日本语' },
  ], 4),
  subject('russian', '俄语', 'language', [MIDDLE, HIGH], [
    { name: '俄语' },
  ], 5),
  subject('physics', '物理', 'science', [MIDDLE, HIGH], [
    { name: '物理' },
    { name: '物理学' },
  ], 6),
  subject('chemistry', '化学', 'science', [MIDDLE, HIGH], [
    { name: '化学' },
    { name: '应用化学' },
  ], 7),
  subject('biology', '生物', 'science', [MIDDLE, HIGH], [
    { name: '生物' },
    { name: '生物学' },
    { name: '生物科学' },
  ], 8),
  subject('politics', '思想政治', 'humanities', [PRIMARY, MIDDLE, HIGH], [
    { name: '政治' },
    { name: '思想政治' },
    { name: '思想品德' },
    { name: '道德与法治' },
    { name: '道法' },
    { name: '品德与社会' },
  ], 9),
  subject('history', '历史', 'humanities', [MIDDLE, HIGH], [
    { name: '历史' },
    { name: '历史学' },
  ], 10),
  subject('geography', '地理', 'humanities', [MIDDLE, HIGH], [
    { name: '地理' },
    { name: '地理学' },
  ], 11),
  subject('music', '音乐', 'arts', [PRIMARY, MIDDLE, HIGH], [
    { name: '音乐' },
    { name: '音乐教育' },
  ], 12),
  subject('art', '美术', 'arts', [PRIMARY, MIDDLE, HIGH], [
    { name: '美术' },
    { name: '美术教育' },
    { name: '艺术', ambiguous: true, candidates: ['art', 'music'] },
  ], 13),
  subject('pe', '体育', 'physical_education', [PRIMARY, MIDDLE, HIGH], [
    { name: '体育' },
    { name: '体育与健康' },
    { name: '体育教育' },
  ], 14),
  subject('it', '信息技术', 'technology', [PRIMARY, MIDDLE, HIGH], [
    { name: '信息技术' },
    { name: '信息科技' },
    { name: '计算机', ambiguous: true, candidates: ['it', 'vocational'] },
    { name: '计算机科学' },
  ], 15),
  subject('science', '科学', 'science', [PRIMARY, MIDDLE], [
    { name: '科学' },
    { name: '小学科学' },
    { name: '科学教育' },
  ], 16),
  subject('general_technology', '通用技术', 'technology', [HIGH], [
    { name: '通用技术' },
  ], 17),
  subject('comprehensive_practice', '综合实践', 'other', [PRIMARY, MIDDLE, HIGH], [
    { name: '综合实践' },
    { name: '综合实践活动' },
  ], 18),
  subject('labor', '劳动', 'other', [PRIMARY, MIDDLE, HIGH], [
    { name: '劳动' },
    { name: '劳动教育' },
  ], 19),
  subject('mental_health', '心理健康', 'other', [PRIMARY, MIDDLE, HIGH], [
    { name: '心理健康' },
    { name: '心理健康教育' },
    { name: '心理' },
  ], 20),
  subject('preschool', '学前教育', 'preschool', [], [
    { name: '学前教育' },
    { name: '幼儿教育' },
    { name: '幼教' },
    { name: '幼儿园' },
  ], 21),
  subject('special_education', '特殊教育', 'special_education', [], [
    { name: '特殊教育' },
    { name: '特教' },
  ], 22),
  subject('vocational', '职教专业课', 'vocational', [], [
    { name: '职业教育' },
    { name: '职教' },
    { name: '专业课' },
    { name: '中职专业课' },
    { name: '职高专业课' },
  ], 23),
];

/** 旧代码 / 外部系统代码归一，避免同一学科出现多个主码。 */
const CODE_ALIASES: Record<string, SubjectCode> = {
  physical_education: 'pe',
  information_technology: 'it',
  info_tech: 'it',
  information_tech: 'it',
  political: 'politics',
  moral_education: 'politics',
  civics: 'politics',
  kindergarten: 'preschool',
  pre_school: 'preschool',
  special: 'special_education',
  vocational_education: 'vocational',
  math: 'mathematics',
  maths: 'mathematics',
  chinese_language: 'chinese',
};

const BY_CODE = new Map<string, SubjectDefinition>(
  SUBJECTS.map((s) => [s.code, s]),
);

/** 全部启用的学科代码（匹配闸门、下拉选项的数据源）。 */
export const OPEN_SUBJECT_CODES: readonly SubjectCode[] = SUBJECTS.filter(
  (s) => s.enabled,
).map((s) => s.code);

/** 把旧代码/别名代码归一为字典主码；未知代码原样返回（交由审核，不丢弃）。 */
export function canonicalSubjectCode(code: string): SubjectCode {
  const trimmed = code.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.toLowerCase();
  if (BY_CODE.has(normalized)) return normalized;
  return CODE_ALIASES[normalized] ?? trimmed;
}

export function subjectDefinition(code: string): SubjectDefinition | undefined {
  return BY_CODE.get(canonicalSubjectCode(code));
}

export function isOpenSubject(code: string): boolean {
  return OPEN_SUBJECT_CODES.includes(canonicalSubjectCode(code));
}

/** 全半角、空白、常见分隔符归一，用于名称比较（不输出展示文本）。 */
export function normalizeSubjectText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·•\-_／/、,，.。()（）[\]【】:：;；]+/g, '');
}

const STAGE_PREFIXES: ReadonlyArray<{ prefix: string; stage: StageCode }> = [
  { prefix: '小学', stage: 'primary' },
  { prefix: '初中', stage: 'middle' },
  { prefix: '中学', stage: 'middle' },
  { prefix: '高中', stage: 'high' },
  { prefix: '中职', stage: 'vocational' },
  { prefix: '职高', stage: 'vocational' },
  { prefix: '幼儿园', stage: 'preschool' },
  { prefix: '学前', stage: 'preschool' },
  { prefix: '特殊教育', stage: 'special_education' },
  { prefix: '特教', stage: 'special_education' },
];

/** 从「小学语文」「初中数学」等官方表述推断学段；无法判断返回 undefined。 */
export function inferStageFromText(value: string): StageCode | undefined {
  const normalized = normalizeSubjectText(value);
  const prefixHit = STAGE_PREFIXES.find((p) => normalized.startsWith(p.prefix));
  if (prefixHit) return prefixHit.stage;
  // 官方写法「语文（小学）」：学段在括号内，去掉标点后按最长词匹配。
  const contained = [...STAGE_PREFIXES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((p) => normalized.includes(p.prefix));
  return contained?.stage;
}

export interface SubjectAliasHit {
  subjectCode: SubjectCode;
  alias: string;
  ambiguous: boolean;
  candidates: readonly SubjectCode[];
}

const ALIAS_INDEX: readonly SubjectAliasHit[] = SUBJECTS.flatMap((s) =>
  s.aliases.map((alias) => ({
    subjectCode: s.code,
    alias: alias.name,
    ambiguous: alias.ambiguous === true,
    candidates: alias.candidates ?? [s.code],
  })),
);

/** 按归一化名称精确查别名（可能命中多个学科，调用方必须处理冲突）。 */
export function lookupSubjectAliases(raw: string): SubjectAliasHit[] {
  const normalized = normalizeSubjectText(raw);
  if (!normalized) return [];
  return ALIAS_INDEX.filter((hit) => normalizeSubjectText(hit.alias) === normalized);
}

export type SubjectResolutionStatus = 'resolved' | 'ambiguous' | 'unknown';

export interface SubjectResolution {
  input: string;
  status: SubjectResolutionStatus;
  /** 仅 resolved 时存在 */
  code?: SubjectCode;
  /** 可能的学科代码（ambiguous 时给出，不自动选择） */
  candidates: SubjectCode[];
  /** 命中的别名，便于审核与解释 */
  matchedAlias?: string;
  /** 官方学段（由文本前缀推断时给出） */
  stage?: StageCode;
  reviewRequired: boolean;
  reason: string;
}

function resolved(
  input: string,
  code: SubjectCode,
  matchedAlias: string,
  stage?: StageCode,
): SubjectResolution {
  return {
    input,
    status: 'resolved',
    code,
    candidates: [code],
    matchedAlias,
    ...(stage ? { stage } : {}),
    reviewRequired: false,
    reason: `按“${matchedAlias}”识别为${BY_CODE.get(code)?.name ?? code}`,
  };
}

/**
 * 解析单个学科表述。
 *
 * 顺序：精确别名 → 前缀/包含匹配（仅当唯一学科）→ ambiguous / unknown。
 * 不使用编辑距离、向量相似度或模型猜测，保证可复核。
 */
export function resolveSubject(
  raw: string,
  options: { stage?: string } = {},
): SubjectResolution {
  const input = raw.trim();
  if (!input) {
    return {
      input: raw,
      status: 'unknown',
      candidates: [],
      reviewRequired: true,
      reason: '学科为空',
    };
  }

  const stage = options.stage?.trim()
    ? (inferStageFromText(options.stage) ??
      (['primary', 'middle', 'high'].includes(options.stage.trim())
        ? (options.stage.trim() as StageCode)
        : undefined))
    : undefined;

  const exact = lookupSubjectAliases(input);
  if (exact.length > 0) {
    const ambiguous = exact.find((hit) => hit.ambiguous);
    if (ambiguous) {
      return {
        input,
        status: 'ambiguous',
        candidates: [...ambiguous.candidates],
        matchedAlias: ambiguous.alias,
        ...(stage ? { stage } : {}),
        reviewRequired: true,
        reason: `“${ambiguous.alias}”可对应多个学科，需人工确认`,
      };
    }
    const codes = [...new Set(exact.map((hit) => hit.subjectCode))];
    if (codes.length > 1) {
      return {
        input,
        status: 'ambiguous',
        candidates: codes,
        matchedAlias: exact[0]?.alias,
        ...(stage ? { stage } : {}),
        reviewRequired: true,
        reason: '该表述命中多个学科，需人工确认',
      };
    }
    return resolved(input, codes[0]!, exact[0]!.alias, stage);
  }

  // 「小学语文」「初中数学」：去掉学段前缀后唯一命中。
  const normalized = normalizeSubjectText(input);
  const prefixHit = STAGE_PREFIXES.find((p) => normalized.startsWith(p.prefix));
  if (prefixHit) {
    const rest = normalized.slice(prefixHit.prefix.length);
    const restHits = lookupSubjectAliases(rest);
    const codes = [...new Set(restHits.filter((h) => !h.ambiguous).map((h) => h.subjectCode))];
    if (codes.length === 1 && !restHits.some((h) => h.ambiguous)) {
      return resolved(input, codes[0]!, restHits[0]!.alias, prefixHit.stage);
    }
  }

  // 官方常见写法「语文（小学）」：最长别名包含匹配，唯一学科才接受。
  const contained = ALIAS_INDEX.filter((hit) => {
    const alias = normalizeSubjectText(hit.alias);
    return alias.length >= 2 && normalized.includes(alias);
  }).sort((a, b) => normalizeSubjectText(b.alias).length - normalizeSubjectText(a.alias).length);
  if (contained.length > 0 && !contained[0]!.ambiguous) {
    const longest = normalizeSubjectText(contained[0]!.alias).length;
    const top = contained.filter(
      (hit) => normalizeSubjectText(hit.alias).length === longest && !hit.ambiguous,
    );
    const codes = [...new Set(top.map((hit) => hit.subjectCode))];
    if (codes.length === 1) {
      return resolved(input, codes[0]!, top[0]!.alias, stage ?? inferStageFromText(input));
    }
  }

  return {
    input,
    status: 'unknown',
    candidates: [],
    ...(stage ? { stage } : {}),
    reviewRequired: true,
    reason: '未在学科字典中找到确定对应，保留原名并转人工审核',
  };
}

export interface SubjectListResolution {
  codes: SubjectCode[];
  unresolved: SubjectResolution[];
  ambiguous: SubjectResolution[];
  reviewRequired: boolean;
}

/** 批量解析岗位/公告的学科表述；能确定的先保留，不能确定的进入审核清单。 */
export function resolveSubjectList(
  raws: readonly string[],
  options: { stage?: string } = {},
): SubjectListResolution {
  const codes: SubjectCode[] = [];
  const unresolved: SubjectResolution[] = [];
  const ambiguous: SubjectResolution[] = [];
  for (const raw of raws) {
    const result = resolveSubject(raw, options);
    if (result.status === 'resolved' && result.code) {
      if (!codes.includes(result.code)) codes.push(result.code);
    } else if (result.status === 'ambiguous') {
      ambiguous.push(result);
    } else {
      unresolved.push(result);
    }
  }
  return {
    codes,
    unresolved,
    ambiguous,
    reviewRequired: unresolved.length > 0 || ambiguous.length > 0,
  };
}

/** 岗位的学科集合：复数优先，单值回退，旧代码归一（W1 兼容核心）。 */
export function unitSubjectCodes(
  unit: { subject?: string; subjects?: readonly string[] },
): SubjectCode[] {
  const codes: SubjectCode[] = [];
  for (const code of [...(unit.subjects ?? []), ...(unit.subject ? [unit.subject] : [])]) {
    const canonical = canonicalSubjectCode(code);
    if (canonical && !codes.includes(canonical)) codes.push(canonical);
  }
  return codes;
}

/** 单元的任一学科开放即进入匹配；空学科视为不开放并转人工。 */
export function unitHasOpenSubject(unit: {
  subject?: string;
  subjects?: readonly string[];
}): boolean {
  const codes = unitSubjectCodes(unit);
  return codes.some((code) => isOpenSubject(code));
}

/** 供前端/管理端展示的选项（稳定排序）。 */
export function subjectOptions(): Array<{
  code: SubjectCode;
  name: string;
  category: SubjectCategory;
}> {
  return [...SUBJECTS]
    .filter((s) => s.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ code: s.code, name: s.name, category: s.category }));
}
