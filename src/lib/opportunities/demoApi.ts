/**
 * 公开演示专用的浏览器本地机会数据通道。
 * 它只消费明确标记的示例公告；受邀模式仍由后端完成资格判断和持久化。
 */
import { authService } from "@/lib/auth";
import { currentVersion } from "@/lib/announcements/domain";
import type { RecruitmentAnnouncement } from "@/lib/announcements/types";
import { GUEST_COVERAGE } from "@/lib/guest/coverage";
import {
  collectHistoricalUnits,
  filterHistoricalUnits,
  availableBatchYears,
  historySampleNote,
  paginate,
} from "@/lib/history/domain";
import { availableHistoryRegions, toHistoryUnitDTO } from "@/lib/history/dto";
import { getDemoHistoryAnnouncements } from "@/lib/seed/v61-history";
import {
  buildCandidates,
  groupByMissingDimension,
  sortCandidates,
  type OpportunityCandidate,
} from "@/lib/matching/domain";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { getRollingDemoAnnouncements } from "@/lib/seed/demoTimeline";
import { loadFromStorage, saveToStorageStrict } from "@/lib/storage";
import type {
  FollowDTO,
  FollowStatus,
  GoalsResponse,
  HistoryDetailResponse,
  HistoryFilters,
  HistoryListResponse,
  MatchResponse,
  MaterialStatus,
  OpportunityCorrectionDTO,
  StudyTargetRole,
  SubscriptionDTO,
  SubscriptionSyncDTO,
  SubscriptionUpdateInput,
  UnitDetailResponse,
  UnitMatchDTO,
} from "./api-types";

interface DemoFollow extends FollowDTO {
  remindersMuted: boolean;
}

interface DemoData {
  follows: DemoFollow[];
  corrections: OpportunityCorrectionDTO[];
}

function currentUserId(): string {
  const id = authService.getSession()?.userId;
  if (!id) throw new Error("请先登录演示账号");
  return id;
}

function storageKey(): string {
  return `kb_demo_opportunities_v1_${currentUserId()}`;
}

function load(): DemoData {
  // v7.2：访客在 /preview/supplement 按需补问时需要只读访问演示详情；
  // 无会话时返回空数据（不写本机），写操作仍由 persist→currentUserId 抛错守住。
  if (!authService.getSession()?.userId) {
    return { follows: [], corrections: [] };
  }
  return loadFromStorage<DemoData>(storageKey(), { follows: [], corrections: [] });
}

function persist(data: DemoData): void {
  saveToStorageStrict(storageKey(), data);
}

function findUnit(unitId: string): {
  announcement: RecruitmentAnnouncement;
  version: RecruitmentAnnouncement["versions"][number];
  unit: RecruitmentAnnouncement["versions"][number]["units"][number];
} {
  for (const announcement of getRollingDemoAnnouncements()) {
    const version = currentVersion(announcement);
    const unit = version.units.find((item) => item.id === unitId);
    if (unit) return { announcement, version, unit };
  }
  throw new Error("未找到这个演示机会");
}

function byUnit(data: DemoData, unitId: string): DemoFollow | undefined {
  return data.follows.find((follow) => follow.unitId === unitId);
}

function updateFollow(unitId: string, change: (follow: DemoFollow) => void): DemoFollow {
  const data = load();
  const follow = byUnit(data, unitId);
  if (!follow) throw new Error("请先保存这个机会");
  change(follow);
  follow.version += 1;
  persist(data);
  return { ...follow };
}

function checkVersion(follow: DemoFollow, version?: number): void {
  if (version !== undefined && version !== follow.version) {
    const error = new Error("状态已变化，请刷新后重试") as Error & { status?: number };
    error.status = 409;
    throw error;
  }
}

