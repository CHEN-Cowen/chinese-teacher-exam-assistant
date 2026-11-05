export const KNOWLEDGE_DOCUMENT_TYPES = [
  'announcement',
  'attachment',
  'policy',
  'other',
] as const;
export type KnowledgeDocumentType = (typeof KNOWLEDGE_DOCUMENT_TYPES)[number];

export const KNOWLEDGE_DOCUMENT_STATUSES = [
  'draft',
  'review',
  'approved',
  'published',
  'withdrawn',
] as const;
export type KnowledgeDocumentStatus =
  (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];

export const KNOWLEDGE_VERSION_STATUSES = [
  'draft',
  'review',
  'approved',
  'published',
  'withdrawn',
  'superseded',
] as const;

export type KnowledgeIndexStatus =
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'superseded';

export interface CreateKnowledgeDocumentInput {
  title: string;
  documentType: string;
  /** 正文纯文本或 HTML */
  content?: string;
  mimeType?: string;
  /** 附件 base64（PDF/XLSX 等），与 content 二选一 */
  base64?: string;
  fileName?: string;
  /** 复用既有抓取快照（最推荐的官方来源路径） */
  snapshotId?: string;
  announcementId?: string;
  announcementVersionId?: string;
  regionCode?: string;
  provinceCode?: string;
  year?: number;
  publisher?: string;
  officialUrl?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  /** W5：政策适用对象（自由文本，如「教师公开招聘」） */
  applicableAudience?: string;
  /** W5：适用学科代码数组；空数组表示不限学科 */
  applicableSubjects?: string[];
  /** W5：适用学段标签数组（如「小学」「初中」） */
  applicableStages?: string[];
  /** 已有逻辑文档时追加版本 */
  documentId?: string;
  /** 岗位级材料关联（可选） */
  unitIds?: string[];
}

export interface KnowledgeSearchScope {
  announcementId?: string;
  unitId?: string;
  regionCode?: string;
  /** W5：适用年份；政策问答必须显式传入，避免跨年混用 */
  year?: number;
  /** W5：地区检索时是否纳入全国性政策（regionCode 为空或 000000） */
  includeNational?: boolean;
  /** W5：学科限定；材料未标注学科时视为通用，不冒充已匹配 */
  applicableSubjects?: string[];
  /** W5：适用对象限定（自由文本） */
  applicableAudience?: string;
  /** W5：以该日期判断有效期（默认今天）；失效材料不得作为回答依据 */
  asOf?: string;
  documentTypes?: string[];
}
