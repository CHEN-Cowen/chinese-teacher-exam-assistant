/**
 * v7.2 附件解析：电子表格解析器测试（XLSX/XLSB/ET、多表、合并单元格、
 * 日期与数字格式、公式、压缩炸弹预算、损坏文件）。
 *
 * M04/F6：资源边界测试（真实单元格驱动迭代、全空 !ref 跳过、跨度守卫、
 * 合并展开预算、墙钟时长）。极端工作簿无法经真实 XLSX.write 构造
 * （写出端同样按范围迭代会挂死），通过 spy XLSX.read 注入内存工作簿
 * 验证解析器自身逻辑；正常表格回归用真实字节 fixture。
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { GuardError, readParseLimits } from '../parse-guard.js';
import { SpreadsheetDocumentParser } from './spreadsheet-document.parser.js';
import {
  buildEtFixture,
  buildXlsbFixture,
  buildXlsxFixture,
} from '../testing/fixture-builders.js';

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn(actual.read) };
});

const limits = readParseLimits({});

function input(bytes: Buffer, ext: string) {
  return {
    snapshotId: 'snap-xls-1',
    sourceUrl: `https://example.gov.cn/positions.${ext}`,
    storageKey: 'snapshots/ab/abc',
    contentHash: 'abc',
    declaredMime: 'application/octet-stream',
    declaredExtension: ext,
    bytes,
  };
}

describe.each([
  ['xlsx', buildXlsxFixture],
  ['xlsb', buildXlsbFixture],
  ['et', buildEtFixture],
])('SpreadsheetDocumentParser（.%s）', (ext, build) => {
  it('解析多工作表并记录工作表/行/列/单元格定位', async () => {
    const doc = await new SpreadsheetDocumentParser(limits).parse(input(build(), ext));
    expect(doc.format).toBe('spreadsheet');
    expect(doc.sheetCount).toBe(2);
    expect(doc.blocks.length).toBeGreaterThan(0);
    const cells = doc.blocks.filter((b) => b.locator.kind === 'worksheet');
    const sheets = new Set(cells.map((b) => (b.locator as { sheet: string }).sheet));
    expect(sheets.has('Positions')).toBe(true);
    expect(sheets.has('Schedule')).toBe(true);
    const first = cells[0];
    expect(first.locator).toMatchObject({
      kind: 'worksheet',
      row: expect.any(Number),
      column: expect.any(Number),
      cell: expect.stringMatching(/^[A-Z]+\d+$/),
    });
  });

  it('原始值与展示值都保留（日期/数字格式不破坏解析）', async () => {
    const doc = await new SpreadsheetDocumentParser(limits).parse(input(build(), ext));
    const raws = doc.blocks.filter((b) => b.rawValue !== undefined);
    expect(raws.length).toBeGreaterThan(0);
    const schedule = doc.blocks.filter(
      (b) => b.locator.kind === 'worksheet' && (b.locator as { sheet: string }).sheet === 'Schedule',
    );
    expect(schedule.some((b) => b.text.includes('2026'))).toBe(true);
  });

  it('合并单元格只取左上角并告警；表头候选给出确定性建议字段', async () => {
    const doc = await new SpreadsheetDocumentParser(limits).parse(input(build(), ext));
    // 合并 A1:B1 → 合并告警
    expect(doc.warnings.some((w) => w.includes('合并单元格'))).toBe(true);
    // 表头候选：学历/专业列
    const headers = doc.tableHeaders ?? [];
    expect(headers.length).toBeGreaterThan(0);
    const suggested = headers
      .flatMap((h) => h.columns.map((c) => c.suggestedField))
      .filter(Boolean);
    expect(suggested).toContain('education');
    expect(suggested).toContain('major');
  });

  it('公式单元格不重新求值：缓存值保留；xlsx 场景登记公式告警', async () => {
    // SheetJS 社区版写入端仅 xlsx 保留公式字段；xlsb/BIFF8 写入时公式退化为缓存值，
    // 因此 xlsb/et 场景验证"缓存值保留"，公式告警路径由 xlsx 覆盖。
    const doc = await new SpreadsheetDocumentParser(limits).parse(input(build(), ext));
    const f3 = doc.blocks.find(
      (b) => b.locator.kind === 'worksheet' && (b.locator as { cell?: string }).cell === 'F3',
    );
    expect(f3?.rawValue).toBe('7');
    if (ext === 'xlsx') {
      expect(doc.warnings.some((w) => w.includes('公式'))).toBe(true);
    }
  });
});

describe('SpreadsheetDocumentParser（异常与防护）', () => {
  it('损坏/加密字节 → CORRUPT_FILE（失败不覆盖旧数据）', async () => {
    // OLE2 魔数 + 非法内容
    const junk = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from([0xff, 0x00, 0x13, 0x37, 0x00, 0x42]),
    ]);
    await expect(
      new SpreadsheetDocumentParser(limits).parse(input(junk, 'xls')),
    ).rejects.toMatchObject({ name: 'GuardError', code: 'CORRUPT_FILE' } as Partial<GuardError>);
  });

  it('压缩炸弹：单元格预算超限立即终止（CELL_BUDGET_EXCEEDED）', async () => {
    const tinyLimits = { ...limits, maxCells: 3 };
    await expect(
      new SpreadsheetDocumentParser(tinyLimits).parse(input(buildXlsxFixture(), 'xlsx')),
    ).rejects.toMatchObject({
      name: 'GuardError',
      code: 'CELL_BUDGET_EXCEEDED',
    } as Partial<GuardError>);
  });

  it('工作表数量上限截断并告警', async () => {
    const tinyLimits = { ...limits, maxSheets: 1 };
    const doc = await new SpreadsheetDocumentParser(tinyLimits).parse(input(buildXlsxFixture(), 'xlsx'));
    expect(doc.sheetCount).toBe(1);
    expect(doc.warnings.some((w) => w.includes('工作表数量超过上限'))).toBe(true);
  });
});

/**
 * M04/F6：资源边界。
 * 极端工作簿经 spy XLSX.read 注入（真实写出端按范围迭代无法构造），
 * 断言解析器自身按真实单元格驱动、快速终止并产出可理解告警。
 */
