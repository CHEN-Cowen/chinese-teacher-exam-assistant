/**
 * v7.2 附件解析：电子表格解析器（SheetJS，XLS/XLSX/XLSB/ET）。
 *
 * 只做"字节 → 标准文档"：
 * - 逐工作表、逐单元格输出块：保留工作表名、行号、列号、单元格地址、
 *   原始值（cell.v）与展示值（cell.w）；
 * - 合并单元格：只在左上角单元格出块，并在告警中登记合并范围；
 * - 公式单元格：保留缓存计算值并告警（不重新求值、不执行公式）；
 * - 外部链接：登记告警（永不访问）；
 * - 单元格预算防压缩炸弹；工作表数量上限。
 *
 * 分层边界：本文件不做任何资格/业务判断；表头"建议字段"只是确定性
 * 关键词候选，最终语义由业务抽取层与人工审核确认。
 */
import * as XLSX from 'xlsx';
import {
  Budget,
  GuardError,
  clampText,
  type ParseLimits,
} from '../parse-guard.js';
import type {
  DocumentParser,
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
  TableHeaderCandidate,
} from '../parsed-document.js';

export const SPREADSHEET_PARSER_VERSION = 'spreadsheet-parser@1.0.0';

/** 表头候选关键词 → 建议字段（仅候选；业务语义由抽取层与审核确认） */
const HEADER_HINTS: Array<{ keywords: string[]; field: string }> = [
  { keywords: ['岗位代码', '职位代码', '代码'], field: 'position_code' },
  { keywords: ['招聘单位', '用人单位', '单位名称', '主管部门'], field: 'employer' },
  { keywords: ['岗位', '职位名称', '招聘岗位'], field: 'position_name' },
  { keywords: ['学科', '科目'], field: 'subjects' },
  { keywords: ['人数', '名额', '招聘数'], field: 'headcount' },
  { keywords: ['学历'], field: 'education' },
  { keywords: ['专业'], field: 'major' },
  { keywords: ['年龄'], field: 'age' },
  { keywords: ['户籍', '户口'], field: 'hukou' },
  { keywords: ['教师资格', '教资'], field: 'teacher_cert' },
  { keywords: ['用工', '编制', '性质'], field: 'employment_nature' },
  { keywords: ['备注'], field: 'remarks' },
];

interface CellRecord {
  v?: unknown;
  w?: string;
  f?: string;
  t?: string;
}

interface Worksheet {
  [cell: string]: CellRecord | object | string | undefined;
  '!ref'?: string;
  '!merges'?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
}
interface Workbook {
  SheetNames: string[];
  Sheets: Record<string, Worksheet>;
  Workbook?: { ExternalLinks?: unknown[] };
}

function isCell(
  value: CellRecord | object | string | undefined,
): value is CellRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('v' in value || 'f' in value || 'w' in value)
  );
}

