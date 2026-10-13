/**
 * v7.2 附件解析：电子表格解析器测试（XLSX/XLSB/ET、多表、合并单元格、
 * 日期与数字格式、公式、压缩炸弹预算、损坏文件）。
 */
import { describe, expect, it } from 'vitest';
import { GuardError, readParseLimits } from '../parse-guard.js';
import { SpreadsheetDocumentParser } from './spreadsheet-document.parser.js';
import {
  buildEtFixture,
  buildXlsbFixture,
  buildXlsxFixture,
} from '../testing/fixture-builders.js';

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
