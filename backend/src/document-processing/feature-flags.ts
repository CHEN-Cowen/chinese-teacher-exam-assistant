/**
 * v7.2.2 按需能力开关：DOCX 解析与 OCR。
 *
 * 原则（用户要求）：
 * - 未正式启用时使用 Feature Flag，结果标记"待人工处理"，不能伪装成功；
 * - OCR 只在没有有效文本层时触发；
 * - OCR/对象存储凭证只放服务端环境变量。
 */

export interface FeatureFlags {
  /** DOCX 解析（Mammoth）；默认关闭（v7.2.1 范围外） */
  docxParseEnabled: boolean;
  /** OCR 解析；默认关闭 */
  ocrParseEnabled: boolean;
}

export interface OcrConfig {
  /** OCR 供应商服务版本（写入证据 locator） */
  serviceVersion: string;
  /** 低置信度阈值：低于该值的结果强制人工确认 */
  lowConfidenceThreshold: number;
}

export function readFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return {
    docxParseEnabled: env.FEATURE_DOCX_PARSE === 'true',
    ocrParseEnabled: env.FEATURE_OCR_PARSE === 'true',
  };
}

export function readOcrConfig(env: NodeJS.ProcessEnv = process.env): OcrConfig {
  const threshold = Number(env.OCR_LOW_CONFIDENCE_THRESHOLD);
  return {
    serviceVersion: env.OCR_SERVICE_VERSION ?? 'pending-provider',
    lowConfidenceThreshold:
      Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : 0.8,
  };
}
