/**
 * R02：专业条件的分阶段结构（单一事实源）。
 *
 * 审核员可在 `major` 字段里显式写入结构化值：
 * `{"names":["汉语言文学","学科教学（语文）"],"stages":["bachelor","master"],"stageMode":"any"}`
 *
 * 规则：
 * - 普通文本（不以 `{` 开头）不是结构化值，返回 null，保持旧行为且**不推断阶段**；
 * - 以 `{` 开头但结构非法的值直接报错，绝不静默回退成普通文本；
 * - 多阶段必须显式给出 stageMode（any/all），系统不默认猜测；
 * - 无 stages 表示「公告未明确适用阶段」，不得被解释为最高学历阶段要求。
 *
 * 该模块同时被审核校验（domain.ts）与发布装配（catalog-payload-assembler.ts）使用，
 * 保证「审核可校验」、「发布可校验」同一口径。
 */
import type { CredentialLevel } from '../matching/types.js';

export const MAJOR_STAGE_CODES: readonly CredentialLevel[] = [
  'secondary',
  'college',
  'bachelor',
  'master',
  'doctorate',
];

export const MAJOR_STAGE_LABELS: Record<CredentialLevel, string> = {
  secondary: '中专/高中',
  college: '大专',
  bachelor: '本科',
  master: '硕士研究生',
  doctorate: '博士研究生',
};

export interface StructuredMajorValue {
  names: string[];
  stages?: CredentialLevel[];
  stageMode?: 'any' | 'all';
  ambiguous?: boolean;
}

const STRUCTURED_MAJOR_KEYS = new Set([
  'names',
  'stages',
  'stageMode',
  'ambiguous',
]);

/** 结构化专业值错误：携带字段路径与原因，供审核/发布分别呈现 */
export class MajorCriterionError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'MajorCriterionError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new MajorCriterionError(path, message);
}

function isCredentialLevel(value: unknown): value is CredentialLevel {
  return typeof value === 'string' && MAJOR_STAGE_CODES.includes(value as CredentialLevel);
}

/**
 * 解析结构化专业值。
 * 返回 null 表示「不是结构化值」（普通文本 / 空白），由调用方按旧逻辑处理。
 */
export function parseStructuredMajor(
  raw: string,
  path = 'major',
): StructuredMajorValue | null {
  const text = raw.trim();
  if (!text.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(path, '专业结构化值不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(path, '专业结构化值必须是对象');
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!STRUCTURED_MAJOR_KEYS.has(key)) {
      fail(path, `专业结构化值包含未知字段：${key}`);
    }
  }

  const rawNames = record['names'];
  if (!Array.isArray(rawNames) || rawNames.length === 0) {
    fail(path, '专业结构化值缺少非空 names 数组');
  }
  const names: string[] = [];
  for (const item of rawNames) {
    if (typeof item !== 'string' || !item.trim()) {
      fail(path, 'names 每项必须是非空字符串');
    }
    const trimmed = item.trim();
    if (!names.includes(trimmed)) names.push(trimmed);
  }

  let stages: CredentialLevel[] | undefined;
  if (record['stages'] !== undefined) {
    const rawStages = record['stages'];
    if (!Array.isArray(rawStages) || rawStages.length === 0) {
      fail(path, 'stages 必须是非空数组');
    }
    stages = [];
    for (const item of rawStages) {
      if (!isCredentialLevel(item)) {
        fail(path, `stages 取值非法：${String(item)}（仅支持 ${MAJOR_STAGE_CODES.join('/')}）`);
      }
      if (!stages.includes(item)) stages.push(item);
    }
  }

  let stageMode: 'any' | 'all' | undefined;
  if (record['stageMode'] !== undefined) {
    const rawMode = record['stageMode'];
    if (rawMode !== 'any' && rawMode !== 'all') {
      fail(path, 'stageMode 只能是 any 或 all');
    }
    if (!stages) {
      fail(path, 'stageMode 必须与 stages 同时给出');
    }
    stageMode = rawMode;
  }
  // 多阶段必须由审核员明确口径：任一 / 同时；系统不默认猜测。
  if (stages && stages.length > 1 && !stageMode) {
    fail(path, '多阶段专业要求必须明确 stageMode（any=任一 / all=同时）');
  }

  let ambiguous: boolean | undefined;
  if (record['ambiguous'] !== undefined) {
    if (typeof record['ambiguous'] !== 'boolean') {
      fail(path, 'ambiguous 必须是布尔值');
    }
    ambiguous = record['ambiguous'];
  }

  return {
    names,
    ...(stages ? { stages } : {}),
    ...(stageMode ? { stageMode } : {}),
    ...(ambiguous ? { ambiguous: true } : {}),
  };
}

/** 结构化专业要求的人读描述（用户端“公告怎么写”，不含 JSON） */
export function describeStructuredMajor(value: StructuredMajorValue): string {
  const names = value.names.join('、');
  if (!value.stages || value.stages.length === 0) return names;
  const labels = value.stages.map((stage) => MAJOR_STAGE_LABELS[stage]);
  if (labels.length === 1) return `${names}（限${labels[0]}阶段）`;
  const mode = value.stageMode === 'all' ? '均须符合' : '任一符合';
  return `${names}（${labels.join('、')}阶段${mode}）`;
}
