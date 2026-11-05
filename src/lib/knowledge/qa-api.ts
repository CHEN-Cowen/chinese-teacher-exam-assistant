/**
 * W3：公告级问答 API 客户端。
 *
 * 只在受邀（invited）环境调用同源 /api/knowledge/qa*，身份由后端 HttpOnly 会话确定。
 * 演示环境没有后端问答，不伪造答案，直接返回 null 由调用方隐藏入口。
 */
import { AUTH_MODE } from "@/lib/auth";

const API_BASE = "/api/knowledge/qa";

export interface QaCitationDTO {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentType?: string;
  officialUrl: string | null;
  locator: {
    anchor?: string;
    excerpt?: string;
    page?: number;
    sheet?: string;
    cell?: string;
    fileName?: string;
  };
  snippet: string;
  score: number;
  regionCode?: string | null;
  year?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  validity?: "effective" | "expired" | "not_yet_effective" | "unknown";
  applicableAudience?: string | null;
  applicableSubjects?: string[];
  applicableStages?: string[];
}

export type QaStatus = "answered" | "unverified" | "refused" | "no_coverage" | "error";

export interface QaAnswerDTO {
  id: string;
  question: string;
  answer: string;
  status: QaStatus;
  needsOfficialConfirmation: boolean;
  citations: QaCitationDTO[];
  model: string | null;
  mode: string;
  latencyMs: number;
  createdAt: string;
  retrieval?: {
    candidates: number;
    vectorUsed: boolean;
    rerankUsed: boolean;
    rerankFailed: boolean;
  };
}

export interface AskQaInput {
  question: string;
  unitId?: string;
  announcementId?: string;
  regionCode?: string;
  documentTypes?: string[];
}

export class QaRequestError extends Error {
  status?: number;
  code?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const err = new QaRequestError(body.message || body.error || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = typeof body.code === "string" ? body.code : undefined;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const qaApi = {
  /** 演示环境无后端问答能力 */
  supported: AUTH_MODE === "invited",

  ask(input: AskQaInput): Promise<QaAnswerDTO> {
    if (AUTH_MODE !== "invited") throw new QaRequestError("演示环境不开放问答");
    return request<QaAnswerDTO>("", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  feedback(answerId: string, type: "helpful" | "not_helpful" | "incorrect") {
    return request<{ id: string }>(`/${answerId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
  },
};