/** 单元格值安全文本化：基本类型直转，其余 JSON 序列化（绝不 '[object Object]'） */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export class SpreadsheetDocumentParser implements DocumentParser {
  readonly format = 'spreadsheet' as const;

  constructor(private readonly limits: ParseLimits) {}

  async parse(input: {
    snapshotId: string;
    sourceUrl: string | null;
    storageKey: string;
    contentHash: string;
    declaredMime: string;
    declaredExtension: string;
    bytes: Buffer;
  }): Promise<ParsedDocument> {
    const warnings: string[] = [];

    let wb: Workbook;
    try {
      wb = XLSX.read(input.bytes, {
        type: 'buffer',
        cellDates: false,
        cellFormula: true,
        cellStyles: false,
        dense: false,
      }) as unknown as Workbook;
    } catch (error) {
      throw new GuardError(
        'CORRUPT_FILE',
        `表格文件损坏或格式不受支持：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (input.declaredExtension === 'docx' || input.declaredExtension === 'doc') {
      warnings.push(`扩展名（.${input.declaredExtension}）不属于电子表格，已按内容处理`);
    }
    if (wb.Workbook?.ExternalLinks && wb.Workbook.ExternalLinks.length > 0) {
      warnings.push(
        `工作簿包含 ${wb.Workbook.ExternalLinks.length} 个外部链接引用（已登记，永不访问）`,
      );
    }

    const sheets = wb.SheetNames.slice(0, this.limits.maxSheets);
    if (wb.SheetNames.length > this.limits.maxSheets) {
      warnings.push(`工作表数量超过上限 ${this.limits.maxSheets}，已截断`);
    }

    const blocks: ParsedBlock[] = [];
    const tableHeaders: TableHeaderCandidate[] = [];
    const budget = new Budget(this.limits.maxCells);

    for (const sheetName of sheets) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet?.['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']!);
      const merges = sheet['!merges'] ?? [];
      const mergedTopLeft = new Set(merges.map((m) => `${m.s.r}:${m.s.c}`));

      // 表头候选：首个包含 ≥2 个非空单元格的行
      let headerRow = -1;
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 9); r += 1) {
        let filled = 0;
        for (let c = range.s.c; c <= range.e.c; c += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })];
          if (isCell(cell) && cell.v != null) filled += 1;
        }
        if (filled >= 2) {
          headerRow = r;
          break;
        }
      }
      if (headerRow >= 0) {
        const columns: TableHeaderCandidate['columns'] = [];
        for (let c = range.s.c; c <= range.e.c; c += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
          if (!isCell(cell) || cell.v == null) continue;
          const headerText = cellText(cell.w ?? cell.v).trim();
          if (!headerText) continue;
          const hint = HEADER_HINTS.find((h) =>
            h.keywords.some((kw) => headerText.includes(kw)),
          );
          columns.push({
            column: c,
            cell: XLSX.utils.encode_cell({ r: headerRow, c }),
            headerText,
            suggestedField: hint?.field,
          });
        }
        if (columns.length >= 2) {
          tableHeaders.push({ sheet: sheetName, headerRow, columns });
        }
      }

      for (let r = range.s.r; r <= range.e.r; r += 1) {
        for (let c = range.s.c; c <= range.e.c; c += 1) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr];
          if (!isCell(cell) || cell.v == null) continue;
          budget.spend();
          if (blocks.length >= this.limits.maxBlocks) {
            warnings.push(`内容块数量超过上限 ${this.limits.maxBlocks}，已截断`);
            r = range.e.r + 1;
            break;
          }
          // 合并单元格：非左上角不再单独出块（左上角值代表整块）
          const isMergedNonTopLeft =
            merges.some(
              (m) =>
                r >= m.s.r &&
                r <= m.e.r &&
                c >= m.s.c &&
                c <= m.e.c &&
                !(r === m.s.r && c === m.s.c),
            ) ?? false;
          if (isMergedNonTopLeft) continue;

          const display = cellText(cell.w ?? cell.v).trim();
          const raw = cellText(cell.v).trim();
          if (!raw && !display) continue;
          const [clamped, truncated] = clampText(display || raw, this.limits.maxBlockTextLength);
          if (truncated) warnings.push(`${sheetName}!${addr} 文本超长已截断`);
          const locator: DocumentLocator = {
            kind: 'worksheet',
            sheet: sheetName,
            row: r + 1,
            column: c + 1,
            cell: addr,
          };
          blocks.push({
            kind: 'table-cell',
            text: clamped,
            locator,
            rawValue: raw,
            displayValue: display,
          });
          if (cell.f) {
            warnings.push(
              `${sheetName}!${addr} 含公式（仅保留缓存计算值，不重新求值、不执行）`,
            );
          }
          if (mergedTopLeft.has(`${r}:${c}`)) {
            const merge = merges.find((m) => m.s.r === r && m.s.c === c)!;
            warnings.push(
              `${sheetName} 合并单元格 ${XLSX.utils.encode_range(merge)}（值取左上角 ${addr}）`,
            );
          }
        }
      }
    }

    if (blocks.length === 0) {
      throw new GuardError('CORRUPT_FILE', '工作簿中没有可读取的内容单元格');
    }

    return {
      snapshotId: input.snapshotId,
      sourceUrl: input.sourceUrl,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      format: 'spreadsheet',
      formatDetails: {
        detectedBy: 'magic-bytes',
        declaredMime: input.declaredMime,
        declaredExtension: input.declaredExtension,
        detectedMime: 'application/vnd.ms-excel',
      },
      parserVersion: SPREADSHEET_PARSER_VERSION,
      title: undefined,
      blocks,
      tableHeaders: tableHeaders.length > 0 ? tableHeaders : undefined,
      scanned: false,
      sheetCount: sheets.length,
      warnings,
    };
  }
}
