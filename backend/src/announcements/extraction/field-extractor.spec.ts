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

  it('多行岗位表逐行抽取：每一行产出独立 job scope，不再只抽首行', () => {
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
    // 两行数据，两个不同 job scope
    const eduFields = result.fields.filter((f) => f.field === 'education');
    expect(eduFields).toHaveLength(2);
    const scopes = eduFields.map((f) => f.jobScope?.key);
    expect(new Set(scopes).size).toBe(2);
    expect(eduFields.map((f) => f.value).sort()).toEqual(['本科', '硕士']);
    // 不再产生"只抽首行"的误导 warning
    expect(result.warnings.some((w) => w.includes('只抽首行') || w.includes('已抽取首行'))).toBe(false);
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

// ==================== WB2：多岗位逐行抽取 ====================

describe('WB2 多岗位逐行抽取', () => {
  const cell = (sheet: string, row: number, column: number, text: string): ParsedBlock =>
    block(text, { kind: 'worksheet', sheet, row, column, cell: `R${row}C${column}` });

  /** 构造含岗位编号+岗位名称+专业+学历+人数的两行岗位表 */
  function twoJobDoc(extraBlocks: ParsedBlock[] = [], extraHeaders: TableHeaderCandidate[] = []): ParsedDocument {
    const headers: TableHeaderCandidate[] = [
      {
        sheet: '岗位表',
        headerRow: 1,
        columns: [
          { column: 1, cell: 'A1', headerText: '岗位编号', suggestedField: 'job_code' },
          { column: 2, cell: 'B1', headerText: '岗位名称', suggestedField: 'position_name' },
          { column: 3, cell: 'C1', headerText: '专业', suggestedField: 'major' },
          { column: 4, cell: 'D1', headerText: '学历', suggestedField: 'education' },
          { column: 5, cell: 'E1', headerText: '人数', suggestedField: 'headcount' },
        ],
      },
      ...extraHeaders,
    ];
    const blocks: ParsedBlock[] = [
      cell('岗位表', 1, 1, '岗位编号'),
      cell('岗位表', 1, 2, '岗位名称'),
      cell('岗位表', 1, 3, '专业'),
      cell('岗位表', 1, 4, '学历'),
      cell('岗位表', 1, 5, '人数'),
      cell('岗位表', 2, 1, '3301A01'),
      cell('岗位表', 2, 2, '语文教师'),
      cell('岗位表', 2, 3, '汉语言文学（师范）'),
      cell('岗位表', 2, 4, '本科及以上'),
      cell('岗位表', 2, 5, '2'),
      cell('岗位表', 3, 1, '3301A02'),
      cell('岗位表', 3, 2, '数学教师'),
      cell('岗位表', 3, 3, '数学与应用数学'),
      cell('岗位表', 3, 4, '硕士研究生及以上'),
      cell('岗位表', 3, 5, '1'),
      ...extraBlocks,
    ];
    return doc(blocks, headers);
  }

  it('两个岗位行产生两个不同 scope，且岗位编号作为业务属性保留', () => {
    const result = extractFields(twoJobDoc());
    const jobFields = result.fields.filter((f) => f.scope === 'job');
    const keys = new Set(jobFields.map((f) => f.jobScope?.key));
    expect(keys.size).toBe(2);
    const codes = jobFields
      .filter((f) => f.field === 'job_code')
      .map((f) => f.value);
    expect(codes.sort()).toEqual(['3301A01', '3301A02']);
  });

  it('两个岗位的 major/education/headcount 不互相覆盖', () => {
    const result = extractFields(twoJobDoc());
    const majors = result.fields.filter((f) => f.field === 'major').map((f) => f.value).sort();
    const edus = result.fields.filter((f) => f.field === 'education').map((f) => f.value).sort();
    const counts = result.fields.filter((f) => f.field === 'headcount').map((f) => f.value).sort();
    expect(majors).toEqual(['数学与应用数学', '汉语言文学（师范）']);
    expect(edus).toEqual(['本科及以上', '硕士研究生及以上']);
    expect(counts).toEqual(['1', '2']);
  });

  it('第二行不再被丢弃（headcount 两行都在）', () => {
    const result = extractFields(twoJobDoc());
    expect(result.fields.filter((f) => f.field === 'headcount')).toHaveLength(2);
  });

  it('公共报名时间保持 announcement scope，不被误绑定到岗位', () => {
    const parsed = twoJobDoc([
      block('报名时间：2026年10月1日至2026年10月7日。', {
        kind: 'pdf-text',
        page: 1,
        textFragment: '报名时间',
      }),
    ]);
    const result = extractFields(parsed);
    const reg = result.fields.find((f) => f.field === 'registration_time');
    expect(reg).toBeTruthy();
    expect(reg!.scope).toBe('announcement');
    expect(reg!.jobScope).toBeUndefined();
    // 且报名时间只出现一次，不复制成每岗位一份
    expect(result.fields.filter((f) => f.field === 'registration_time')).toHaveLength(1);
  });

  it('同 scope 同 field 不同值 → conflict，保留 alternatives 及各自证据', () => {
    // 构造同 sheet 两行岗位编号相同（同 job scope），但专业不同 → 冲突
    const parsed = twoJobDoc([
      cell('岗位表', 4, 1, '3301A01'), // 与第 2 行同岗位编号
      cell('岗位表', 4, 3, '汉语言文学'),
    ]);
    const result = extractFields(parsed);
    const conflicts = result.fields.filter((f) => f.status === 'conflict' && f.field === 'major');
    // 找到 jobCode=3301A01 的冲突
    const conflict = conflicts.find((f) => f.jobScope?.jobCode === '3301A01');
    expect(conflict).toBeTruthy();
    expect(conflict!.alternatives).toBeTruthy();
    expect(conflict!.alternatives!.map((a) => a.value).sort()).toEqual(
      expect.arrayContaining(['汉语言文学（师范）', '汉语言文学']),
    );
  });

  it('相同值重复来源不膨胀成多个岗位', () => {
    // 两行岗位编号相同、专业相同 → 同 scope 同 field 同值 → 去重
    const parsed = twoJobDoc([
      cell('岗位表', 4, 1, '3301A01'),
      cell('岗位表', 4, 3, '汉语言文学（师范）'),
    ]);
    const result = extractFields(parsed);
    const major3301A01 = result.fields.filter(
      (f) => f.field === 'major' && f.jobScope?.jobCode === '3301A01',
    );
    // 相同值去重后只保留一个 major
    expect(major3301A01).toHaveLength(1);
    expect(major3301A01[0]!.value).toBe('汉语言文学（师范）');
  });

  it('两个 sheet 使用各自表头和数据行，不跨 sheet 复用', () => {
    const parsed = twoJobDoc(
      [
        cell('Sheet2', 1, 1, '专业'),
        cell('Sheet2', 2, 1, '英语'),
      ],
      [
        {
          sheet: 'Sheet2',
          headerRow: 1,
          columns: [{ column: 1, cell: 'A1', headerText: '专业', suggestedField: 'major' }],
        },
      ],
    );
    const result = extractFields(parsed);
    const majors = result.fields.filter((f) => f.field === 'major').map((f) => f.value);
    // Sheet2 的英语也进来了，且不与 Sheet1 的岗位混
    expect(majors).toEqual(expect.arrayContaining(['英语', '汉语言文学（师范）', '数学与应用数学']));
    // Sheet2 的 major 有自己的 job scope（row=2，sheet=Sheet2）
    const english = result.fields.find((f) => f.field === 'major' && f.value === '英语');
    expect(english!.jobScope?.sheet).toBe('Sheet2');
    expect(english!.jobScope?.row).toBe(2);
  });

  it('空行、说明行、重复表头行有明确 warning 且不产出字段', () => {
    const parsed = twoJobDoc([
      // 空行（第 4 行所有映射列无值）
      cell('岗位表', 4, 1, ''),
      cell('岗位表', 4, 3, ''),
      // 说明行（第 5 行只有非映射列的说明文字）
      cell('岗位表', 5, 1, '说明：以上岗位均需体检'),
      // 重复表头行（第 6 行）
      cell('岗位表', 6, 1, '岗位编号'),
      cell('岗位表', 6, 3, '专业'),
      cell('岗位表', 6, 4, '学历'),
    ]);
    const result = extractFields(parsed);
    expect(result.warnings.some((w) => w.includes('空行'))).toBe(true);
    // 说明行命中「未命中表头」或「说明行（岗位编号列含说明关键词）」两种之一
    expect(
      result.warnings.some((w) => w.includes('未命中任何表头字段') || w.includes('说明行')),
    ).toBe(true);
    expect(result.warnings.some((w) => w.includes('重复表头'))).toBe(true);
    // 说明行的文字不进入字段
    expect(result.fields.some((f) => f.value.includes('以上岗位均需体检'))).toBe(false);
  });

  it('每个岗位字段能回到准确 cell', () => {
    const result = extractFields(twoJobDoc());
    const edu3301A01 = result.fields.find(
      (f) => f.field === 'education' && f.jobScope?.jobCode === '3301A01',
    );
    expect(edu3301A01!.anchor!.locator).toMatchObject({
      kind: 'worksheet',
      sheet: '岗位表',
      cell: 'R2C4',
    });
  });
});
