/**
 * v7.2 证据链：确定性业务字段抽取器（层 4：招聘业务字段抽取）。
 *
 * 输入：文档解析层产出的标准文档（ParsedDocument）；
 * 输出：候选字段（CandidateField）+ 证据锚点（可回到原文的 locator）。
 *
 * 分层边界与红线：
 * - 本文件不做任何文件格式解析（那是 document-processing 的职责）；
 * - 高影响字段必须有原文证据（锚点）——无证据的字段直接丢弃并记录，绝不编造；
 * - 本层只产出候选（pending_review），发布必须经人工审核；
 * - AI/OCR 只能在本层之外以候选方式进入（见 ai-candidate.ts），
 *   且 origin=ai/ocr 的字段在人工确认前不能发布。
 */
import {
  type CandidateField,
  type EvidenceAnchorInput,
  type EvidenceLocator,
} from '../domain.js';
import type {
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
} from '../../document-processing/parsed-document.js';

export const FIELD_EXTRACTOR_VERSION = 'rule-field-extractor@1.0.0';

/** OCR 低置信度默认阈值（与 feature-flags 保持一致的兜底值） */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

const DATE_PATTERN =
  /(?:20\d{2}年)?\d{1,2}月\d{1,2}日(?:\s*[—\-–至到~]\s*(?:20\d{2}年)?\d{1,2}月\d{1,2}日)?/;

const EDUCATION_PATTERN = /(博士研究生|硕士研究生|博士|硕士|本科及以上|本科|大专及以上|大专|专科)/;

const RULES: Array<{
  field: string;
  /** 命中关键词（决定哪一块文本参与抽取） */
  match: (text: string) => boolean;
  /** 从命中文本中取值 */
  value: (text: string) => string;
}> = [
  {
    field: 'registration_time',
    match: (t) => /报名|注册|报考/.test(t) && DATE_PATTERN.test(t),
    value: (t) => t.match(DATE_PATTERN)?.[0] ?? '',
  },
  {
    field: 'exam_time',
    match: (t) => /笔试时间|考试时间|笔试定于|统一笔试/.test(t) && DATE_PATTERN.test(t),
    value: (t) => t.match(DATE_PATTERN)?.[0] ?? '',
  },
  {
    field: 'subjects',
    match: (t) => /《[^》]{1,20}》/.test(t),
    value: (t) => Array.from(new Set(t.match(/《[^》]{1,20}》/g) ?? [])).slice(0, 4).join('、'),
  },
  {
    field: 'headcount',
    match: (t) => /招聘[^\d]{0,8}\d+\s*(名|人)/.test(t),
    value: (t) => t.match(/招聘[^\d]{0,8}(\d+)\s*(名|人)/)?.[1] ?? '',
  },
  {
    field: 'education',
    match: (t) => EDUCATION_PATTERN.test(t),
    value: (t) => t.match(EDUCATION_PATTERN)?.[0] ?? '',
  },
  {
    field: 'major',
    match: (t) => /专业/.test(t),
    value: (t) => {
      const m =
        t.match(/(?:专业名称|专业)(?:要求|：|:|为)?\s*([^，。；、]{2,30})/) ??
        t.match(/专业不限/);
      return (m?.[1] ?? m?.[0] ?? '').trim();
    },
  },
  {
    field: 'age',
    match: (t) => /\d{2}\s*周岁/.test(t),
    value: (t) => t.match(/\d{2}\s*周岁(?:及以下|以下|及以上)?/)?.[0] ?? '',
  },
  {
    field: 'teacher_cert',
    match: (t) => /教师资格/.test(t),
    value: (t) => t.slice(0, 80),
  },
  {
    field: 'employment_nature',
    match: (t) => /事业编制|在编|编外|合同制|聘用制|劳务派遣|备案制/.test(t),
    value: (t) =>
      t.match(/事业编制|在编|编外|合同制|聘用制|劳务派遣|备案制/)?.[0] ?? '',
  },
  {
    field: 'hukou',
    match: (t) => /户籍|户口/.test(t),
    value: (t) => t.slice(0, 60),
  },
  {
    field: 'score',
    match: (t) => /满分|总分/.test(t),
    value: (t) => t.slice(0, 80),
  },
];

/** 抽取结果：字段 + 被丢弃的无证据内容 + 告警 */
export interface RuleExtractionResult {
  fields: CandidateField[];
  /** 无证据被丢弃的候选（审计用，绝不进入 fields） */
  dropped: Array<{ field: string; text: string; reason: string }>;
  warnings: string[];
}

/**
 * 从标准文档抽取候选字段。
 * 规则来源：块文本匹配（全文类）+ 表格表头候选映射（岗位表类）。
 */
