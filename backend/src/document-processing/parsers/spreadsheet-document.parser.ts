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
  ParseDeadline,
  clampText,
  type ParseLimits,
} from '../parse-guard.js';
import { suggestField } from '../header-hints.js';
import type {
  DocumentParser,
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
  TableHeaderCandidate,
} from '../parsed-document.js';

export const SPREADSHEET_PARSER_VERSION = 'spreadsheet-parser@1.2.0';

/** 合并单元格覆盖地址展开总预算（超出则只登记左上角并告警，不逐格展开） */
const MERGE_EXPANSION_BUDGET = 100_000;

/** 墙钟守卫检查节拍（每处理多少真实单元格检查一次超时） */
const DEADLINE_CHECK_INTERVAL = 4096;

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

/** 解码后的真实单元格（v 非空），按 (row, col) 升序 */
interface RealCell {
  address: string;
  row: number;
  column: number;
  cell: CellRecord;
}

/**
 * 按实际单元格地址收集真实内容单元格（v 非空），一次解码并排序。
 * 官方 xlsx 可能把 !ref 标到整表（如 A1:XFD1048576），不能据此做
 * 矩形扫描——M04/F6：遍历一律以真实单元格键为准。
 */
function collectRealCells(sheet: Worksheet): RealCell[] {
  const cells: RealCell[] = [];
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue;
    const cell = sheet[address];
    if (!isCell(cell) || cell.v == null) continue;
    const decoded = XLSX.utils.decode_cell(address);
    cells.push({ address, row: decoded.r, column: decoded.c, cell });
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  return cells;
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

/**
 * 合并单元格覆盖地址集合（含展开预算）。
 * 超预算的合并范围不逐格展开：非左上角残留值会按普通单元格出块，
 * 显式告警说明，不静默丢弃也不无限消耗内存。
 */
function expandMergeCoverage(
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>,
  warnings: string[],
  sheetName: string,
): { covered: Set<string>; budgetExceeded: boolean } {
  const covered = new Set<string>();
  let budgetExceeded = false;
  let expanded = 0;
  for (const merge of merges) {
    const span =
      (merge.e.r - merge.s.r + 1) * (merge.e.c - merge.s.c + 1);
    if (expanded + span > MERGE_EXPANSION_BUDGET) {
      budgetExceeded = true;
      warnings.push(
        `${sheetName} 合并范围 ${XLSX.utils.encode_range(merge)} 过大，未逐格登记覆盖（值仍取左上角）`,
      );
      continue;
    }
    expanded += span;
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (r === merge.s.r && c === merge.s.c) continue;
        covered.add(`${r}:${c}`);
      }
    }
  }
  return { covered, budgetExceeded };
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
    // M04/F6：解析墙钟守卫（在迭代节拍内真实终止我们的循环）
    const deadline = new ParseDeadline(this.limits.timeoutMs);

    for (const sheetName of sheets) {
      deadline.check(); // 每张表开始时检查一次（小表也可能因前表耗时超限）
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const realCells = collectRealCells(sheet);
      if (realCells.length === 0) {
        // 全空虚大 !ref（如 A1:XFD1048576）没有真实内容：跳过并告警，
        // 绝不按 !ref 做矩形扫描（旧实现会在此处空扫上亿次）。
        if (sheet['!ref']) {
          warnings.push(`${sheetName} 声明范围 ${sheet['!ref']} 但无实际内容单元格，已跳过`);
        }
        continue;
      }

      // 跨度守卫：真实单元格的包围盒不得超出合理岗位表规模；
      // 两个远距离单元格也会把包围盒撑满整表 → 明确转人工，不硬扫。
      const minRow = realCells[0]!.row;
      const maxRow = realCells[realCells.length - 1]!.row;
      const minCol = realCells.reduce((m, c) => Math.min(m, c.column), Number.POSITIVE_INFINITY);
      const maxCol = realCells.reduce((m, c) => Math.max(m, c.column), -1);
      if (
        maxRow - minRow + 1 > this.limits.maxSheetRows ||
        maxCol - minCol + 1 > this.limits.maxSheetCols
      ) {
        throw new GuardError(
          'SHEET_SPAN_EXCEEDED',
          `工作表「${sheetName}」实际内容跨度（${maxRow - minRow + 1} 行 × ${maxCol - minCol + 1} 列）超过上限（${this.limits.maxSheetRows} 行 × ${this.limits.maxSheetCols} 列），已转人工处理`,
        );
      }

      const merges = sheet['!merges'] ?? [];
      const mergedTopLeft = new Set(merges.map((m) => `${m.s.r}:${m.s.c}`));
      const { covered: mergedCovered } = expandMergeCoverage(merges, warnings, sheetName);

      // 表头识别（支持多级表头）：只在真实单元格的顶部窗口内做，
      // 不做矩形扫描。学科列（语文/数学/…）的 subject 映射仅在
      // 「已是表头行」的行内生效。
      const headerWindowEnd = Math.min(maxRow, minRow + 9);
      const headerRows = new Map<number, RealCell[]>();
      for (const entry of realCells) {
        if (entry.row > headerWindowEnd) break; // 已按 (row, col) 排序
        const list = headerRows.get(entry.row);
        if (list) list.push(entry);
        else headerRows.set(entry.row, [entry]);
      }
      const headerCandidates: Array<{ row: number; columns: TableHeaderCandidate['columns'] }> = [];
      for (const [r, rowCells] of headerRows) {
        const rowColumns: TableHeaderCandidate['columns'] = [];
        let strongHeaderCount = 0;
        let subjectColumnCount = 0;
        for (const entry of rowCells) {
          const headerText = cellText(entry.cell.w ?? entry.cell.v).trim();
          if (!headerText) continue;
          const hint = suggestField(headerText);
          rowColumns.push({
            column: entry.column + 1,
            cell: entry.address,
            headerText,
            suggestedField: hint,
          });
          // 强表头关键词（非学科名）计数：用于判定该行是否为表头行
          if (hint && hint !== 'subject' && hint !== 'subjects') strongHeaderCount += 1;
          else if (hint === 'subject') subjectColumnCount += 1;
        }
        // 该行是否算表头行：
        // (a) 多数单元格命中强表头关键词；或 (b) 全为学科列（≥2 列）且紧跟在
        //     已识别表头行之后（多级表头：学科子列常在「招聘单位」等一级
        //     表头行的下一行）。
        // 强表头不能只要求「命中 1 个」：真实公告的数据行长文本常偶然含
        // 「学历/年龄/学科」等词（宁波 2026 公告实测：数据行命中 1-2 个），
        // 会被误认为表头并占据最大 headerRow，令真正表头列映射被覆盖、
        // 后续同单位数据行被「重复表头行」规则整批误杀。
        // 因此要求 ≥2 个强关键词，且命中占比 ≥40%。
        const strongRatio = rowColumns.length > 0 ? strongHeaderCount / rowColumns.length : 0;
        const isStrongHeader =
          rowColumns.length >= 2 && strongHeaderCount >= 2 && strongRatio >= 0.4;
        const isSubjectHeader =
          subjectColumnCount >= 2 && headerCandidates.length > 0;
        if (isStrongHeader || isSubjectHeader) {
          headerCandidates.push({ row: r, columns: rowColumns });
        }
      }
      for (const hc of headerCandidates) {
        tableHeaders.push({
          sheet: sheetName,
          headerRow: hc.row + 1,
          columns: hc.columns,
        });
      }

      // 逐真实单元格出块：每格只访问一次（无矩形空扫描），
      // 访问计数与墙钟按节拍推进。
      let sinceDeadlineCheck = 0;
      for (const entry of realCells) {
        sinceDeadlineCheck += 1;
        if (sinceDeadlineCheck >= DEADLINE_CHECK_INTERVAL) {
          deadline.check();
          sinceDeadlineCheck = 0;
        }
        budget.spend();
        if (blocks.length >= this.limits.maxBlocks) {
          warnings.push(`内容块数量超过上限 ${this.limits.maxBlocks}，已截断`);
          break;
        }
        // 合并单元格：非左上角不再单独出块（左上角值代表整块）
        if (mergedCovered.has(`${entry.row}:${entry.column}`)) continue;

        const display = cellText(entry.cell.w ?? entry.cell.v).trim();
        const raw = cellText(entry.cell.v).trim();
        if (!raw && !display) continue;
        const [clamped, truncated] = clampText(display || raw, this.limits.maxBlockTextLength);
        if (truncated) warnings.push(`${sheetName}!${entry.address} 文本超长已截断`);
        const locator: DocumentLocator = {
          kind: 'worksheet',
          sheet: sheetName,
          row: entry.row + 1,
          column: entry.column + 1,
          cell: entry.address,
        };
        blocks.push({
          kind: 'table-cell',
          text: clamped,
          locator,
          rawValue: raw,
          displayValue: display,
        });
        if (entry.cell.f) {
          warnings.push(
            `${sheetName}!${entry.address} 含公式（仅保留缓存计算值，不重新求值、不执行）`,
          );
        }
        if (mergedTopLeft.has(`${entry.row}:${entry.column}`)) {
          const merge = merges.find((m) => m.s.r === entry.row && m.s.c === entry.column)!;
          warnings.push(
            `${sheetName} 合并单元格 ${XLSX.utils.encode_range(merge)}（值取左上角 ${entry.address}）`,
          );
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
