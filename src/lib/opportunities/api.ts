/**
 * 机会发现模块 API 客户端（模块 5）。
 *
 * demo 只读浏览器本地示例；invited 只调用同源 /api/opportunities/*，
 * 身份由后端 HttpOnly 会话确定。正式判定逻辑在后端。
 */
import { AUTH_MODE } from "@/lib/auth";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { demoOpportunitiesApi } from "./demoApi";
import type {
  AnnouncementSubmissionDTO,
  FollowDTO,
  FollowStatus,
  GoalsResponse,
  HistoryDetailResponse,
  HistoryFilters,
  HistoryListResponse,
  MatchResponse,
  MaterialStatus,
  OpportunityCorrectionDTO,
  OrganizationFollowDTO,
  StaffAnnouncementSubmissionDTO,
  StaffOpportunityCorrectionDTO,
  StudyTargetRole,
  SubscriptionDTO,
  SubscriptionSyncDTO,
  SubscriptionUpdateInput,
  UnitDetailResponse,
} from "./api-types";

const API_BASE = "/api/opportunities";

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
    const err = new Error(body.message || body.error || `请求失败 (${res.status})`);
    // 携带原始响应，便于调用方处理 VERSION_CONFLICT 等结构化错误
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { status?: number; body?: unknown }).body = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const opportunitiesApi = {
  /** 当前用户的新机会订阅（v7.1 M6；未开启过返回 null） */
  getSubscription(): Promise<SubscriptionDTO | null> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.getSubscription();
    return request<SubscriptionDTO | null>("/subscription");
  },

  /** 创建/修改订阅（部分更新，未传字段保留现值；enabled=false 关闭） */
  upsertSubscription(input: SubscriptionUpdateInput): Promise<SubscriptionDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.upsertSubscription(input);
    return request<SubscriptionDTO>("/subscription", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  /** 订阅同步（幂等）：已人工核对的匹配新公告产生一次站内提醒 */
  syncSubscription(): Promise<SubscriptionSyncDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.syncSubscription();
    return request<SubscriptionSyncDTO>("/subscription/sync", { method: "POST" });
  },

  // ==================== 单位关注（D07 / PRD 11.8 U07） ====================

  /** 当前用户的单位关注列表 */
  listOrganizationFollows(): Promise<OrganizationFollowDTO[]> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.listOrganizationFollows();
    return request<OrganizationFollowDTO[]>("/organization-follows");
  },

  /**
   * 关注单位：身份键 = 规范化发布主体名 + 公告级地区码（仅精确匹配，
   * 同名不同地区不串联，更名/合并不做模糊推断）。重复关注幂等。
   */
  followOrganization(input: {
    publisherName: string;
    regionCode: string;
  }): Promise<OrganizationFollowDTO> {
    if (AUTH_MODE === "demo")
      return demoOpportunitiesApi.followOrganization(input);
    return request<OrganizationFollowDTO>("/organization-follows", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** 取消单位关注（按身份键；幂等） */
  unfollowOrganization(identityKey: string): Promise<{ ok: true }> {
    if (AUTH_MODE === "demo")
      return demoOpportunitiesApi.unfollowOrganization(identityKey);
    return request<{ ok: true }>(
      `/organization-follows/${encodeURIComponent(identityKey)}`,
      { method: "DELETE" },
    );
  },

  /** 机会列表（按当前画像即时计算，四档分组 + 关注状态 + 版本信息）。
   *  invited 模式下默认不发送画像（由后端读取已持久化的画像）；
   *  v7.1 M8：访客（未登录）通过 sendProfile=true 在请求体携带访客画像。 */
  match(
    profile: UserRecruitmentProfile,
    options?: { sendProfile?: boolean },
  ): Promise<MatchResponse> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.match(profile);
    const sendProfile = options?.sendProfile ?? AUTH_MODE !== "invited";
    return request<MatchResponse>("/match", {
      method: "POST",
      body: JSON.stringify(sendProfile ? { profile } : {}),
    });
  },

  /** 机会详情（三层结构所需的逐条件、证据、版本链数据）。
   *  invited 模式下默认不发送画像（由后端读取已持久化的画像）；
   *  v7.1 M8：访客（未登录）通过 sendProfile=true 在请求体携带访客画像。 */
  unitDetail(
    unitId: string,
    profile: UserRecruitmentProfile,
    options?: { sendProfile?: boolean },
  ): Promise<UnitDetailResponse> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.unitDetail(unitId, profile);
    const sendProfile = options?.sendProfile ?? AUTH_MODE !== "invited";
    return request<UnitDetailResponse>(`/units/${encodeURIComponent(unitId)}/detail`, {
      method: "POST",
      body: JSON.stringify(sendProfile ? { profile } : {}),
    });
  },

  listFollows(): Promise<FollowDTO[]> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.listFollows();
    return request<FollowDTO[]>("/follows");
  },

  /** 登录后合并访客本机暂存的关注（服务端已有则跳过） */
  mergeGuestFollows(items: {
    unitId: string;
    status?: string;
    materialStatuses?: Record<string, string>;
    consultationNotes?: Record<string, string>;
  }[]): Promise<{ merged: number; skipped: number }> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.mergeGuestFollows(items);
    return request<{ merged: number; skipped: number }>("/follows/merge", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  },

  /** 备考目标列表（模块 7）：活跃关注 + 公告版本聚合 */
  getGoals(): Promise<GoalsResponse> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.getGoals();
    return request<GoalsResponse>("/goals");
  },

  /** 关注：后端保证初始状态为 considering（收藏 ≠ 准备报名），重复关注幂等 */
  follow(unitId: string): Promise<FollowDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.follow(unitId);
    return request<FollowDTO>(
      `/units/${encodeURIComponent(unitId)}/follow`,
      { method: "POST" },
    );
  },

  transition(
    unitId: string,
    status: FollowStatus,
    options?: { note?: string; abandonReason?: string; version?: number },
  ): Promise<FollowDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.transition(unitId, status, options);
    return request<FollowDTO>(
      `/units/${encodeURIComponent(unitId)}/follow`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          note: options?.note,
          abandonReason: options?.abandonReason,
          version: options?.version,
        }),
      },
    );
  },

  /** 设置某报名材料项的完成状态（带 version 乐观锁） */
  setMaterialStatus(
    unitId: string,
    itemId: string,
    status: MaterialStatus,
    version: number,
  ): Promise<FollowDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.setMaterialStatus(unitId, itemId, status, version);
    return request<FollowDTO>(
      `/units/${encodeURIComponent(unitId)}/materials`,
      {
        method: "PATCH",
        body: JSON.stringify({ itemId, status, version }),
      },
    );
  },

  /** 记录用户自行填写的官方咨询结论（带 version 乐观锁，不影响匹配） */
  saveConsultationNote(
    unitId: string,
    dimensionKey: string,
    note: string,
    version: number,
  ): Promise<FollowDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.saveConsultationNote(unitId, dimensionKey, note, version);
    return request<FollowDTO>(
      `/units/${encodeURIComponent(unitId)}/consultation`,
      {
        method: "PATCH",
        body: JSON.stringify({ dimensionKey, note, version }),
      },
    );
  },

  unfollow(unitId: string): Promise<{ ok: true }> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.unfollow(unitId);
    return request<{ ok: true }>(
      `/units/${encodeURIComponent(unitId)}/follow`,
      { method: "DELETE" },
    );
  },

  setRole(unitId: string, role: StudyTargetRole): Promise<FollowDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.setRole(unitId, role);
    return request<FollowDTO>(
      `/units/${encodeURIComponent(unitId)}/role`,
      { method: "PUT", body: JSON.stringify({ role }) },
    );
  },

  /** 开启/关闭单个机会的站内提醒（日程仍可见，只控制通知生成） */
  setRemindersMuted(unitId: string, muted: boolean): Promise<FollowDTO> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.setRemindersMuted(unitId, muted);
    return request<FollowDTO>(
      `/units/${encodeURIComponent(unitId)}/reminders`,
      { method: "PATCH", body: JSON.stringify({ muted }) },
    );
  },

  submitCorrection(
    unitId: string,
    input: { fieldPath: string; content: string; contact?: string },
  ): Promise<{ id: string; status: string }> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.submitCorrection(unitId, input);
    return request<{ id: string; status: string }>(
      `/units/${encodeURIComponent(unitId)}/corrections`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },

  /** 我提交过的纠错与员工处理状态（我的页） */
  listMyCorrections(): Promise<OpportunityCorrectionDTO[]> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.listMyCorrections();
    return request<OpportunityCorrectionDTO[]>("/corrections/mine");
  },

  // ==================== 公告补录（D08 / PRD 11.9 U08） ====================

  /** 补录未收录官方公告：只进运营待办队列，不直接发布 */
  submitAnnouncementSubmission(input: {
    officialUrl: string;
    publisherName: string;
    regionCode: string;
    note?: string;
  }): Promise<{ id: string; status: string }> {
    if (AUTH_MODE === "demo")
      return demoOpportunitiesApi.submitAnnouncementSubmission(input);
    return request<{ id: string; status: string }>(
      "/announcement-submissions",
      { method: "POST", body: JSON.stringify(input) },
    );
  },

  /** 我提交过的补录与处理状态（我的页） */
  listMyAnnouncementSubmissions(): Promise<AnnouncementSubmissionDTO[]> {
    if (AUTH_MODE === "demo")
      return demoOpportunitiesApi.listMyAnnouncementSubmissions();
    return request<AnnouncementSubmissionDTO[]>(
      "/announcement-submissions/mine",
    );
  },

  // ==================== 往年参考（D06 / PRD 11.7 U06） ====================

  /** 往年参考列表（只读；公开可访问，无需画像） */
  listHistory(filters: HistoryFilters = {}): Promise<HistoryListResponse> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.listHistory(filters);
    const params = new URLSearchParams();
    if (filters.year !== undefined) params.set("year", String(filters.year));
    if (filters.regionCode) params.set("regionCode", filters.regionCode);
    if (filters.stage) params.set("stage", filters.stage);
    if (filters.nature) params.set("nature", filters.nature);
    if (filters.keyword) params.set("keyword", filters.keyword);
    if (filters.educationLevel) params.set("educationLevel", filters.educationLevel);
    if (filters.major) params.set("major", filters.major);
    if (filters.page !== undefined) params.set("page", String(filters.page));
    if (filters.pageSize !== undefined) params.set("pageSize", String(filters.pageSize));
    const qs = params.toString();
    return request<HistoryListResponse>(`/history${qs ? `?${qs}` : ""}`);
  },

  /**
   * 往年参考详情（公开可访问）。携带画像时返回「当年条件 × 当前资料」对照；
   * 受邀模式默认不发送画像（后端读已持久化画像，无画像则对照为 null）。
   */
  historyDetail(
    unitId: string,
    profile?: UserRecruitmentProfile,
    options?: { sendProfile?: boolean },
  ): Promise<HistoryDetailResponse> {
    if (AUTH_MODE === "demo") return demoOpportunitiesApi.historyDetail(unitId, profile);
    const sendProfile = options?.sendProfile ?? (AUTH_MODE !== "invited" && !!profile);
    return request<HistoryDetailResponse>(
      `/history/${encodeURIComponent(unitId)}/detail`,
      {
        method: "POST",
        body: JSON.stringify(sendProfile && profile ? { profile } : {}),
      },
    );
  },

  /** 员工跨用户纠错队列（STAFF_ROLES；status 省略时返回全部） */
  adminListCorrections(
    status?: string,
  ): Promise<StaffOpportunityCorrectionDTO[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<StaffOpportunityCorrectionDTO[]>(`/admin/corrections${qs}`);
  },

  /**
   * 员工处理纠错：reviewing / need_supplement / resolved / rejected
   * （need_supplement、rejected 必填 reviewNote；resolved 可带 resolvedVersionId）
   */
  adminReviewCorrection(
    correctionId: string,
    input: {
      status: "reviewing" | "need_supplement" | "resolved" | "rejected";
      reviewNote?: string;
      resolvedVersionId?: string;
    },
  ): Promise<OpportunityCorrectionDTO> {
    return request<OpportunityCorrectionDTO>(
      `/admin/corrections/${encodeURIComponent(correctionId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },

  // ==================== 公告补录（D08 / PRD 11.9 U08） ====================

  /** 员工补录队列（STAFF_ROLES；status 省略时返回全部） */
  adminListAnnouncementSubmissions(
    status?: string,
  ): Promise<StaffAnnouncementSubmissionDTO[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<StaffAnnouncementSubmissionDTO[]>(
      `/admin/announcement-submissions${qs}`,
    );
  },

  /** 员工处理补录：reviewing / need_supplement / resolved / rejected */
  adminReviewAnnouncementSubmission(
    submissionId: string,
    input: {
      status: "reviewing" | "need_supplement" | "resolved" | "rejected";
      reviewNote?: string;
    },
  ): Promise<AnnouncementSubmissionDTO> {
    return request<AnnouncementSubmissionDTO>(
      `/admin/announcement-submissions/${encodeURIComponent(submissionId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
};
