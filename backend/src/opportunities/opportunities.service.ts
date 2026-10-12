import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';
import { REAL_ANNOUNCEMENTS } from '../matching/real-catalog.js';
import { getRollingCatalogAnnouncements } from '../matching/rolling-catalog.js';
import { buildCandidates, currentVersion } from '../matching/engine.js';
import type {
  CredentialLevel,
  DegreeCode,
  EmploymentNatureCode,
  EmploymentStatus,
  MaterialStatus,
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
  validateReview,
  type CorrectionDTO,
  type StaffCorrectionDTO,
} from './corrections.domain.js';
import {
  buildGoals,
  buildMatchResponse,
  buildQualificationSnapshot,
  buildUnitDetail,
  type CatalogSnapshot,
  type FollowDTO,
  type GoalsResponse,
  type MatchResponse,
  type SubscriptionDTO,
  type SubscriptionSyncDTO,
  type UnitDetailResponse,
} from './view.js';
import {
  deriveSubscriptionCriteria,
  planOpportunityNotices,
  type NaturePreferenceCode,
  type SubscriptionCriteria,
} from './subscription.domain.js';

/**
 * 当前已发布公告目录 = 演示场景（catalog.ts 滚动时间轴）+
 * 真实监测台账（real-catalog.ts，杭州/宁波，人工维护）。
 * 两者通过 dataset 字段区分；真实记录未人工复核不进主要推荐。
 */
function getPublishedAnnouncements() {
  return [
    ...getRollingCatalogAnnouncements(),
    ...REAL_ANNOUNCEMENTS,
  ];
}

