/** W2：知识库材料管理接口类型（仅后台使用） */

export type KnowledgeDocumentType = "announcement" | "attachment" | "policy" | "other";

export type KnowledgeVersionStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "withdrawn"
  | "superseded";

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  documentType: KnowledgeDocumentType;
  status: string;
  announcementId: string | null;
  regionCode: string | null;
  year: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  applicableAudience?: string | null;
  applicableSubjects?: string[];
  applicableStages?: string[];
  currentVersionId: string | null;
  activeIndexVersion: number | null;
  versionCount: number;
  updatedAt: string;
}

export interface KnowledgeIndexJob {
  id: string;
  indexVersion: number;
  status: "queued" | "running" | "ready" | "failed";
  chunkCount: number;
  embeddedCount: number;
  embeddingModel: string | null;
  embeddingDim: number | null;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface KnowledgeVersion {
  id: string;
  versionNumber: number;
  status: KnowledgeVersionStatus;
  contentHash: string;
  parserVersion: string;
  chunkerVersion: string;
  mimeType: string | null;
  sourceUrl: string | null;
  activeIndexVersion: number | null;
  reviewNote: string | null;
  publishedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  jobs?: KnowledgeIndexJob[];
  _count?: { chunks: number };
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  versions: KnowledgeVersion[];
}

export interface KnowledgeStatus {
  ai: {
    enabled?: boolean;
    mode?: string;
    embedding?: { model: string; dimension: number };
    rerank?: { model: string };
    chat?: { model: string };
  };
  vector: { pgvectorAvailable: boolean };
  counts: { documents: number; versions: number; jobs: number; chunks: number };
  enabled: boolean;
}

export interface CreateKnowledgeDocumentInput {
  title: string;
  documentType: KnowledgeDocumentType;
  content?: string;
  base64?: string;
  fileName?: string;
  mimeType?: string;
  snapshotId?: string;
  documentId?: string;
  announcementId?: string;
  regionCode?: string;
  provinceCode?: string;
  year?: number;
  publisher?: string;
  officialUrl?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  applicableAudience?: string;
  applicableSubjects?: string[];
  applicableStages?: string[];
  unitIds?: string[];
}
