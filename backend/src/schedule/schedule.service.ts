/**
 * 日程与通知服务（v6.1 模块 6）。
 *
 * - 事件从已发布公告版本的 timeline 生成，按用户关注的报考单元落库；
 * - eventKey 用户内唯一，重复同步幂等；新版本变更时间时更新同一记录并追加 changeHistory；
 * - 时间未定（pendingItems）只生成 dateIso=null 的 pending_notice 事件，绝不推测日期；
 * - 已关闭提醒的机会仍在日程中展示，只是不产生通知；
 * - 不接短信/微信/邮件/Web Push，仅站内通知（NotificationRecord）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { getRollingCatalogAnnouncements } from '../matching/rolling-catalog.js';
import { currentVersion } from '../matching/engine.js';
import type {
  ApplicationUnit,
  RecruitmentAnnouncement,
} from '../matching/types.js';
import {
  baselineStateFor,
  changeNotificationBody as versionChangeBody,
  changeNotificationTitle as versionChangeTitle,
  deriveUnitTrust,
  describeTimelineChange,
  diffFollowedAnnouncement,
  maxSeverity,
  noticeStateOf,
  resolveUnitInVersion,
  sameNoticeState,
  type FollowNoticeState,
  type UnitTrust,
} from '../changes/changes.domain.js';
import { regionLabel } from './labels.js';
import {
  daysUntil,
  generateEvents,
  isPast,
  KIND_LABELS,
  severityOfChange,
  urgencyOf,
  type NotificationSeverity,
  type RawTimelineEvent,
  type TimelineChangeRecord,
  type TimelineEventKind,
} from './events.domain.js';

export interface TimelineEventDTO {
  id: string;
  unitId: string;
  unitName: string;
  regionText: string;
  registerUrl?: string;
  eventKey: string;
  kind: TimelineEventKind;
  kindLabel: string;
  dateIso: string | null;
  dateText: string;
  pending: boolean;
  urgency: 'must' | 'suggest' | 'info';
  past: boolean;
  action: { label: string; href: string; external?: boolean } | null;
  /** 相比上一版本是否有变更（前端可高亮） */
  changedFromPrevious: {
    field: 'dateIso' | 'title';
    oldValue: string;
    newValue: string;
    /** 对当前用户的影响（模块 7） */
    impact?: string;
    /** 下一步建议动作（模块 7） */
    nextStep?: string;
  } | null;
}

export interface ScheduleResponse {
  meta: { evaluatedAt: string; syncVersion: string };
  events: TimelineEventDTO[];
  /** 已关闭提醒的机会（前端可在对应分组显示“已静音”标记） */
  mutedUnitIds: string[];
  /** 首屏「当前最重要的一个动作」：按状态/截止/材料进度推导 */
  nextAction: NextActionDTO | null;
  /** 各机会的可信状态（模块 7）：来源失效/公告取消/待人工复核时降级为可理解状态 */
  unitTrust: Record<string, UnitTrust>;
}

export interface NextActionDTO {
  unitId: string;
  unitName: string;
  kind: 'register' | 'materials' | 'review' | 'timeline';
  label: string;
  href: string;
}

export interface NotificationDTO {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  relatedUnitId: string | null;
  readAt: string | null;
  createdAt: string;
}

export const SYNC_VERSION = 'kb-schedule-sync-1.1.0';

