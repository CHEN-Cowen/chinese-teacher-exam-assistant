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
  /** WB4：后端用 WB3 纯函数算出的质量门禁报告（按岗位可复算状态） */
  quality?: QualityReport | null;
}

/**
 * WB4：字段级审核决策（前端提交）。
 * identity 用后端 fieldIdentity 的规则：job → `job:<jobKey>:<field>`，
 * 其余 → `<scope>:<field>`。
 */
interface FieldDecision {
  identity: string;
  field: string;
  action: "adopt" | "edit" | "reject" | "pending";
  afterValue?: string;
  reason: string;
}

/** WB3 质量门禁报告（后端 buildCompletenessReport 的 JSON 形态） */
interface ScopeCompleteness {
  key: string;
  expected: number;
  extracted: number;
  unknown: number;
  conflict: number;
  fieldNames: string[];
}

interface QualityReport {
  scopes: ScopeCompleteness[];
  missingEvidence: Array<{ field: string; scope: string; jobKey?: string; displayName: string }>;
  unconfirmedAuto: Array<{ field: string; scope: string; jobKey?: string; origin: "ai" | "ocr" }>;
  conflicts: Array<{ field: string; scope: string; jobKey?: string; alternativeCount: number }>;
  reviewBlockers: Array<{ code: string; field?: string; scope?: string; jobKey?: string; alternativeCount?: number; message: string }>;
  publishBlockers: Array<{ code: string; field?: string; scope?: string; jobKey?: string; alternativeCount?: number; message: string }>;
  metrics: { completeness: number; adoptionRate: number; editRate: number };
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

// ==================== WB6：审核导出与实测指标 ====================

/** 单个 scope（公告公共 / 某岗位 / 归属未知）的实测指标 */
interface ScopeMetrics {
  key: string;
  /** 应有字段数 = 该 scope 内去重出现过的字段名数（与 WB3 expected 同口径） */
  expected: number;
  extracted: number;
  unknown: number;
  conflict: number;
  /** 有证据的高影响字段数（携带 anchor） */
  highImpactEvidenced: number;
  /** 应有高影响字段数 = 该 scope 内出现的高影响字段总数 */
  highImpactExpected: number;
  adopt: number;
  edit: number;
  reject: number;
  pending: number;
  /** 人工修改字段数 = decision.action=edit 的字段数 */
  humanModified: number;
}

/** 比例指标：分子、分母、公式齐备；分母为 0 时 value 为 null（UI 显示「未记录」） */
interface RatioMetric {
  key: "completeness" | "highImpactEvidenceCoverage" | "humanAdoptionRate";
  numerator: number;
  denominator: number;
  formula: string;
  value: number | null;
}

/** 时间指标：无可靠时间戳为 null（显示「未记录」，不补零） */
interface TimingMetrics {
  totalDurationMs: number | null;
  reviewDurationMs: number | null;
  retryCount: number;
}

/** 实测指标响应（后端 export.ts computeExportMetrics 的 JSON 形态） */
interface ExportMetrics {
  runId: string;
  status: string;
  parserVersion: string;
  datasetMark: "test" | "demo" | "real" | "unmarked";
  sourceHost: string;
  isExampleSource: boolean;
  scopes: ScopeMetrics[];
  totals: ScopeMetrics;
  ratios: RatioMetric[];
  timing: TimingMetrics;
  formulaNotes: string[];
}

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

/** WB6：下载文件结果（blob + 文件名） */
interface DownloadFile {
  blob: Blob;
  filename: string;
}

/**
 * WB6：下载导出文件。失败时抛出服务端错误信息（绝不把失败响应当成功文件）。
 * 文件名优先取 Content-Disposition，兜底用服务端约定的默认名。
 */
async function downloadFile(path: string, fallbackFilename: string): Promise<DownloadFile> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `导出失败 (${res.status})`);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? fallbackFilename;
  const blob = await res.blob();
  // 服务端明确告知为空载荷时同样视为失败，不生成空文件冒充成功
  if (blob.size === 0) {
    throw new Error("导出内容为空，请稍后重试或联系管理员");
  }
  return { blob, filename };
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
    fieldDecisions?: FieldDecision[];
    baseUpdatedAt?: string;
  }): Promise<Run> {
    return request<Run>(`/runs/${input.runId}/review`, {
      method: "POST",
      body: JSON.stringify({
        action: input.action,
        reason: input.reason,
        editedFields: input.editedFields,
        fieldDecisions: input.fieldDecisions,
        baseUpdatedAt: input.baseUpdatedAt,
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

  // ==================== WB6：审核导出与实测指标（只读） ====================

  /**
   * 下载 JSON 导出。返回 blob 与文件名（取自 Content-Disposition，兜底本地构造）。
   * 失败时抛错（不生成空文件）；调用方负责把 blob 触发浏览器下载。
   */
  async exportRunJson(runId: string): Promise<DownloadFile> {
    return downloadFile(`/runs/${runId}/export/json`, `workbuddy-run-${runId}.json`);
  },

  /** 下载 UTF-8 CSV 导出（一行一个「岗位 × 字段」，14 列固定顺序） */
  async exportRunCsv(runId: string): Promise<DownloadFile> {
    return downloadFile(`/runs/${runId}/export/csv`, `workbuddy-run-${runId}.csv`);
  },

  /** 实测指标（按 run + 按公告公共/逐岗位，分子分母与公式齐备） */
  getExportMetrics(runId: string): Promise<ExportMetrics> {
    return request<ExportMetrics>(`/runs/${runId}/export/metrics`);
  },
};

export type {
  Run,
  PublishedVersion,
  SnapshotParsedBlock,
  SnapshotParseRun,
  SnapshotParsedResponse,
  ProjectionStatus,
  FieldDecision,
  QualityReport,
  ScopeCompleteness,
  ExportMetrics,
  ScopeMetrics,
  RatioMetric,
  TimingMetrics,
  DownloadFile,
};
