/**
 * v7.2 附件解析：文件格式检测（magic bytes 优先）。
 *
 * 规则（用户要求：使用 magic bytes 判断格式）：
 * - 先看文件头魔数，再看声明扩展名/MIME；
 * - 三者交叉校验，不一致时给出明确结论，绝不仅凭扩展名采信；
 * - ZIP 容器进一步区分 xlsx（xl/workbook.xml）、xlsb（xl/workbook.bin）、
 *   docx（word/document.xml）；OLE2 容器视为 xls/et 家族（交由解析器验证）。
 */

import type { DocumentFormat } from './parsed-document.js';

export interface DetectedFormat {
  format: DocumentFormat;
  /** 规范化 MIME（用于快照与审计） */
  mime: string;
  detectedBy: 'magic-bytes' | 'unknown';
  /** magic bytes 与声明扩展名/MIME 不一致时的告警 */
  mismatchWarning?: string;
}

/** OLE2 复合文档魔数（XLS/DOC/旧版 ET 等） */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

export function extensionOf(nameOrUrl: string): string {
  try {
    const path = nameOrUrl.startsWith('http')
      ? new URL(nameOrUrl).pathname
      : nameOrUrl;
    const base = path.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    if (dot < 0) return '';
    return base.slice(dot + 1).toLowerCase();
  } catch {
    return '';
  }
}

/** 在 ZIP 条目目录中查找文件名（buffer 内直接搜字符串，避免整包解压） */
function zipContainsEntry(buf: Buffer, entry: string): boolean {
  // 中央目录位于文件尾；直接全文搜索足以覆盖本地头+中央目录两处
  return buf.includes(Buffer.from(entry, 'latin1'));
}

/** 按文件头判定格式；无法判定返回 unknown */
export function detectFormat(buf: Buffer): DetectedFormat {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { format: 'pdf', mime: 'application/pdf', detectedBy: 'magic-bytes' };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE2_MAGIC)) {
    // OLE2：xls / 旧版 et / doc —— 具体由电子表格解析器尝试，失败再判 unsupported
    return { format: 'spreadsheet', mime: 'application/vnd.ms-excel', detectedBy: 'magic-bytes' };
  }
  if (
    buf.length >= 4 &&
    (buf.subarray(0, 4).equals(ZIP_MAGIC) || buf.subarray(0, 4).equals(ZIP_EMPTY_MAGIC))
  ) {
    if (zipContainsEntry(buf, 'xl/workbook.bin')) {
      return {
        format: 'spreadsheet',
        mime: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
        detectedBy: 'magic-bytes',
      };
    }
    if (zipContainsEntry(buf, 'xl/workbook.xml')) {
      return {
        format: 'spreadsheet',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        detectedBy: 'magic-bytes',
      };
    }
    if (zipContainsEntry(buf, 'word/document.xml')) {
      return {
        format: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        detectedBy: 'magic-bytes',
      };
    }
    // 未知 ZIP（可能是压缩包伪装成文档）：不是受支持的文档格式
    return { format: 'unknown', mime: 'application/zip', detectedBy: 'magic-bytes' };
  }
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<')) {
    return { format: 'html', mime: 'text/html', detectedBy: 'magic-bytes' };
  }
  return { format: 'unknown', mime: 'application/octet-stream', detectedBy: 'unknown' };
}

export interface FormatCheckInput {
  bytes: Buffer;
  declaredMime: string;
  /** 来源 URL 或文件名（取扩展名） */
  sourceName: string;
}

/**
 * 完整格式判定：magic bytes 为主，交叉校验扩展名与声明 MIME。
 * 扩展名/MIME 不一致只告警不阻断（以 magic bytes 为准）；
 * 但"声明为文类、magic bytes 判定为另一文档类"时同样只告警——最终以检测为准。
 */
export function detectDocumentFormat(input: FormatCheckInput): DetectedFormat {
  const detected = detectFormat(input.bytes);
  const ext = extensionOf(input.sourceName);
  const extFormat: Record<string, DocumentFormat> = {
    html: 'html',
    htm: 'html',
    pdf: 'pdf',
    xls: 'spreadsheet',
    xlsx: 'spreadsheet',
    xlsb: 'spreadsheet',
    et: 'spreadsheet',
    docx: 'docx',
  };
  const declaredFormat = extFormat[ext];

  let mismatchWarning: string | undefined;
  if (detected.format !== 'unknown' && declaredFormat && detected.format !== declaredFormat) {
    mismatchWarning = `扩展名（.${ext}）与文件魔数判定（${detected.format}）不一致，已按魔数处理`;
  }
  const declaredMime = (input.declaredMime || '').split(';')[0].trim().toLowerCase();
  if (
    detected.format !== 'unknown' &&
    declaredMime &&
    declaredMime !== 'application/octet-stream' &&
    !isCompatibleMime(detected.format, declaredMime)
  ) {
    mismatchWarning =
      (mismatchWarning ? `${mismatchWarning}；` : '') +
      `声明 Content-Type（${declaredMime}）与文件魔数判定（${detected.mime}）不一致，已按魔数处理`;
  }
  return { ...detected, mismatchWarning };
}

function isCompatibleMime(format: DocumentFormat, mime: string): boolean {
  switch (format) {
    case 'html':
      return mime.startsWith('text/html') || mime.startsWith('application/xhtml');
    case 'pdf':
      return mime === 'application/pdf';
    case 'spreadsheet':
      return (
        mime.includes('excel') ||
        mime.includes('spreadsheet') ||
        mime === 'application/zip' ||
        mime === 'application/octet-stream' ||
        mime.startsWith('application/kset')
      );
    case 'docx':
      return mime.includes('wordprocessing');
    default:
      return true;
  }
}