export function extractFields(parsed: ParsedDocument): RuleExtractionResult {
  const fields: CandidateField[] = [];
  const dropped: RuleExtractionResult['dropped'] = [];
  const warnings: string[] = [];
  /** 同一字段先命中先用（避免重复） */
  const claimed = new Set<string>();

  // 1. 表格列语义（确定性表头映射 → 首个数据行；多行岗位表需人工确认行级拆分）
  const columnField = new Map<string, { field: string; headerRow: number }>();
  for (const th of parsed.tableHeaders ?? []) {
    for (const col of th.columns) {
      if (col.suggestedField) {
        columnField.set(`${th.sheet}:${col.column}`, {
          field: col.suggestedField,
          headerRow: th.headerRow,
        });
      }
    }
  }
  if (columnField.size > 0) {
    let dataRows = new Set<number>();
    for (const th of parsed.tableHeaders ?? []) {
      for (const block of parsed.blocks) {
        if (block.locator.kind === 'worksheet' && block.locator.sheet === th.sheet) {
          dataRows.add(block.locator.row);
        }
      }
    }
    for (const th of parsed.tableHeaders ?? []) {
      const rows = [...dataRows].filter((r) => r > th.headerRow).sort((a, b) => a - b);
      if (rows.length > 1) {
        warnings.push(
          `${th.sheet} 工作表包含 ${rows.length} 行岗位数据，已抽取首行（行级拆分需人工处理）`,
        );
      }
      const firstRow = rows[0];
      if (firstRow === undefined) continue;
      for (const block of parsed.blocks) {
        if (block.locator.kind !== 'worksheet') continue;
        if (block.locator.sheet !== th.sheet || block.locator.row !== firstRow) continue;
        const mapping = columnField.get(`${block.locator.sheet}:${block.locator.column}`);
        if (!mapping || claimed.has(mapping.field)) continue;
        const value = (block.displayValue ?? block.text).trim();
        if (!value) continue;
        claimed.add(mapping.field);
        fields.push({
          field: mapping.field,
          value,
          anchor: buildAnchor(block, parsed, mapping.field),
          origin: 'rule',
        });
      }
    }
  }

  // 2. 文本规则（全文类块）
  for (const block of parsed.blocks) {
    const text = blockText(block);
    if (!text) continue;
    for (const rule of RULES) {
      if (claimed.has(rule.field)) continue;
      if (!rule.match(text)) continue;
      const value = rule.value(text).trim();
      if (!value) continue;
      claimed.add(rule.field);
      fields.push({
        field: rule.field,
        value,
        anchor: buildAnchor(block, parsed, rule.field),
        origin: 'rule',
      });
    }
  }

  // 3. 高影响字段无证据 → 不能产出（防御性校验：规则字段都带锚点）
  for (const field of fields) {
    if (!field.anchor) {
      dropped.push({ field: field.field, text: field.value, reason: '缺少证据锚点' });
    }
  }
  const anchored = fields.filter((f) => f.anchor);
  if (anchored.length !== fields.length) {
    warnings.push('部分候选字段缺少证据锚点，已被丢弃（不进入审核）');
  }

  return { fields: anchored, dropped, warnings };
}

/** OCR/AI 候选进入候选列表前的整备：一律标记 needsHumanConfirm（人工确认后才可发布） */
export function prepareAutoCandidateFields(
  fields: CandidateField[],
  lowConfidenceThreshold = LOW_CONFIDENCE_THRESHOLD,
): CandidateField[] {
  return fields.map((f) => {
    if (f.origin !== 'ocr' && f.origin !== 'ai') return f;
    const low =
      typeof f.confidence === 'number' && f.confidence < lowConfidenceThreshold;
    return {
      ...f,
      needsHumanConfirm: true,
      ...(low ? { confidence: f.confidence } : {}),
    };
  });
}

/** 块文本：表格类用展示值（更接近公告原文写法） */
function blockText(block: ParsedBlock): string {
  if (block.locator.kind === 'worksheet') {
    return (block.displayValue ?? block.text).trim();
  }
  return block.text.trim();
}

/** 把标准文档定位映射为证据锚点（locatorData 保留全部回原文信息） */
export function buildAnchor(
  block: ParsedBlock,
  parsed: ParsedDocument,
  field: string,
): EvidenceAnchorInput {
  const locatorData = {
    ...block.locator,
    // 证据链回溯所需：原件位置 + 哈希 + 解析器版本
    snapshotId: parsed.snapshotId,
    storageKey: parsed.storageKey,
    contentHash: parsed.contentHash,
    sourceUrl: parsed.sourceUrl,
    format: parsed.format,
    parserVersion: parsed.parserVersion,
  };
  const excerpt = block.text.slice(0, 200);

  return {
    field,
    locator: toEvidenceLocator(block.locator, parsed),
    excerpt,
    locatorData,
  };
}

/** DocumentLocator → announcements EvidenceLocator（对齐 v6.1 前端类型） */
function toEvidenceLocator(
  locator: DocumentLocator,
  parsed: ParsedDocument,
): EvidenceLocator {
  const fileName = fileNameOf(parsed.sourceUrl) ?? parsed.storageKey;
  switch (locator.kind) {
    case 'pdf-text':
      return {
        kind: 'file',
        fileId: parsed.snapshotId,
        fileName,
        page: locator.page,
      };
    case 'ocr':
      return {
        kind: 'file',
        fileId: parsed.snapshotId,
        fileName,
        page: locator.page,
      };
    case 'worksheet':
      return {
        kind: 'worksheet',
        fileId: parsed.snapshotId,
        fileName,
        sheet: locator.sheet,
        cell: locator.cell,
      };
    case 'html':
      return {
        kind: 'url',
        url: parsed.sourceUrl ?? '',
        anchor: locator.selector,
      };
    case 'docx-paragraph':
    case 'excerpt':
      return { kind: 'excerpt', excerpt: locator.textFragment ?? '' };
    case 'docx-table-cell':
      return {
        kind: 'excerpt',
        excerpt: `DOCX 表格${locator.table + 1} 第${locator.row}行第${locator.column}列（无文本摘录）`,
      };
  }
}

function fileNameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const pathname = url.startsWith('http') ? new URL(url).pathname : url;
    const base = decodeURIComponent(pathname.split('/').pop() ?? '');
    return base || null;
  } catch {
    return null;
  }
}