describe('SpreadsheetDocumentParser 资源边界（M04/F6）', () => {
  type FakeCell = { t: string; v: string };
  type FakeSheet = Record<string, unknown>;
  function injectWorkbook(sheets: Record<string, FakeSheet>): void {
    const wb = { SheetNames: Object.keys(sheets), Sheets: sheets };
    vi.mocked(XLSX.read).mockImplementationOnce(() => wb as never);
  }
  function cell(text: string): FakeCell {
    return { t: 's', v: text };
  }

  it('远距离两个真实单元格（5 万行 × 500 列跨度内）按真实地址快速完成', async () => {
    injectWorkbook({
      Positions: {
        '!ref': 'A1:SF50000',
        A1: cell('招聘单位'),
        SF50000: cell('岗位X'),
      },
    });
    const started = performance.now();
    const doc = await new SpreadsheetDocumentParser(limits).parse(input(buildXlsxFixture(), 'xlsx'));
    const elapsedMs = performance.now() - started;
    // 旧矩形扫描需访问 50_000 × 500 = 2500 万地址；真实单元格驱动只访问 2 格
    expect(elapsedMs).toBeLessThan(3_000);
    const cells = doc.blocks.filter((b) => b.kind === 'table-cell');
    expect(cells).toHaveLength(2);
    expect(cells.map((b) => (b.locator as { cell: string }).cell).sort()).toEqual([
      'A1',
      'SF50000',
    ]);
    console.info(`[M04证据] 远距离单元格解析耗时 ${elapsedMs.toFixed(1)}ms`);
  });

  it('全空虚大 !ref（A1:XFD1048576 无内容）→ 跳过该表并告警，不矩形扫描', async () => {
    injectWorkbook({
      Empty: { '!ref': 'A1:XFD1048576' },
    });
    await expect(
      new SpreadsheetDocumentParser(limits).parse(input(buildXlsxFixture(), 'xlsx')),
    ).rejects.toMatchObject({
      name: 'GuardError',
      code: 'CORRUPT_FILE',
      message: expect.stringContaining('没有可读取的内容单元格'),
    } as Partial<GuardError>);
  });

  it('极端远距离单元格（超出 10 万行跨度）→ SHEET_SPAN_EXCEEDED 秒级转人工', async () => {
    injectWorkbook({
      Extreme: {
        '!ref': 'A1:XFD1048576',
        A1: cell('a'),
        XFD1048576: cell('b'),
      },
    });
    const started = performance.now();
    await expect(
      new SpreadsheetDocumentParser(limits).parse(input(buildXlsxFixture(), 'xlsx')),
    ).rejects.toMatchObject({
      name: 'GuardError',
      code: 'SHEET_SPAN_EXCEEDED',
      message: expect.stringContaining('转人工'),
    } as Partial<GuardError>);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(1_000);
    console.info(`[M04证据] 跨度守卫终止耗时 ${elapsedMs.toFixed(1)}ms`);
  });

  it('超大合并范围 → 只登记展开预算内覆盖并显式告警，值取左上角，解析不中断', async () => {
    injectWorkbook({
      Merged: {
        '!ref': 'A1:C3',
        '!merges': [{ s: { r: 0, c: 0 }, e: { r: 49_999, c: 499 } }],
        A1: cell('合并标题'),
        A2: cell('残留值A'),
        C3: cell('独立值'),
      },
    });
    const doc = await new SpreadsheetDocumentParser(limits).parse(input(buildXlsxFixture(), 'xlsx'));
    // 展开预算 100_000 < 50_000 × 500 合并跨度 → 显式告警而非逐格展开
    expect(
      doc.warnings.some((w) => w.includes('合并范围') && w.includes('未逐格登记覆盖')),
    ).toBe(true);
    const cells = doc.blocks.filter((b) => b.kind === 'table-cell');
    // 左上角 A1 出块；超预算的覆盖范围不登记 → A2/C3 按普通单元格出块
    expect(cells.length).toBe(3);
    expect(
      doc.warnings.some((w) => w.includes('合并单元格 A1:SF50000')),
    ).toBe(true);
  });

  it('墙钟超时 → PARSE_TIMEOUT（负值仅测试用于表示必然超时）', async () => {
    const zeroDeadlineLimits = { ...limits, timeoutMs: -1 };
    injectWorkbook({
      Positions: {
        '!ref': 'A1:B3',
        A1: cell('单位'),
        A2: cell('单位A'),
        A3: cell('单位B'),
      },
    });
    // 每张表开始时的检查点即超时（真实终止，不产出任何块）
    await expect(
      new SpreadsheetDocumentParser(zeroDeadlineLimits).parse(input(buildXlsxFixture(), 'xlsx')),
    ).rejects.toMatchObject({
      name: 'GuardError',
      code: 'PARSE_TIMEOUT',
    } as Partial<GuardError>);
  });
});
