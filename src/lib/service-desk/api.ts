/**
 * 人工工作台 API 客户端（异常转人工闭环升级）。
 * 仅用于 /admin/* 页面；后端全部路由在 AdminGuard 之后，且操作身份由服务端会话确定。
 */
const API_BASE = "/api/admin/service-desk";

export type TicketType =
  | "correction"
  | "announcement_submission"
  | "parse_manual"
  | "source_alert";

export type TicketPriority = "high" | "medium" | "low";

export interface WorkbenchTaskDTO {
  id: string;
  ticketNo: string;
  statusVersion: number;
  type: TicketType;
  status: string;
  statusLabel: string;
  priority: TicketPriority;
  priorityLabel: string;
  priorityReason: string | null;
  prioritySource: string;
  assignee: { id: string; name: string | null; email: string } | null;
  defaultOwner: { id: string; name: string | null; email: string } | null;
  lastHandlerId: string | null;
  claimedAt: string | null;
  waitingOn: string | null;
  waitingLabel: string | null;
  firstResponseAt: string | null;
  lastEffectiveUpdateAt: string | null;
  responseDueAt: string | null;
  updateDueAt: string | null;
  escalationDueAt: string | null;
  pausedAt: string | null;
  supplementWaitingHours: number | null;
  longWaitingSupplement: boolean;
  nextFollowUpAt: string | null;
  overdue: boolean;
  overdueAt: string | null;
  escalated: boolean;
  routedToAdmin: boolean;
  routeIssue: string | null;
  outcome: string | null;
  resolutionNote: string | null;
  summary: string;
  sourcePath: string | null;
  submitter: { id: string; email: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEventDTO {
  id: string;
  action: string;
  visibility: string;
  message: string | null;
  actorId: string | null;
  actorRole: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  createdAt: string;
}

export interface WorkbenchTaskDetail extends WorkbenchTaskDTO {
  business: Record<string, unknown> | null;
  events: TicketEventDTO[];
  supplements: Array<{
    id: string;
    body: string;
    links: Array<{ url: string; label?: string }>;
    authorId: string;
    createdAt: string;
  }>;
  config: ServiceDeskConfigView;
}

export interface ServiceDeskConfigView {
  dutyOwnerId: string | null;
  backupOwnerId: string | null;
  dutyOwner: { id: string; name: string | null; email: string; role: string; isActive: boolean } | null;
  backupOwner: { id: string; name: string | null; email: string; role: string; isActive: boolean } | null;
  complete: boolean;
  issues: string[];
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ServiceDeskPolicyView {
  id: string;
  priority: TicketPriority;
  version: number;
  active: boolean;
  firstResponseHours: number;
  updateHours: number;
  escalationGraceHours: number;
}

export interface QueueResult {
  items: WorkbenchTaskDTO[];
  total: number;
  page: number;
  pageSize: number;
  bucket: string;
  now: string;
}

export interface PublishedResultDTO {
  announcementId: string;
  versionId: string;
  title: string;
  publisherName: string;
  officialUrl: string;
  unitId: string | null;
  publishedAt: string | null;
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
    const err = new Error(
      body.message || body.error || `请求失败 (${res.status})`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const serviceDeskApi = {
  getConfig: () => request<ServiceDeskConfigView>("/config"),
  updateConfig: (input: { dutyOwnerId: string; backupOwnerId: string; reason?: string }) =>
    request<ServiceDeskConfigView>("/config", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  eligibleOwners: () =>
    request<Array<{ id: string; name: string | null; email: string; role: string }>>(
      "/eligible-owners",
    ),
  getPolicies: () => request<ServiceDeskPolicyView[]>("/policies"),
  updatePolicies: (input: {
    policies: Array<{
      priority: TicketPriority;
      firstResponseHours: number;
      updateHours: number;
      escalationGraceHours: number;
    }>;
    reason?: string;
  }) =>
    request<ServiceDeskPolicyView[]>("/policies", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  queue: (params: Record<string, string>) => {
    const search = new URLSearchParams(params).toString();
    return request<QueueResult>(`/queue?${search}`);
  },
  task: (taskId: string) =>
    request<WorkbenchTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`),
  claim: (taskId: string, expectedVersion: number) =>
    request<WorkbenchTaskDetail>(`/tasks/${encodeURIComponent(taskId)}/claim`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    }),
  transfer: (taskId: string, input: { toUserId: string; reason: string; expectedVersion: number }) =>
    request<WorkbenchTaskDetail>(`/tasks/${encodeURIComponent(taskId)}/transfer`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  setPriority: (taskId: string, input: { priority: string; reason: string }) =>
    request<WorkbenchTaskDetail>(`/tasks/${encodeURIComponent(taskId)}/priority`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  addNote: (taskId: string, input: { message: string; visibility: "public" | "internal" }) =>
    request(`/tasks/${encodeURIComponent(taskId)}/notes`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  requestSupplement: (taskId: string, question: string) =>
    request<WorkbenchTaskDetail>(
      `/tasks/${encodeURIComponent(taskId)}/request-supplement`,
      { method: "POST", body: JSON.stringify({ question }) },
    ),
  startReview: (taskId: string) =>
    request<WorkbenchTaskDetail>(`/tasks/${encodeURIComponent(taskId)}/start-review`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  resolveCorrection: (
    taskId: string,
    input: {
      status: "resolved" | "rejected";
      reviewNote: string;
      resolvedVersionId?: string;
    },
  ) =>
    request(`/tasks/${encodeURIComponent(taskId)}/resolve-correction`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resolveSubmission: (
    taskId: string,
    input: {
      status: "resolved" | "rejected";
      reviewNote: string;
      expectedAnnouncementId?: string;
      expectedVersionId?: string;
      resolutionBasis?: string;
    },
  ) =>
    request(`/tasks/${encodeURIComponent(taskId)}/resolve-submission`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  completeDerived: (
    taskId: string,
    input: {
      outcome?: "resolved" | "limited";
      note: string;
      extractionRunId?: string;
      missingCheckNote?: string;
    },
  ) =>
    request(`/tasks/${encodeURIComponent(taskId)}/complete-derived`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  metrics: () => request<Record<string, unknown>>("/metrics"),
  scan: () => request<Record<string, unknown>>("/scan", { method: "POST" }),
  publishedResults: (q: string) =>
    request<PublishedResultDTO[]>(`/published-results?q=${encodeURIComponent(q)}`),
};
