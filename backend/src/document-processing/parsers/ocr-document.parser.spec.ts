/**
 * v7.2.2 按需层：OCR 解析与 Feature Flag 测试。
 * 红线：未启用/供应商缺失 → 待人工处理，绝不伪装成功；低置信度必须人工确认。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFeatureFlags, readOcrConfig } from '../feature-flags.js';
import { DocumentParserService } from '../document-parser.service.js';
import { OcrDocumentParser, type OcrProvider } from './ocr-document.parser.js';
import { readParseLimits } from '../parse-guard.js';
import { buildScannedPdf } from '../testing/fixture-builders.js';

const limits = readParseLimits({});

function scannedInput() {
  return {
    snapshotId: 'snap-ocr-1',
    sourceUrl: 'https://example.gov.cn/scan.pdf',
    storageKey: 'snapshots/ab/abc',
    contentHash: 'abc',
    declaredMime: 'application/pdf',
    declaredExtension: 'pdf',
    bytes: buildScannedPdf(),
  };
}

const goodProvider: OcrProvider = {
  serviceVersion: 'ocr-test@1.0.0',
  recognize: async () => [
    {
      page: 1,
      lines: [
        {
          text: '学历要求：本科及以上',
          bbox: { x: 72, y: 700, width: 200, height: 14 },
          confidence: 0.95,
        },
        {
          text: '户籍要求：杭州市户籍',
          bbox: { x: 72, y: 680, width: 200, height: 14 },
          confidence: 0.5, // 低置信度
        },
      ],
    },
  ],
};

const failingProvider: OcrProvider = {
  serviceVersion: 'ocr-test@1.0.0',
  recognize: async () => {
    throw new Error('provider down');
  },
};

afterEach(() => {
  delete process.env.FEATURE_OCR_PARSE;
  delete process.env.FEATURE_DOCX_PARSE;
  delete process.env.OCR_LOW_CONFIDENCE_THRESHOLD;
});

describe('Feature Flags', () => {
  it('默认全部关闭（未正式启用不得伪装成功）', () => {
    const flags = readFeatureFlags({});
    expect(flags.docxParseEnabled).toBe(false);
    expect(flags.ocrParseEnabled).toBe(false);
  });

  it('显式开启才为 true', () => {
    expect(readFeatureFlags({ FEATURE_DOCX_PARSE: 'true' }).docxParseEnabled).toBe(true);
    expect(readFeatureFlags({ FEATURE_OCR_PARSE: 'true' }).ocrParseEnabled).toBe(true);
  });

  it('OCR 配置缺省回退 pending-provider / 0.8', () => {
    const config = readOcrConfig({});
    expect(config.serviceVersion).toBe('pending-provider');
    expect(config.lowConfidenceThreshold).toBe(0.8);
  });
});

describe('OcrDocumentParser', () => {
  it('供应商未接入 → pendingManual（blocks 为空，不伪造文本）', async () => {
    const doc = await new OcrDocumentParser(readOcrConfig({}), null, 200).parse(scannedInput());
    expect(doc.pendingManualReason).toBeTruthy();
    expect(doc.blocks).toHaveLength(0);
    expect(doc.ocr?.status).toBe('pending_manual');
  });

  it('成功识别：块保留页码/坐标/置信度/OCR 标记/服务版本', async () => {
    const doc = await new OcrDocumentParser(readOcrConfig({}), goodProvider, 200).parse(
      scannedInput(),
    );
    expect(doc.blocks.length).toBe(2);
    const locator = doc.blocks[0].locator;
    expect(locator).toMatchObject({
      kind: 'ocr',
      page: 1,
      confidence: 0.95,
      ocrMarked: true,
      serviceVersion: 'ocr-test@1.0.0',
    });
    if (locator.kind === 'ocr') {
      expect(locator.bbox).toEqual({ x: 72, y: 700, width: 200, height: 14 });
    }
  });

  it('低置信度行 → 告警"必须人工确认"（不自动发布）', async () => {
    const doc = await new OcrDocumentParser(readOcrConfig({}), goodProvider, 200).parse(
      scannedInput(),
    );
    expect(
      doc.warnings.some((w) => w.includes('人工确认') && w.includes('0.5')),
    ).toBe(true);
  });

  it('供应商故障 → 回退待人工处理（核心流程不依赖其实时可用性）', async () => {
    const doc = await new OcrDocumentParser(readOcrConfig({}), failingProvider, 200).parse(
      scannedInput(),
    );
    expect(doc.pendingManualReason).toBeTruthy();
    expect(doc.blocks).toHaveLength(0);
  });
});

describe('DocumentParserService（OCR 触发条件）', () => {
  it('OCR 未启用：扫描件 → pending_manual + pendingManualReason（诚实标记）', async () => {
    const service = new DocumentParserService({ limits, flags: readFeatureFlags({}) });
    const doc = await service.parse(scannedInput());
    expect(doc.pendingManualReason).toContain('人工处理');
    expect(doc.ocr?.status).toBe('pending_manual');
    expect(doc.blocks).toHaveLength(0);
  });

  it('OCR 启用且有供应商：扫描件 → OCR 解析成功（只在无有效文本层时触发）', async () => {
    const service = new DocumentParserService({
      limits,
      flags: readFeatureFlags({ FEATURE_OCR_PARSE: 'true' }),
      ocrProvider: goodProvider,
    });
    const doc = await service.parse(scannedInput());
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.ocr?.status).toBe('completed'); // OCR 成功路径
  });

  it('OCR 启用但供应商未接入：仍回退待人工处理', async () => {
    const service = new DocumentParserService({
      limits,
      flags: readFeatureFlags({ FEATURE_OCR_PARSE: 'true' }),
      ocrProvider: null,
    });
    const doc = await service.parse(scannedInput());
    expect(doc.pendingManualReason).toBeTruthy();
    expect(doc.ocr?.reason).toContain('待人工处理');
  });
});