/**
 * 机会发现服务（PRD 7.4/7.5/7.7/7.10）。
 *
 * - 匹配为“按请求即时计算”：每次请求用当前画像 + 已发布公告目录现算，
 *   受邀用户量级很小，不引入批量队列与缓存；
 * - 画像由前端随请求提交（基础画像 + 补问事实），服务端不做规则缓存，
 *   用户修改画像后的下一次请求即为新结果；
 * - 关注关系与纠错留痕持久化在 PostgreSQL。
 */
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileService: ProfileService,
  ) {}

  /** 画像来源：请求体优先；未携带时读取服务端持久画像（受邀模式跨浏览器恢复） */
  private async resolveProfile(
    profile: unknown,
    userId: string,
  ): Promise<UserRecruitmentProfile> {
    if (profile !== undefined && profile !== null) {
      return this.validateProfile(profile);
    }
    const persisted = await this.profileService.getProfile(userId);
    if (persisted === null) {
      throw new BadRequestException('尚未保存画像，请先完成基础画像');
    }
    return this.validateProfile(persisted);
  }

  // ==================== 匹配：列表 / 详情 ====================

  async match(profile: unknown, userId: string): Promise<MatchResponse> {
    const valid = await this.resolveProfile(profile, userId);
    const candidates = buildCandidates(
      getPublishedAnnouncements(),
      valid,
      new Date().toISOString(),
    );
    return this.assemble(candidates, valid, userId);
  }

  async unitDetail(
    profile: unknown,
    userId: string,
    unitId: string,
  ): Promise<UnitDetailResponse> {
    const valid = await this.resolveProfile(profile, userId);
    const candidates = buildCandidates(
      getPublishedAnnouncements(),
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
    userId: string,
  ): Promise<MatchResponse> {
    const follows = await this.listFollowRecords(userId);
    return buildMatchResponse(candidates, profile, follows, new Date());
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
    const row = await this.prisma.opportunitySubscription.findUnique({
      where: { userId },
    });
    if (!row || !row.enabled) {
      return { enabled: false, subscribed: row !== null, newNotices: 0, backfilled: 0 };
    }
    const criteria: SubscriptionCriteria = {
      regions: row.regions as SubscriptionCriteria['regions'],
      subject: row.subject,
      naturePreference: row.naturePreference as NaturePreferenceCode,
    };

    // “没有已知明确不符合项”：以当前画像的即时匹配结果为准
    const profile = await this.safeProfile(userId);
    const ineligibleUnitIds = new Set<string>();
    if (profile) {
      const candidates = buildCandidates(
        getPublishedAnnouncements(),
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
      announcements: getPublishedAnnouncements(),
      criteria,
      ineligibleUnitIds,
      existingKeys,
      now: new Date(),
    });
    if (plan.keys.length === 0) {
      return { enabled: true, subscribed: true, newNotices: 0, backfilled: 0 };
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
    };
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
    return follows.map((follow) => this.toDTO(follow));
  }

  /** 备考目标列表（模块 7）：活跃关注 + 公告版本聚合，供主要目标选择与 /study 页使用 */
  async listGoals(userId: string): Promise<GoalsResponse> {
    const follows = await this.listFollowRecords(userId);
    const catalog = this.buildCatalogSnapshot();
    return buildGoals(follows, catalog);
  }

  /** 当前目录的全部公告/版本/单元聚合快照（goals 视图装配用） */
  private buildCatalogSnapshot(): CatalogSnapshot[] {
    const snapshots: CatalogSnapshot[] = [];
    for (const announcement of getPublishedAnnouncements()) {
      // 模块 7.5 合规过滤：用户端不返回 AI 初核待人工复核记录
      if (announcement.dataset === 'real') continue;
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
   */
  async follow(userId: string, unitId: string): Promise<FollowDTO> {
    const target = this.findCatalogUnit(unitId);
    const existing = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (existing) {
      return this.toDTO(this.fromRow(existing));
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
        materialStatuses: this.initialMaterialStatuses(unitId) as Prisma.InputJsonValue,
      },
    });
    return this.toDTO(this.fromRow(row));
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
    let merged = 0;
    let skipped = 0;
    for (const item of items) {
      if (!item || typeof item.unitId !== 'string') {
        skipped++;
        continue;
      }
      let target: { announcementId: string; versionId: string };
      try {
        target = this.findCatalogUnit(item.unitId);
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
              : (this.initialMaterialStatuses(item.unitId) as Prisma.InputJsonValue),
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
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('尚未关注该机会');
    const current = this.fromRow(row);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        error: 'VERSION_CONFLICT',
        current: this.toDTO(current),
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
    return this.toDTO(this.fromRow(saved));
  }

  private assertVersion(current: FollowRecord, expectedVersion?: number) {
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        error: 'VERSION_CONFLICT',
        current: this.toDTO(current),
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
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('尚未关注该机会');
    const current = this.fromRow(row);
    this.assertVersion(current, expectedVersion);
    const updated = applyMaterialStatus(current, itemId, status);
    if (updated === current) return this.toDTO(current);
    const saved = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: {
        materialStatuses: updated.materialStatuses as unknown as Prisma.InputJsonValue,
        version: updated.version,
      },
    });
    return this.toDTO(this.fromRow(saved));
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
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('尚未关注该机会');
    const current = this.fromRow(row);
    this.assertVersion(current, expectedVersion);
    const updated = applyConsultationNote(current, dimensionKey, note);
    if (updated === current) return this.toDTO(current);
    const saved = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: {
        consultationNotes: updated.consultationNotes as unknown as Prisma.InputJsonValue,
        version: updated.version,
      },
    });
    return this.toDTO(this.fromRow(saved));
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
    return this.toDTO(this.fromRow(row));
  }

  /** 开启/关闭单个机会的站内提醒（日程仍可见，只是不产生通知） */
  async setRemindersMuted(
    userId: string,
    unitId: string,
    muted: boolean,
  ): Promise<FollowDTO> {
    const row = await this.prisma.followedOpportunity.findUnique({
      where: { userId_unitId: { userId, unitId } },
    });
    if (!row) throw new NotFoundException('请先关注该机会，再设置提醒开关');
    const updated = await this.prisma.followedOpportunity.update({
      where: { userId_unitId: { userId, unitId } },
      data: { remindersMuted: muted },
    });
    return this.toDTO(this.fromRow(updated));
  }

  // ==================== 纠错提交（证据层，PRD 7.10） ====================

  async submitCorrection(
    userId: string,
    unitId: string,
    body: { fieldPath?: unknown; content?: unknown; contact?: unknown },
  ): Promise<{ id: string; status: string }> {
    const target = this.findCatalogUnit(unitId);
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
    const rows = await this.prisma.opportunityCorrection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.toCorrectionDTO(row));
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
    return rows.map((row) => {
      const submitterRow = submitterMap.get(row.userId) ?? null;
      return {
        ...this.toCorrectionDTO(row),
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
   * 员工处理纠错：
   * - 状态机校验见 corrections.domain（终态不可改、不采纳必须写说明）；
   * - resolved/rejected 时给提交人发一条站内通知，通知只含结论与说明，
   *   不含联系方式等其他用户信息；
   * - 纠错记录不物理删除，处理人/处理时间/说明全部留痕。
   */
  async reviewCorrection(
    reviewer: { id: string; role: string },
    correctionId: string,
    body: { status?: unknown; reviewNote?: unknown },
  ): Promise<CorrectionDTO> {
    const row = await this.prisma.opportunityCorrection.findUnique({
      where: { id: correctionId },
    });
    if (!row) {
      throw new NotFoundException('未找到该纠错记录');
    }
    const result = validateReview({
      from: row.status,
      to: body.status,
      reviewNote: body.reviewNote,
    });
    if (!result.ok) {
      throw new ConflictException(result.message);
    }
    const now = new Date();
    const updated = await this.prisma.opportunityCorrection.update({
      where: { id: row.id },
      data: {
        status: result.status,
        reviewNote: result.note ?? row.reviewNote,
        reviewerId: reviewer.id,
        reviewedAt: now,
      },
    });

    if (isTerminalStatus(result.status)) {
      const meta = this.findCatalogUnitMeta(row.unitId);
      const unitName = meta?.unitName ?? '该机会';
      const noteLine = result.note ? `处理说明：${result.note}` : '';
      if (result.status === 'resolved') {
        await this.prisma.notificationRecord.create({
          data: {
            userId: row.userId,
            severity: 'info',
            title: `你提交的「${unitName}」纠错已采纳并修正`,
            body:
              `我们已核对官方原文，确认你反馈的「${fieldPathLabel(row.fieldPath)}」问题，` +
              `并在新版本中完成更正，感谢你的反馈。${noteLine}`,
            eventKey: null,
            relatedUnitId: row.unitId,
          },
        });
      } else {
        await this.prisma.notificationRecord.create({
          data: {
            userId: row.userId,
            severity: 'info',
            title: `你提交的「${unitName}」纠错已核对完成`,
            body:
              `我们核对官方原文后暂未采纳这条「${fieldPathLabel(row.fieldPath)}」纠错。` +
              noteLine,
            eventKey: null,
            relatedUnitId: row.unitId,
          },
        });
      }
    }

    return this.toCorrectionDTO(updated);
  }

  // ==================== 内部工具 ====================

  private findCatalogUnit(unitId: string): {
    announcementId: string;
    versionId: string;
  } {
    for (const announcement of getPublishedAnnouncements()) {
      // 模块 7.5 合规过滤：普通用户端不允许关注/查看 AI 初核待人工复核记录
      if (announcement.dataset === 'real') continue;
      const version = currentVersion(announcement);
      const unit = version.units.find((u) => u.id === unitId);
      if (unit) return { announcementId: announcement.id, versionId: version.id };
    }
    throw new NotFoundException('未找到该报考单元，它可能不属于当前已发布公告');
  }

  /** 新保存机会立即建立材料进度；旧关注记录读取时也得到同样的默认状态。 */
  private initialMaterialStatuses(unitId: string): Record<string, MaterialStatus> {
    for (const announcement of getPublishedAnnouncements()) {
      if (announcement.dataset === 'real') continue;
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
  private findCatalogUnitMeta(unitId: string): {
    unitName: string;
    announcementTitle: string;
  } | null {
    for (const announcement of getPublishedAnnouncements()) {
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
      createdAt: Date;
    },
  ): CorrectionDTO {
    const meta = this.findCatalogUnitMeta(row.unitId);
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
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async listFollowRecords(userId: string): Promise<FollowRecord[]> {
    const rows = await this.prisma.followedOpportunity.findMany({
      where: { userId },
      orderBy: { followedAt: 'asc' },
    });
    return rows.map((row) => this.fromRow(row));
  }

  private fromRow(row: {
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
  }): FollowRecord {
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
        this.initialMaterialStatuses(row.unitId),
      consultationNotes:
        (row.consultationNotes as Record<string, string> | null) ?? null,
      version: row.version ?? 0,
      remindersMuted: row.remindersMuted ?? false,
    };
  }

  private toDTO(follow: FollowRecord): FollowDTO {
    const announcement = getPublishedAnnouncements().find(
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
