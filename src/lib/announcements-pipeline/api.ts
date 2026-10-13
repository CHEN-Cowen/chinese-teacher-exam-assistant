/**
 * 公告数据流水线前端 API 客户端。
 *
 * 调用后端 /api/announcements/* 接口，透传当前登录用户的身份头供后端权限校验。
 * 后端 AdminGuard / ReviewGuard 在服务端强制校验角色，前端仅做体验层隐藏。
 */
import { AUTH_MODE, authService } from "@/lib/auth";

const API_BASE = "/api/announcements";

interface Run {
  id: string;
  snapshotId: string;
  announcementId: string | null;
  parserVersion: string;
  status: string;
  progress: number;
  candidate: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  snapshot?: {
    id: string;
    officialUrl: string | null;
    contentHash: string;
    mimeType: string;
    /** v7.2：快照抓取元信息（可能缺省，页面判空展示） */
    httpStatus?: number | null;
    fetchedAt?: string | null;
    source?: { publisher: string; officialUrl: string };
  };
  evidenceAnchors?: Array<{
    id: string;
    field: string;
    locatorKind: string;
    excerpt: string | null;
  }>;
  reviewRecords?: Array<{
    id: string;
    action: string;
    reason: string;
    reviewerName: string;
    reviewedAt: string;
  }>;
  publishedVersion?: { id: string; versionNumber: number; status: string } | null;
}

interface PublishedVersion {
  id: string;
  announcementId: string;
  versionNumber: number;
  status: string;
  payload: unknown;
  publishedAt: string;
  previousVersionId: string | null;
  supersededAt: string | null;
  /** v7.2 撤回留痕（未撤回版本为 null/缺省） */
  withdrawnAt?: string | null;
  withdrawReason?: string | null;
  withdrawnBy?: string | null;
}

/** v7.2 快照标准文档解析结果（层 2） */
interface SnapshotParsedBlock {
  kind?: string;
  text?: string;
  locator?: unknown;
  rawValue?: string;
  displayValue?: string;
}

interface SnapshotParseRun {
  id: string;
  format: string;
  parserVersion: string;
  status: string;
  blocks: unknown;
  tableHeaders: unknown | null;
  warnings: Array<{ type?: string; message?: string } | string> | null;
  warningCount: number;
  scanned: boolean;
  ocrRequired: boolean;
  ocrStatus: string | null;
  finishedAt: string | null;
}

interface SnapshotParsedResponse {
  parseRun: SnapshotParseRun | null;
  change?: {
    hasPreviousSnapshot: boolean;
    previousFetchedAt: string | null;
    currentFetchedAt: string | null;
  };
}

/** v7.2 用户目录投影状态 */
type ProjectionStatus =
  | { status: "not_published" }
  | { status: "projected"; unitCount: number; versionNumber: number }
  | { status: "failed"; fieldPath?: string; message?: string; versionNumber: number };

/** 从当前会话读取用户身份，注入请求头。
 * invited 模式：身份由 HttpOnly 会话 cookie 承载，绝不发送客户端可伪造的 x-user-*。 */
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

export const announcementsPipelineApi = {
  /** 提交公告来源（URL/文本内容） */
  submitSource(input: {
    publisher: string;
    officialUrl: string;
    sourceType: string;
    content: string;
    mimeType: string;
    regionCode?: string;
    announcementId?: string;
  }): Promise<Run> {
    return request<Run>("/sources", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** 手动触发提取 */
  runExtraction(runId: string): Promise<Run> {
    return request<Run>(`/runs/${runId}/extract`, { method: "POST" });
  },

  /** 任务列表 */
  listRuns(params?: { status?: string; announcementId?: string }): Promise<Run[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.announcementId) qs.set("announcementId", params.announcementId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<Run[]>(`/runs${suffix}`);
  },

  /** 任务详情 */
  getRun(runId: string): Promise<Run> {
    return request<Run>(`/runs/${runId}`);
  },

  /** 提交审核 */
  submitReview(input: {
    runId: string;
    action: "approve" | "approve_with_edit" | "reject" | "mark_incomplete";
    reason: string;
    editedFields?: Array<{ field: string; value: string; anchor?: object }>;
  }): Promise<Run> {
    return request<Run>(`/runs/${input.runId}/review`, {
      method: "POST",
      body: JSON.stringify({
        action: input.action,
        reason: input.reason,
        editedFields: input.editedFields,
      }),
    });
  },

  /** 发布 */
  publish(runId: string): Promise<PublishedVersion> {
    return request<PublishedVersion>(`/runs/${runId}/publish`, { method: "POST" });
  },

  /** 重试失败任务 */
  retryRun(runId: string): Promise<Run> {
    return request<Run>(`/runs/${runId}/retry`, { method: "POST" });
  },

  /** 版本列表 */
  listVersions(announcementId: string): Promise<PublishedVersion[]> {
    return request<PublishedVersion[]>(`/${announcementId}/versions`);
  },

  /** 版本差异 */
  getVersionDiff(announcementId: string, v1: number, v2: number) {
    return request(`/${announcementId}/versions/diff?v1=${v1}&v2=${v2}`);
  },

  /** 读取快照原始内容（审核页左侧原文） */
  getSnapshotContent(snapshotId: string): Promise<{ content: string; mimeType: string }> {
    return request<{ content: string; mimeType: string }>(`/snapshots/${snapshotId}/content`);
  },

  /** v7.2：快照标准文档解析结果 + 来源变化提示（审核页层 2） */
  getSnapshotParsed(snapshotId: string): Promise<SnapshotParsedResponse> {
    return request<SnapshotParsedResponse>(`/snapshots/${snapshotId}/parsed`);
  },

  /** v7.2：撤回已发布版本（必填原因，留痕可审计） */
  withdrawVersion(
    announcementId: string,
    versionId: string,
    reason: string
  ): Promise<PublishedVersion> {
    return request<PublishedVersion>(`/${announcementId}/versions/${versionId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  /** v7.2：公告在用户目录的投影状态 */
  getProjection(announcementId: string): Promise<ProjectionStatus> {
    return request<ProjectionStatus>(`/${announcementId}/projection`);
  },
};

export type {
  Run,
  PublishedVersion,
  SnapshotParsedBlock,
  SnapshotParseRun,
  SnapshotParsedResponse,
  ProjectionStatus,
};
