/**
 * v7.2 附件解析：格式解析调度器测试（分发、Feature Flag、防护入口）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentParserService, GuardError } from './document-parser.service.js';
import { readParseLimits } from './parse-guard.js';
import { readFeatureFlags } from './feature-flags.js';
import {
  MALICIOUS_HTML,
  buildCorruptPdf,
  buildEtFixture,
  buildTextPdf,
  buildXlsxFixture,
} from './testing/fixture-builders.js';

const limits = readParseLimits({});

function input(bytes: Buffer, name = 'a.bin', mime = '') {
  return {
    snapshotId: 'snap-d-1',
    sourceUrl: `https://example.gov.cn/${name}`,
    storageKey: 'snapshots/ab/abc',
    contentHash: 'abc',
    declaredMime: mime,
    bytes,
  };
}

afterEach(() => {
  delete process.env.FEATURE_DOCX_PARSE;
});

describe('DocumentParserService（分发）', () => {
  it('HTML → HtmlDocumentParser（含恶意节点剥离）', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    const doc = await service.parse(input(Buffer.from(MALICIOUS_HTML, 'utf8'), 'a.html', 'text/html'));
    expect(doc.format).toBe('html');
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  it('XLSX / ET（OLE2）→ 电子表格解析器', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    const xlsx = await service.parse(input(buildXlsxFixture(), 'p.xlsx'));
    expect(xlsx.format).toBe('spreadsheet');
    const et = await service.parse(input(buildEtFixture(), 'p.et'));
    expect(et.format).toBe('spreadsheet');
  });

  it('PDF 文本层 → pdf；损坏 PDF → CORRUPT_FILE', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    const pdf = await service.parse(
      input(buildTextPdf(['Hangzhou 2026 teacher recruitment announcement with enough text content here.'])),
    );
    expect(pdf.format).toBe('pdf');
    await expect(service.parse(input(buildCorruptPdf(), 'x.pdf'))).rejects.toMatchObject({
      name: 'GuardError',
      code: 'CORRUPT_FILE',
    } as Partial<GuardError>);
  });

  it('未知格式（非法魔数）→ UNKNOWN_FORMAT', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    await expect(service.parse(input(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])))).rejects.toMatchObject({
      name: 'GuardError',
      code: 'UNKNOWN_FORMAT',
    } as Partial<GuardError>);
  });

  it('空文件 → EMPTY_FILE（防护先于解析）', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    await expect(service.parse(input(Buffer.alloc(0)))).rejects.toMatchObject({
      name: 'GuardError',
      code: 'EMPTY_FILE',
    } as Partial<GuardError>);
  });
});

describe('DocumentParserService（DOCX Feature Flag）', () => {
  /** 最小 DOCX 识别字节：ZIP 魔数 + word/document.xml 条目名 */
  const fakeDocx = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('word/document.xml', 'latin1'),
    Buffer.from('0'.repeat(64), 'latin1'),
  ]);

  it('默认关闭：DOCX → 待人工处理（不伪装成功）', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    const doc = await service.parse(input(fakeDocx, 'a.docx'));
    expect(doc.pendingManualReason).toContain('待人工处理');
    expect(doc.blocks).toHaveLength(0);
    expect(doc.format).toBe('docx');
  });

  it('开启后进入 DOCX 解析路径（本测试仅验证开关放行，解析本身依赖 Mammoth）', async () => {
    const service = new DocumentParserService({
      limits,
      flags: readFeatureFlags({ FEATURE_DOCX_PARSE: 'true' }),
    });
    // 伪 DOCX 不是合法 ZIP 文档：预期解析层报错（CORRUPT_FILE），但绝不能是"待人工"
    await expect(service.parse(input(fakeDocx, 'a.docx'))).rejects.toMatchObject({
      name: 'GuardError',
    } as Partial<GuardError>);
  }, 30_000); // Mammoth 首次动态加载在 Windows 并发下可能超过默认 5 秒
});
