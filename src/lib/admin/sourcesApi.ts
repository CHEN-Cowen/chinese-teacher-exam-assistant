/**
 * v7.2 来源管理前端 API 客户端。
 *
 * 调用后端 /api/admin/sources/* 接口（BFF 代理透传，后端 SourcingController）。
 * 后端 AdminGuard 在服务端强制校验角色，前端仅做体验层隐藏。
 * 所有时间字段均为 ISO 字符串；后端并行开发中，缺省字段由页面防御性判空。
 */
import { AUTH_MODE, authService } from "@/lib/auth";

const API_BASE = "/api/admin/sources";

/** 来源健康状态五档 */
export type SourceHealthStatus =
  | "healthy"
  | "degraded"
  | "structure_changed"
  | "blocked"
  | "paused";

/** 抓取运行审计记录（业务事实，非队列记录） */
export interface CrawlRun {
  id: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  downloadedCount: number;
  unchangedCount: number;
  failedCount: number;
  adapterVersion: string | null;
  errorSummary: string | null;
  createdAt?: string;
}

/** 来源健康概览行 */
export interface SourceHealth {
  id: string;
  publisher: string;
  officialUrl?: string | null;
  enabled: boolean;
  adapterKey: string | null;
  healthStatus: SourceHealthStatus;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  nextCheckAt: string | null;
  lastFailReason: string | null;
  latestRun?: CrawlRun | null;
  parserVersion?: string | null;
  pendingReviewCount?: number;
  /** 来源台账（M08）：地区、负责人/处理入口、调度周期、材料与发布状态 */
  regionCode?: string | null;
  contactInfo?: string | null;
  pollEveryMinutes?: number;
  snapshotCount?: number;
  publishedVersionCount?: number;
}

/** 队列积压摘要（后端可观测性注入，可能为空） */
export interface QueueSummary {
  waiting: number;
  delayed: number;
  active: number;
}

export interface SourcesHealthResponse {
  sources: SourceHealth[];
  queue?: QueueSummary | null;
}

/** 手动检查来源的返回 */
export interface CheckSourceResult {
  runId: string;
  sourceId: string;
  trigger: string;
  status: string;
  jobId: string | null;
  deduplicated: boolean;
}

/** 来源文档（公告/附件/关系待定） */
export interface SourceDocument {
  id: string;
  canonicalUrl: string;
  kind: string;
  /** 以 "Candidate" 结尾表示机器建议、待人工确认的关系 */
  relationType: string | null;
  parentDocumentId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  latestSnapshotId: string | null;
}

function authHeaders(): Record<string, string> {
  if (AUTH_MODE === "invited") return {};
  const session = authService.getSession();
  if (!session) return {};
  return {
    "x-user-id": session.userId,
    "x-user-role": session.role,
    "x-user-name": session.user.name,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const sourcesApi = {
  /** 来源健康概览 + 队列积压摘要 */
  getHealth(): Promise<SourcesHealthResponse> {
    return request<SourcesHealthResponse>("/health");
  },
  /** 手动触发一次来源检查 */
  checkSource(sourceId: string): Promise<CheckSourceResult> {
    return request<CheckSourceResult>(`/${sourceId}/check`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  /** 指定来源的抓取运行审计（最近 limit 条） */
  listRuns(sourceId: string, limit = 20): Promise<{ runs: CrawlRun[] }> {
    return request<{ runs: CrawlRun[] }>(`/${sourceId}/runs?limit=${limit}`);
  },

  /** 暂停来源（停止自动抓取，保留历史审计） */
  pauseSource(sourceId: string): Promise<{ sourceId: string; paused: boolean }> {
    return request(`/${sourceId}/pause`, { method: "POST" });
  },

  /** 恢复来源 */
  resumeSource(sourceId: string): Promise<{ sourceId: string; paused: boolean }> {
    return request(`/${sourceId}/resume`, { method: "POST" });
  },

  /** 来源文档列表（含待确认关系） */
  listDocuments(sourceId: string): Promise<{ documents: SourceDocument[] }> {
    return request<{ documents: SourceDocument[] }>(`/${sourceId}/documents`);
  },

  /** 确认文档关系（补充/延期/取消） */
  confirmDocumentRelation(
    documentId: string,
    input: { relationType: "supplement" | "delay" | "cancel"; parentDocumentId: string }
  ): Promise<unknown> {
    return request(`/documents/${documentId}/relation`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

// ==================== 采集管线跨阶段汇总（D09 / U10） ====================

/** 管线汇总响应：只含数据库真实计数；时间字段 ISO 字符串或 null */
export interface PipelineSummary {
  generatedAt: string;
  sources: {
    total: number;
    byHealthStatus: Record<string, number>;
    lastSuccessAt: string | null;
  };
  snapshots: { total: number; last24h: number };
  parseRuns: { byStatus: Record<string, number> };
  extractionRuns: { byStatus: Record<string, number> };
  publishedVersions: {
    byStatus: Record<string, number>;
    lastPublishedAt: string | null;
  };
}

const ANNOUNCEMENTS_API_BASE = "/api/announcements";

/**
 * 公告管理端点客户端（/api/announcements/admin/*，BFF 代理透传）。
 * 后端 AdminGuard 强制校验角色；前端仅做体验层展示。
 */
export const announcementsAdminApi = {
  /** 跨阶段流水线汇总（来源/快照/解析/提取/发布各阶段计数） */
  pipelineSummary(): Promise<PipelineSummary> {
    return requestAnnouncements<PipelineSummary>("/admin/pipeline-summary");
  },
};

async function requestAnnouncements<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${ANNOUNCEMENTS_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}
