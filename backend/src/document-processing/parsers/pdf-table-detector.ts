/**
 * 通用 PDF 表格还原器（坐标聚类，纯函数）。
 *
 * 背景：PDF 文本层不含表格结构，只有带坐标的文本项（x/y/width）。
 * 本模块依据坐标把文本项聚类成"行 × 列"的单元格结构，还原出：
 *   - worksheet 风格的 cell 块（locator.kind='worksheet'，带 sheet/row/column/cell）
 *   - 表头候选（tableHeaders，含表头文本与建议字段）
 * 供下游业务抽取层（announcements/extraction）与电子表格同构消费。
 *
 * 不变量：
 * - 只做结构还原（行列 + 表头文本），不做业务资格判断；
 * - 表头"建议字段"只是确定性关键词候选，最终语义由抽取层与人工审核确认；
 * - 检测不到可靠表格结构时返回 null（调用方保持原逐行文本，不伪造表格）。
 */

import { suggestField } from '../header-hints.js';
import type {
  DocumentLocator,
  ParsedBlock,
  TableHeaderCandidate,
} from '../parsed-document.js';

/** 一个带坐标的 PDF 文本项（输入） */
export interface PdfTextItem {
  page: number;
  /** PDF 用户空间 x（左缘） */
  x: number;
  /** PDF 用户空间 y（上缘，越大越靠上） */
  y: number;
  width: number;
  /** 行高（用于判断跨行文本）；缺省用字号估算 */
  height?: number;
  str: string;
}

/** 还原出的一个单元格（row/column 均 1-based） */
interface DetectedCell {
  row: number;
  column: number;
  text: string;
  x: number;
  y: number;
}

/** 表格还原结果 */
export interface DetectedTable {
  sheet: string;
  headerRow: number;
  headers: Array<{ column: number; text: string }>;
  cells: DetectedCell[];
  /** 列坐标（用于证据定位与调试） */
  columns: number[];
}

/** 行聚类容差（同一行的 y 差阈值，PDF 用户空间单位） */
const ROW_TOLERANCE = 5;
/** 列聚类容差（同一列的 x 差阈值） */
const COLUMN_TOLERANCE = 6;
/** 表头识别：在页面顶部扫描的最多行数 */
const HEADER_SCAN_ROWS = 6;
/** 判定为表格所需的最少列数（<2 列视为非表格） */
const MIN_COLUMNS = 2;
/** 判定为表格所需的最少行数 */
const MIN_ROWS = 2;

/** 聚类容差分组：把一维数值按"相邻差 ≤ tolerance"聚类 */
function cluster(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];
  for (const v of sorted) {
    const cur = centers[centers.length - 1];
    if (cur === undefined || v - cur > tolerance) {
      centers.push(v);
    }
    // 若 v 落在当前聚类容差内，不更新中心（保持首点作为该列锚点），
    // 避免"移动平均"让列中心随数据点增多而漂移，导致后续归属错位。
  }
  return centers;
}

