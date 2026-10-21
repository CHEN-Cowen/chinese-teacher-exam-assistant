/**
 * 通用 PDF 表格还原器单元测试。
 *
 * 用真实黄金样本（南京市玄武区岗位表 PDF，2026-10-21 抓取）验证：
 * - 坐标聚类能识别多级表头（招聘单位 + 学科列 + 学历/电话等）；
 * - 数据行文本项能按 x 中心正确归属到列（招聘单位名 + 各学科人数）；
 * - 检测不到表格结构时返回 null（不伪造表格）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectPdfTable, tableToParsedBlocks, type PdfTextItem } from './pdf-table-detector.js';

function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'tests', 'fixtures', 'golden-sources', 'nanjing');
    if (readFileSafe(path.join(candidate, 'gw1.pdf')) !== null) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/nanjing 目录');
}

function readFileSafe(p: string): Buffer | null {
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

const GOLDEN_DIR = resolveGoldenDir();

/** 用 pdfjs 从 PDF 提取带坐标的文本项（与 parser 同一来源） */
async function loadPdfItems(pdfName: string): Promise<PdfTextItem[]> {
  const bytes = readFileSync(path.join(GOLDEN_DIR, pdfName));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  }).promise;
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const text = await page.getTextContent();
    for (const it of text.items) {
      const t = it as { str?: string; transform: number[]; width: number; height: number };
      if (typeof t.str !== 'string' || t.str.trim().length === 0) continue;
      items.push({
        page: p,
        x: t.transform[4],
        y: t.transform[5],
        width: t.width,
        height: t.height,
        str: t.str,
      });
    }
  }
  return items;
}

describe('pdf-table-detector（真实玄武岗位表 PDF）', () => {
  it('gw1 矩阵表：识别出招聘单位列 + 学科列（多级表头）', async () => {
    const table = detectPdfTable(await loadPdfItems('gw1.pdf'), 1);
    expect(table).not.toBeNull();
    const headerTexts = table!.headers.map((h) => h.text);
    // 一级表头「招聘单位」
    expect(headerTexts.some((t) => t.includes('招聘单位'))).toBe(true);
    // 二级表头学科列
    for (const subj of ['语文', '数学', '英语', '物理', '化学']) {
      expect(headerTexts.some((t) => t.includes(subj))).toBe(true);
    }
    // 其他一级表头
    expect(headerTexts.some((t) => t.includes('学历要求'))).toBe(true);
    expect(headerTexts.some((t) => t.includes('政策咨询电话'))).toBe(true);
  }, 60000);

  it('gw1 矩阵表：数据行的招聘单位名与其学科人数归属正确', async () => {
    const table = detectPdfTable(await loadPdfItems('gw1.pdf'), 1)!;
    const employerCol = table.headers.find((h) => h.text.includes('招聘单位'))?.column;
    expect(employerCol).toBeGreaterThan(0);
    // 「招聘单位」列内应含招聘单位名（如「南京市第九中学」作为独立 cell）
    const employerCells = table.cells.filter((c) => c.column === employerCol);
    expect(employerCells.length).toBeGreaterThan(0);
    expect(employerCells.some((c) => /中学|学校|学院/.test(c.text))).toBe(true);
    // 整表存在学科人数数字（纯数字 cell，代表各学科招聘人数）
    expect(table.cells.some((c) => /^\d+$/.test(c.text))).toBe(true);
  }, 60000);

  it('gw2 列表表：识别出序号/招聘单位/学科/人数列', async () => {
    const table = detectPdfTable(await loadPdfItems('gw2.pdf'), 1);
    expect(table).not.toBeNull();
    const headerTexts = table!.headers.map((h) => h.text);
    expect(headerTexts.some((t) => t.includes('序号'))).toBe(true);
    expect(headerTexts.some((t) => t.includes('招聘单位'))).toBe(true);
    expect(headerTexts.some((t) => t.includes('人数'))).toBe(true);
  }, 60000);

  it('无表格结构：单行文本不产出表格（返回 null）', () => {
    const items: PdfTextItem[] = [
      { page: 1, x: 100, y: 500, width: 50, height: 10, str: '这是一段普通正文，没有表格' },
      { page: 1, x: 100, y: 490, width: 50, height: 10, str: '继续正文内容' },
    ];
    expect(detectPdfTable(items, 1)).toBeNull();
  });

  it('tableToParsedBlocks：产出 worksheet locator 的 cell 块与表头候选', async () => {
    const table = detectPdfTable(await loadPdfItems('gw1.pdf'), 1)!;
    const { blocks, tableHeaders } = tableToParsedBlocks(table);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.locator.kind === 'worksheet')).toBe(true);
    expect(blocks.every((b) => b.locator.row >= 1 && b.locator.column >= 1)).toBe(true);
    expect(tableHeaders).toHaveLength(1);
    expect(tableHeaders[0].columns.length).toBeGreaterThan(0);
    expect(tableHeaders[0].headerRow).toBeGreaterThan(0);
  }, 60000);
});