const KIND_ORDER: TimelineEventKind[] = [
  'registration_start',
  'registration_end',
  'payment',
  'admit_ticket',
  'written_exam',
  'score',
  'interview',
  'pending_notice',
];

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 事件同步（按用户关注的机会） ====================

  /**
   * 从当前已发布公告目录重新同步某用户的时间线事件，并检测公告级别变更。
   * - 同一 eventKey 已存在且版本未变 → 跳过（幂等）；
   * - 版本变化导致 dateIso/title 变化 → 更新记录并追加 changeHistory，同时产生一条变更通知；
   * - 公告级别变更（取消/来源失效/资格条件变化）→ 由 changes.domain 检测，幂等通知；
   * - 当前公告版本中不再存在的 eventKey → 标记 superseded（保留记录，不删除）；
   * - 已静音的机会仍同步事件（日程可见），但不产生通知。
   *
   * 返回本次产生的通知数量。
   */
  async syncEventsForUser(userId: string): Promise<number> {
    const follows = await this.prisma.followedOpportunity.findMany({
      where: {
        userId,
        status: { notIn: ['abandoned', 'closed'] },
      },
    });

    const now = new Date();
    const nowIso = now.toISOString();
    const activeKeys = new Set<string>();
    let notificationCount = 0;

    for (const follow of follows) {
      const announcement = getRollingCatalogAnnouncements().find(
        (a) => a.id === follow.announcementId,
      );
      if (!announcement) continue;
      const version = currentVersion(announcement);

      // === 模块 7：公告级别变更检测（版本 / 生命周期 / 来源健康度）===
      const previousState =
        this.parseLastNotifiedState(follow.lastNotifiedState as Prisma.JsonValue) ??
        baselineStateFor(follow.versionId, announcement);
      const currentState = noticeStateOf(announcement, version);

      if (!sameNoticeState(previousState, currentState)) {
        const versionChanges = diffFollowedAnnouncement({
          announcement,
          previous: previousState,
          current: version,
          followedUnitId: follow.unitId,
        });

        if (versionChanges.length > 0 && !follow.remindersMuted) {
          const oldVersion = announcement.versions.find(
            (v) => v.id === previousState.versionId,
          );
          const unitCurrent = resolveUnitInVersion(version, follow.unitId, oldVersion);
          const unitOld = oldVersion
            ? resolveUnitInVersion(oldVersion, follow.unitId, oldVersion)
            : undefined;
          const title = versionChangeTitle(
            unitCurrent?.name ?? unitOld?.name ?? '已关注岗位',
            versionChanges,
            version,
          );
          const severity = maxSeverity(versionChanges);
          const body = versionChangeBody(versionChanges);
          await this.createNotification(
            userId,
            severity,
            title,
            body,
            null,
            follow.unitId,
          );
          notificationCount += 1;
        }

        // 推进通知基线
        await this.prisma.followedOpportunity.update({
          where: { id: follow.id },
          data: {
            lastNotifiedState: currentState as unknown as Prisma.InputJsonValue,
          },
        });
      } else if (follow.lastNotifiedState == null) {
        // 历史记录首次同步：静默落基线（以关注版本 + 当前生命周期/来源为准），
        // 之后的取消/失效/版本变更才能与持久基线对比，且不产生补发风暴。
        await this.prisma.followedOpportunity.update({
          where: { id: follow.id },
          data: {
            lastNotifiedState: currentState as unknown as Prisma.InputJsonValue,
          },
        });
      }

      // === 时间线事件同步（报考单元跨版本按 code 对齐；版本中已移除则跳过事件同步）===
      const followVersion = announcement.versions.find(
        (v) => v.id === follow.versionId,
      );
      const unit = resolveUnitInVersion(version, follow.unitId, followVersion);
      if (!unit) continue;

      const rawEvents = generateEvents(follow.unitId, version.timeline);

      for (const raw of rawEvents) {
        activeKeys.add(raw.eventKey);
        const existing = await this.prisma.timelineEvent.findUnique({
          where: { userId_eventKey: { userId, eventKey: raw.eventKey } },
        });

        if (existing && existing.versionId === version.id) {
          // 同一版本重复同步：幂等，不更新、不产生通知
          if (existing.status === 'superseded') {
            await this.prisma.timelineEvent.update({
              where: { id: existing.id },
              data: { status: 'active' },
            });
          }
          continue;
        }

        if (!existing) {
          await this.prisma.timelineEvent.create({
            data: {
              userId,
              unitId: follow.unitId,
              announcementId: follow.announcementId,
              versionId: version.id,
              eventKey: raw.eventKey,
              kind: raw.kind,
              title: raw.title,
              dateIso: raw.dateIso,
              status: 'active',
              changeHistory: [],
            },
          });
          // 新事件：仅在非静音且为截止类/明确日期时产生 info 通知
          if (!follow.remindersMuted && raw.dateIso) {
            await this.createNotification(
              userId,
              'info',
              `${unit.name} · ${raw.title}`,
              this.notificationBody(raw, unit, version.id, announcement),
              raw.eventKey,
              follow.unitId,
            );
            notificationCount += 1;
          }
          continue;
        }

        // 已有记录但版本变化：比较 dateIso 与 title
        const dateChanged = existing.dateIso !== raw.dateIso;
        const titleChanged = existing.title !== raw.title;
        if (!dateChanged && !titleChanged) {
          // 版本变但值未变：只更新 versionId，不产生通知
          await this.prisma.timelineEvent.update({
            where: { id: existing.id },
            data: { versionId: version.id, status: 'active' },
          });
          continue;
        }

        // 值变化：追加 changeHistory（先捕获旧值，再更新，避免对象引用被覆盖）
        const oldDateIso = existing.dateIso;
        const oldTitle = existing.title;
        const history = (existing.changeHistory as unknown as TimelineChangeRecord[]) ?? [];
        history.push({
          versionId: existing.versionId,
          dateIso: oldDateIso,
          title: oldTitle,
          changedAt: nowIso,
        });
        await this.prisma.timelineEvent.update({
          where: { id: existing.id },
          data: {
            versionId: version.id,
            title: raw.title,
            dateIso: raw.dateIso,
            status: 'active',
            changeHistory: history as unknown as Prisma.InputJsonValue,
          },
        });

        if (!follow.remindersMuted) {
          const severity = severityOfChange(raw.kind, oldDateIso, raw.dateIso);
          await this.createNotification(
            userId,
            severity,
            `${unit.name} · ${raw.title}时间有更新`,
            this.changeNotificationBody(raw, oldDateIso, oldTitle, unit),
            raw.eventKey,
            follow.unitId,
          );
          notificationCount += 1;
        }
      }
    }

    // 当前版本中不再存在的事件 → superseded（保留记录）
    if (activeKeys.size > 0) {
      await this.prisma.timelineEvent.updateMany({
        where: {
          userId,
          status: 'active',
          eventKey: { notIn: Array.from(activeKeys) },
        },
        data: { status: 'superseded' },
      });
    }

    return notificationCount;
  }

  // ==================== 日程查询 ====================

  async getSchedule(userId: string): Promise<ScheduleResponse> {
    // 先同步再查询，保证拿到最新公告版本的事件
    await this.syncEventsForUser(userId);

    const nowIso = new Date().toISOString();
    const events = await this.prisma.timelineEvent.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    // 取关注记录（含静音标记）与单元元信息
    const follows = await this.prisma.followedOpportunity.findMany({
      where: { userId, status: { notIn: ['abandoned', 'closed'] } },
    });
    const mutedUnitIds = follows.filter((f) => f.remindersMuted).map((f) => f.unitId);
    const unitMeta = new Map<string, { name: string; regionText: string; registerUrl?: string; registrationEnd?: string; materialsCount: number; doneCount: number; status: string }>();
    const unitTrust: Record<string, UnitTrust> = {};
    for (const f of follows) {
      const ann = getRollingCatalogAnnouncements().find((a) => a.id === f.announcementId);
      if (!ann) continue;
      const version = currentVersion(ann);
      const followVersion = ann.versions.find((v) => v.id === f.versionId);
      // 模块 7：跨版本按 code 对齐单元（关注时的单元 id 可能属于旧版本）
      const unit = resolveUnitInVersion(version, f.unitId, followVersion);
      // 可信状态降级（来源失效/取消/待复核）：单元被移除时也保留状态展示
      unitTrust[f.unitId] = deriveUnitTrust(ann);
      if (!unit) continue;
      const materialStatuses =
        (f.materialStatuses as Record<string, string> | null) ?? null;
      const materials = unit.materials ?? [];
      const doneCount = materials.filter(
        (m) => materialStatuses?.[m.id] === 'done',
      ).length;
      unitMeta.set(f.unitId, {
        name: unit.name,
        regionText: regionLabel(unit.region),
        registerUrl: unit.registerUrl,
        registrationEnd: version.timeline.registrationEnd,
        materialsCount: materials.length,
        doneCount,
        status: f.status,
      });
    }

    const dtos: TimelineEventDTO[] = events
      .map((e) => {
        const meta = unitMeta.get(e.unitId);
        if (!meta) return null;
        return this.toDTO(e, meta, nowIso, unitTrust[e.unitId]);
      })
      .filter((d): d is TimelineEventDTO => d !== null)
      .sort((a, b) => {
        const byKind =
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
        if (byKind !== 0) return byKind;
        return (a.dateIso ?? '').localeCompare(b.dateIso ?? '');
      });

    // 首屏「当前最重要的一个动作」：按截止临近 > 材料未完成 > 查看机会 优先级选一个
    const nowMs = Date.now();
    const candidates: { priority: number; sortKey: number; action: NextActionDTO }[] = [];
    for (const f of follows) {
      const meta = unitMeta.get(f.unitId);
      if (!meta) continue;
      // 可信状态降级（公告取消/来源失效）的机会不进入「当前最重要的一个动作」
      const trust = unitTrust[f.unitId];
      if (trust && trust.state !== 'ok' && trust.state !== 'pending_review') continue;
      const href = `/opportunities/${encodeURIComponent(f.unitId)}#follow`;
      if (meta.registrationEnd && f.status !== 'registered') {
        const daysLeft = Math.ceil(
          (new Date(meta.registrationEnd).getTime() - nowMs) / 86400000,
        );
        if (daysLeft <= 3) {
          candidates.push({
            priority: 0,
            sortKey: daysLeft,
            action: {
              unitId: f.unitId,
              unitName: meta.name,
              kind: 'register',
              label: `进入官方报名入口（还剩 ${daysLeft} 天）`,
              href,
            },
          });
          continue;
        }
      }
      if (f.status === 'preparing' && meta.materialsCount > meta.doneCount) {
        candidates.push({
          priority: 1,
          sortKey: meta.doneCount - meta.materialsCount,
          action: {
            unitId: f.unitId,
            unitName: meta.name,
            kind: 'materials',
            label: `准备报名材料（${meta.doneCount}/${meta.materialsCount}）`,
            href,
          },
        });
        continue;
      }
      if (f.status === 'considering') {
        candidates.push({
          priority: 2,
          sortKey: 0,
          action: {
            unitId: f.unitId,
            unitName: meta.name,
            kind: 'review',
            label: '查看该机会并推进',
            href,
          },
        });
      }
    }
    candidates.sort((a, b) =>
      a.priority !== b.priority
        ? a.priority - b.priority
        : a.sortKey - b.sortKey,
    );
    const nextAction = candidates[0]?.action ?? null;

    return {
      meta: { evaluatedAt: nowIso, syncVersion: SYNC_VERSION },
      events: dtos,
      mutedUnitIds,
      nextAction,
      unitTrust,
    };
  }

  // ==================== 通知 ====================

  async listNotifications(userId: string): Promise<NotificationDTO[]> {
    const rows = await this.prisma.notificationRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      severity: r.severity as NotificationSeverity,
      title: r.title,
      body: r.body,
      relatedUnitId: r.relatedUnitId,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notificationRecord.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notificationRecord.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ==================== 内部工具 ====================

  private toDTO(
    row: {
      id: string;
      unitId: string;
      eventKey: string;
      kind: string;
      title: string;
      dateIso: string | null;
      changeHistory: Prisma.JsonValue;
    },
    meta: { name: string; regionText: string; registerUrl?: string },
    nowIso: string,
    trust?: UnitTrust,
  ): TimelineEventDTO {
    const kind = row.kind as TimelineEventKind;
    const d = daysUntil(row.dateIso, nowIso);
    const past = isPast(row.dateIso, nowIso);
    // 公告取消 / 来源失效：节点保留作留档，但不再提示行动、不制造紧迫感
    const degraded = trust?.state === 'withdrawn' || trust?.state === 'source_unavailable';
    const urgency = degraded ? 'info' : urgencyOf(kind, d);
    const action = degraded
      ? null
      : this.buildAction(kind, row.dateIso, past, meta.registerUrl);

    // 检测是否有变更历史（最近一次）
    const history = (row.changeHistory as unknown as TimelineChangeRecord[]) ?? [];
    let changedFromPrevious: TimelineEventDTO['changedFromPrevious'] = null;
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (last.dateIso !== row.dateIso) {
        const desc = describeTimelineChange(kind, last.dateIso, row.dateIso);
        changedFromPrevious = {
          field: 'dateIso',
          oldValue: last.dateIso ?? '待官方通知',
          newValue: row.dateIso ?? '待官方通知',
          impact: desc.impact,
          nextStep: desc.nextStep,
        };
      } else if (last.title !== row.title) {
        changedFromPrevious = {
          field: 'title',
          oldValue: last.title,
          newValue: row.title,
        };
      }
    }

    return {
      id: row.id,
      unitId: row.unitId,
      unitName: meta.name,
      regionText: meta.regionText,
      registerUrl: meta.registerUrl,
      eventKey: row.eventKey,
      kind,
      kindLabel: KIND_LABELS[kind],
      dateIso: row.dateIso,
      dateText: row.dateIso ? this.formatDate(row.dateIso) : '待官方通知',
      pending: row.dateIso === null,
      urgency,
      past,
      action,
      changedFromPrevious,
    };
  }

  private buildAction(
    kind: TimelineEventKind,
    dateIso: string | null,
    past: boolean,
    registerUrl?: string,
  ): TimelineEventDTO['action'] {
    if (past || !dateIso) return null;
    if (kind === 'registration_end' && registerUrl) {
      return { label: '去报名入口', href: registerUrl, external: true };
    }
    if (kind === 'registration_start' && registerUrl) {
      return { label: '查看报名入口', href: registerUrl, external: true };
    }
    if (kind === 'written_exam' || kind === 'interview') {
      return { label: '去备考', href: '/study' };
    }
    return null;
  }

  private formatDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
  }

  /** 解析关注记录的通知基线（模块 7）；非法结构视为无基线 */
  private parseLastNotifiedState(value: Prisma.JsonValue): FollowNoticeState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.versionId !== 'string') return null;
    if (v.lifecycle !== 'active' && v.lifecycle !== 'withdrawn') return null;
    if (typeof v.sourceOk !== 'boolean') return null;
    return {
      versionId: v.versionId,
      lifecycle: v.lifecycle,
      sourceOk: v.sourceOk,
    };
  }

  private async createNotification(
    userId: string,
    severity: NotificationSeverity,
    title: string,
    body: string,
    eventKey: string | null,
    relatedUnitId: string,
  ): Promise<void> {
    await this.prisma.notificationRecord.create({
      data: {
        userId,
        severity,
        title,
        body,
        eventKey,
        relatedUnitId,
      },
    });
  }

  private notificationBody(
    raw: RawTimelineEvent,
    unit: ApplicationUnit,
    versionId: string,
    announcement: RecruitmentAnnouncement,
  ): string {
    const dateText = raw.dateIso
      ? this.formatDate(raw.dateIso)
      : '待官方通知';
    return `${announcement.publisher}发布的${unit.name}，${raw.title}：${dateText}。请留意后续安排。`;
  }

  private changeNotificationBody(
    raw: RawTimelineEvent,
    oldDateIso: string | null,
    oldTitle: string,
    unit: ApplicationUnit,
  ): string {
    const oldText = oldDateIso ? this.formatDate(oldDateIso) : '待官方通知';
    const newText = raw.dateIso ? this.formatDate(raw.dateIso) : '待官方通知';
    if (oldDateIso !== raw.dateIso) {
      // 模块 7：旧值 → 新值 → 影响 → 下一步
      const desc = describeTimelineChange(raw.kind, oldDateIso, raw.dateIso);
      return `${unit.name}的${raw.title}时间已更新：${oldText} → ${newText}。影响：${desc.impact}。下一步：${desc.nextStep}。`;
    }
    return `${unit.name}的事项描述已更新：「${oldTitle}」→「${raw.title}」。`;
  }
}