/** 找到 v 所属的聚类中心索引（按最近中心） */
function nearestCenter(v: number, centers: number[]): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centers.length; i += 1) {
    const d = Math.abs(v - centers[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** A1 地址：列号(1-based) → 字母 */
function columnLetter(column: number): string {
  let n = column;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellAddress(row: number, column: number): string {
  return `${columnLetter(column)}${row}`;
}

/**
 * 从单页 PDF 文本项还原表格；检测不到可靠表格结构返回 null。
 * 返回的 row/column 均为 1-based（与 spreadsheet parser 约定一致）。
 *
 * 列对齐策略：先按 y 聚类出行，从顶部几行里选出"表头行"（含最多
 * 表头关键词/学科名的行），用表头行的文本项 x 中心定义列中心，
 * 再把数据行文本项按 x 中心归属到最近的列中心（而非重新聚类，
 * 以消除「表头左对齐 vs 数据右对齐」导致的列错位）。
 */
export function detectPdfTable(
  items: PdfTextItem[],
  page: number,
): DetectedTable | null {
  const usable = items.filter((it) => it.str.trim().length > 0);
  if (usable.length < MIN_ROWS * MIN_COLUMNS) return null;

  // 1. 行聚类：用 y 聚类出行（PDF y 轴向上，越大越靠上）
  const yValues = usable.map((it) => it.y);
  const rows = cluster(yValues, ROW_TOLERANCE);
  if (rows.length < MIN_ROWS) return null;
  const sortedRows = [...rows].sort((a, b) => b - a);
  const rowIndexByY = new Map(sortedRows.map((y, i) => [y, i + 1]));

  // 2. 先把每个文本项归属到行（仅按 y），便于按行统计表头特征
  const itemsByRow = new Map<number, PdfTextItem[]>();
  for (const it of usable) {
    const row = rowIndexByY.get(rows[nearestCenter(it.y, rows)])!;
    const arr = itemsByRow.get(row) ?? [];
    arr.push(it);
    itemsByRow.set(row, arr);
  }

  // 3. 识别表头区域：顶部连续几行中，含表头关键词/学科名的文本项最多的行
  //    为主表头行；并把与它相邻（上方 1–2 行）且含表头特征的行纳入表头区域
  //    （多级表头合并，如「招聘单位/学历/其他条件」+「语文/数学/英语…」）。
  const headerHint = (text: string): number => {
    let score = 0;
    if (suggestField(text)) score += 2;
    if (/语文|数学|英语|物理|化学|生物|历史|地理|音乐|体育|美术|政治|信息|心理|科学|学科|岗位|招聘|人数|学历|专业|年龄|电话|备注|序号|单位|名称/.test(text)) score += 1;
    return score;
  };
  const rowScore = (r: number): number =>
    (itemsByRow.get(r) ?? []).reduce((sum, it) => sum + headerHint(it.str), 0);
  let headerRow = 0;
  let bestScore = -1;
  for (let r = 1; r <= Math.min(HEADER_SCAN_ROWS, sortedRows.length); r += 1) {
    const score = rowScore(r);
    if (score > bestScore) {
      bestScore = score;
      headerRow = r;
    }
  }
  if (headerRow === 0) return null;

  const headerZoneRows = new Set<number>([headerRow]);
  // 多级表头：学科子列通常在主表头行的「下方」（如「招聘单位/学历」在上、
  // 「语文/数学/英语…」在下），因此向下合并相邻的含表头特征的行。
  for (let r = headerRow + 1; r <= Math.min(headerRow + 2, sortedRows.length); r += 1) {
    if (rowScore(r) > 0) headerZoneRows.add(r);
  }
  // 同时向上合并一级表头（如「招聘单位」上方的大类表头），双向兼容。
  for (let r = headerRow - 1; r >= Math.max(1, headerRow - 1); r -= 1) {
    if (rowScore(r) > 0) headerZoneRows.add(r);
  }

  // 4. 用表头区域所有文本项的 x 中心聚类出完整列集合
  const zoneItems: PdfTextItem[] = [];
  for (const r of headerZoneRows) {
    zoneItems.push(...(itemsByRow.get(r) ?? []));
  }
  if (zoneItems.length < MIN_COLUMNS) return null;
  const headerCenters = cluster(
    zoneItems.map((it) => it.x + it.width / 2),
    COLUMN_TOLERANCE * 2,
  );
  if (headerCenters.length < MIN_COLUMNS) return null;

  // 5. 把每个文本项归属到 (row, column)：列用「x 中心 vs 表头列中心最近」
  const cellMap = new Map<string, { text: string; x: number; y: number }>();
  for (const it of usable) {
    const row = rowIndexByY.get(rows[nearestCenter(it.y, rows)])!;
    const centerX = it.x + it.width / 2;
    const col = nearestCenter(centerX, headerCenters) + 1;
    const key = `${row}:${col}`;
    const existing = cellMap.get(key);
    if (existing) {
      existing.text = `${existing.text} ${it.str}`.trim();
    } else {
      cellMap.set(key, { text: it.str.trim(), x: it.x, y: it.y });
    }
  }

  // 6. 表头文本：每个列在表头区域内所有行的文本合并（多级表头拼成完整表头名）
  const headerTextByCol = new Map<number, string>();
  for (const [key, cell] of cellMap) {
    const [r, c] = key.split(':').map(Number);
    if (headerZoneRows.has(r)) {
      const prev = headerTextByCol.get(c);
      headerTextByCol.set(c, prev ? `${prev} ${cell.text}`.trim() : cell.text);
    }
  }
  const headers: Array<{ column: number; text: string }> = [...headerTextByCol.entries()]
    .map(([column, text]) => ({ column, text }))
    .sort((a, b) => a.column - b.column);
  if (headers.length < MIN_COLUMNS) return null;

  const cells: DetectedCell[] = [];
  for (const [key, cell] of cellMap) {
    const [r, c] = key.split(':').map(Number);
    if (headerZoneRows.has(r)) continue; // 表头区域不产出数据 cell
    cells.push({ row: r, column: c, text: cell.text, x: cell.x, y: cell.y });
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);

  return {
    sheet: `page-${page}`,
    headerRow,
    headers,
    cells,
    columns: headerCenters,
  };
}

/** 把还原结果转成标准 ParsedBlock[] + TableHeaderCandidate[] */
export function tableToParsedBlocks(
  table: DetectedTable,
): { blocks: ParsedBlock[]; tableHeaders: TableHeaderCandidate[] } {
  const blocks: ParsedBlock[] = [];
  for (const cell of table.cells) {
    const locator: DocumentLocator = {
      kind: 'worksheet',
      sheet: table.sheet,
      row: cell.row,
      column: cell.column,
      cell: cellAddress(cell.row, cell.column),
    };
    blocks.push({
      kind: 'table-cell',
      text: cell.text,
      locator,
      rawValue: cell.text,
      displayValue: cell.text,
    });
  }

  const tableHeaders: TableHeaderCandidate[] = [
    {
      sheet: table.sheet,
      headerRow: table.headerRow,
      columns: table.headers.map((h) => ({
        column: h.column,
        cell: cellAddress(table.headerRow, h.column),
        headerText: h.text,
        suggestedField: suggestField(h.text),
      })),
    },
  ];

  return { blocks, tableHeaders };
}
