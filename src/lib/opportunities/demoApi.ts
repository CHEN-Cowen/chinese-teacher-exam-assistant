/**
 * 公开演示专用的浏览器本地机会数据通道。
 * 它只消费明确标记的示例公告；受邀模式仍由后端完成资格判断和持久化。
 */
import { authService } from "@/lib/auth";
import { currentVersion } from "@/lib/announcements/domain";
import type { RecruitmentAnnouncement } from "@/lib/announcements/types";
import { GUEST_COVERAGE } from "@/lib/guest/coverage";
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

const DEMO_SUBSCRIPTION_KEY = "demo-opportunity-subscription";

interface DemoSubscriptionRow {
  regions: SubscriptionDTO["regions"];
  naturePreference: SubscriptionDTO["naturePreference"];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function deriveDemoDefault(profile: UserRecruitmentProfile): DemoSubscriptionRow {
  const accepted = profile.acceptedEmploymentNatures ?? [];
  const naturePreference: SubscriptionDTO["naturePreference"] =
    accepted.length === 0
      ? "undecided"
      : accepted.length === 1 && accepted[0] === "public_institution_staff"
        ? "public_only"
        : "official_open";
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
    const { announcement, version, unit } = findUnit(unitId);
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
};

export function demoFollowRecords(): DemoFollow[] {
  return load().follows;
}

export function demoFollowedUnit(unitId: string): ReturnType<typeof findUnit> {
  return findUnit(unitId);
}
