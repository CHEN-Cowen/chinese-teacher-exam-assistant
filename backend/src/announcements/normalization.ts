/**
 * WB3：语义保真标准化（纯函数）。
 *
 * 目标：把原文提取值收敛到“机器可比、含义不变”的规范形态，同时严守红线：
 * - 只做 Unicode 归一、空白归一、全半角标点归一、首尾清理，不做任何改变含义的归一；
 * - 「汉语言文学（师范）」标准化后必须仍包含「师范」；
 * - 「本科」与「本科及以上」不得合并；
 * - 「事业编制」「事业单位工作人员」「合同制」「员额制」等不得凭近义词强行归一，
 *   只保留官方原文，规则明确命中时才附加分类码；
 * - 年龄基准日/例外缺失时保持 unknown，禁止从当前日期推算；
 * - 报名 URL 禁止从搜索结果或相似公告猜测。
 *
 * 本模块只产出字符串结果，不修改 `CandidateField` 状态；调用方（抽取器或
 * 后续 WB5）在提取后用本模块标准化 `value`，并保留原文证据。
 */
import { normalizationStrategyOf } from './field-registry.js';

/**
 * 全半角标点映射：只处理“视觉等价、含义相同”的标点，不做语义改写。
 * 半角 → 全角（面向中文正文的统一显示形态）。
 */
const HALF_TO_FULL_PUNCT: Readonly<Record<string, string>> = {
  '(': '（',
  ')': '）',
  ',': '，',
  ':': '：',
  ';': '；',
  '!': '！',
  '?': '？',
};

/** 把 ASCII 全角字符归一为半角（用于数字/字母/日期等不影响含义的形态统一） */
function normalizeFullwidthAscii(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/** 统一空格：把多种 Unicode 空白归一为单个半角空格（仅用于单词间，尾部随后清理） */
function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** 半角标点转全角（仅在中文语境安全处转换） */
function halfwidthPunctToFull(input: string): string {
  let out = input;
  for (const [half, full] of Object.entries(HALF_TO_FULL_PUNCT)) {
    out = out.split(half).join(full);
  }
  return out;
}

/**
 * 基础机械清洗：不改变含义的 Unicode/空白/全半角/首尾清理。
 *
 * 顺序：全角 ASCII → 半角 → 半角标点转全角 → 空白塌缩 → 首尾 trim。
 * 此函数是唯一允许“自动”改动的入口；任何语义归一必须显式、单独调用。
 */
export function cleanText(input: string): string {
  if (typeof input !== 'string') return '';
  return collapseWhitespace(halfwidthPunctToFull(normalizeFullwidthAscii(input)));
}

/** 专业字段标准化：只做机械清洗，绝不剥离「（师范）」等限定词 */
export function normalizeMajor(input: string): string {
  return cleanText(input);
}

/** 学历字段标准化：只做机械清洗；「本科」与「本科及以上」保持不同值，禁止合并 */
export function normalizeEducation(input: string): string {
  return cleanText(input);
}

/** 编制/用工性质标准化：只做机械清洗，保留官方原文，禁止近义词归一 */
export function normalizeEmploymentNature(input: string): string {
  return cleanText(input);
}

/**
 * 编制/用工性质分类码：仅在官方原文精确命中已知写法时附加，否则返回 undefined。
 * 分类码只作为“辅助标签”，绝不替代 official text；近义词不强行归并。
 */
const EMPLOYMENT_NATURE_CODES: ReadonlyArray<{
  keywords: readonly string[];
  code: string;
}> = [
  { keywords: ['事业编制'], code: 'public_institution_staff' },
  { keywords: ['备案制'], code: 'record_filing' },
  { keywords: ['员额制'], code: 'post_quota' },
  { keywords: ['控制数', '控制总量'], code: 'headcount_control' },
  { keywords: ['合同制'], code: 'contract' },
  { keywords: ['聘用制'], code: 'employment_system' },
  { keywords: ['编外'], code: 'off_payroll' },
  { keywords: ['劳务派遣'], code: 'labor_dispatch' },
];

/**
 * 仅在官方原文精确命中时返回分类码；多义/未命中返回 undefined，由人工审核。
 * 注意：同一原文命中多个关键词时返回 null（歧义，需人工），不静默选一。
 */
export function classifyEmploymentNature(
  officialText: string,
): string | undefined {
  const cleaned = cleanText(officialText);
  const hits = EMPLOYMENT_NATURE_CODES.filter((e) =>
    e.keywords.some((k) => cleaned.includes(k)),
  );
  if (hits.length === 1) return hits[0]!.code;
  return undefined; // 0 或 2+ 命中 → 不猜测
}

/** 日期字段标准化：只做机械清洗；空/缺失不推算，返回空串由调用方置 unknown */
export function normalizeDate(input: string): string {
  return cleanText(input);
}

/**
 * 报名入口 URL 标准化：只做首尾清理与去空白；不接受非 URL 或猜测值。
 * 返回 null 表示该值不可作为官方入口（调用方应置 unknown 而非猜测）。
 * 注意：URL 不做全半角标点转换（`:` `/` 等必须保留），只做空白清理。
 */
export function normalizeEntryUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\u00A0\u3000]/g, ' ').trim();
  if (!cleaned) return null;
  // 必须是 http/https 绝对地址，拒绝纯文本、内网地址、搜索词
  if (!/^https?:\/\//i.test(cleaned)) return null;
  return cleaned;
}

/**
 * 按字段注册表的标准化策略标准化一个值。
 * 未登记字段按 identity（只做机械清洗）处理。
 */
export function normalizeFieldValue(field: string, value: string): string {
  const strategy = normalizationStrategyOf(field);
  switch (strategy) {
    case 'preserve-major':
      return normalizeMajor(value);
    case 'education':
      return normalizeEducation(value);
    case 'employment-nature':
      return normalizeEmploymentNature(value);
    case 'date':
      return normalizeDate(value);
    case 'url':
      return normalizeEntryUrl(value) ?? '';
    case 'identity':
    default:
      return cleanText(value);
  }
}
