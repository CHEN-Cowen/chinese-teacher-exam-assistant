/**
 * 受邀试用看板 API 客户端（v7.0 模块 7）。
 * 数据源是服务端 trial_events（与 localStorage Mock 完全无关）；
 * demo 模式身份头传 x-user-id + x-user-role，invited 模式由 HttpOnly 会话 cookie 承载。
 */
import { authService, AUTH_MODE } from "@/lib/auth";

const API_BASE = "/api/trial";

export type TrialCohortKey = "invited" | "invited_staff" | "demo" | "seed";

export interface TrialMetric {
  numerator: number;
  denominator: number;
  /** 分母为 0 时为 null（显示「—」，绝不显示 0%） */
  rate: number | null;
}

export interface TrialStepRow {
  step: number;
  label: string;
  users: number;
  rateFromFirst: number | null;
}

export interface TrialNorthStar {
  denominator: number;
  numerator: number;
  rate: number | null;
  observing: number;
}

export interface TrialCohortReport {
  users: number;
  opportunityRate: TrialMetric;
  profileSteps: TrialStepRow[];
  matchBasis: TrialMetric;
  follow: TrialMetric;
  conclusionChanged: TrialMetric;
  materialsDone: TrialMetric;
  preparing: TrialMetric;
  registerEntry: TrialMetric;
  registered: TrialMetric;
  primaryTarget: TrialMetric;
  northStar: TrialNorthStar;
  datasetSplit: { real: number; demo: number; unknown: number };
  // —— v7.1 M9 新增 ——
  homeUnderstanding: TrialMetric;
  noResultReasons: { reasonCode: string; count: number }[];
  subscriptionUsage: TrialMetric;
  subscriptionClosedCount: number;
  mapUsage: TrialMetric;
  scheduleSyncHealth: { success: number; failure: number; rate: number | null; failureReasons: { reasonCode: string; count: number }[] };
  scheduleConflictRate: TrialMetric;
}

export interface SupplySnapshot {
  generatedAt: string;
  coverage: {
    subjectLabel: string;
    status: "monitoring_no_open" | "open_batch_exists" | "paused";
    monitoredRegions: number;
    monitoredSources: number;
    sourcesUnhealthy: number;
    lastCheckedAt: string;
    openOpportunityCount: number;
  };
  announcements: {
    total: number;
    active: number;
    withdrawn: number;
    open: number;
    preview: number;
    closed: number;
    sourceFailed: number;
    review: { humanReviewed: number; pending: number };
  };
  units: { total: number; open: number };
  crossCheck: { manualOpenCount: number; computedOpenUnits: number; consistent: boolean };
}

export interface TrialDashboardResponse {
  generatedAt: string;
  cohorts: Record<TrialCohortKey, TrialCohortReport>;
  supply: SupplySnapshot;
}

export const TRIAL_COHORT_LABELS: Record<TrialCohortKey, string> = {
  invited: "受邀真实用户（主列）",
  invited_staff: "受邀员工账号",
  demo: "演示环境",
  seed: "演示种子（seed）",
};

function authHeaders(): Record<string, string> {
  if (AUTH_MODE === "invited") return {};
  const session = authService.getSession();
  if (!session) return {};
  return { "x-user-id": session.userId, "x-user-role": session.role };
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

export const trialApi = {
  /** 管理员看板（AdminGuard） */
  getDashboard(): Promise<TrialDashboardResponse> {
    return request<TrialDashboardResponse>("/dashboard");
  },

  /** 灌入演示种子（幂等，已有种子则跳过；AdminGuard） */
  seed(): Promise<{ seeded: boolean }> {
    return request<{ seeded: boolean }>("/seed", { method: "POST" });
  },
};