function toUnit(candidate: OpportunityCandidate, data: DemoData): UnitMatchDTO {
  const { announcement, version, unit, match } = candidate;
  const follow = byUnit(data, unit.id) ?? null;
  return {
    unit: {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      region: unit.region,
      subject: unit.subject,
      stage: unit.stage,
      headcount: unit.headcount,
      organizationType: unit.organizationType,
      employmentNature: unit.employmentNature,
      allocation: unit.allocation,
      teachingScope: unit.teachingScope,
      schoolPlacement: unit.schoolPlacement,
      registerUrl: unit.registerUrl,
      sourceRow: unit.requirements[0]?.evidence,
      materials: unit.materials ?? [],
    },
    announcement: {
      id: announcement.id,
      title: announcement.title,
      publisher: announcement.publisher,
      organizationType: announcement.organizationType,
      officialUrl: announcement.officialUrl,
      dataset: "demo",
      reviewStatus: "human_reviewed",
      reviewedBy: null,
      reviewedAt: null,
    },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      sourceKind: version.sourceKind,
      publishedAt: version.publishedAt,
      changeNote: version.changeNote,
      timeline: version.timeline,
      officialSource: version.officialSource,
    },
    gates: match.gates,
    dimensions: match.dimensions.map((dimension) => {
      const requirement = unit.requirements.find((item) => item.id === dimension.requirementId);
      return {
        ...dimension,
        requirementDescription: requirement?.description ?? "岗位地区需在你填写的可接受范围内",
        evidence: requirement?.evidence,
      };
    }),
    overall: match.overall,
    summary: match.summary,
    follow,
    consultationTemplates: match.dimensions
      .filter((dimension) => dimension.value === "MANUAL_REVIEW")
      .map((dimension) => ({
        dimensionKey: dimension.dimension,
        dimensionLabel: dimension.dimension,
        question: `请向招聘单位核对「${unit.name}」的${dimension.dimension}条件。`,
      })),
  };
}

function candidates(profile: UserRecruitmentProfile, now: string): OpportunityCandidate[] {
  return sortCandidates(buildCandidates(getRollingDemoAnnouncements(new Date(now)), profile, now), profile);
}

// ==================== 演示环境订阅（v7.1 M6，localStorage 持久化） ====================

const DEMO_SUBSCRIPTION_KEY = "kb_demo_subscription";

