/**
 * v7.2 证据链：业务字段抽取器测试（表格列映射、文本规则、证据锚点、无证据不产出）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildAnchor,
  extractFields,
  prepareAutoCandidateFields,
} from './field-extractor.js';
import type { ParsedDocument, ParsedBlock, TableHeaderCandidate } from '../../document-processing/parsed-document.js';

function block(
  text: string,
  locator: ParsedBlock['locator'],
  extra: Partial<ParsedBlock> = {},
): ParsedBlock {
  return { kind: 'paragraph', text, locator, rawValue: text, displayValue: text, ...extra };
}

function doc(blocks: ParsedBlock[], tableHeaders?: TableHeaderCandidate[]): ParsedDocument {
  return {
    snapshotId: 'snap-1',
    sourceUrl: 'https://example.gov.cn/a.pdf',
    contentHash: 'hash-1',
    storageKey: 'snapshots/ha/hash-1',
    format: 'pdf',
    formatDetails: {
      detectedBy: 'magic-bytes',
      declaredMime: 'application/pdf',
      declaredExtension: 'pdf',
      detectedMime: 'application/pdf',
    },
    parserVersion: 'pdf-parser@1.0.0',
    blocks,
    ...(tableHeaders ? { tableHeaders } : {}),
    scanned: false,
    warnings: [],
  };
}

describe('extractFields（文本规则）', () => {
  it('报名/考试时间、学历、教资、年龄、户籍等字段带原文锚点', () => {
    const parsed = doc([
      block('报名时间：2026年10月1日至2026年10月7日。', {
        kind: 'pdf-text',
        page: 1,
        textFragment: '报名时间',
      }),
      block('笔试时间：2026年12月13日。', { kind: 'pdf-text', page: 1, textFragment: '笔试时间' }),
      block('学历要求：本科及以上，须具有教师资格证，年龄35周岁及以下，户籍不限。', {
        kind: 'pdf-text',
        page: 2,
        textFragment: '学历要求',
      }),
    ]);
    const result = extractFields(parsed);
    const byField = new Map(result.fields.map((f) => [f.field, f]));
    expect(byField.get('registration_time')?.value).toContain('2026年10月1日');
    expect(byField.get('exam_time')?.value).toBe('2026年12月13日');
    expect(byField.get('education')?.value).toBe('本科及以上');
    expect(byField.get('age')?.value).toContain('35周岁');
    expect(byField.get('hukou')).toBeTruthy();

    // 证据锚点：可回到原文（页码 + 快照 + 哈希 + 解析器版本）
    const education = byField.get('education')!;
    expect(education.anchor?.locator).toMatchObject({ kind: 'file', page: 2 });
    expect(education.anchor?.locatorData).toMatchObject({
      kind: 'pdf-text',
      page: 2,
      snapshotId: 'snap-1',
      contentHash: 'hash-1',
      storageKey: 'snapshots/ha/hash-1',
      parserVersion: 'pdf-parser@1.0.0',
    });
    expect(education.origin).toBe('rule');
  });

  it('规则字段一律带锚点（高影响字段无证据不能通过）', () => {
    const result = extractFields(
      doc([block('招聘50名教师。', { kind: 'excerpt', textFragment: '招聘50名' })]),
    );
    expect(result.fields.length).toBeGreaterThan(0);
    for (const field of result.fields) {
      expect(field.anchor).toBeTruthy();
    }
  });
});

describe('extractFields（表格列映射）', () => {
  it('表头建议字段映射到首个数据行，锚点为单元格定位', () => {
    const cell = (sheet: string, row: number, column: number, text: string): ParsedBlock =>
      block(text, {
        kind: 'worksheet',
        sheet,
        row,
        column,
        cell: `R${row}C${column}`,
      });
    const headers: TableHeaderCandidate[] = [
      {
        sheet: 'Positions',
        headerRow: 1,
        columns: [
          { column: 2, cell: 'B1', headerText: '岗位名称', suggestedField: 'position_name' },
          { column: 3, cell: 'C1', headerText: '学历要求', suggestedField: 'education' },
          { column: 4, cell: 'D1', headerText: '专业', suggestedField: 'major' },
        ],
      },
    ];
    const parsed = doc(
      [
        cell('Positions', 1, 2, '岗位名称'),
        cell('Positions', 2, 2, '语文教师'),
        cell('Positions', 2, 3, '本科及以上'),
        cell('Positions', 2, 4, '中国语言文学类'),
      ],
      headers,
    );
    const result = extractFields(parsed);
    const byField = new Map(result.fields.map((f) => [f.field, f]));
    expect(byField.get('education')?.value).toBe('本科及以上');
    expect(byField.get('major')?.value).toBe('中国语言文学类');
    const anchor = byField.get('education')!.anchor!;
    expect(anchor.locator).toMatchObject({
      kind: 'worksheet',
      sheet: 'Positions',
      cell: 'R2C3',
    });
    expect(anchor.locatorData).toMatchObject({ row: 2, column: 3, format: 'pdf' });
  });

  it('多行岗位表只抽首行并告警（行级拆分需人工处理）', () => {
    const cell = (row: number, column: number, text: string): ParsedBlock =>
      block(text, { kind: 'worksheet', sheet: 'S', row, column, cell: `R${row}C${column}` });
    const headers: TableHeaderCandidate[] = [
      {
        sheet: 'S',
        headerRow: 1,
        columns: [{ column: 1, cell: 'A1', headerText: '学历', suggestedField: 'education' }],
      },
    ];
    const result = extractFields(
      doc(
        [cell(1, 1, '学历'), cell(2, 1, '本科'), cell(3, 1, '硕士')],
        headers,
      ),
    );
    expect(result.warnings.some((w) => w.includes('2 行岗位数据'))).toBe(true);
    expect(result.fields.find((f) => f.field === 'education')?.value).toBe('本科');
  });
});

describe('prepareAutoCandidateFields（AI/OCR 候选整备）', () => {
  it('AI/OCR 字段一律标记 needsHumanConfirm（人工确认后才可发布）', () => {
    const prepared = prepareAutoCandidateFields([
      { field: 'education', value: '本科', origin: 'ai', anchor: { field: 'education', locator: { kind: 'excerpt', excerpt: 'x' } } },
      { field: 'title', value: '标题', origin: 'rule' },
      { field: 'major', value: '数学', origin: 'ocr', confidence: 0.5, anchor: { field: 'major', locator: { kind: 'excerpt', excerpt: 'y' } } },
    ]);
    const ai = prepared.find((f) => f.origin === 'ai')!;
    const ocr = prepared.find((f) => f.origin === 'ocr')!;
    expect(ai.needsHumanConfirm).toBe(true);
    expect(ocr.needsHumanConfirm).toBe(true);
    expect(prepared.find((f) => f.origin === 'rule')?.needsHumanConfirm).toBeUndefined();
  });
});

describe('buildAnchor', () => {
  it('locatorData 覆盖九要素（来源/快照/哈希/版本/定位）', () => {
    const parsed = doc([block('正文', { kind: 'html', selector: 'body > p', textFragment: '正文' })]);
    const anchor = buildAnchor(parsed.blocks[0], parsed, 'education');
    expect(anchor.locatorData).toMatchObject({
      kind: 'html',
      selector: 'body > p',
      snapshotId: 'snap-1',
      storageKey: 'snapshots/ha/hash-1',
      contentHash: 'hash-1',
      sourceUrl: 'https://example.gov.cn/a.pdf',
      format: 'pdf',
      parserVersion: 'pdf-parser@1.0.0',
    });
    expect(anchor.excerpt).toBe('正文');
  });
});
