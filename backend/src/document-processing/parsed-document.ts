/**
 * v7.2 附件解析：标准文档与证据定位类型。
 *
 * 分层边界（技术方案 §6.1 / 用户要求 1-6 层）：
 * - 本文件只定义"字节 → 标准文档"的输出结构；
 * - 不包含任何招聘业务字段判断（那是 announcements/extraction 的职责）；
 * - 所有 block 都必须携带可回到原文的 EvidenceLocator。
 */

/** 证据定位：按输入格式区分，保证"高影响字段能回到原文" */
export type DocumentLocator =
  /** HTML：选择器路径 + 文本片段 + 来源 URL */
  | { kind: 'html'; selector: string; textFragment: string; sourceUrl?: string }
  /** PDF 文本：页码 + 必要坐标（PDF 用户空间）+ 文本片段 */
  | {
      kind: 'pdf-text';
      page: number;
      bbox?: { x: number; y: number; width: number; height: number };
      textFragment: string;
    }
  /** OCR 结果：页码 + 坐标 + 置信度 + OCR 标记 + 服务版本 */
  | {
      kind: 'ocr';
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
      confidence: number;
      ocrMarked: true;
      serviceVersion: string;
      textFragment: string;
    }
  /** 电子表格：工作表名 + 行号 + 列号 + 单元格地址 */
  | { kind: 'worksheet'; sheet: string; row: number; column: number; cell: string }
  /** DOCX：段落序号（Word 不虚构页码） */
  | { kind: 'docx-paragraph'; index: number; textFragment: string }
  /** DOCX 表格单元格：第几个表格 + 行 + 列 */
  | { kind: 'docx-table-cell'; table: number; row: number; column: number }
  /** 兜底：纯文本摘录（用于无法结构化定位的内容） */
  | { kind: 'excerpt'; textFragment: string };

export type ParsedBlockKind = 'heading' | 'paragraph' | 'table-cell' | 'list-item';

/** 标准文档的一个内容块 */
export interface ParsedBlock {
  kind: ParsedBlockKind;
  text: string;
  locator: DocumentLocator;
  /** 原始值（Excel 单元格未格式化值；其余格式通常等于 text） */
  rawValue?: string;
  /** 展示值（Excel 按格式代码格式化后的值） */
  displayValue?: string;
}

/** 表格表头候选映射（供业务抽取确认列语义） */
export interface TableHeaderCandidate {
  sheet: string;
  headerRow: number;
  columns: Array<{
    column: number;
    cell: string;
    headerText: string;
    /** 确定性建议字段（仅候选，需审核确认） */
    suggestedField?: string;
  }>;
}

/** 解析后的标准文档：所有格式的统一输出 */
export interface ParsedDocument {
  /** 来源快照 id */
  snapshotId: string;
  /** 原始来源 URL（快照 officialUrl） */
  sourceUrl: string | null;
  /** 快照内容哈希（SHA-256） */
  contentHash: string;
  /** 存储引用（对象存储 key，用于回读原件） */
  storageKey: string;
  format: DocumentFormat;
  /** 格式判定依据（magic bytes / 扩展名 / 声明 MIME） */
  formatDetails: {
    detectedBy: 'magic-bytes' | 'extension' | 'mime' | 'unknown';
    declaredMime: string;
    declaredExtension: string;
    detectedMime: string;
  };
  parserVersion: string;
  title?: string;
  blocks: ParsedBlock[];
  tableHeaders?: TableHeaderCandidate[];
  /** 是否判定为扫描件/无有效文本层 */
  scanned: boolean;
  /** 页数（PDF）或工作表数（Excel），无则不设 */
  pageCount?: number;
  sheetCount?: number;
  ocr?: {
    required: boolean;
    /** not_triggered / pending_manual / disabled / completed */
    status: 'not_triggered' | 'pending_manual' | 'disabled' | 'completed';
    reason?: string;
  };
  /** 非空表示需要人工处理（如 DOCX/OCR 未启用），不得伪装成功 */
  pendingManualReason?: string;
  warnings: string[];
}

export type DocumentFormat = 'html' | 'pdf' | 'spreadsheet' | 'docx' | 'ocr' | 'unknown';

/** DocumentParseRun 的终态（与 Prisma 模型注释一致） */
export type DocumentParseStatus =
  | 'pending'
  | 'parsed'
  | 'pending_manual'
  | 'unsupported_format'
  | 'failed';

/** 文档解析器接口：每个格式一个实现，输入原始字节，输出标准文档 */
export interface DocumentParser {
  readonly format: DocumentFormat;
  parse(input: {
    snapshotId: string;
    sourceUrl: string | null;
    storageKey: string;
    contentHash: string;
    declaredMime: string;
    declaredExtension: string;
    bytes: Buffer;
  }): Promise<ParsedDocument>;
}
