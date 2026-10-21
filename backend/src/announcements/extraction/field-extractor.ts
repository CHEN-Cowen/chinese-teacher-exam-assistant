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
  deriveJobKey,
  fieldIdentity,
  type CandidateField,
  type EvidenceAnchorInput,
  type EvidenceLocator,
  type FieldAlternative,
  type JobScopeInfo,
} from '../domain.js';
import type {
  DocumentLocator,
  ParsedBlock,
  ParsedDocument,
} from '../../document-processing/parsed-document.js';

export const FIELD_EXTRACTOR_VERSION = 'rule-field-extractor@2.0.0';

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
 * 从标准文档抽取候选字段（WB2：多岗位逐行抽取）。
 * 规则来源：块文本匹配（全文类）+ 表格表头候选映射（岗位表类）。
 *
 * 岗位表抽取不变量：
 * - 每个 sheet 独立识别数据行，不复用其它 sheet 的行号集合；
 * - 每个有效数据行产生一个稳定 job scope（deriveJobKey）；
 * - 同一行内所有表格字段共享同一 job scope 与精确 worksheet/cell 证据；
 * - 去重 key 使用 scope identity + field（fieldIdentity），不同岗位同名字段全保留；
 * - 同 scope 同 field 不同值 → conflict（保留 alternatives 及各自证据），不采用"首次命中"；
 * - 空行/重复表头行/说明行跳过并产生可审计 warning，不静默吞掉。
 */
