/**
 * v7.2 附件解析：格式检测（magic bytes 优先）测试。
 * 覆盖：各格式魔数识别、扩展名/MIME 不一致告警、相同哈希判定一致、未知格式。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  detectDocumentFormat,
  detectFormat,
  extensionOf,
} from './format-detector.js';
import {
  buildEtFixture,
  buildTextPdf,
  buildXlsbFixture,
  buildXlsxFixture,
} from './testing/fixture-builders.js';

describe('detectFormat（magic bytes）', () => {
  it('文本 PDF：识别为 pdf', () => {
    const detected = detectFormat(buildTextPdf(['Hello Hangzhou 2026 teacher recruitment announcement content']));
    expect(detected.format).toBe('pdf');
    expect(detected.mime).toBe('application/pdf');
    expect(detected.detectedBy).toBe('magic-bytes');
  });

  it('XLSX（ZIP 容器）→ spreadsheet；XLSB（workbook.bin）→ spreadsheet', () => {
    expect(detectFormat(buildXlsxFixture()).format).toBe('spreadsheet');
    expect(detectFormat(buildXlsbFixture()).format).toBe('spreadsheet');
  });

  it('ET（BIFF8/OLE2 魔数）→ spreadsheet', () => {
    const detected = detectFormat(buildEtFixture());
    expect(detected.format).toBe('spreadsheet');
    expect(detected.mime).toBe('application/vnd.ms-excel');
  });

  it('HTML 文本 → html；随机字节 → unknown', () => {
    expect(detectFormat(Buffer.from('<!doctype html><html></html>')).format).toBe('html');
    expect(detectFormat(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])).format).toBe('unknown');
  });

  it('错误扩展名/MIME 不改变 magic bytes 结论（同一内容判定一致）', () => {
    const pdfBytes = buildTextPdf(['Education requirement: Bachelor degree or above. Registration time October 1 to October 7, 2026.']);
    const hash1 = createHash('sha256').update(pdfBytes).digest('hex');
    const hash2 = createHash('sha256').update(pdfBytes).digest('hex');
    expect(hash1).toBe(hash2); // 相同哈希
    expect(detectFormat(pdfBytes).format).toBe('pdf');
  });
});

describe('detectDocumentFormat（交叉校验）', () => {
  it('扩展名与魔数不一致 → 告警并按魔数处理', () => {
    const detected = detectDocumentFormat({
      bytes: buildXlsxFixture(),
      declaredMime: '',
      sourceName: 'https://example.gov.cn/attachment.pdf',
    });
    expect(detected.format).toBe('spreadsheet');
    expect(detected.mismatchWarning).toContain('.pdf');
  });

  it('声明 MIME 与魔数不一致 → 告警（错误 MIME 只告警不阻断）', () => {
    const detected = detectDocumentFormat({
      bytes: buildTextPdf(['Hangzhou teacher recruitment 2026 content with more than sixty characters in this line of text here.']),
      declaredMime: 'application/msword',
      sourceName: 'a.pdf',
    });
    expect(detected.format).toBe('pdf');
    expect(detected.mismatchWarning).toContain('application/msword');
  });

  it('一致时无告警', () => {
    const detected = detectDocumentFormat({
      bytes: buildXlsxFixture(),
      declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sourceName: 'positions.xlsx',
    });
    expect(detected.mismatchWarning).toBeUndefined();
  });

  it('extensionOf 从 URL 取扩展名', () => {
    expect(extensionOf('https://a.gov.cn/x/y.xls?token=1')).toBe('xls');
    expect(extensionOf('no-ext')).toBe('');
  });
});
