/**
 * v7.2 附件解析：PDF 解析器测试（文本/多页/扫描件/加密/损坏/页数上限/坐标证据）。
 */
import { describe, expect, it } from 'vitest';
import { GuardError } from '../parse-guard.js';
import { readParseLimits } from '../parse-guard.js';
import { PdfDocumentParser } from './pdf-document.parser.js';
import {
  buildCorruptPdf,
  buildEncryptedPdf,
  buildMultiPagePdf,
  buildScannedPdf,
  buildTextPdf,
} from '../testing/fixture-builders.js';

const limits = readParseLimits({});
const parser = new PdfDocumentParser(limits);

function input(bytes: Buffer) {
  return {
    snapshotId: 'snap-pdf-1',
    sourceUrl: 'https://example.gov.cn/jj.pdf',
    storageKey: 'snapshots/ab/abc',
    contentHash: 'abc',
    declaredMime: 'application/pdf',
    declaredExtension: 'pdf',
    bytes,
  };
}

describe('PdfDocumentParser（文本层）', () => {
  it('提取文本行：块带页码与 bbox 定位（可回原文）', async () => {
    const doc = await parser.parse(
      input(buildTextPdf(['Hangzhou Municipal Education Bureau 2026 open teacher recruitment announcement', 'Education requirement: Bachelor degree or above, teacher qualification certificate required.'])),
    );
    expect(doc.format).toBe('pdf');
    expect(doc.scanned).toBe(false);
    expect(doc.pageCount).toBe(1);
    expect(doc.blocks.length).toBeGreaterThan(0);
    const first = doc.blocks[0];
    expect(first.locator.kind).toBe('pdf-text');
    if (first.locator.kind === 'pdf-text') {
      expect(first.locator.page).toBe(1);
      expect(first.locator.bbox).toBeDefined();
      expect(first.locator.textFragment.length).toBeGreaterThan(0);
    }
  });

  it('多页 PDF：逐页出块并记录页数', async () => {
    const doc = await parser.parse(input(buildMultiPagePdf()));
    expect(doc.pageCount).toBe(2);
    const pages = new Set(
      doc.blocks.map((b) => (b.locator.kind === 'pdf-text' ? b.locator.page : -1)),
    );
    expect(pages.has(1)).toBe(true);
    expect(pages.has(2)).toBe(true);
  });
});

describe('PdfDocumentParser（安全与异常）', () => {
  it('扫描件（无有效文本层 + 图片）→ scanned + OCR pending_manual（不伪装成功）', async () => {
    const doc = await parser.parse(input(buildScannedPdf()));
    expect(doc.scanned).toBe(true);
    expect(doc.ocr?.required).toBe(true);
    expect(doc.ocr?.status).toBe('pending_manual');
    expect(doc.warnings.some((w) => w.includes('扫描件') || w.includes('文本层'))).toBe(true);
  });

  it('加密 PDF → ENCRYPTED_PDF（待人工处理语义）', async () => {
    await expect(parser.parse(input(buildEncryptedPdf()))).rejects.toMatchObject({
      name: 'GuardError',
      code: 'ENCRYPTED_PDF',
    } as Partial<GuardError>);
  });

  it('损坏 PDF → CORRUPT_FILE', async () => {
    await expect(parser.parse(input(buildCorruptPdf()))).rejects.toMatchObject({
      name: 'GuardError',
      code: 'CORRUPT_FILE',
    } as Partial<GuardError>);
  });

  it('页数超上限 → TOO_MANY_PAGES（防护不产出半成品）', async () => {
    const tinyLimits = { ...limits, maxPdfPages: 1 };
    const parser1 = new PdfDocumentParser(tinyLimits);
    await expect(parser1.parse(input(buildMultiPagePdf()))).rejects.toMatchObject({
      name: 'GuardError',
      code: 'TOO_MANY_PAGES',
    } as Partial<GuardError>);
  });
});