export function extractFields(parsed: ParsedDocument): RuleExtractionResult {
  const fields: CandidateField[] = [];
  const dropped: RuleExtractionResult['dropped'] = [];
  const warnings: string[] = [];

  // 1. 表格列语义（确定性表头映射 → 逐数据行，每行一个 job scope）
  const tableFields = extractTableFields(parsed, warnings);
  fields.push(...tableFields);

  // 2. 文本规则（全文类块，产出公告级字段）。
  // M3：去掉「表格已产出同名字段就跳过文本规则」的跨范围抢占——
  // 表格字段是 job scope、文本字段是 announcement scope，二者身份不同、是不同的槽位
  // （如公告总人数 vs 各岗位人数、公共学历条件 vs 岗位学历要求）。
  // 抢占会把公告级事实（正文里的总人数/公共条件）静默丢弃，即「同字段首次命中
  // 丢弃另一来源」。文本规则之间仍按同 scope 首次命中去重（同一来源内的去重）。
  // 表格单元格文本不参与文本规则（其语义由表格列映射按岗位行归属，spec §1.3
  // 归属判定以原文结构为准），避免单元格值被误抽为公告级条件。
  const claimed = new Set<string>();
  for (const block of parsed.blocks) {
    if (block.locator.kind === 'worksheet') continue;
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
        scope: 'announcement',
        status: 'extracted',
        ruleVersion: FIELD_EXTRACTOR_VERSION,
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

/**
 * WB2：按工作表逐行抽取岗位表字段。
 *
 * 返回带 job scope 的候选字段；跨行冲突通过 makeConflictField 保留 alternatives。
 */
function extractTableFields(
  parsed: ParsedDocument,
  warnings: string[],
): CandidateField[] {
  const headers = parsed.tableHeaders ?? [];
  if (headers.length === 0) return [];

  // 按 sheet 收集表头候选（sheet → 列号 → 建议字段）
  const headersBySheet = new Map<string, { headerRow: number; columns: Map<number, string> }>();
  for (const th of headers) {
    const entry = headersBySheet.get(th.sheet) ?? { headerRow: th.headerRow, columns: new Map<number, string>() };
    for (const col of th.columns) {
      if (col.suggestedField) entry.columns.set(col.column, col.suggestedField);
    }
    headersBySheet.set(th.sheet, entry);
  }

  const out: CandidateField[] = [];
  // 记录每个 (identity → field) 已产出的值与证据，用于去重与冲突判定
  const seen = new Map<string, { field: string; value: string; jobScope: JobScopeInfo; block: ParsedBlock }>();

  for (const [sheet, headerInfo] of headersBySheet) {
    // 本 sheet 的表头列号集合（用于识别重复表头行/说明行）
    const headerRow = headerInfo.headerRow;
    // 收集本 sheet 所有 worksheet block 的行号（不跨 sheet 复用）
    const sheetRows = new Set<number>();
    for (const block of parsed.blocks) {
      if (block.locator.kind === 'worksheet' && block.locator.sheet === sheet) {
        sheetRows.add(block.locator.row);
      }
    }
    const dataRows = [...sheetRows].filter((r) => r > headerRow).sort((a, b) => a - b);

    for (const row of dataRows) {
      const rowBlocks = parsed.blocks.filter(
        (b): b is ParsedBlock & { locator: Extract<DocumentLocator, { kind: 'worksheet' }> } =>
          b.locator.kind === 'worksheet' &&
          b.locator.sheet === sheet &&
          b.locator.row === row,
      );
      if (rowBlocks.length === 0) continue;

      // 判定空行：该行所有单元格 value 均为空
      const rowValues = rowBlocks.map((b) => (b.displayValue ?? b.text).trim());
      const isEmptyRow = rowValues.every((v) => v === '');
      if (isEmptyRow) {
        warnings.push(`${sheet} 第 ${row} 行为空行，已跳过`);
        continue;
      }

      // 判定重复表头行：该行文本与表头行高度重合（视为重复表头，跳过）
      const headerTexts = new Set(
        parsed.blocks
          .filter(
            (b) =>
              b.locator.kind === 'worksheet' &&
              b.locator.sheet === sheet &&
              b.locator.row === headerRow,
          )
          .map((b) => (b.displayValue ?? b.text).trim())
          .filter(Boolean),
      );
      const rowTextSet = new Set(rowValues.filter(Boolean));
      let headerHit = 0;
      for (const t of rowTextSet) if (headerTexts.has(t)) headerHit += 1;
      const isHeaderRepeat =
        headerTexts.size > 0 &&
        rowTextSet.size > 0 &&
        headerHit / Math.max(rowTextSet.size, 1) >= 0.5;
      if (isHeaderRepeat) {
        warnings.push(`${sheet} 第 ${row} 行为重复表头行，已跳过`);
        continue;
      }

      // 判定说明行：无任何列命中表头列映射（该行不含可抽取的业务字段值）
      const mappedCells = rowBlocks.filter((b) => {
        const field = headerInfo.columns.get(b.locator.column);
        const v = (b.displayValue ?? b.text).trim();
        return field && v !== '';
      });
      if (mappedCells.length === 0) {
        warnings.push(`${sheet} 第 ${row} 行未命中任何表头字段（疑似说明行），已跳过`);
        continue;
      }

      // 判定说明行（补充）：岗位编号列的值包含说明类关键词（说明/备注/注/以上/以下等），
      // 说明该行是脚注而非真实岗位数据行。
      const jobCodeCols = [...headerInfo.columns.entries()]
        .filter(([, f]) => f === 'job_code' || f === 'position_code' || f === 'code')
        .map(([col]) => col);
      const firstColValue = (() => {
        for (const col of jobCodeCols) {
          const cellBlock = rowBlocks.find((b) => b.locator.column === col);
          if (cellBlock) return (cellBlock.displayValue ?? cellBlock.text).trim();
        }
        return '';
      })();
      if (/说明|备注|注[：: ]|以上|以下|合计|小计|共计/.test(firstColValue)) {
        warnings.push(`${sheet} 第 ${row} 行为说明行（岗位编号列含说明关键词），已跳过`);
        continue;
      }

      // 识别岗位编号（jobCode）：优先命中 field=job_code 的单元格
      const jobCodeCell = mappedCells.find((b) => {
        const field = headerInfo.columns.get(b.locator.column);
        return field === 'job_code' || field === 'position_code' || field === 'code';
      });
      const jobCode = jobCodeCell ? (jobCodeCell.displayValue ?? jobCodeCell.text).trim() : undefined;
      const jobKey = deriveJobKey({
        jobCode,
        sheet,
        row,
        sourceKey: parsed.snapshotId,
      });
      const jobScope: JobScopeInfo = { key: jobKey, jobCode, sheet, row };

      // 为该行每个映射单元格生成字段
      for (const cell of mappedCells) {
        const field = headerInfo.columns.get(cell.locator.column)!;
        const value = (cell.displayValue ?? cell.text).trim();
        if (value === '') continue;

        const candidate: CandidateField = {
          field,
          value,
          scope: 'job',
          jobScope,
          status: 'extracted',
          ruleVersion: FIELD_EXTRACTOR_VERSION,
          anchor: buildAnchor(cell, parsed, field),
          origin: 'rule',
        };
        const identity = fieldIdentity(candidate);

        const existing = seen.get(identity);
        if (!existing) {
          seen.set(identity, { field, value, jobScope, block: cell });
          out.push(candidate);
          continue;
        }

        // 同 scope 同 field：
        if (existing.value === value) {
          // 相同值：去重，保留最强证据（本实现保留首个证据；可审计地记录重复来源）
          warnings.push(
            `${sheet} 第 ${row} 行 ${field}=${value} 与已存在来源重复，已去重（保留首个证据）`,
          );
          continue;
        }

        // 不同值 → 冲突：不采用首次命中，保留 alternatives
        const altA: FieldAlternative = {
          value: existing.value,
          source: toEvidenceLocator(existing.block.locator, parsed),
          excerpt: existing.block.text.slice(0, 200),
        };
        const altB: FieldAlternative = {
          value,
          source: toEvidenceLocator(cell.locator, parsed),
          excerpt: cell.text.slice(0, 200),
        };
        const conflictField: CandidateField = {
          field,
          value: existing.value, // 主值保留首个来源，alternatives 保留全部
          status: 'conflict',
          scope: 'job',
          jobScope,
          ruleVersion: FIELD_EXTRACTOR_VERSION,
          anchor: existing.block ? buildAnchor(existing.block, parsed, field) : undefined,
          origin: 'rule',
          alternatives: [altA, altB],
        };
        // 用冲突字段替换原有字段
        const idx = out.findIndex((f) => fieldIdentity(f) === identity);
        if (idx >= 0) out[idx] = conflictField;
        else out.push(conflictField);
        warnings.push(
          `${sheet} ${field} 出现冲突值（${existing.value} vs ${value}），已保留 alternatives 待人工裁决`,
        );
      }
    }
  }

  return out;
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
