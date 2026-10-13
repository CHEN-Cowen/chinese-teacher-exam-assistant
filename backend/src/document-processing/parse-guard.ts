/**
 * v7.2 附件解析：解析前/解析中安全防护（parse-guard）。
 *
 * 处理（用户要求"安全"清单）：
 * - 超大文件（字节数上限）；
 * - 压缩炸弹（解压后单元格/块预算上限）；
 * - 损坏文件（解析器抛错 → failed，不产生半成品覆盖旧数据）；
 * - 加密文件（PDF PasswordException → pending_manual，不伪装成功）；
 * - 错误扩展名/MIME（由 format-detector 告警）；
 * - 页数/工作表数量上限。
 *
 * 失败语义：任何防护失败都不修改既有成功记录（幂等键隔离），更不会
 * 覆盖已发布版本——旧标准文档与已发布数据永远只读。
 */

export interface ParseLimits {
  maxBytes: number;
  maxPdfPages: number;
  maxSheets: number;
  maxBlocks: number;
  /** 解压后单元格总预算（防压缩炸弹） */
  maxCells: number;
  /** 单块文本最大长度（超出截断并告警） */
  maxBlockTextLength: number;
}

export function readParseLimits(env: NodeJS.ProcessEnv = process.env): ParseLimits {
  return {
    maxBytes: intFromEnv(env.DOC_PARSE_MAX_BYTES, 20 * 1024 * 1024),
    maxPdfPages: intFromEnv(env.DOC_PARSE_MAX_PDF_PAGES, 200),
    maxSheets: intFromEnv(env.DOC_PARSE_MAX_SHEETS, 50),
    maxBlocks: intFromEnv(env.DOC_PARSE_MAX_BLOCKS, 20_000),
    maxCells: intFromEnv(env.DOC_PARSE_MAX_CELLS, 500_000),
    maxBlockTextLength: intFromEnv(env.DOC_PARSE_MAX_BLOCK_TEXT, 4_000),
  };
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export type GuardErrorCode =
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'UNKNOWN_FORMAT'
  | 'ENCRYPTED_PDF'
  | 'CORRUPT_FILE'
  | 'TOO_MANY_PAGES'
  | 'TOO_MANY_SHEETS'
  | 'CELL_BUDGET_EXCEEDED'
  | 'BLOCK_BUDGET_EXCEEDED';

export class GuardError extends Error {
  readonly code: GuardErrorCode;
  constructor(code: GuardErrorCode, message: string) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}

/** 解析入口防护：大小与空文件 */
export function assertWithinLimits(bytes: Buffer, limits: ParseLimits): void {
  if (bytes.length === 0) {
    throw new GuardError('EMPTY_FILE', '空文件无法解析');
  }
  if (bytes.length > limits.maxBytes) {
    throw new GuardError(
      'FILE_TOO_LARGE',
      `文件超过解析上限（${bytes.length} > ${limits.maxBytes} 字节），已拒绝解析`,
    );
  }
}

/** 解析过程中递增预算，超限立即抛错（终止解析，不产出半成品） */
export class Budget {
  private used = 0;
  constructor(private readonly max: number) {}
  spend(n = 1): void {
    this.used += n;
    if (this.used > this.max) {
      throw new GuardError(
        'CELL_BUDGET_EXCEEDED',
        `解压后内容超过预算上限（${this.max}），疑似压缩炸弹，已终止解析`,
      );
    }
  }
}

/** 截断超长块文本；返回 [文本, 是否截断] */
export function clampText(
  text: string,
  max: number,
): [string, boolean] {
  if (text.length <= max) return [text, false];
  return [text.slice(0, max), true];
}
