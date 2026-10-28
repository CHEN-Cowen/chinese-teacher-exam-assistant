import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { REVIEW_ROLES } from '../auth/admin.guard.js';
import { ProfileService } from '../profile/profile.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';
import { REAL_ANNOUNCEMENTS } from '../matching/real-catalog.js';
import { getRollingCatalogAnnouncements } from '../matching/rolling-catalog.js';
import {
  buildCandidates,
  currentVersion,
  isUserVisibleInCatalog,
} from '../matching/engine.js';
import { PublishedCatalogRepository } from '../catalog/published-catalog.repository.js';
import { isDbCatalogEnabled } from '../catalog/feature-flag.js';
import type {
  CredentialLevel,
  DegreeCode,
  EmploymentNatureCode,
  EmploymentNaturePreference,
  EmploymentStatus,
  MaterialStatus,
  RecruitmentAnnouncement,
  RegionPreferenceLevel,
  TeacherCertStatus,
  UserRecruitmentProfile,
} from '../matching/types.js';
import {
  applyConsultationNote,
  applyMaterialStatus,
  canTransition,
  isFollowStatus,
  transitionFollow,
  type FollowRecord,
  type FollowStatus,
  type FollowStatusEvent,
  type StudyTargetRole,
} from './follow.domain.js';
import {
  CORRECTION_STATUSES,
  fieldPathLabel,
  isTerminalStatus,
  validateResolution,
  validateReview,
  type CorrectionDTO,
  type CorrectionVersionRef,
  type StaffCorrectionDTO,
} from './corrections.domain.js';
import {
  decideSubmission,
  validateSubmissionInput,
  type AnnouncementSubmissionDTO,
} from './announcement-submission.domain.js';
import {
  buildGoals,
  buildMatchResponse,
  buildQualificationSnapshot,
  buildUnitDetail,
  type CatalogSnapshot,
  type FollowDTO,
  type GoalsResponse,
  type MatchResponse,
  type OrganizationFollowDTO,
  type SubscriptionDTO,
  type SubscriptionSyncDTO,
  type UnitDetailResponse,
} from './view.js';
import {
  buildCoverageProjection,
  type RuntimeSourceState,
  type UnifiedCoverageProjection,
} from './coverage-projection.js';
import {
  buildHistoryDetail,
  buildHistoryList,
  parseHistoryQuery,
  type HistoryDetailResponse,
  type HistoryListResponse,
  type HistoryQueryRaw,
} from './history.js';
import {
  SOURCE_CATALOG,
  SOURCE_MONITORING_RECORDS,
} from '../sourcing/source-catalog.js';
import {
  deriveSubscriptionCriteria,
  planOpportunityNotices,
  type NaturePreferenceCode,
  type SubscriptionCriteria,
} from './subscription.domain.js';
import {
  organizationIdentityKey,
  planOrganizationNotices,
} from './organization-follow.domain.js';

/**
 * 目录来源（v7.2 工作包 3）：
 * - `ff_db_catalog` 开：只读数据库 `PublishedAnnouncementVersion(status=published)`
 *   —— 生产唯一事实源，静态演示/台账目录一律不参与；
 * - 关：沿用 v7.1 现状（catalog.ts 滚动时间轴 + real-catalog.ts 真实台账），
 *   仅用于 Demo 与测试。
 */
