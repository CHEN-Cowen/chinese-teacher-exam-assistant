/**
 * W2：知识库材料管理 API 客户端（仅后台邀请模式使用）。
 *
 * 同源 /api/knowledge/*，身份由后端 HttpOnly 会话确定；
 * 演示模式不提供管理写操作，避免演示环境伪装真实入库。
 */
import { AUTH_MODE } from "@/lib/auth";
import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocumentDetail,
  KnowledgeDocumentSummary,
  KnowledgeIndexJob,
  KnowledgeStatus,
} from "./api-types";

const API_BASE = "/api/knowledge";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (AUTH_MODE === "demo") {
    throw new Error("演示环境不开放知识库管理");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const knowledgeApi = {
  listDocuments(filters: {
    status?: string;
    documentType?: string;
    regionCode?: string;
    limit?: number;
  } = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    return request<{ items: KnowledgeDocumentSummary[]; total: number }>(
      `/documents${query ? `?${query}` : ""}`,
    );
  },

  getDocument(id: string) {
    return request<KnowledgeDocumentDetail>(`/documents/${id}`);
  },

  createDocument(input: CreateKnowledgeDocumentInput) {
    return request<{ documentId: string; versionId: string; versionNumber: number }>(
      "/documents",
      { method: "POST", body: JSON.stringify(input) },
    );
  },

  submitReview(versionId: string) {
    return request<{ versionId: string; status: string }>(
      `/versions/${versionId}/submit-review`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  approve(versionId: string, note?: string) {
    return request<{ versionId: string; status: string }>(
      `/versions/${versionId}/approve`,
      { method: "POST", body: JSON.stringify({ note }) },
    );
  },

  reject(versionId: string, note?: string) {
    return request<{ versionId: string; status: string }>(
      `/versions/${versionId}/reject`,
      { method: "POST", body: JSON.stringify({ note }) },
    );
  },

  publish(versionId: string) {
    return request<{
      versionId: string;
      status: string;
      indexJob: { jobId: string; indexVersion: number; queued: boolean; warning?: string };
    }>(`/versions/${versionId}/publish`, { method: "POST", body: JSON.stringify({}) });
  },

  withdraw(documentId: string, reason: string) {
    return request<{ documentId: string; withdrawnVersions: string[] }>(
      `/documents/${documentId}/withdraw`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },

  rebuildIndex(versionId: string) {
    return request<{ jobId: string; indexVersion: number; queued: boolean; warning?: string }>(
      `/versions/${versionId}/index`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  listIndexJobs(params: { status?: string; limit?: number } = {}) {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.limit) search.set("limit", String(params.limit));
    const query = search.toString();
    return request<{ items: KnowledgeIndexJob[]; total: number }>(
      `/index-jobs${query ? `?${query}` : ""}`,
    );
  },

  status() {
    return request<KnowledgeStatus>("/status");
  },
};