interface DemoSubscriptionRow {
  regions: SubscriptionDTO["regions"];
  naturePreference: SubscriptionDTO["naturePreference"];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function deriveDemoDefault(profile: UserRecruitmentProfile): DemoSubscriptionRow {
  // v7.2：优先用 onboarding 第二屏收集的显式偏好；旧画像回退到白名单派生
  const naturePreference: SubscriptionDTO["naturePreference"] =
    profile.employmentNaturePreference ??
    ((): SubscriptionDTO["naturePreference"] => {
      const accepted = profile.acceptedEmploymentNatures ?? [];
      if (accepted.length === 0) return "undecided";
      if (
        accepted.length === 1 &&
        accepted[0] === "public_institution_staff"
      ) {
        return "public_only";
      }
      return "official_open";
    })();
  const now = new Date().toISOString();
  return {
    regions: profile.regions.map((r) => ({
      code: r.code,
      province: r.province,
      ...(r.city ? { city: r.city } : {}),
      ...(r.district ? { district: r.district } : {}),
    })),
    naturePreference,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function loadDemoSubscription(profile: UserRecruitmentProfile): SubscriptionDTO {
  try {
    const raw = window.localStorage.getItem(DEMO_SUBSCRIPTION_KEY);
    const row: DemoSubscriptionRow = raw
      ? (JSON.parse(raw) as DemoSubscriptionRow)
      : deriveDemoDefault(profile);
    return {
      regions: row.regions,
      subject: "chinese",
      naturePreference: row.naturePreference,
      qualification: {
        degree: profile.degree,
        graduationDate: profile.graduationDate,
        certSubject: profile.teacherCert?.subject,
        certStage: profile.teacherCert?.stage,
      },
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch {
    // localStorage 不可用时退化为内存默认值（不阻塞页面）
    const fallback = deriveDemoDefault(profile);
    return {
      regions: fallback.regions,
      subject: "chinese",
      naturePreference: fallback.naturePreference,
      qualification: null,
      enabled: fallback.enabled,
      createdAt: fallback.createdAt,
      updatedAt: fallback.updatedAt,
    };
  }
}

export const demoOpportunitiesApi = {
  /** 演示环境订阅：localStorage 持久化；未开启过返回 null（与后端口径一致） */
  async getSubscription(): Promise<SubscriptionDTO | null> {
    try {
      if (!window.localStorage.getItem(DEMO_SUBSCRIPTION_KEY)) return null;
    } catch {
      return null;
    }
    // demo 匹配需要画像；此处用种子画像派生默认值
    const { V61_SEED_PROFILE } = await import("@/lib/seed/v61-opportunities");
    return loadDemoSubscription(V61_SEED_PROFILE);
  },

  async upsertSubscription(input: SubscriptionUpdateInput): Promise<SubscriptionDTO> {
    const { V61_SEED_PROFILE } = await import("@/lib/seed/v61-opportunities");
    const current = loadDemoSubscription(V61_SEED_PROFILE);
    const row: DemoSubscriptionRow = {
      regions: input.regions ?? current.regions,
      naturePreference: input.naturePreference ?? current.naturePreference,
      enabled: input.enabled ?? current.enabled,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(DEMO_SUBSCRIPTION_KEY, JSON.stringify(row));
    } catch {
      // 持久化失败不阻塞：本次会话内仍生效
    }
    return loadDemoSubscription(V61_SEED_PROFILE);
  },

  /** 演示环境无真实公告流入，同步恒为幂等空操作 */
  async syncSubscription(): Promise<SubscriptionSyncDTO> {
    const { V61_SEED_PROFILE } = await import("@/lib/seed/v61-opportunities");
    const subscription = loadDemoSubscription(V61_SEED_PROFILE);
    return {
      enabled: subscription.enabled,
      subscribed: true,
      newNotices: 0,
      backfilled: 0,
    };
  },

  async match(profile: UserRecruitmentProfile): Promise<MatchResponse> {
    const now = new Date().toISOString();
    const data = load();
    const rows = candidates(profile, now);
    const dto = (candidate: OpportunityCandidate) => toUnit(candidate, data);
    const groups: MatchResponse["groups"] = {
      preliminary: [],
      needInfo: groupByMissingDimension(rows).map((group) => ({
        dimension: group.dimension,
        count: group.count,
        units: group.candidates.map(dto),
      })),
      manualReview: [],
      notEligible: [],
      closed: [],
    };
    for (const candidate of rows) {
      const row = dto(candidate);
      if (!candidate.match.gates.every((gate) => gate.passed)) {
        groups.closed.push(row);
      } else if (candidate.match.overall === "preliminary_eligible") {
        groups.preliminary.push(row);
      } else if (candidate.match.overall === "manual_review") {
        groups.manualReview.push(row);
      } else if (candidate.match.overall === "not_eligible") {
        groups.notEligible.push(row);
      }
    }
    return {
      meta: {
        ruleVersion: "demo-frontend-matching-1",
        majorAliasVersion: "demo-1",
        catalogVersion: "demo-seed-1",
        realCatalogVersion: GUEST_COVERAGE.version,
        evaluatedAt: now,
      },
      coverage: GUEST_COVERAGE,
      primaryTargetUnitId: data.follows.find((follow) => follow.role === "primary")?.unitId ?? null,
      groups,
      follows: data.follows,
    };
  },

  async unitDetail(unitId: string, profile: UserRecruitmentProfile): Promise<UnitDetailResponse> {
    const now = new Date().toISOString();
    const candidate = candidates(profile, now).find((item) => item.unit.id === unitId);
    if (!candidate) throw new Error("未找到这个演示机会");
    return {
      meta: (await this.match(profile)).meta,
      unit: toUnit(candidate, load()),
      previousVersions: candidate.announcement.versions
        .filter((version) => version.id !== candidate.version.id)
        .map((version) => ({
          id: version.id,
          versionNumber: version.versionNumber,
          sourceKind: version.sourceKind,
          publishedAt: version.publishedAt,
          supersededAt: version.supersededAt,
          changeNote: version.changeNote,
        })),
    };
  },

  async listFollows(): Promise<FollowDTO[]> {
    return load().follows;
  },

  async mergeGuestFollows(items: { unitId: string; status?: string }[]): Promise<{ merged: number; skipped: number }> {
    let merged = 0;
    let skipped = 0;
    for (const item of items) {
      if (byUnit(load(), item.unitId)) {
        skipped += 1;
        continue;
      }
      try {
        await this.follow(item.unitId);
        merged += 1;
      } catch {
        skipped += 1;
      }
    }
    return { merged, skipped };
  },

  async follow(unitId: string): Promise<FollowDTO> {
    const data = load();
    const existing = byUnit(data, unitId);
    if (existing) return existing;
    const { announcement, version, unit } = findUnit(unitId);
    const now = new Date().toISOString();
    const follow: DemoFollow = {
      id: `demo-${currentUserId()}-${unitId}`,
      unitId,
      announcementId: announcement.id,
      versionId: version.id,
      status: "considering",
      role: null,
      followedAt: now,
      statusHistory: [{ status: "considering", at: now }],
      abandonReason: null,
      newerVersion: false,
      remindersMuted: false,
      version: 1,
      materialStatuses: Object.fromEntries(
        (unit.materials ?? []).map((material) => [material.id, "not_started" as const]),
      ),
      consultationNotes: null,
    };
    data.follows.push(follow);
    persist(data);
    return follow;
  },

  async transition(
    unitId: string,
    status: FollowStatus,
    options?: { note?: string; abandonReason?: string; version?: number },
  ): Promise<FollowDTO> {
    return updateFollow(unitId, (follow) => {
      checkVersion(follow, options?.version);
      follow.status = status;
      follow.abandonReason = status === "abandoned" ? options?.abandonReason ?? null : null;
      follow.statusHistory.push({ status, at: new Date().toISOString(), note: options?.note });
      if (status === "abandoned" || status === "closed") follow.role = null;
    });
  },

  async setMaterialStatus(unitId: string, itemId: string, status: MaterialStatus, version: number): Promise<FollowDTO> {
    return updateFollow(unitId, (follow) => {
      checkVersion(follow, version);
      follow.materialStatuses = { ...follow.materialStatuses, [itemId]: status };
    });
  },

  async saveConsultationNote(unitId: string, dimensionKey: string, note: string, version: number): Promise<FollowDTO> {
    return updateFollow(unitId, (follow) => {
      checkVersion(follow, version);
      follow.consultationNotes = { ...follow.consultationNotes, [dimensionKey]: note };
    });
  },

  async unfollow(unitId: string): Promise<{ ok: true }> {
    const data = load();
    data.follows = data.follows.filter((follow) => follow.unitId !== unitId);
    persist(data);
    return { ok: true };
  },

  async setRole(unitId: string, role: StudyTargetRole): Promise<FollowDTO> {
    const data = load();
    const follow = byUnit(data, unitId);
    if (!follow) throw new Error("请先保存这个机会");
    if (role === "primary") {
      for (const item of data.follows) {
        if (item.role === "primary") item.role = "backup";
      }
    }
    follow.role = role;
    follow.version += 1;
    persist(data);
    return follow;
  },

  async setRemindersMuted(unitId: string, muted: boolean): Promise<FollowDTO> {
    return updateFollow(unitId, (follow) => { follow.remindersMuted = muted; });
  },

  async getGoals(): Promise<GoalsResponse> {
    const data = load();
    const goals: GoalsResponse["goals"] = [];
    for (const follow of data.follows) {
      if (follow.status === "abandoned" || follow.status === "closed") continue;
      const { announcement, version, unit } = findUnit(follow.unitId);
      goals.push({
        unitId: unit.id,
        unitName: unit.name,
        unitCode: unit.code,
        region: unit.region,
        stage: unit.stage,
        subject: unit.subject,
        headcount: unit.headcount,
        announcement: {
          id: announcement.id,
          title: announcement.title,
          publisher: announcement.publisher,
          officialUrl: announcement.officialUrl,
        },
        version: {
          id: version.id,
          versionNumber: version.versionNumber,
          publishedAt: version.publishedAt,
          timeline: version.timeline,
        },
        role: follow.role ?? "backup",
        followStatus: follow.status,
        followedAt: follow.followedAt,
        newerVersion: follow.versionId !== version.id,
      });
    }
    return {
      goals,
      primaryTargetUnitId: goals.find((goal) => goal.role === "primary")?.unitId ?? null,
    };
  },

  async submitCorrection(unitId: string, input: { fieldPath: string; content: string; contact?: string }): Promise<{ id: string; status: string }> {
    // D06：往年参考详情也保留纠错入口；历史单元不在当前滚动目录时回退到历史示例查找
    let announcement: RecruitmentAnnouncement;
    let version: RecruitmentAnnouncement["versions"][number];
    let unit: RecruitmentAnnouncement["versions"][number]["units"][number];
    try {
      ({ announcement, version, unit } = findUnit(unitId));
    } catch {
      const record = collectHistoricalUnits(getDemoHistoryAnnouncements(), new Date()).find(
        (item) => item.unit.id === unitId,
      );
      if (!record) throw new Error("未找到这个演示机会");
      announcement = record.announcement;
      version = record.version;
      unit = record.unit;
    }
    const data = load();
    const id = `demo-correction-${Date.now()}`;
    data.corrections.push({
      id,
      unitId,
      unitName: unit.name,
      announcementId: announcement.id,
      announcementTitle: announcement.title,
      versionId: version.id,
      fieldPath: input.fieldPath,
      fieldLabel: input.fieldPath,
      content: input.content,
      contact: input.contact ?? null,
      status: "submitted",
      reviewNote: null,
      reviewerId: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    });
    persist(data);
    return { id, status: "submitted" };
  },

  async listMyCorrections(): Promise<OpportunityCorrectionDTO[]> {
    return load().corrections;
  },

  // ==================== 往年参考（D06 / PRD 11.7 U06） ====================

  /** 往年参考列表：浏览器本地固定日期的示例历史公告，只读、不滚动 */
  async listHistory(filters: HistoryFilters = {}): Promise<HistoryListResponse> {
    const now = new Date();
    const all = collectHistoricalUnits(getDemoHistoryAnnouncements(), now);
    const filtered = filterHistoricalUnits(all, filters);
    const page = paginate(
      filtered.map(toHistoryUnitDTO),
      filters.page ?? 1,
      filters.pageSize ?? 20,
    );
    const years = availableBatchYears(all);
    return {
      meta: {
        ruleVersion: "demo-frontend-matching-1",
        majorAliasVersion: "demo-1",
        catalogVersion: "demo-history-1",
        realCatalogVersion: GUEST_COVERAGE.version,
        evaluatedAt: now.toISOString(),
      },
      sampleNote: historySampleNote(years, all.length),
      years,
      availableRegions: availableHistoryRegions(all),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      items: page.items,
    };
  },

  /**
   * 往年参考详情：历史事实 + 版本链 + 用当前资料对照当年条件。
   * 无画像时 comparison 为 null（页面引导先填资料，不编造对照）。
   */
  async historyDetail(
    unitId: string,
    profile?: UserRecruitmentProfile,
  ): Promise<HistoryDetailResponse> {
    const now = new Date();
    const records = collectHistoricalUnits(getDemoHistoryAnnouncements(), now);
    const record = records.find((item) => item.unit.id === unitId);
    if (!record) throw new Error("未找到这个往年公告，它可能不在已收录范围内");
    const { announcement, version, unit } = record;

    let comparison: HistoryDetailResponse["comparison"] = null;
    if (profile) {
      const candidate = buildCandidates([announcement], profile, now.toISOString()).find(
        (item) => item.unit.id === unitId,
      );
      if (candidate) {
        comparison = {
          computedAt: now.toISOString(),
          overall: candidate.match.overall,
          summary: candidate.match.summary,
          dimensions: candidate.match.dimensions.map((dimension) => {
            const requirement = unit.requirements.find(
              (item) => item.id === dimension.requirementId,
            );
            return {
              ...dimension,
              requirementDescription:
                requirement?.description ?? "岗位地区需在你填写的可接受范围内",
              evidence: requirement?.evidence,
            };
          }),
        };
      }
    }

    return {
      meta: {
        ruleVersion: "demo-frontend-matching-1",
        majorAliasVersion: "demo-1",
        catalogVersion: "demo-history-1",
        realCatalogVersion: GUEST_COVERAGE.version,
        evaluatedAt: now.toISOString(),
      },
      item: toHistoryUnitDTO(record),
      requirements: unit.requirements.map((requirement) => ({
        id: requirement.id,
        dimension: requirement.dimension,
        description: requirement.description,
        hard: requirement.hard,
        evidence: requirement.evidence,
      })),
      materials: unit.materials ?? [],
      previousVersions: announcement.versions
        .filter((item) => item.id !== version.id)
        .map((item) => ({
          id: item.id,
          versionNumber: item.versionNumber,
          sourceKind: item.sourceKind,
          publishedAt: item.publishedAt,
          supersededAt: item.supersededAt,
          changeNote: item.changeNote,
        })),
      comparison,
    };
  },
};

export function demoFollowRecords(): DemoFollow[] {
  return load().follows;
}

export function demoFollowedUnit(unitId: string): ReturnType<typeof findUnit> {
  return findUnit(unitId);
}