@Injectable()
export class OpportunitiesService {
  private readonly catalogRepository: PublishedCatalogRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileService: ProfileService,
    private readonly scheduleService: ScheduleService,
    @Optional()
    @Inject(PublishedCatalogRepository)
    catalogRepository?: PublishedCatalogRepository,
  ) {
    this.catalogRepository =
      catalogRepository ?? new PublishedCatalogRepository(prisma);
  }

  /** 按请求加载一次目录：flag 开走数据库，关走静态（Demo/测试） */
  private async loadCatalog(
    now: Date = new Date(),
  ): Promise<readonly RecruitmentAnnouncement[]> {
    if (isDbCatalogEnabled()) {
      // 正式目录只消费明确 real；demo/test 仍可存档，但不能混入正式用户匹配。
      return (await this.catalogRepository.listPublished(now))
        .filter((announcement) => announcement.dataset === 'real');
    }
    return [
      ...getRollingCatalogAnnouncements(),
      ...REAL_ANNOUNCEMENTS,
    ];
  }

  /**
   * 画像来源：请求体优先；未携带时读取服务端持久画像（受邀模式跨浏览器恢复）。
   * v7.1 M8：userId 可选——访客（未登录）必须在请求体携带画像。
   */
  private async resolveProfile(
    profile: unknown,
    userId?: string,
  ): Promise<UserRecruitmentProfile> {
    if (profile !== undefined && profile !== null) {
      return this.validateProfile(profile);
    }
    if (!userId) {
      throw new BadRequestException('尚未保存画像，请先完成基础画像');
    }
    const persisted = await this.profileService.getProfile(userId);
    if (persisted === null) {
      throw new BadRequestException('尚未保存画像，请先完成基础画像');
    }
    return this.validateProfile(persisted);
  }

  // ==================== 匹配：列表 / 详情 ====================

  /** 机会列表（v7.1 M8：userId 可选，访客无关注记录） */
  async match(profile: unknown, userId?: string): Promise<MatchResponse> {
    const valid = await this.resolveProfile(profile, userId);
    const now = new Date();
    const catalog = await this.loadCatalog(now);
    const candidates = buildCandidates(
      catalog,
      valid,
      now.toISOString(),
    );
    const coverage = await this.buildUnifiedCoverage(now, catalog);
    return this.assemble(candidates, valid, userId, coverage);
  }

  /**
   * 公开覆盖摘要（M01/F1/F2）：匿名可读，与 match 响应共用统一覆盖投影。
   */
  async coverage(): Promise<UnifiedCoverageProjection> {
    const now = new Date();
    const catalog = await this.loadCatalog(now);
    return this.buildUnifiedCoverage(now, catalog);
  }

  /**
   * 统一覆盖投影（M01/F2）：来源台账 + 监测记录 + 运行时 Source 状态
   * + 已发布目录岗位，单一事实来源；访客与登录用户一致。
   *
   * 运行时 Source 表仅在数据库目录模式（ff_db_catalog 开）下读取；
   * 读取失败回退台账静态投影并显式标注非实时（caliber.isFallback）。
   */
  private async buildUnifiedCoverage(
    now: Date,
    catalog: readonly RecruitmentAnnouncement[],
  ): Promise<UnifiedCoverageProjection> {
    const publishedOpenUnits = this.countOpenRealUnits(catalog, now);
    const publishedProvinceCodes = new Set<string>();
    const timestamp = now.getTime();
    for (const announcement of catalog) {
      if (announcement.dataset !== 'real') continue;
      const version = currentVersion(announcement);
      if (version.units.length === 0) continue;
      const start = version.timeline.registrationStart
        ? new Date(version.timeline.registrationStart).getTime()
        : Number.NEGATIVE_INFINITY;
      const end = version.timeline.registrationEnd
        ? new Date(version.timeline.registrationEnd).getTime()
        : Number.NEGATIVE_INFINITY;
      if (start <= timestamp && timestamp <= end) {
        publishedProvinceCodes.add(announcement.region.code.slice(0, 2));
      }
    }

    let runtimeSources: RuntimeSourceState[] | null = null;
    if (isDbCatalogEnabled()) {
      try {
        const rows = await this.prisma.source.findMany({
          select: {
            adapterKey: true,
            enabled: true,
            lastSuccessAt: true,
            lastCheckedAt: true,
            consecutiveFailures: true,
            // M02：按来源调度周期判定检查超时（统一覆盖投影口径）
            pollEveryMinutes: true,
            nextCheckAt: true,
          },
        });
        runtimeSources = rows;
      } catch {
        // 运行状态不可读：回退台账静态投影，投影内显式标注非实时。
        runtimeSources = null;
      }
    }

    return buildCoverageProjection({
      now,
      sourceCatalog: SOURCE_CATALOG,
      monitoringRecords: SOURCE_MONITORING_RECORDS,
      runtimeSources,
      publishedOpenUnits,
      publishedProvinceCodes: [...publishedProvinceCodes],
    });
  }

  /** 机会详情（v7.1 M8：userId 可选，访客无关注记录） */
  async unitDetail(
    profile: unknown,
    userId: string | undefined,
    unitId: string,
  ): Promise<UnitDetailResponse> {
    const valid = await this.resolveProfile(profile, userId);
    const catalog = await this.loadCatalog();
    const candidates = buildCandidates(
      catalog,
      valid,
      new Date().toISOString(),
    );
    const follows = await this.listFollowRecords(userId);
    const detail = buildUnitDetail(candidates, unitId, follows, new Date());
    if (!detail) {
      throw new NotFoundException('未找到该报考单元，它可能不属于当前已发布公告');
    }
    return detail;
  }

  private async assemble(
    candidates: ReturnType<typeof buildCandidates>,
    profile: UserRecruitmentProfile,
    userId: string | undefined,
    coverage: UnifiedCoverageProjection,
  ): Promise<MatchResponse> {
    const follows = await this.listFollowRecords(userId);
    return buildMatchResponse(candidates, profile, follows, new Date(), coverage);
  }

  /**
   * 覆盖数来自当前目录的报名时间窗口，不再依赖静态手填数量。
   */
  private countOpenRealUnits(
    catalog: readonly RecruitmentAnnouncement[],
    now: Date,
  ): number {
    const timestamp = now.getTime();
    return catalog
      .filter((announcement) => announcement.dataset === 'real')
      .reduce((count, announcement) => {
        const version = currentVersion(announcement);
        const start = version.timeline.registrationStart
          ? new Date(version.timeline.registrationStart).getTime()
          : Number.NEGATIVE_INFINITY;
        const end = version.timeline.registrationEnd
          ? new Date(version.timeline.registrationEnd).getTime()
          : Number.NEGATIVE_INFINITY;
        return count + (start <= timestamp && timestamp <= end ? version.units.length : 0);
      }, 0);
  }

  // ==================== 往年参考（D06 / PRD 11.7 U06） ====================

  /**
   * 往年参考列表（公开只读）：报名已截止或已撤回的往年公告。
   * 不进入当前可报名计数，没有任何报名/关注动作；查询串非法值 400，不静默猜测。
   */
  async listHistory(query: HistoryQueryRaw): Promise<HistoryListResponse> {
    const parsed = parseHistoryQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const now = new Date();
    const catalog = await this.loadCatalog(now);
    return buildHistoryList(catalog, parsed.filters, now);
  }

  /**
   * 往年参考详情（公开）：历史事实 + 版本链 + 用当前资料的可选对照。
   * 画像可选：请求体未携带且服务端无持久画像时 comparison 为 null（不编造对照）；
   * 请求体携带了画像但结构非法仍按 400 处理（边界校验不放宽）。
   */
  async historyDetail(
    profile: unknown,
    userId: string | undefined,
    unitId: string,
  ): Promise<HistoryDetailResponse> {
    const valid = await this.resolveOptionalProfile(profile, userId);
    const now = new Date();
    const catalog = await this.loadCatalog(now);
    const detail = buildHistoryDetail(catalog, unitId, valid, now);
    if (!detail) {
      throw new NotFoundException('未找到这个往年公告，它可能不在已收录范围内');
    }
    return detail;
  }

  /**
   * 画像可选解析（往年参考对照专用）：请求体优先；其次服务端持久画像；
   * 都没有时返回 null——历史事实浏览不因缺画像而中断。
   */
  private async resolveOptionalProfile(
    profile: unknown,
    userId?: string,
  ): Promise<UserRecruitmentProfile | null> {
    if (profile !== undefined && profile !== null) {
      return this.validateProfile(profile);
    }
    return userId ? this.safeProfile(userId) : null;
  }

  // ==================== 新机会订阅（v7.1 M6） ====================

  private toSubscriptionDTO(row: {
    regions: unknown;
    subject: string;
    naturePreference: string;
    qualification: unknown;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SubscriptionDTO {
    return {
      regions: row.regions as SubscriptionDTO['regions'],
      subject: row.subject,
      naturePreference: row.naturePreference as SubscriptionDTO['naturePreference'],
      qualification:
        (row.qualification as SubscriptionDTO['qualification']) ?? null,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 当前用户的订阅（未开启过返回 null，前端用画像默认值引导开启） */
  async getSubscription(userId: string): Promise<SubscriptionDTO | null> {
    const row = await this.prisma.opportunitySubscription.findUnique({
      where: { userId },
    });
    return row ? this.toSubscriptionDTO(row) : null;
  }

  /**
   * 创建/修改订阅（每用户一条 upsert）。
   * 未传字段用画像默认值补齐；enabled=false 关闭后停止新提醒，历史通知保留。
   */
  async upsertSubscription(
    userId: string,
    input: {
      regions?: unknown;
      subject?: unknown;
      naturePreference?: unknown;
      enabled?: unknown;
    },
  ): Promise<SubscriptionDTO> {
    const profile = await this.safeProfile(userId);
    const existing = await this.prisma.opportunitySubscription.findUnique({
      where: { userId },
    });
    const defaults = profile
      ? deriveSubscriptionCriteria(profile)
      : {
          regions: [],
          subject: 'chinese',
          naturePreference: 'undecided' as NaturePreferenceCode,
        };
    // 更新时未传字段保留现值（不能被默认值覆盖）；创建时用画像默认值补齐
    const regionsFallback = existing
      ? ((existing.regions as SubscriptionCriteria['regions']) ?? defaults.regions)
      : defaults.regions;
    const regions = this.validatedSubscriptionRegions(
      input.regions,
      regionsFallback,
    );
    const naturePreference = this.asNaturePreference(
      input.naturePreference,
      existing
        ? (existing.naturePreference as NaturePreferenceCode)
        : defaults.naturePreference,
    );
    const snapshot = profile ? buildQualificationSnapshot(profile) : null;
    // 资格快照只在画像可用时刷新；画像缺失时保留现值（创建则留空列）
    const base = {
      regions: regions as unknown as Prisma.InputJsonValue,
      subject: 'chinese',
      naturePreference,
      enabled:
        typeof input.enabled === 'boolean'
          ? input.enabled
          : (existing?.enabled ?? true),
    };
    const withSnapshot = {
      ...base,
      ...(snapshot
        ? { qualification: snapshot as unknown as Prisma.InputJsonValue }
        : {}),
    };
    const row = await this.prisma.opportunitySubscription.upsert({
      where: { userId },
      create: { userId, ...withSnapshot },
      update: withSnapshot,
    });
    return this.toSubscriptionDTO(row);
  }

  /**
   * 订阅同步（幂等）：按订阅条件筛选当前公告目录，新匹配公告产生一次站内提醒。
   * - 未开启订阅：直接返回，不产生任何通知；
   * - 首次同步：对既有匹配公告做基线回填（不通知），避免开启即通知风暴；
   * - 重复同步：dedupKey 命中日志的全部跳过；
   * - 新版本发布：新 dedupKey 允许再次提醒（每版本一次）。
   */
  async syncSubscription(userId: string): Promise<SubscriptionSyncDTO> {
    // D07：单位关注同步独立于订阅开关——订阅关闭只停订阅提醒，单位关注提醒照常
    const org = await this.syncOrganizationFollows(userId);
    const orgFields = {
      orgNewNotices: org.newNotices,
      orgBackfilled: org.backfilled,
    };
    const row = await this.prisma.opportunitySubscription.findUnique({
      where: { userId },
    });
    if (!row || !row.enabled) {
      return { enabled: false, subscribed: row !== null, newNotices: 0, backfilled: 0, ...orgFields };
    }
    const criteria: SubscriptionCriteria = {
      regions: row.regions as SubscriptionCriteria['regions'],
      subject: row.subject,
      naturePreference: row.naturePreference as NaturePreferenceCode,
    };
    const catalog = await this.loadCatalog();

    // “没有已知明确不符合项”：以当前画像的即时匹配结果为准
    const profile = await this.safeProfile(userId);
    const ineligibleUnitIds = new Set<string>();
    if (profile) {
      const candidates = buildCandidates(
        catalog,
        profile,
        new Date().toISOString(),
      );
      for (const c of candidates) {
        if (c.match.overall === 'not_eligible') ineligibleUnitIds.add(c.unit.id);
      }
    }

    const existing = await this.prisma.opportunityNoticeLog.findMany({
      where: { userId },
      select: { dedupKey: true },
    });
    const existingKeys = new Set(existing.map((r) => r.dedupKey));
    const plan = planOpportunityNotices({
      announcements: catalog,
      criteria,
      ineligibleUnitIds,
      existingKeys,
      now: new Date(),
    });
    if (plan.keys.length === 0) {
      return { enabled: true, subscribed: true, newNotices: 0, backfilled: 0, ...orgFields };
    }

    for (const notice of plan.notices) {
      await this.prisma.notificationRecord.create({
        data: {
          userId,
          severity: 'info',
          title: `新机会提醒：${notice.publisher}`,
          body: [
            `${notice.regionLabel} ${notice.unitName}`,
            `招 ${notice.headcount} 人，报名截止 ${notice.registrationEnd}`,
            '已通过人工核对且符合你的订阅条件，详情见机会页。',
          ].join('；'),
          relatedUnitId: notice.unitId,
        },
      });
    }
    await this.prisma.opportunityNoticeLog.createMany({
      data: plan.keys.map((k) => ({
        userId,
        announcementId: k.announcementId,
        versionId: k.versionId,
        dedupKey: k.dedupKey,
        notified: k.notified,
      })),
      skipDuplicates: true,
    });
    return {
      enabled: true,
      subscribed: true,
      newNotices: plan.notices.length,
      backfilled: plan.backfillCount,
      ...orgFields,
    };
  }

  // ==================== 单位关注（D07 / PRD 11.8 U07） ====================

  /** 当前用户的单位关注列表（按关注时间升序） */
  async listOrganizationFollows(
    userId: string,
  ): Promise<OrganizationFollowDTO[]> {
    const rows = await this.prisma.followedOrganization.findMany({
      where: { userId },
      orderBy: { followedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      identityKey: r.identityKey,
      publisherName: r.publisherName,
      regionCode: r.regionCode,
      followedAt: r.followedAt.toISOString(),
    }));
  }

  /**
   * 关注一个单位：身份键 = 规范化发布主体名 + 地区码（仅精确匹配，
   * 不做更名/合并的模糊推断）。重复关注幂等返回已有记录，followedAt 不变。
   */
  async followOrganization(
    userId: string,
    input: { publisherName?: unknown; regionCode?: unknown },
  ): Promise<OrganizationFollowDTO> {
    const publisherName =
      typeof input.publisherName === 'string' ? input.publisherName.trim() : '';
    const regionCode =
      typeof input.regionCode === 'string' ? input.regionCode.trim() : '';
    if (!publisherName) {
      throw new BadRequestException('缺少发布主体名称');
    }
    if (!/^\d{6}$/.test(regionCode)) {
      throw new BadRequestException('地区码格式不正确');
    }
    const identityKey = organizationIdentityKey({ publisherName, regionCode });
    const row = await this.prisma.followedOrganization.upsert({
      where: { userId_identityKey: { userId, identityKey } },
      create: { userId, identityKey, publisherName, regionCode },
      update: {},
    });
    return {
      id: row.id,
      identityKey: row.identityKey,
      publisherName: row.publisherName,
      regionCode: row.regionCode,
      followedAt: row.followedAt.toISOString(),
    };
  }

  /** 取消单位关注（按身份键；幂等，本就不存在也返回 ok） */
  async unfollowOrganization(
    userId: string,
    identityKey: unknown,
  ): Promise<{ ok: true }> {
    if (typeof identityKey !== 'string' || !identityKey.trim()) {
      throw new BadRequestException('缺少单位身份键');
    }
    await this.prisma.followedOrganization.deleteMany({
      where: { userId, identityKey },
    });
    return { ok: true };
  }

  /**
   * 单位关注同步（幂等）：被关注单位发布的新公告产生一次站内提醒。
   * 触发口径与订阅一致（官方来源、未过期、已人工核对、用户可见）；
   * 首次同步以关注时刻为水位回填基线（即使当时没有匹配公告也会写入水位），
   * 避免「历史键为空」被永久当作首次同步而漏报（R04）；
   * 先写幂等键再通知，且整体在一个事务里：并发同步/中途失败不会重复提醒。
   */
  async syncOrganizationFollows(
    userId: string,
  ): Promise<{ newNotices: number; backfilled: number }> {
    const rows = await this.prisma.followedOrganization.findMany({
      where: { userId },
    });
    if (rows.length === 0) return { newNotices: 0, backfilled: 0 };
    const catalog = await this.loadCatalog();
    const existing = await this.prisma.opportunityNoticeLog.findMany({
      where: { userId },
      select: { dedupKey: true },
    });
    const now = new Date();
    const plan = planOrganizationNotices({
      announcements: catalog,
      follows: rows.map((r) => ({
        identityKey: r.identityKey,
        publisherName: r.publisherName,
        regionCode: r.regionCode,
        followedAt: r.followedAt.toISOString(),
        baselineSyncedAt: r.baselineSyncedAt?.toISOString() ?? null,
      })),
      existingKeys: new Set(existing.map((r) => r.dedupKey)),
      now,
    });
    const pendingBaseline = rows.some((r) => r.baselineSyncedAt == null);
    if (plan.keys.length === 0 && !pendingBaseline) {
      return { newNotices: 0, backfilled: 0 };
    }

    const noticeByKey = new Map(plan.notices.map((n) => [n.dedupKey, n]));
    return this.prisma.$transaction(async (tx) => {
      let newNotices = 0;
      let backfilled = 0;
      for (const key of plan.keys) {
        // 先落唯一幂等键：只有真正插入成功才创建通知，重复/并发同步自然跳过
        const inserted = await tx.opportunityNoticeLog.createMany({
          data: [
            {
              userId,
              announcementId: key.announcementId,
              versionId: key.versionId,
              dedupKey: key.dedupKey,
              notified: key.notified,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 0) continue;
        if (!key.notified) {
          backfilled += 1;
          continue;
        }
        const notice = noticeByKey.get(key.dedupKey);
        if (!notice) continue;
        await tx.notificationRecord.create({
          data: {
            userId,
            severity: 'info',
            title: `关注单位新公告：${notice.publisher}`,
            body: [
              `${notice.regionLabel}《${notice.announcementTitle}》`,
              `含 ${notice.unitCount} 个岗位，报名截止 ${notice.registrationEnd}`,
              '来自你关注的单位，已通过人工核对，详情见机会页。',
            ].join('；'),
            relatedUnitId: notice.unitId,
          },
        });
        newNotices += 1;
      }
      if (pendingBaseline) {
        await tx.followedOrganization.updateMany({
          where: { userId, baselineSyncedAt: null },
          data: { baselineSyncedAt: now },
        });
      }
      return { newNotices, backfilled };
    });
  }

  /** 画像读取失败/未保存时返回 null（同步与订阅默认值不因此中断） */
  private async safeProfile(userId: string): Promise<UserRecruitmentProfile | null> {
    try {
      const persisted = await this.profileService.getProfile(userId);
      return persisted ? this.validateProfile(persisted) : null;
    } catch {
      return null;
    }
  }

  private validatedSubscriptionRegions(
    input: unknown,
    fallback: SubscriptionCriteria['regions'],
  ): SubscriptionCriteria['regions'] {
    if (!Array.isArray(input)) return fallback;
    const result: SubscriptionCriteria['regions'] = [];
    for (const raw of input) {
      if (typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.code !== 'string' || typeof r.province !== 'string') continue;
      result.push({
        code: r.code,
        province: r.province,
        ...(typeof r.city === 'string' ? { city: r.city } : {}),
        ...(typeof r.district === 'string' ? { district: r.district } : {}),
      });
    }
    return result.length > 0 ? result : fallback;
  }

  private asNaturePreference(
    input: unknown,
    fallback: NaturePreferenceCode,
  ): NaturePreferenceCode {
    if (
      input === 'public_only' ||
      input === 'official_open' ||
      input === 'undecided'
    ) {
      return input;
    }
    return fallback;
  }

  // ==================== 关注关系 ====================

  async listFollows(userId: string): Promise<FollowDTO[]> {
    const follows = await this.listFollowRecords(userId);
    const catalog = await this.loadCatalog();
    return follows.map((follow) => this.toDTO(follow, catalog));
  }

  /** 备考目标列表（模块 7）：活跃关注 + 公告版本聚合，供主要目标选择与 /study 页使用 */
  async listGoals(userId: string): Promise<GoalsResponse> {
    const follows = await this.listFollowRecords(userId);
    const catalog = await this.loadCatalog();
    return buildGoals(follows, this.buildCatalogSnapshot(catalog));
  }

  /** 当前目录的全部公告/版本/单元聚合快照（goals 视图装配用） */
  private buildCatalogSnapshot(
    catalog: readonly RecruitmentAnnouncement[],
  ): CatalogSnapshot[] {
    const snapshots: CatalogSnapshot[] = [];
    for (const announcement of catalog) {
      // M5 合规过滤：test 样本与 AI 初核待复核的真实记录不进用户端备考目标；
      // 已人工复核（human_reviewed）的真实岗位照常进入。
      if (!isUserVisibleInCatalog(announcement)) continue;
      const version = currentVersion(announcement);
      for (const unit of version.units) {
        // 旧版本中同 code 单元的 id（关注记录可能仍指向旧版本单元 id）
        const legacyUnitIds = announcement.versions
          .filter((v) => v.id !== version.id)
          .flatMap((v) => v.units)
          .filter((u) => u.code === unit.code)
          .map((u) => u.id);
        snapshots.push({
          announcementId: announcement.id,
          title: announcement.title,
          publisher: announcement.publisher,
          officialUrl: announcement.officialUrl,
          versionId: version.id,
          versionNumber: version.versionNumber,
          publishedAt: version.publishedAt,
          timeline: version.timeline,
          unit: {
            id: unit.id,
            code: unit.code,
            name: unit.name,
            region: unit.region,
            subject: unit.subject,
            stage: unit.stage,
            headcount: unit.headcount,
          },
          legacyUnitIds,
        });
      }
    }
    return snapshots;
  }

  /**
   * 关注一个报考单元。收藏 ≠ 准备报名：初始状态恒为 considering。
   * 重复关注幂等返回已有记录（状态不被重置）。
   * M7：关注成功后立即同步官方已明确节点，并返回 syncedEventCount。
   */
  async follow(userId: string, unitId: string): Promise<FollowDTO> {
    const catalog = await this.loadCatalog();
    const target = this.findCatalogUnit(unitId, catalog);
    const existing = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (existing) {
      const dto = this.toDTO(this.fromRow(existing, catalog), catalog);
      // M7：重复关注也触发同步（幂等），反馈当前已同步节点数
      const syncResult = await this.scheduleService.syncEventsForUser(userId);
      dto.syncedEventCount = syncResult.syncedEventCount;
      return dto;
    }
    const atIso = new Date().toISOString();
    const row = await this.prisma.followedOpportunity.create({
      data: {
        userId,
        unitId,
        announcementId: target.announcementId,
        versionId: target.versionId,
        status: 'considering',
        role: null,
        followedAt: new Date(atIso),
        statusHistory: [
          { status: 'considering', at: atIso },
        ] satisfies Prisma.InputJsonValue,
        abandonReason: null,
        materialStatuses: this.initialMaterialStatuses(
          unitId,
          catalog,
        ) as Prisma.InputJsonValue,
      },
    });
    // M7：关注成功后立即同步官方已明确节点
    const syncResult = await this.scheduleService.syncEventsForUser(userId);
    const dto = this.toDTO(this.fromRow(row, catalog), catalog);
    dto.syncedEventCount = syncResult.syncedEventCount;
    return dto;
  }

  /** 登录后合并访客本地关注：服务端已有记录时以服务端为准（不覆盖）。 */
  async mergeGuestFollows(
    userId: string,
    items: Array<{
      unitId?: unknown;
      status?: unknown;
      materialStatuses?: unknown;
      consultationNotes?: unknown;
    }>,
  ): Promise<{ merged: number; skipped: number }> {
    if (!Array.isArray(items)) return { merged: 0, skipped: 0 };
    const catalog = await this.loadCatalog();
    let merged = 0;
    let skipped = 0;
    for (const item of items) {
      if (!item || typeof item.unitId !== 'string') {
        skipped++;
        continue;
      }
      let target: { announcementId: string; versionId: string };
      try {
        target = this.findCatalogUnit(item.unitId, catalog);
      } catch {
        skipped++;
        continue;
      }
      const existing = await this.prisma.followedOpportunity.findUnique({
        where: { userId_unitId: { userId, unitId: item.unitId } },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const status = this.asFollowStatus(item.status) ?? 'considering';
      const atIso = new Date().toISOString();
      await this.prisma.followedOpportunity.create({
        data: {
          userId,
          unitId: item.unitId,
          announcementId: target.announcementId,
          versionId: target.versionId,
          status,
          role: null,
          followedAt: new Date(atIso),
          statusHistory: [
            { status, at: atIso },
          ] satisfies Prisma.InputJsonValue,
          abandonReason: null,
          materialStatuses:
            item.materialStatuses && typeof item.materialStatuses === 'object'
              ? (item.materialStatuses as Prisma.InputJsonValue)
              : (this.initialMaterialStatuses(
                  item.unitId,
                  catalog,
                ) as Prisma.InputJsonValue),
          consultationNotes:
            item.consultationNotes && typeof item.consultationNotes === 'object'
              ? (item.consultationNotes as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      });
      merged++;
    }
    return { merged, skipped };
  }

  /** 状态流转（非法边由领域层拒绝）；只影响该单元，其他关注记录不变。
   *  乐观锁：expectedVersion 与当前 version 不一致时抛 409，返回服务端最新状态。 */
  async transition(
    userId: string,
    unitId: string,
    nextInput: unknown,
    note?: string,
    abandonReason?: string,
    expectedVersion?: number,
  ): Promise<FollowDTO> {
    const next = this.asFollowStatus(nextInput);
    const catalog = await this.loadCatalog();
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('尚未关注该机会');
    const current = this.fromRow(row, catalog);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        error: 'VERSION_CONFLICT',
        current: this.toDTO(current, catalog),
      });
    }
    if (!canTransition(current.status, next)) {
      throw new BadRequestException(
        `不允许从「${current.status}」流转到「${next}」`,
      );
    }
    const updated = transitionFollow(
      current,
      next,
      new Date().toISOString(),
      note,
      abandonReason,
    );
    const saved = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: {
        status: updated.status,
        statusHistory: updated.statusHistory as unknown as Prisma.InputJsonValue,
        abandonReason: updated.abandonReason,
        version: updated.version,
      },
    });
    return this.toDTO(this.fromRow(saved, catalog), catalog);
  }

  private assertVersion(
    current: FollowRecord,
    catalog: readonly RecruitmentAnnouncement[],
    expectedVersion?: number,
  ) {
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        error: 'VERSION_CONFLICT',
        current: this.toDTO(current, catalog),
      });
    }
  }

  /** 设置某报名材料项的完成状态。同状态幂等；带乐观锁。 */
  async setMaterialStatus(
    userId: string,
    unitId: string,
    itemIdInput: unknown,
    statusInput: unknown,
    expectedVersion?: number,
  ): Promise<FollowDTO> {
    const itemId = typeof itemIdInput === 'string' ? itemIdInput : '';
    const status = this.asMaterialStatus(statusInput);
    const catalog = await this.loadCatalog();
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('尚未关注该机会');
    const current = this.fromRow(row, catalog);
    this.assertVersion(current, catalog, expectedVersion);
    const updated = applyMaterialStatus(current, itemId, status);
    if (updated === current) return this.toDTO(current, catalog);
    const saved = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: {
        materialStatuses: updated.materialStatuses as unknown as Prisma.InputJsonValue,
        version: updated.version,
      },
    });
    return this.toDTO(this.fromRow(saved, catalog), catalog);
  }

  /** 记录用户自行填写的官方咨询结论。不参与匹配；带乐观锁。 */
  async saveConsultationNote(
    userId: string,
    unitId: string,
    dimensionKeyInput: unknown,
    noteInput: unknown,
    expectedVersion?: number,
  ): Promise<FollowDTO> {
    const dimensionKey =
      typeof dimensionKeyInput === 'string' ? dimensionKeyInput : '';
    const note = typeof noteInput === 'string' ? noteInput : '';
    if (!dimensionKey) throw new BadRequestException('缺少维度标识');
    const catalog = await this.loadCatalog();
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('尚未关注该机会');
    const current = this.fromRow(row, catalog);
    this.assertVersion(current, catalog, expectedVersion);
    const updated = applyConsultationNote(current, dimensionKey, note);
    if (updated === current) return this.toDTO(current, catalog);
    const saved = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: {
        consultationNotes: updated.consultationNotes as unknown as Prisma.InputJsonValue,
        version: updated.version,
      },
    });
    return this.toDTO(this.fromRow(saved, catalog), catalog);
  }

  /** 取消关注（删除记录，不影响其他机会） */
  async unfollow(userId: string, unitId: string): Promise<{ ok: true }> {
    await this.prisma.followedOpportunity.deleteMany({
      where: { userId, unitId },
    });
    return { ok: true };
  }

  /**
   * 设置/取消备考角色。主要目标全局唯一：设为 primary 时，
   * 同一用户原 primary 在事务内自动降为 backup（PRD 7.7）。
   */
  async setRole(
    userId: string,
    unitId: string,
    roleInput: unknown,
  ): Promise<FollowDTO> {
    const role = this.asRole(roleInput);
    const catalog = await this.loadCatalog();
    const target = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!target) throw new NotFoundException('请先关注该机会，再设置备考目标');

    if (role === 'primary') {
      await this.prisma.$transaction([
        this.prisma.followedOpportunity.updateMany({
          where: { userId, role: 'primary', NOT: { unitId } },
          data: { role: 'backup' },
        }),
        this.prisma.followedOpportunity.update({
          where: { userId_unitId: { userId, unitId } },
          data: { role: 'primary' },
        }),
      ]);
    } else {
      await this.prisma.followedOpportunity.update({
        where: { userId_unitId: { userId, unitId } },
        data: { role: 'backup' },
      });
    }
    const row = await this.prisma.followedOpportunity.findUniqueOrThrow({
      where: { userId_unitId: { userId, unitId } },
    });
    return this.toDTO(this.fromRow(row, catalog), catalog);
  }

  /** 开启/关闭单个机会的站内提醒（日程仍可见，只是不产生通知） */
  async setRemindersMuted(
    userId: string,
    unitId: string,
    muted: boolean,
  ): Promise<FollowDTO> {
    const catalog = await this.loadCatalog();
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('请先关注该机会，再设置提醒开关');
    const updated = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: { remindersMuted: muted },
    });
    return this.toDTO(this.fromRow(updated, catalog), catalog);
  }

  // ==================== 纠错提交（证据层，PRD 7.10） ====================

  /** 纠错提交限流：同一用户 24 小时滚动窗口内最多 20 条 */
  private static readonly CORRECTION_MAX_PER_DAY = 20;
  private static readonly CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

  async submitCorrection(
    userId: string,
    unitId: string,
    body: { fieldPath?: unknown; content?: unknown; contact?: unknown },
  ): Promise<{ id: string; status: string }> {
    const catalog = await this.loadCatalog();
    const target = this.findCatalogUnit(unitId, catalog);
    const fieldPath = typeof body.fieldPath === 'string' ? body.fieldPath.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!fieldPath) {
      throw new BadRequestException('请选择要纠错的内容位置（条件/证据/版本）');
    }
    if (content.length < 5) {
      throw new BadRequestException('请填写至少 5 个字的纠错说明');
    }
    if (content.length > 1000) {
      throw new BadRequestException('纠错说明不能超过 1000 字');
    }
    // D08（PRD 11.9）：限流 + 重复提交可识别。
    const windowStart = new Date(
      Date.now() - OpportunitiesService.CORRECTION_WINDOW_MS,
    );
    const recent = await this.prisma.opportunityCorrection.findMany({
      where: { userId, createdAt: { gte: windowStart } },
      select: { id: true, unitId: true, fieldPath: true, content: true },
      orderBy: { createdAt: 'desc' },
    });
    const duplicate = recent.find(
      (row) =>
        row.unitId === unitId &&
        row.fieldPath === fieldPath &&
        row.content === content,
    );
    if (duplicate) {
      throw new ConflictException(
        '这条纠错你已提交过，处理进度可在「我的资料」页查看',
      );
    }
    if (recent.length >= OpportunitiesService.CORRECTION_MAX_PER_DAY) {
      throw new ConflictException(
        `提交太频繁：24 小时内最多提交 ${OpportunitiesService.CORRECTION_MAX_PER_DAY} 条纠错，请稍后再试`,
      );
    }
    const row = await this.prisma.opportunityCorrection.create({
      data: {
        userId,
        unitId,
        announcementId: target.announcementId,
        versionId: target.versionId,
        fieldPath,
        content,
        contact:
          typeof body.contact === 'string' && body.contact.trim()
            ? body.contact.trim().slice(0, 200)
            : null,
      },
    });
    return { id: row.id, status: row.status };
  }

  // ==================== 纠错处理闭环（P0-F / 模块 8） ====================

  /** 用户查看自己提交过的纠错及员工处理状态 */
  async listMyCorrections(userId: string): Promise<CorrectionDTO[]> {
    const catalog = await this.loadCatalog();
    const rows = await this.prisma.opportunityCorrection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.toCorrectionDTO(row, catalog));
  }

  /** 员工跨用户纠错队列；status 为空时返回全部 */
  async listCorrectionsForStaff(
    status: string | null,
  ): Promise<StaffCorrectionDTO[]> {
    if (
      status !== null &&
      !(CORRECTION_STATUSES as readonly string[]).includes(status)
    ) {
      throw new BadRequestException('纠错状态筛选值无效');
    }
    const rows = await this.prisma.opportunityCorrection.findMany({
      where: status === null ? {} : { status },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const submitterIds = [...new Set(rows.map((r) => r.userId))];
    const submitters = await this.prisma.user.findMany({
      where: { id: { in: submitterIds } },
      select: { id: true, email: true, name: true },
    });
    const submitterMap = new Map(submitters.map((u) => [u.id, u]));
    const catalog = await this.loadCatalog();
    return rows.map((row) => {
      const submitterRow = submitterMap.get(row.userId) ?? null;
      return {
        ...this.toCorrectionDTO(row, catalog),
        submitter: submitterRow
          ? {
              id: submitterRow.id,
              email: submitterRow.email,
              name: submitterRow.name,
            }
          : { id: row.userId, email: '', name: null },
      };
    });
  }

  /**
   * 员工处理纠错（R05）：
   * - 权限：服务层再校验一次处理角色（ReviewGuard 之外的第二道保险，便于审计）；
   * - 状态机校验见 corrections.domain（终态不可改、不采纳/需补充必须写说明）；
   * - resolved 必须真实：数据类问题需登记已发布、晚于提交版本的修正版本；
   *   非数据类问题不得登记版本，必须写清实际处理结果；
   * - 幂等：同一终态重复提交返回当前记录且不重复通知；并发处理用
   *   `where id + status` 条件更新，只有一个请求能推进状态并产生通知；
   * - 纠错记录不物理删除，处理人/处理时间/说明全部留痕。
   */
  async reviewCorrection(
    reviewer: { id: string; role: string },
    correctionId: string,
    body: { status?: unknown; reviewNote?: unknown; resolvedVersionId?: unknown },
  ): Promise<CorrectionDTO> {
    if (!REVIEW_ROLES.includes(reviewer.role)) {
      throw new ForbiddenException('当前账号没有处理纠错的权限');
    }
    const catalog = await this.loadCatalog();
    const row = await this.prisma.opportunityCorrection.findUnique({
      where: { id: correctionId },
    });
    if (!row) {
      throw new NotFoundException('未找到该纠错记录');
    }
    // 幂等：网络重试提交相同终态时返回当前记录，不再产生通知
    if (isTerminalStatus(row.status) && body.status === row.status) {
      return this.toCorrectionDTO(row, catalog);
    }
    const result = validateReview({
      from: row.status,
      to: body.status,
      reviewNote: body.reviewNote,
      existingNote: row.reviewNote,
    });
    if (!result.ok) {
      throw new ConflictException(result.message);
    }
    const requestedVersionId =
      typeof body.resolvedVersionId === 'string' && body.resolvedVersionId.trim()
        ? body.resolvedVersionId.trim().slice(0, 100)
        : null;
    const effectiveNote = result.note ?? row.reviewNote ?? null;
    const announcement = catalog.find((a) => a.id === row.announcementId);
    const versions: CorrectionVersionRef[] = (announcement?.versions ?? []).map(
      (version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        superseded: Boolean(version.supersededAt),
      }),
    );

    let resolvedVersionId: string | null = null;
    let versionLine = '';
    if (result.status === 'resolved') {
      const check = validateResolution({
        fieldPath: row.fieldPath,
        submittedVersionId: row.versionId,
        reviewNote: effectiveNote,
        resolvedVersionId: requestedVersionId,
        versions,
      });
      if (!check.ok) {
        throw check.kind === 'invalid_version' ||
          check.kind === 'version_not_allowed'
          ? new BadRequestException(check.message)
          : new ConflictException(check.message);
      }
      resolvedVersionId = check.resolvedVersionId;
      const target = versions.find((version) => version.id === resolvedVersionId);
      versionLine = target
        ? `更正版本：第 ${target.versionNumber} 版（${target.id}）。`
        : '';
    }

    const now = new Date();
    const data = {
      status: result.status,
      reviewNote: effectiveNote,
      reviewerId: reviewer.id,
      reviewedAt: now,
      resolvedVersionId,
    };
    const meta = this.findCatalogUnitMeta(row.unitId, catalog);
    const unitName = meta?.unitName ?? '该机会';
    const noteLine = effectiveNote ? `处理说明：${effectiveNote}` : '';

    return this.prisma.$transaction(async (tx) => {
      // 条件更新：并发处理同一纠错时只有一个请求能推进状态
      const claimed = await tx.opportunityCorrection.updateMany({
        where: { id: row.id, status: row.status },
        data,
      });
      if (claimed.count === 0) {
        const latest = await tx.opportunityCorrection.findUnique({
          where: { id: row.id },
        });
        return this.toCorrectionDTO(latest ?? row, catalog);
      }

      if (result.status === 'resolved') {
        const body =
          resolvedVersionId !== null
            ? `我们已核对官方原文，确认你反馈的「${fieldPathLabel(row.fieldPath)}」问题，` +
              `并在${versionLine}完成更正，感谢你的反馈。${noteLine}`
            : `我们已核对并处理你反馈的「${fieldPathLabel(row.fieldPath)}」问题，` +
              `处理结果可在机会详情页核对，感谢你的反馈。${noteLine}`;
        await tx.notificationRecord.create({
          data: {
            userId: row.userId,
            severity: 'info',
            title: `你提交的「${unitName}」纠错已处理完成`,
            body,
            eventKey: `correction:${row.id}`,
            reminderStage: `correction_resolved_${now.getTime()}`,
            relatedUnitId: row.unitId,
          },
        });
      } else if (result.status === 'need_supplement') {
        await tx.notificationRecord.create({
          data: {
            userId: row.userId,
            severity: 'info',
            title: `你提交的「${unitName}」纠错需要补充信息`,
            body:
              `我们核对你反馈的「${fieldPathLabel(row.fieldPath)}」问题时还需要更多信息。` +
              `${noteLine}请在「我的资料」页查看这条纠错，并重新提交一条包含补充信息的纠错，` +
              `我们会继续跟进。`,
            eventKey: `correction:${row.id}`,
            reminderStage: `correction_need_supplement_${now.getTime()}`,
            relatedUnitId: row.unitId,
          },
        });
      } else if (result.status === 'rejected') {
        await tx.notificationRecord.create({
          data: {
            userId: row.userId,
            severity: 'info',
            title: `你提交的「${unitName}」纠错已核对完成`,
            body:
              `我们核对官方原文后暂未采纳这条「${fieldPathLabel(row.fieldPath)}」纠错。` +
              noteLine,
            eventKey: `correction:${row.id}`,
            reminderStage: `correction_rejected_${now.getTime()}`,
            relatedUnitId: row.unitId,
          },
        });
      }

      return this.toCorrectionDTO({ ...row, ...data }, catalog);
    });
  }

  // ==================== 公告补录（D08 / PRD 11.9 U08） ====================

  /**
   * 用户提交未收录官方公告的补录。只进运营待办队列，绝不直接进入采集
   * 与发布；链接经安全校验，按用户限流，重复提交可识别。
   */
  async submitAnnouncementSubmission(
    userId: string,
    body: {
      officialUrl?: unknown;
      publisherName?: unknown;
      regionCode?: unknown;
      note?: unknown;
    },
  ): Promise<{ id: string; status: string }> {
    const check = validateSubmissionInput(body);
    if (!check.ok || !check.value) {
      throw new BadRequestException(check.message ?? '补录信息不完整');
    }
    const value = check.value;
    const [recentForUser, accepted] = await Promise.all([
      this.prisma.announcementSubmission.findMany({
        where: { userId },
        select: {
          id: true,
          userId: true,
          urlHash: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      // 已收录（resolved）链接全库去重：同一公告链接不需要重复补录
      this.prisma.announcementSubmission.findMany({
        where: { status: 'resolved', urlHash: value.urlHash },
        select: { urlHash: true },
        take: 1,
      }),
    ]);
    const decision = decideSubmission({
      urlHash: value.urlHash,
      userId,
      recentForUser,
      acceptedHashes: new Set(accepted.map((r) => r.urlHash)),
      now: new Date(),
    });
    if (!decision.ok) {
      if (decision.kind === 'duplicate_self') {
        throw new ConflictException(decision.message);
      }
      throw new ConflictException(decision.message);
    }
    const row = await this.prisma.announcementSubmission.create({
      data: {
        userId,
        officialUrl: value.officialUrl,
        urlHash: value.urlHash,
        publisherName: value.publisherName,
        regionCode: value.regionCode,
        note: value.note,
      },
    });
    return { id: row.id, status: row.status };
  }

  /** 当前用户提交过的补录与处理状态（我的页） */
  async listMyAnnouncementSubmissions(
    userId: string,
  ): Promise<AnnouncementSubmissionDTO[]> {
    const rows = await this.prisma.announcementSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.toSubmissionDTO(row));
  }

  /** 员工补录队列；status 为空时返回全部 */
  async listAnnouncementSubmissionsForStaff(
    status: string | null,
  ): Promise<
    (AnnouncementSubmissionDTO & {
      submitter: { id: string; email: string; name: string | null };
    })[]
  > {
    if (
      status !== null &&
      !(CORRECTION_STATUSES as readonly string[]).includes(status)
    ) {
      throw new BadRequestException('补录状态筛选值无效');
    }
    const rows = await this.prisma.announcementSubmission.findMany({
      where: status === null ? {} : { status },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const submitterIds = [...new Set(rows.map((r) => r.userId))];
    const submitters = await this.prisma.user.findMany({
      where: { id: { in: submitterIds } },
      select: { id: true, email: true, name: true },
    });
    const submitterMap = new Map(submitters.map((u) => [u.id, u]));
    return rows.map((row) => {
      const submitterRow = submitterMap.get(row.userId) ?? null;
      return {
        ...this.toSubmissionDTO(row),
        submitter: submitterRow
          ? {
              id: submitterRow.id,
              email: submitterRow.email,
              name: submitterRow.name,
            }
          : { id: row.userId, email: '', name: null },
      };
    });
  }

  /**
   * 员工处理补录：与纠错共用状态机（need_supplement 须附说明；
   * resolved = 已收录）。终态/需补充均给提交人发站内通知；
   * 处理只改变补录记录本身，不直接修改任何公共目录或发布数据。
   */
  async reviewAnnouncementSubmission(
    reviewer: { id: string; role: string },
    submissionId: string,
    body: { status?: unknown; reviewNote?: unknown },
  ): Promise<AnnouncementSubmissionDTO> {
    const row = await this.prisma.announcementSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!row) {
      throw new NotFoundException('未找到该补录记录');
    }
    const result = validateReview({
      from: row.status,
      to: body.status,
      reviewNote: body.reviewNote,
      existingNote: row.reviewNote,
    });
    if (!result.ok) {
      throw new ConflictException(result.message);
    }
    const updated = await this.prisma.announcementSubmission.update({
      where: { id: row.id },
      data: {
        status: result.status,
        reviewNote: result.note ?? row.reviewNote,
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
      },
    });
    const noteLine = result.note ? `处理说明：${result.note}` : '';
    if (result.status === 'resolved') {
      await this.prisma.notificationRecord.create({
        data: {
          userId: row.userId,
          severity: 'info',
          title: `你补录的「${row.publisherName}」公告已收录处理`,
          body: `我们会按官方来源核对该公告并纳入监测，感谢你的补录。${noteLine}`,
          eventKey: null,
          relatedUnitId: null,
        },
      });
    } else if (result.status === 'need_supplement') {
      await this.prisma.notificationRecord.create({
        data: {
          userId: row.userId,
          severity: 'info',
          title: `你补录的「${row.publisherName}」公告需要补充信息`,
          body: `处理这条补录还需要更多信息。${noteLine}`,
          eventKey: null,
          relatedUnitId: null,
        },
      });
    } else if (result.status === 'rejected') {
      await this.prisma.notificationRecord.create({
        data: {
          userId: row.userId,
          severity: 'info',
          title: `你补录的「${row.publisherName}」公告暂未采纳`,
          body: `我们核对后暂未采纳这条补录。${noteLine}`,
          eventKey: null,
          relatedUnitId: null,
        },
      });
    }
    return this.toSubmissionDTO(updated);
  }

  // ==================== 内部工具 ====================

  private findCatalogUnit(
    unitId: string,
    catalog: readonly RecruitmentAnnouncement[],
  ): {
    announcementId: string;
    versionId: string;
  } {
    for (const announcement of catalog) {
      // M5 合规过滤：test 样本与 AI 初核待复核真实记录不可关注/查看
      if (!isUserVisibleInCatalog(announcement)) continue;
      const version = currentVersion(announcement);
      const unit = version.units.find((u) => u.id === unitId);
      if (unit) return { announcementId: announcement.id, versionId: version.id };
    }
    throw new NotFoundException('未找到该报考单元，它可能不属于当前已发布公告');
  }

  /** 新保存机会立即建立材料进度；旧关注记录读取时也得到同样的默认状态。 */
  private initialMaterialStatuses(
    unitId: string,
    catalog: readonly RecruitmentAnnouncement[],
  ): Record<string, MaterialStatus> {
    for (const announcement of catalog) {
      if (!isUserVisibleInCatalog(announcement)) continue;
      for (const version of announcement.versions) {
        const unit = version.units.find((candidate) => candidate.id === unitId);
        if (!unit) continue;
        return Object.fromEntries(
          (unit.materials ?? []).map((material) => [material.id, 'not_started' as const]),
        );
      }
    }
    return {};
  }

  /** 纠错展示用：跨全部版本查找单元名与公告标题（旧版本单元也要能显示） */
  private findCatalogUnitMeta(
    unitId: string,
    catalog: readonly RecruitmentAnnouncement[],
  ): {
    unitName: string;
    announcementTitle: string;
  } | null {
    for (const announcement of catalog) {
      for (const version of announcement.versions) {
        const unit = version.units.find((u) => u.id === unitId);
        if (unit) {
          return {
            unitName: unit.name,
            announcementTitle: announcement.title,
          };
        }
      }
    }
    return null;
  }

  private toCorrectionDTO(
    row: {
      id: string;
      userId: string;
      unitId: string;
      announcementId: string;
      versionId: string;
      fieldPath: string;
      content: string;
      contact: string | null;
      status: string;
      reviewNote: string | null;
      reviewerId: string | null;
      reviewedAt: Date | null;
      resolvedVersionId?: string | null;
      createdAt: Date;
    },
    catalog: readonly RecruitmentAnnouncement[],
  ): CorrectionDTO {
    const meta = this.findCatalogUnitMeta(row.unitId, catalog);
    return {
      id: row.id,
      unitId: row.unitId,
      unitName: meta?.unitName ?? null,
      announcementId: row.announcementId,
      announcementTitle: meta?.announcementTitle ?? null,
      versionId: row.versionId,
      fieldPath: row.fieldPath,
      fieldLabel: fieldPathLabel(row.fieldPath),
      content: row.content,
      contact: row.contact,
      status: row.status,
      reviewNote: row.reviewNote,
      reviewerId: row.reviewerId,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      resolvedVersionId: row.resolvedVersionId ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toSubmissionDTO(row: {
    id: string;
    officialUrl: string;
    publisherName: string;
    regionCode: string;
    note: string | null;
    status: string;
    reviewNote: string | null;
    reviewerId: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  }): AnnouncementSubmissionDTO {
    return {
      id: row.id,
      officialUrl: row.officialUrl,
      publisherName: row.publisherName,
      regionCode: row.regionCode,
      note: row.note,
      status: row.status,
      reviewNote: row.reviewNote,
      reviewerId: row.reviewerId,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** v7.1 M8：userId 可选——访客无关注记录，返回空数组 */
  private async listFollowRecords(userId?: string): Promise<FollowRecord[]> {
    if (!userId) return [];
    const catalog = await this.loadCatalog();
    const rows = await this.prisma.followedOpportunity.findMany({
      where: { userId },
      orderBy: { followedAt: 'asc' },
    });
    return rows.map((row) => this.fromRow(row, catalog));
  }

  private fromRow(
    row: {
      id: string;
      userId: string;
      unitId: string;
      announcementId: string;
      versionId: string;
      status: string;
      role: string | null;
      followedAt: Date;
      statusHistory: Prisma.JsonValue;
      abandonReason: string | null;
      materialStatuses?: Prisma.JsonValue | null;
      consultationNotes?: Prisma.JsonValue | null;
      version?: number;
      remindersMuted?: boolean;
    },
    catalog: readonly RecruitmentAnnouncement[],
  ): FollowRecord {
    return {
      id: row.id,
      userId: row.userId,
      unitId: row.unitId,
      announcementId: row.announcementId,
      versionId: row.versionId,
      status: (isFollowStatus(row.status) ? row.status : 'considering') as FollowStatus,
      role: row.role === 'primary' || row.role === 'backup' ? row.role : null,
      followedAt: row.followedAt.toISOString(),
      statusHistory: row.statusHistory as unknown as FollowStatusEvent[],
      abandonReason: row.abandonReason,
      materialStatuses:
        (row.materialStatuses as Record<string, MaterialStatus> | null) ??
        this.initialMaterialStatuses(row.unitId, catalog),
      consultationNotes:
        (row.consultationNotes as Record<string, string> | null) ?? null,
      version: row.version ?? 0,
      remindersMuted: row.remindersMuted ?? false,
    };
  }

  private toDTO(
    follow: FollowRecord,
    catalog: readonly RecruitmentAnnouncement[],
  ): FollowDTO {
    const announcement = catalog.find(
      (a) => a.id === follow.announcementId,
    );
    const currentVersionId = announcement
      ? currentVersion(announcement).id
      : follow.versionId;
    return {
      id: follow.id,
      unitId: follow.unitId,
      announcementId: follow.announcementId,
      versionId: follow.versionId,
      status: follow.status,
      role: follow.role,
      followedAt: follow.followedAt,
      statusHistory: follow.statusHistory,
      abandonReason: follow.abandonReason,
      newerVersion: follow.versionId !== currentVersionId,
      remindersMuted: follow.remindersMuted,
      version: follow.version,
      materialStatuses: follow.materialStatuses,
      consultationNotes: follow.consultationNotes,
    };
  }

  private asFollowStatus(value: unknown): FollowStatus {
    if (isFollowStatus(value)) return value;
    throw new BadRequestException('非法的关注状态');
  }

  private asMaterialStatus(value: unknown): MaterialStatus {
    if (
      value === 'not_started' ||
      value === 'in_progress' ||
      value === 'done' ||
      value === 'not_applicable'
    ) {
      return value;
    }
    throw new BadRequestException('非法的材料状态');
  }

  private asRole(value: unknown): StudyTargetRole {
    if (value === 'primary' || value === 'backup') return value;
    throw new BadRequestException('备考目标角色只能是 primary 或 backup');
  }

  /**
   * 画像入参校验（只做结构与枚举校验，不做业务推断）。
   * 缺省的条件事实（birthDate/hukouRegionCode 等）保持 undefined，
   * 由匹配引擎产出 UNKNOWN。
   */
  private validateProfile(input: unknown): UserRecruitmentProfile {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException('请求体缺少画像数据 profile');
    }
    const p = input as Record<string, unknown>;

    if (!Array.isArray(p.regions)) {
      throw new BadRequestException('画像 regions 必须是数组');
    }
    const regionLevels: RegionPreferenceLevel[] = [
      'required',
      'preferred',
      'consider',
    ];
    const regions = p.regions.map((raw, index) => {
      if (typeof raw !== 'object' || raw === null) {
        throw new BadRequestException(`regions[${index}] 结构不正确`);
      }
      const r = raw as Record<string, unknown>;
      if (
        typeof r.code !== 'string' ||
        typeof r.province !== 'string' ||
        !regionLevels.includes(r.level as RegionPreferenceLevel)
      ) {
        throw new BadRequestException(`regions[${index}] 字段不完整或取值非法`);
      }
      return {
        code: r.code,
        province: r.province,
        city: typeof r.city === 'string' ? r.city : undefined,
        district: typeof r.district === 'string' ? r.district : undefined,
        level: r.level as RegionPreferenceLevel,
      };
    });

    const educationLevels: CredentialLevel[] = [
      'secondary',
      'college',
      'bachelor',
      'master',
      'doctorate',
    ];
    if (
      p.educationLevel !== undefined &&
      p.educationLevel !== null &&
      !educationLevels.includes(p.educationLevel as CredentialLevel)
    ) {
      throw new BadRequestException('画像 educationLevel 取值非法');
    }
    const degrees: DegreeCode[] = ['none', 'bachelor', 'master', 'doctorate'];
    if (
      p.degree !== undefined &&
      p.degree !== null &&
      !degrees.includes(p.degree as DegreeCode)
    ) {
      throw new BadRequestException('画像 degree 取值非法');
    }
    if (
      p.majorFullName !== undefined &&
      p.majorFullName !== null &&
      typeof p.majorFullName !== 'string'
    ) {
      throw new BadRequestException('画像 majorFullName 必须是字符串');
    }
    const employmentStatuses: EmploymentStatus[] = [
      'student',
      'fresh_unemployed',
      'employed_fulltime',
      'employed_parttime',
      'other',
    ];
    if (
      p.employmentStatus !== undefined &&
      p.employmentStatus !== null &&
      !employmentStatuses.includes(p.employmentStatus as EmploymentStatus)
    ) {
      throw new BadRequestException('画像 employmentStatus 取值非法');
    }
    if (
      p.teacherCert !== undefined &&
      p.teacherCert !== null &&
      typeof p.teacherCert !== 'object'
    ) {
      throw new BadRequestException('画像 teacherCert 结构不正确');
    }
    const cert =
      typeof p.teacherCert === 'object' && p.teacherCert !== null
        ? (p.teacherCert as Record<string, unknown>)
        : undefined;
    const certStatuses: TeacherCertStatus[] = [
      'obtained',
      'in_progress',
      'none',
    ];
    if (
      cert?.status !== undefined &&
      !certStatuses.includes(cert.status as TeacherCertStatus)
    ) {
      throw new BadRequestException('画像 teacherCert.status 取值非法');
    }
    if (
      !Array.isArray(p.acceptedEmploymentNatures) ||
      p.acceptedEmploymentNatures.some(
        (n) =>
          !([
            'public_institution_staff',
            'record_filing',
            'post_quota',
            'headcount_control',
            'other',
          ] as EmploymentNatureCode[]).includes(n as EmploymentNatureCode),
      )
    ) {
      throw new BadRequestException(
        '画像 acceptedEmploymentNatures 必须是用工性质枚举数组',
      );
    }
    // v7.2：用工偏好三选一，只影响展示/排序/偏好范围外分类，不进入资格判定
    const naturePrefRaw = (p as Record<string, unknown>).employmentNaturePreference;
    if (
      naturePrefRaw !== undefined &&
      naturePrefRaw !== null &&
      !(['public_only', 'official_open', 'undecided'] as string[]).includes(
        naturePrefRaw as string,
      )
    ) {
      throw new BadRequestException(
        '画像 employmentNaturePreference 取值非法（必须为 public_only/official_open/undecided）',
      );
    }

    const optionalIso = (key: string): string | undefined => {
      const v = p[key];
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v !== 'string' || Number.isNaN(new Date(v).getTime())) {
        throw new BadRequestException(`画像 ${key} 不是合法日期`);
      }
      return v;
    };
    const optionalMonths = (key: string): number | undefined => {
      const v = p[key];
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) {
        throw new BadRequestException(`画像 ${key} 必须是非负数字`);
      }
      return v;
    };

    return {
      regions,
      educationLevel: p.educationLevel as CredentialLevel | undefined,
      degree: p.degree as DegreeCode | undefined,
      majorFullName:
        typeof p.majorFullName === 'string' && p.majorFullName.trim()
          ? p.majorFullName.trim()
          : undefined,
      graduationDate: optionalIso('graduationDate'),
      employmentStatus: p.employmentStatus as EmploymentStatus | undefined,
      teacherCert: cert?.status
        ? {
            status: cert.status as TeacherCertStatus,
            subject: typeof cert.subject === 'string' ? cert.subject : undefined,
            stage: typeof cert.stage === 'string' ? cert.stage : undefined,
            expectedDate:
              typeof cert.expectedDate === 'string'
                ? cert.expectedDate
                : undefined,
          }
        : undefined,
      acceptedEmploymentNatures:
        p.acceptedEmploymentNatures as EmploymentNatureCode[],
      // v7.2：用工偏好透传（已校验），只影响展示/排序/偏好范围外分类
      employmentNaturePreference:
        naturePrefRaw === undefined || naturePrefRaw === null
          ? undefined
          : (naturePrefRaw as EmploymentNaturePreference),
      birthDate: optionalIso('birthDate'),
      hukouRegionCode:
        typeof p.hukouRegionCode === 'string' && p.hukouRegionCode
          ? p.hukouRegionCode
          : undefined,
      socialSecurityMonths: optionalMonths('socialSecurityMonths'),
      workExperienceMonths: optionalMonths('workExperienceMonths'),
      extraAnswers:
        typeof p.extraAnswers === 'object' &&
        p.extraAnswers !== null &&
        !Array.isArray(p.extraAnswers)
          ? (p.extraAnswers as Record<string, string>)
          : undefined,
    };
  }
}
