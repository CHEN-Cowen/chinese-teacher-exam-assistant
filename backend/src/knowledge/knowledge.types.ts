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
  /** 已有逻辑文档时追加版本 */
  documentId?: string;
  /** 岗位级材料关联（可选） */
  unitIds?: string[];
}

export interface KnowledgeSearchScope {
  announcementId?: string;
  unitId?: string;
  regionCode?: string;
  documentTypes?: string[];
  /** policy 检索时是否包含全国性（regionCode 为空）材料 */
  includeNational?: boolean;
}
