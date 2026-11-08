/**
 * 人工处理工作台与内部时限服务（2026-11-08）。
 *
 * 职责：
 * - 纠错/补录/扫描件待人工/来源告警的统一人工待办外壳（ServiceTask）；
 * - 负责人配置、认领、转交、优先级、公开进展、内部备注；
 * - 内部时限、暂停恢复、催办、升级、去重；
 * - 公告补录「已收录」真实发布关联门禁；
 * - 用户补充在原工单追加（工单状态与计时由本服务与 OpportunitiesService 同事务维护）。
 *
 * 所有业务对象的事实（公告、原件、发布版本）仍由各自模块保存，本服务不复制。
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ServiceTask } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import { REVIEW_ROLES } from '../auth/admin.guard.js';
import {
  DEFAULT_SLA_POLICIES,
  LONG_WAITING_SUPPLEMENT_HOURS,
  PRIORITY_LABELS,
  SUPPLEMENT_REMINDER_HOURS,
  TICKET_STATUS_LABELS,
  WORKBENCH_BUCKETS,
  adjustDeadlineForPriority,
  canTransitionTicket,
  computeDeadlines,
  computeUpdateDeadlines,
  isEffectiveResponse,
  isPriority,
  isTerminalTicketStatus,
  makeTicketNo,
  pauseDeadline,
  reminderCycleKey,
  resumeDeadline,
  suggestPriority,
  validateOwnerPair,
  validateParseManualCompletion,
  validatePriorityChange,
  validatePublishedResolution,
  validateSlaPolicy,
  validateSourceAlertCompletion,
  validateSupplementInput,
  type Priority,
  type SlaPolicy,
  type SlaPolicySet,
  type TicketType,
  type WorkbenchBucket,
} from './service-desk.domain.js';
import {
  CORRECTION_STATUSES,
  fieldPathLabel,
  isTerminalStatus as isTerminalCorrection,
  isVersionCorrectableField,
  validateResolution,
  validateReview,
} from '../opportunities/corrections.domain.js';

type Db = Prisma.TransactionClient;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

type Actor = { id: string; role: string };

export interface OwnerCandidateLite {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
}

export interface ServiceDeskConfigView {
  dutyOwnerId: string | null;
  backupOwnerId: string | null;
  dutyOwner: OwnerCandidateLite | null;
  backupOwner: OwnerCandidateLite | null;
  complete: boolean;
  issues: string[];
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SlaPolicyView {
  priority: Priority;
  policy: SlaPolicy;
  version: number;
  source: 'default' | 'configured';
}

export interface WorkbenchTaskDTO {
  id: string;
  ticketNo: string;
  /** 乐观锁版本：认领/转交/结案用；前端不得自行推断 */
  statusVersion: number;
  type: TicketType;
  status: string;
  statusLabel: string;
  priority: Priority;
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

export interface QueueQuery {
  bucket?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  createdAfter?: string;
  createdBefore?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface QueueResult {
  items: WorkbenchTaskDTO[];
  total: number;
  page: number;
  pageSize: number;
  bucket: WorkbenchBucket;
  now: string;
}

export interface SweepResult {
  scanned: number;
  reminders: number;
  escalations: number;
  routed: number;
  derivedCreated: number;
  derivedClosed: number;
  skipped: boolean;
  trigger: string;
  finishedAt: string;
}

const ACTIVE_STATUSES = CORRECTION_STATUSES.filter((s) => s !== 'resolved' && s !== 'rejected');

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nonEmptyString(value: unknown, max = 2000): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  return v.slice(0, max);
}

@Injectable()
export class ServiceDeskService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 配置 ====================

  async listEligibleOwners(): Promise<OwnerCandidateLite[]> {
    return this.prisma.user.findMany({
      where: { isActive: true, role: { in: REVIEW_ROLES } },
      select: { id: true, email: true, name: true, role: true, isActive: true },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      take: 200,
    });
  }

  async getConfig(): Promise<ServiceDeskConfigView> {
    const row = await this.prisma.serviceDeskConfig.findUnique({
      where: { id: 'default' },
    });
    const ids = [row?.dutyOwnerId, row?.backupOwnerId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    const map = new Map(users.map((u) => [u.id, u]));
    const duty = row?.dutyOwnerId ? map.get(row.dutyOwnerId) ?? null : null;
    const backup = row?.backupOwnerId ? map.get(row.backupOwnerId) ?? null : null;
    const check = validateOwnerPair({
      dutyOwnerId: row?.dutyOwnerId ?? undefined,
      backupOwnerId: row?.backupOwnerId ?? undefined,
      users: map,
    });
    const issues: string[] = [];
    if (!row?.dutyOwnerId || !row?.backupOwnerId) issues.push('运营责任人未配置完整');
    if (row?.dutyOwnerId && !duty) issues.push('日常负责人账号不存在或已停用');
    if (row?.backupOwnerId && !backup) issues.push('备用负责人账号不存在或已停用');
    if (!check.ok && check.message && issues.length === 0) issues.push(check.message);
    return {
      dutyOwnerId: row?.dutyOwnerId ?? null,
      backupOwnerId: row?.backupOwnerId ?? null,
      dutyOwner: duty,
      backupOwner: backup,
      complete: check.ok,
      issues,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async updateConfig(
    actor: Actor,
    body: { dutyOwnerId?: unknown; backupOwnerId?: unknown; reason?: unknown },
  ): Promise<ServiceDeskConfigView> {
    if (actor.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以修改运营负责人配置');
    }
    const dutyOwnerId =
      typeof body.dutyOwnerId === 'string' ? body.dutyOwnerId.trim() : '';
    const backupOwnerId =
      typeof body.backupOwnerId === 'string' ? body.backupOwnerId.trim() : '';
    const ids = [dutyOwnerId, backupOwnerId].filter(Boolean);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    const map = new Map(users.map((u) => [u.id, u]));
    const check = validateOwnerPair({ dutyOwnerId, backupOwnerId, users: map });
    if (!check.ok) throw new BadRequestException(check.message);
    const reason = nonEmptyString(body.reason, 200);

    const before = await this.prisma.serviceDeskConfig.findUnique({
      where: { id: 'default' },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceDeskConfig.upsert({
        where: { id: 'default' },
        create: {
          id: 'default',
          dutyOwnerId,
          backupOwnerId,
          updatedBy: actor.id,
        },
        update: {
          dutyOwnerId,
          backupOwnerId,
          updatedBy: actor.id,
          version: { increment: 1 },
        },
      });
      await tx.serviceDeskConfigAudit.create({
        data: {
          entity: 'service_desk_config',
          actorId: actor.id,
          reason,
          beforeValue: before
            ? {
                dutyOwnerId: before.dutyOwnerId,
                backupOwnerId: before.backupOwnerId,
                version: before.version,
              }
            : undefined,
          afterValue: { dutyOwnerId, backupOwnerId },
        },
      });
    });
    return this.getConfig();
  }

  async getPolicies(): Promise<SlaPolicyView[]> {
    const rows = await this.prisma.serviceDeskPolicy.findMany({
      where: { active: true },
      orderBy: [{ priority: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.priority)) latest.set(row.priority, row);
    }
    return (['high', 'medium', 'low'] as const).map((priority) => {
      const row = latest.get(priority);
      return {
        priority,
        policy: row
          ? {
              firstResponseMinutes: row.firstResponseMinutes,
              updateMinutes: row.updateMinutes,
              escalationGraceMinutes: row.escalationGraceMinutes,
            }
          : DEFAULT_SLA_POLICIES[priority],
        version: row?.version ?? 0,
        source: row ? ('configured' as const) : ('default' as const),
      };
    });
  }

  async updatePolicies(
    actor: Actor,
    body: {
      policies?: unknown;
      reason?: unknown;
    },
  ): Promise<SlaPolicyView[]> {
    if (actor.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以修改内部处理时限');
    }
    if (!Array.isArray(body.policies) || body.policies.length !== 3) {
      throw new BadRequestException('必须同时提交高/中/低三档时限配置');
    }
    const validated: Array<{ priority: Priority; policy: SlaPolicy }> = [];
    for (const raw of body.policies) {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('时限配置格式不正确');
      }
      const item = raw as {
        priority?: unknown;
        firstResponseMinutes?: unknown;
        updateMinutes?: unknown;
        escalationGraceMinutes?: unknown;
      };
      if (typeof item.priority !== 'string' || !isPriority(item.priority)) {
        throw new BadRequestException('时限配置的优先级无效');
      }
      const check = validateSlaPolicy(item);
      if (!check.ok) throw new BadRequestException(check.message);
      validated.push({ priority: item.priority, policy: check.policy });
    }
    if (new Set(validated.map((v) => v.priority)).size !== 3) {
      throw new BadRequestException('必须分别提交高/中/低三档时限');
    }
    const reason = nonEmptyString(body.reason, 200);
    await this.prisma.$transaction(async (tx) => {
      for (const { priority, policy } of validated) {
        const latest = await tx.serviceDeskPolicy.findFirst({
          where: { priority },
          orderBy: { version: 'desc' },
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        await tx.serviceDeskPolicy.updateMany({
          where: { priority, active: true },
          data: { active: false },
        });
        await tx.serviceDeskPolicy.create({
          data: {
            priority,
            firstResponseMinutes: policy.firstResponseMinutes,
            updateMinutes: policy.updateMinutes,
            escalationGraceMinutes: policy.escalationGraceMinutes,
            version: nextVersion,
            createdBy: actor.id,
          },
        });
        await tx.serviceDeskConfigAudit.create({
          data: {
            entity: `sla_policy:${priority}`,
            actorId: actor.id,
            reason,
            beforeValue: latest
              ? {
                  firstResponseMinutes: latest.firstResponseMinutes,
                  updateMinutes: latest.updateMinutes,
                  escalationGraceMinutes: latest.escalationGraceMinutes,
                  version: latest.version,
                }
              : { source: 'default', ...DEFAULT_SLA_POLICIES[priority] },
            afterValue: { ...policy, version: nextVersion },
          },
        });
      }
    });
    return this.getPolicies();
  }

  private async resolvePolicy(
    db: Db,
    priority: Priority,
  ): Promise<{ policy: SlaPolicy; version: number }> {
    const row = await db.serviceDeskPolicy.findFirst({
      where: { priority, active: true },
      orderBy: { version: 'desc' },
    });
    return row
      ? {
          policy: {
            firstResponseMinutes: row.firstResponseMinutes,
            updateMinutes: row.updateMinutes,
            escalationGraceMinutes: row.escalationGraceMinutes,
          },
          version: row.version,
        }
      : { policy: DEFAULT_SLA_POLICIES[priority], version: 0 };
  }

  // ==================== 工作项外壳与状态同步 ====================

  /** 在业务记录创建事务内建立待办外壳；未配置负责人时进入管理员未分配队列 */
  async createTaskTx(
    tx: Db,
    input: {
      type: TicketType;
      refId: string;
      status: string;
      createdAt?: Date;
      priority?: Priority;
      priorityReason?: string;
      registrationEnd?: string | null;
    },
  ) {
    const id = randomUUID();
    const config = await tx.serviceDeskConfig.findUnique({ where: { id: 'default' } });
    const suggestion =
      input.priority && input.priorityReason
        ? { priority: input.priority, reason: input.priorityReason }
        : suggestPriority({
            now: input.createdAt ?? new Date(),
            registrationEnd: input.registrationEnd,
          });
    const { policy } = await this.resolvePolicy(tx, suggestion.priority);
    const createdAt = input.createdAt ?? new Date();
    const deadlines = computeDeadlines(policy, createdAt);
    return tx.serviceTask.create({
      data: {
        id,
        ticketNo: makeTicketNo(input.type, input.refId),
        type: input.type,
        refId: input.refId,
        status: input.status,
        defaultOwnerId: config?.dutyOwnerId ?? null,
        priority: suggestion.priority,
        priorityReason: suggestion.reason,
        prioritySource: 'system',
        responseDueAt: deadlines.responseDueAt,
        updateDueAt: deadlines.updateDueAt,
        escalationDueAt: deadlines.escalationDueAt,
        cycleStartedAt: deadlines.cycleStartedAt,
        createdAt,
      },
    });
  }

  /** 历史记录没有外壳时补齐（只补最终摘要，不补造中间动作/时间/责任人） */
  async ensureTaskTx(
    tx: Db,
    input: {
      type: TicketType;
      refId: string;
      status: string;
      createdAt: Date;
      registrationEnd?: string | null;
    },
  ) {
    const existing = await tx.serviceTask.findUnique({
      where: { type_refId: { type: input.type, refId: input.refId } },
    });
    if (existing) return existing;
    const task = await this.createTaskTx(tx, input);
    const terminal = isTerminalTicketStatus(input.status);
    if (terminal) {
      await tx.serviceTask.update({
        where: { id: task.id },
        data: {
          status: input.status,
          responseDueAt: null,
          updateDueAt: null,
          escalationDueAt: null,
        },
      });
      await this.appendEventTx(tx, {
        task,
        action: 'legacy_summary',
        visibility: 'system',
        message: '历史记录仅有最终处理信息，未补造中间动作与责任人',
        dedupeKey: 'legacy_summary',
      });
    }
    return tx.serviceTask.findUniqueOrThrow({ where: { id: task.id } });
  }

  private async appendEventTx(
    tx: Db,
    input: {
      task: { id: string; ticketNo: string; type: string; refId: string };
      action: string;
      actorId?: string | null;
      actorRole?: string | null;
      visibility?: 'public' | 'internal' | 'system';
      message?: string | null;
      beforeValue?: unknown;
      afterValue?: unknown;
      dedupeKey?: string | null;
      createdAt?: Date;
    },
  ) {
    await tx.ticketEvent.create({
      data: {
        taskId: input.task.id,
        ticketNo: input.task.ticketNo,
        ticketType: input.task.type,
        ticketId: input.task.refId,
        action: input.action,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        visibility: input.visibility ?? 'public',
        message: input.message ?? null,
        beforeValue:
          input.beforeValue === undefined
            ? undefined
            : (input.beforeValue as Prisma.InputJsonValue),
        afterValue:
          input.afterValue === undefined
            ? undefined
            : (input.afterValue as Prisma.InputJsonValue),
        dedupeKey: input.dedupeKey ?? null,
        createdAt: input.createdAt,
      },
    });
  }

  private async notifyTx(
    tx: Db,
    input: {
      recipientIds: readonly string[];
      severity: 'must_handle' | 'suggest_handle' | 'info';
      title: string;
      body: string;
      eventKey: string;
      reminderStage: string;
      linkPath?: string | null;
      relatedUnitId?: string | null;
    },
  ) {
    const ids = [...new Set(input.recipientIds.filter(Boolean))];
    if (ids.length === 0) return;
    await tx.notificationRecord.createMany({
      data: ids.map((userId) => ({
        userId,
        severity: input.severity,
        title: input.title,
        body: input.body,
        eventKey: input.eventKey,
        reminderStage: input.reminderStage,
        linkPath: input.linkPath ?? null,
        relatedUnitId: input.relatedUnitId ?? null,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * 业务状态变更与工作项同步（同事务）。
   * 供 OpportunitiesService 在用户补充、员工处理时调用。
   */
  async syncTransitionTx(
    tx: Db,
    input: {
      type: 'correction' | 'announcement_submission';
      refId: string;
      fromStatus: string;
      toStatus: string;
      action: string;
      actorId: string;
      actorRole: string;
      message?: string | null;
      visibility?: 'public' | 'internal' | 'system';
      effective?: boolean;
      createdAt: Date;
      registrationEnd?: string | null;
      dedupeKey?: string | null;
    },
  ) {
    const task = await this.ensureTaskTx(tx, {
      type: input.type,
      refId: input.refId,
      status: input.fromStatus,
      createdAt: input.createdAt,
      registrationEnd: input.registrationEnd,
    });
    if (
      !isTerminalTicketStatus(input.fromStatus) &&
      !canTransitionTicket(input.fromStatus, input.toStatus as never)
    ) {
      throw new ConflictException('当前工单状态不允许该操作');
    }
    const now = new Date();
    const priority = (isPriority(task.priority) ? task.priority : 'medium') as Priority;
    const { policy } = await this.resolvePolicy(tx, priority);
    const data: Prisma.ServiceTaskUpdateManyMutationInput = {
      status: input.toStatus,
      lastHandlerId: input.actorId,
      waitingOn: null,
      statusVersion: { increment: 1 },
    };
    if (isEffectiveResponse(input.action) || input.effective) {
      data.firstResponseAt = task.firstResponseAt ?? now;
      data.lastEffectiveUpdateAt = now;
    }
    if (input.toStatus === 'need_supplement') {
      const remaining = pauseDeadline(now, task.updateDueAt);
      data.waitingOn = 'user';
      data.pausedAt = now;
      data.pausedRemainingMs = remaining;
      data.updateDueAt = null;
      data.escalationDueAt = null;
    } else if (input.toStatus === 'pending_review') {
      const remaining = task.pausedRemainingMs ?? 0;
      const resumed = resumeDeadline(now, remaining);
      const deadlines = computeUpdateDeadlines(policy, now);
      data.waitingOn = null;
      data.pausedAt = null;
      data.pausedRemainingMs = null;
      data.updateDueAt = resumed;
      data.escalationDueAt = new Date(
        resumed.getTime() + policy.escalationGraceMinutes * 60 * 1000,
      );
      data.cycleStartedAt = deadlines.cycleStartedAt;
      data.totalPausedMs =
        task.totalPausedMs +
        (task.pausedAt ? Math.max(0, now.getTime() - task.pausedAt.getTime()) : 0);
    } else if (input.toStatus === 'reviewing' && isEffectiveResponse(input.action)) {
      const deadlines = computeUpdateDeadlines(policy, now);
      data.updateDueAt = deadlines.updateDueAt;
      data.escalationDueAt = deadlines.escalationDueAt;
      data.cycleStartedAt = deadlines.cycleStartedAt;
    }
    if (isTerminalTicketStatus(input.toStatus)) {
      data.resolvedAt = now;
      data.waitingOn = null;
      data.responseDueAt = null;
      data.updateDueAt = null;
      data.escalationDueAt = null;
    }
    await tx.serviceTask.updateMany({
      where: {
        id: task.id,
        statusVersion: task.statusVersion,
      },
      data,
    });
    const updatedTask = await tx.serviceTask.findUniqueOrThrow({ where: { id: task.id } });
    await this.appendEventTx(tx, {
      task,
      action: input.action,
      actorId: input.actorId,
      actorRole: input.actorRole,
      visibility: input.visibility ?? 'public',
      message: input.message ?? null,
      beforeValue: { status: input.fromStatus },
      afterValue: { status: input.toStatus },
      dedupeKey: input.dedupeKey,
    });
    return updatedTask;
  }

  // ==================== 用户补充 ====================

  private supplementResult(
    task: ServiceTask,
    supplement: { id: string; createdAt: Date },
  ) {
    return {
      id: supplement.id,
      taskId: task.id,
      ticketNo: task.ticketNo,
      status: 'pending_review',
      statusLabel: TICKET_STATUS_LABELS.pending_review,
      createdAt: supplement.createdAt.toISOString(),
    };
  }

  /** 在原工单追加补充：编号不变、原文不变、状态进入待复核 */
  async submitSupplement(
    userId: string,
    type: 'correction' | 'announcement_submission',
    refId: string,
    body: { body?: unknown; links?: unknown; dedupeKey?: unknown },
  ): Promise<{
    id: string;
    taskId: string;
    ticketNo: string;
    status: string;
    statusLabel: string;
    createdAt: string;
  }> {
    const check = validateSupplementInput(body);
    if (!check.ok) throw new BadRequestException(check.message);
    const dedupeKey =
      typeof body.dedupeKey === 'string' && body.dedupeKey.trim()
        ? body.dedupeKey.trim().slice(0, 100)
        : null;

    if (type === 'correction') {
      const row = await this.prisma.opportunityCorrection.findUnique({
        where: { id: refId },
      });
      if (!row) throw new NotFoundException('未找到该纠错工单');
      if (row.userId !== userId) throw new ForbiddenException('只能补充自己提交的工单');
      if (isTerminalCorrection(row.status)) {
        throw new ConflictException('该工单已处理完成，不能补充；如有新问题请创建关联原编号的新工单');
      }
      if (row.status !== 'need_supplement') {
        throw new ConflictException('当前工单不需要用户补充');
      }
      const task = await this.ensureTaskTx(this.prisma as unknown as Db, {
        type,
        refId,
        status: row.status,
        createdAt: row.createdAt,
      });
      const existing = dedupeKey
        ? await this.prisma.ticketSupplement.findUnique({
            where: { taskId_dedupeKey: { taskId: task.id, dedupeKey } },
          })
        : null;
      if (existing) return this.supplementResult(task, existing);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const updated = await tx.opportunityCorrection.updateMany({
            where: { id: refId, status: 'need_supplement' },
            data: { status: 'pending_review' },
          });
          if (updated.count === 0) {
            throw new ConflictException('工单状态已变化，请刷新后重试；你的输入已保留');
          }
          const supplement = await tx.ticketSupplement.create({
            data: {
              taskId: task.id,
              ticketType: type,
              ticketId: refId,
              authorId: userId,
              body: check.body,
              links: check.links as unknown as Prisma.InputJsonValue,
              dedupeKey,
            },
          });
          await this.syncTransitionTx(tx, {
            type,
            refId,
            fromStatus: 'need_supplement',
            toStatus: 'pending_review',
            action: 'user_supplement',
            actorId: userId,
            actorRole: 'user',
            message: check.body.slice(0, 200),
            visibility: 'public',
            createdAt: row.createdAt,
            dedupeKey: dedupeKey ? `supplement:${dedupeKey}` : null,
          });
          await this.notifySupplementReceivedTx(tx, task, supplement.id, check.body);
          return this.supplementResult(task, supplement);
        });
      } catch (error) {
        if (dedupeKey && isUniqueConstraintError(error)) {
          const dup = await this.prisma.ticketSupplement.findUnique({
            where: { taskId_dedupeKey: { taskId: task.id, dedupeKey } },
          });
          if (dup) return this.supplementResult(task, dup);
        }
        throw error;
      }
    }

    const row = await this.prisma.announcementSubmission.findUnique({
      where: { id: refId },
    });
    if (!row) throw new NotFoundException('未找到该补录工单');
    if (row.userId !== userId) throw new ForbiddenException('只能补充自己提交的工单');
    if (isTerminalCorrection(row.status)) {
      throw new ConflictException('该工单已处理完成，不能补充；如有新问题请创建关联原编号的新工单');
    }
    if (row.status !== 'need_supplement') {
      throw new ConflictException('当前工单不需要用户补充');
    }
    const task = await this.ensureTaskTx(this.prisma as unknown as Db, {
      type,
      refId,
      status: row.status,
      createdAt: row.createdAt,
    });
    const existing = dedupeKey
      ? await this.prisma.ticketSupplement.findUnique({
          where: { taskId_dedupeKey: { taskId: task.id, dedupeKey } },
        })
      : null;
    if (existing) return this.supplementResult(task, existing);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.announcementSubmission.updateMany({
          where: { id: refId, status: 'need_supplement' },
          data: { status: 'pending_review' },
        });
        if (updated.count === 0) {
          throw new ConflictException('工单状态已变化，请刷新后重试；你的输入已保留');
        }
        const supplement = await tx.ticketSupplement.create({
          data: {
            taskId: task.id,
            ticketType: type,
            ticketId: refId,
            authorId: userId,
            body: check.body,
            links: check.links as unknown as Prisma.InputJsonValue,
            dedupeKey,
          },
        });
        await this.syncTransitionTx(tx, {
          type,
          refId,
          fromStatus: 'need_supplement',
          toStatus: 'pending_review',
          action: 'user_supplement',
          actorId: userId,
          actorRole: 'user',
          message: check.body.slice(0, 200),
          visibility: 'public',
          createdAt: row.createdAt,
          dedupeKey: dedupeKey ? `supplement:${dedupeKey}` : null,
        });
        await this.notifySupplementReceivedTx(tx, task, supplement.id, check.body);
        return this.supplementResult(task, supplement);
      });
    } catch (error) {
      if (dedupeKey && isUniqueConstraintError(error)) {
        const dup = await this.prisma.ticketSupplement.findUnique({
          where: { taskId_dedupeKey: { taskId: task.id, dedupeKey } },
        });
        if (dup) return this.supplementResult(task, dup);
      }
      throw error;
    }
  }

  /**
   * 用户补充后通知当前负责人；负责人失效时按日常/备用负责人兜底。
   * 两者都无效则不丢工单：留给 5 分钟扫描进入管理员未分配队列。
   */
  private async notifySupplementReceivedTx(
    tx: Db,
    task: ServiceTask,
    supplementId: string,
    supplementBody: string,
  ): Promise<void> {
    const direct = [task.assigneeId, task.defaultOwnerId].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    let recipients: string[] = [];
    if (direct.length > 0) {
      const active = await tx.user.findMany({
        where: { id: { in: direct }, isActive: true },
        select: { id: true },
      });
      recipients = active.map((u) => u.id);
    }
    if (recipients.length === 0) {
      const config = await tx.serviceDeskConfig.findUnique({ where: { id: 'default' } });
      const fallback = [config?.dutyOwnerId, config?.backupOwnerId].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      );
      if (fallback.length > 0) {
        const active = await tx.user.findMany({
          where: { id: { in: fallback }, isActive: true },
          select: { id: true },
        });
        recipients = active.map((u) => u.id);
      }
    }
    if (recipients.length === 0) return;
    await this.notifyTx(tx, {
      recipientIds: recipients,
      severity: 'suggest_handle',
      title: `工单 ${task.ticketNo} 已收到用户补充`,
      body: `用户已补充信息，工单进入待复核。补充内容：${supplementBody.slice(0, 120)}`,
      eventKey: `ticket_owner:${task.id}`,
      reminderStage: `supplemented:${supplementId}`,
      linkPath: `/admin/workbench?task=${task.id}`,
    });
  }

  /**
   * 已发布结果检索：只返回正式发布、未撤回、未取代、dataset=real 的版本。
   * 用于补录结案时选择真实公告；不允许手工输入 ID 绕过校验。
   */
  async searchPublishedResults(query: string): Promise<
    Array<{
      announcementId: string;
      versionId: string;
      title: string;
      publisherName: string;
      officialUrl: string;
      unitId: string | null;
      publishedAt: string | null;
    }>
  > {
    const keyword = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const rows = await this.prisma.publishedAnnouncementVersion.findMany({
      where: {
        status: 'published',
        withdrawnAt: null,
        supersededAt: null,
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: 200,
    });
    return rows
      .map((row) => {
        const payload = row.payload as
          | {
              dataset?: string;
              announcement?: {
                id?: string;
                title?: string;
                publisherName?: string;
                officialUrl?: string;
              };
              version?: { units?: Array<{ unitId?: string }> };
            }
          | null;
        if (payload?.dataset !== 'real') return null;
        const announcement = payload.announcement ?? {};
        const title = announcement.title ?? '';
        const publisherName = announcement.publisherName ?? '';
        const officialUrl = announcement.officialUrl ?? '';
        const unitId = payload.version?.units?.[0]?.unitId ?? null;
        if (keyword) {
          const haystack = `${title} ${publisherName} ${officialUrl}`.toLowerCase();
          if (!haystack.includes(keyword)) return null;
        }
        return {
          announcementId: row.announcementId,
          versionId: row.id,
          title,
          publisherName,
          officialUrl,
          unitId,
          publishedAt: row.publishedAt
            ? row.publishedAt.toISOString()
            : null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .slice(0, 50);
  }

  // ==================== 工作台 ====================

  async listQueue(actorId: string, query: QueueQuery): Promise<QueueResult> {
    await this.ensureLegacyTasks();
    const bucketRaw = typeof query.bucket === 'string' ? query.bucket : 'all';
    if (!(WORKBENCH_BUCKETS as readonly string[]).includes(bucketRaw)) {
      throw new BadRequestException('工作台分组无效');
    }
    const bucket = bucketRaw as WorkbenchBucket;
    const now = new Date();
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));

    const where: Prisma.ServiceTaskWhereInput = {};
    const active: Prisma.ServiceTaskWhereInput = {
      status: { notIn: ['resolved', 'rejected'] },
    };
    if (bucket === 'closed') {
      where.status = { in: ['resolved', 'rejected'] };
    } else if (bucket === 'all') {
      // 全部包含历史结案
    } else {
      Object.assign(where, active);
    }
    if (bucket === 'unassigned') where.assigneeId = null;
    if (bucket === 'mine') where.assigneeId = actorId;
    if (bucket === 'pending_review') where.status = 'pending_review';
    if (bucket === 'waiting_user') where.status = 'need_supplement';
    if (bucket === 'overdue') {
      where.OR = [
        { status: { notIn: ['need_supplement', 'resolved', 'rejected'] }, firstResponseAt: null, responseDueAt: { lt: now } },
        { status: { notIn: ['need_supplement', 'resolved', 'rejected'] }, firstResponseAt: { not: null }, updateDueAt: { lt: now } },
      ];
    }
    if (bucket === 'escalated') {
      where.OR = [{ escalationCount: { gt: 0 } }, { routedToAdmin: true }];
    }
    if (typeof query.type === 'string' && query.type.trim()) {
      where.type = query.type.trim();
    }
    if (typeof query.status === 'string' && query.status.trim()) {
      where.status = query.status.trim();
    }
    if (typeof query.priority === 'string' && query.priority.trim()) {
      if (!isPriority(query.priority.trim())) {
        throw new BadRequestException('优先级筛选无效');
      }
      where.priority = query.priority.trim();
    }
    if (typeof query.assignee === 'string' && query.assignee.trim()) {
      where.assigneeId = query.assignee === 'unassigned' ? null : query.assignee.trim();
    }
    const createdAfter = parseDate(query.createdAfter);
    const createdBefore = parseDate(query.createdBefore);
    if (createdAfter || createdBefore) {
      where.createdAt = {
        ...(createdAfter ? { gte: createdAfter } : {}),
        ...(createdBefore ? { lte: createdBefore } : {}),
      };
    }
    if (typeof query.q === 'string' && query.q.trim()) {
      where.ticketNo = { contains: query.q.trim().toUpperCase() };
    }

    const [rows, total] = await Promise.all([
      this.prisma.serviceTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.serviceTask.count({ where }),
    ]);
    const items = await this.decorateTasks(rows, now);
    items.sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 } as Record<string, number>;
      return rank[b.priority] - rank[a.priority] || b.createdAt.localeCompare(a.createdAt);
    });
    return { items, total, page, pageSize, bucket, now: now.toISOString() };
  }

  private async decorateTasks(
    rows: ServiceTask[],
    now: Date,
  ): Promise<WorkbenchTaskDTO[]> {
    const userIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.assigneeId, r.defaultOwnerId].filter(
            (v): v is string => typeof v === 'string' && v.length > 0,
          ),
        ),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const corrections = await this.prisma.opportunityCorrection.findMany({
      where: { id: { in: rows.filter((r) => r.type === 'correction').map((r) => r.refId) } },
      select: {
        id: true,
        userId: true,
        unitId: true,
        fieldPath: true,
        content: true,
        createdAt: true,
      },
    });
    const submissions = await this.prisma.announcementSubmission.findMany({
      where: {
        id: {
          in: rows
            .filter((r) => r.type === 'announcement_submission')
            .map((r) => r.refId),
        },
      },
      select: {
        id: true,
        userId: true,
        publisherName: true,
        officialUrl: true,
        createdAt: true,
      },
    });
    const parseRuns = await this.prisma.documentParseRun.findMany({
      where: { id: { in: rows.filter((r) => r.type === 'parse_manual').map((r) => r.refId) } },
      select: { id: true, format: true, sourceUrl: true, status: true, createdAt: true },
    });
    const alerts = await this.prisma.sourcingAlert.findMany({
      where: { id: { in: rows.filter((r) => r.type === 'source_alert').map((r) => r.refId) } },
      include: { source: { select: { publisher: true, officialUrl: true } } },
    });
    const submitterIds = [
      ...new Set([
        ...corrections.map((r) => r.userId),
        ...submissions.map((r) => r.userId),
      ]),
    ];
    const submitters = submitterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: submitterIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const submitterMap = new Map(submitters.map((u) => [u.id, u]));
    const corrMap = new Map(corrections.map((r) => [r.id, r]));
    const subMap = new Map(submissions.map((r) => [r.id, r]));
    const parseMap = new Map(parseRuns.map((r) => [r.id, r]));
    const alertMap = new Map(alerts.map((r) => [r.id, r]));

    return rows.map((task) => {
      const priority = (isPriority(task.priority) ? task.priority : 'medium') as Priority;
      const overdueAt =
        task.status === 'need_supplement' || isTerminalTicketStatus(task.status)
          ? null
          : task.firstResponseAt === null
            ? task.responseDueAt && task.responseDueAt < now
              ? task.responseDueAt
              : null
            : task.updateDueAt && task.updateDueAt < now
              ? task.updateDueAt
              : null;
      const waitingHours =
        task.status === 'need_supplement' && task.pausedAt
          ? Math.floor((now.getTime() - task.pausedAt.getTime()) / (60 * 60 * 1000))
          : null;
      let summary = `${task.ticketNo} · ${task.type}`;
      let submitter: WorkbenchTaskDTO['submitter'] = null;
      let sourcePath: string | null = null;
      if (task.type === 'correction') {
        const c = corrMap.get(task.refId);
        if (c) {
          summary = `${fieldPathLabel(c.fieldPath)} · ${c.content.slice(0, 80)}`;
          const u = submitterMap.get(c.userId);
          submitter = u ? { id: u.id, email: u.email, name: u.name } : null;
          sourcePath = `/admin/corrections?ticket=${task.id}`;
        }
      } else if (task.type === 'announcement_submission') {
        const s = subMap.get(task.refId);
        if (s) {
          summary = `${s.publisherName} · ${s.officialUrl}`;
          const u = submitterMap.get(s.userId);
          submitter = u ? { id: u.id, email: u.email, name: u.name } : null;
          sourcePath = `/admin/feedback?tab=submissions&ticket=${task.id}`;
        }
      } else if (task.type === 'parse_manual') {
        const p = parseMap.get(task.refId);
        if (p) {
          summary = `扫描件/解析待人工 · ${p.format} · ${p.sourceUrl ?? '原件快照'}`;
          sourcePath = `/admin/pipeline?parseRun=${task.refId}`;
        }
      } else {
        const a = alertMap.get(task.refId);
        if (a) {
          const source = a.source;
          summary = `${a.type} · ${source?.publisher ?? '全局告警'} · ${a.message.slice(0, 80)}`;
          sourcePath = `/admin/sources?alert=${task.refId}`;
        }
      }
      const owner = (id: string | null) =>
        id ? (() => {
          const u = userMap.get(id);
          return u ? { id: u.id, name: u.name, email: u.email } : { id, name: null, email: '' };
        })() : null;
      return {
        id: task.id,
        ticketNo: task.ticketNo,
        statusVersion: task.statusVersion,
        type: task.type as TicketType,
        status: task.status,
        statusLabel: (TICKET_STATUS_LABELS as Record<string, string>)[task.status] ?? task.status,
        priority,
        priorityLabel: PRIORITY_LABELS[priority],
        priorityReason: task.priorityReason,
        prioritySource: task.prioritySource,
        assignee: owner(task.assigneeId),
        defaultOwner: owner(task.defaultOwnerId),
        lastHandlerId: task.lastHandlerId,
        claimedAt: task.claimedAt?.toISOString() ?? null,
        waitingOn: task.waitingOn,
        waitingLabel:
          task.waitingOn === 'user'
            ? '等待用户补充'
            : task.waitingOn === 'official'
              ? '等待官方回复'
              : task.waitingOn === 'staff'
                ? '等待平台处理'
                : null,
        firstResponseAt: task.firstResponseAt?.toISOString() ?? null,
        lastEffectiveUpdateAt: task.lastEffectiveUpdateAt?.toISOString() ?? null,
        responseDueAt: task.responseDueAt?.toISOString() ?? null,
        updateDueAt: task.updateDueAt?.toISOString() ?? null,
        escalationDueAt: task.escalationDueAt?.toISOString() ?? null,
        pausedAt: task.pausedAt?.toISOString() ?? null,
        supplementWaitingHours: waitingHours,
        longWaitingSupplement:
          waitingHours !== null && waitingHours >= LONG_WAITING_SUPPLEMENT_HOURS,
        nextFollowUpAt: task.nextFollowUpAt?.toISOString() ?? null,
        overdue: overdueAt !== null,
        overdueAt: overdueAt?.toISOString() ?? null,
        escalated: task.escalationCount > 0 || task.routedToAdmin,
        routedToAdmin: task.routedToAdmin,
        routeIssue: task.routeIssue,
        outcome: task.outcome,
        resolutionNote: task.resolutionNote,
        summary,
        sourcePath,
        submitter,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      };
    });
  }

  async getTaskDetail(taskId: string): Promise<WorkbenchTaskDetail> {
    const task = await this.prisma.serviceTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('未找到该人工任务');
    await this.ensureLegacyTasks();
    const [decorated, events, supplements, config] = await Promise.all([
      this.decorateTasks([task], new Date()),
      this.prisma.ticketEvent.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.ticketSupplement.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      this.getConfig(),
    ]);
    const business = await this.loadBusiness(task.type, task.refId);
    return {
      ...decorated[0],
      business,
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        visibility: e.visibility,
        message: e.message,
        actorId: e.actorId,
        actorRole: e.actorRole,
        beforeValue: e.beforeValue,
        afterValue: e.afterValue,
        createdAt: e.createdAt.toISOString(),
      })),
      supplements: supplements.map((s) => ({
        id: s.id,
        body: s.body,
        links: Array.isArray(s.links)
          ? (s.links as Array<{ url: string; label?: string }>)
          : [],
        authorId: s.authorId,
        createdAt: s.createdAt.toISOString(),
      })),
      config,
    };
  }

  private async loadBusiness(type: string, refId: string) {
    if (type === 'correction') {
      const row = await this.prisma.opportunityCorrection.findUnique({ where: { id: refId } });
      return row ? { ...row, fieldLabel: fieldPathLabel(row.fieldPath) } : null;
    }
    if (type === 'announcement_submission') {
      return this.prisma.announcementSubmission.findUnique({ where: { id: refId } });
    }
    if (type === 'parse_manual') {
      return this.prisma.documentParseRun.findUnique({ where: { id: refId } });
    }
    if (type === 'source_alert') {
      return this.prisma.sourcingAlert.findUnique({
        where: { id: refId },
        include: { source: true },
      });
    }
    return null;
  }

  // ==================== 认领 / 转交 / 优先级 / 进展 ====================

  private async loadTask(taskId: string) {
    const task = await this.prisma.serviceTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('未找到该人工任务');
    return task;
  }

  async claim(
    actor: Actor,
    taskId: string,
    body: { expectedVersion?: unknown },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const task = await this.loadTask(taskId);
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案，不能认领');
    }
    const expected =
      typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (task.assigneeId && task.assigneeId !== actor.id) {
      throw new ConflictException('该任务已被其他负责人认领');
    }
    if (task.assigneeId === actor.id) return this.getTaskDetail(taskId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.serviceTask.updateMany({
        where: {
          id: task.id,
          assigneeId: null,
          statusVersion: expected ?? task.statusVersion,
        },
        data: {
          assigneeId: actor.id,
          claimedAt: new Date(),
          lastHandlerId: actor.id,
          statusVersion: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new ConflictException('认领冲突：任务负责人已变化，请刷新后重试');
      }
      await this.appendEventTx(tx, {
        task,
        action: 'claimed',
        actorId: actor.id,
        actorRole: actor.role,
        visibility: 'internal',
        message: '认领任务（认领不算有效公开响应）',
      });
      return tx.serviceTask.findUniqueOrThrow({ where: { id: task.id } });
    });
    void updated;
    return this.getTaskDetail(taskId);
  }

  async transfer(
    actor: Actor,
    taskId: string,
    body: { toUserId?: unknown; reason?: unknown; expectedVersion?: unknown },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const toUserId = typeof body.toUserId === 'string' ? body.toUserId.trim() : '';
    const reason = nonEmptyString(body.reason, 200);
    if (!toUserId) throw new BadRequestException('请选择转交目标');
    if (!reason || reason.length < 5) {
      throw new BadRequestException('转交必须填写至少 5 个字的原因');
    }
    if (toUserId === actor.id) throw new BadRequestException('不能转交给自己');
    const target = await this.prisma.user.findUnique({ where: { id: toUserId } });
    if (!target || !target.isActive || !REVIEW_ROLES.includes(target.role)) {
      throw new BadRequestException('转交目标必须是启用且具备处理权限的员工账号');
    }
    const task = await this.loadTask(taskId);
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案，不能转交');
    }
    const expected =
      typeof body.expectedVersion === 'number' ? body.expectedVersion : task.statusVersion;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.serviceTask.updateMany({
        where: { id: task.id, statusVersion: expected },
        data: {
          assigneeId: toUserId,
          claimedAt: task.claimedAt ?? new Date(),
          lastHandlerId: actor.id,
          statusVersion: { increment: 1 },
          routedToAdmin: false,
          routeIssue: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('转交冲突：任务负责人已变化，请刷新后重试');
      }
      await this.appendEventTx(tx, {
        task,
        action: 'transferred',
        actorId: actor.id,
        actorRole: actor.role,
        visibility: 'internal',
        message: reason,
        beforeValue: { assigneeId: task.assigneeId },
        afterValue: { assigneeId: toUserId },
      });
      await this.notifyTx(tx, {
        recipientIds: [toUserId],
        severity: 'suggest_handle',
        title: `你收到一条转交的人工任务 ${task.ticketNo}`,
        body: `转交原因：${reason}`,
        eventKey: `ticket_owner:${task.id}`,
        reminderStage: `transferred:${Date.now()}`,
        linkPath: `/admin/workbench?task=${task.id}`,
      });
    });
    return this.getTaskDetail(taskId);
  }

  async setPriority(
    actor: Actor,
    taskId: string,
    body: { priority?: unknown; reason?: unknown; expectedVersion?: unknown },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const check = validatePriorityChange({
      priority: body.priority,
      reason: body.reason,
    });
    if (!check.ok) throw new BadRequestException(check.message);
    const task = await this.loadTask(taskId);
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案，不能调整优先级');
    }
    const from = (isPriority(task.priority) ? task.priority : 'medium') as Priority;
    if (from === check.priority) {
      throw new ConflictException('优先级未变化');
    }
    const expected =
      typeof body.expectedVersion === 'number' ? body.expectedVersion : task.statusVersion;
    const { policy } = await this.resolvePolicy(this.prisma as unknown as Db, check.priority);
    const nextDue = adjustDeadlineForPriority({
      changedAt: new Date(),
      currentDueAt: task.updateDueAt,
      cycleStartedAt: task.cycleStartedAt,
      from,
      to: check.priority,
      policy,
    });
    const nextResponseDue =
      task.firstResponseAt === null && task.responseDueAt
        ? adjustDeadlineForPriority({
            changedAt: new Date(),
            currentDueAt: task.responseDueAt,
            cycleStartedAt: task.cycleStartedAt,
            from,
            to: check.priority,
            policy: {
              ...policy,
              updateMinutes: policy.firstResponseMinutes,
            },
          })
        : null;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.serviceTask.updateMany({
        where: { id: task.id, statusVersion: expected },
        data: {
          priority: check.priority,
          priorityReason: check.reason,
          prioritySource: 'staff',
          statusVersion: { increment: 1 },
          ...(nextDue ? { updateDueAt: nextDue } : {}),
          ...(nextResponseDue ? { responseDueAt: nextResponseDue } : {}),
        },
      });
      if (result.count === 0) {
        throw new ConflictException('优先级调整冲突，请刷新后重试');
      }
      await this.appendEventTx(tx, {
        task,
        action: 'priority_changed',
        actorId: actor.id,
        actorRole: actor.role,
        visibility: 'internal',
        message: check.reason,
        beforeValue: { priority: from, updateDueAt: task.updateDueAt },
        afterValue: { priority: check.priority, updateDueAt: nextDue ?? task.updateDueAt },
      });
    });
    return this.getTaskDetail(taskId);
  }

  async addNote(
    actor: Actor,
    taskId: string,
    body: { message?: unknown; visibility?: unknown; waitingReason?: unknown; nextFollowUpAt?: unknown },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const message = nonEmptyString(body.message, 2000);
    if (!message) throw new BadRequestException('请填写说明');
    const visibility = body.visibility === 'public' ? 'public' : 'internal';
    const task = await this.loadTask(taskId);
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案，不能再添加进展');
    }
    if (visibility === 'public' && task.status === 'need_supplement') {
      throw new ConflictException('等待用户补充期间不发送公开进展，以免与补充提醒混淆');
    }
    const now = new Date();
    const priority = (isPriority(task.priority) ? task.priority : 'medium') as Priority;
    const { policy } = await this.resolvePolicy(this.prisma as unknown as Db, priority);
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ServiceTaskUpdateManyMutationInput = {
        lastHandlerId: actor.id,
        statusVersion: { increment: 1 },
      };
      if (visibility === 'public') {
        const deadlines = computeUpdateDeadlines(policy, now);
        data.firstResponseAt = task.firstResponseAt ?? now;
        data.lastEffectiveUpdateAt = now;
        data.updateDueAt = deadlines.updateDueAt;
        data.escalationDueAt = deadlines.escalationDueAt;
        data.cycleStartedAt = deadlines.cycleStartedAt;
        data.waitingOn = 'staff';
      } else {
        const nextFollowUpAt = parseDate(body.nextFollowUpAt);
        const waitingReason = nonEmptyString(body.waitingReason, 200);
        if (waitingReason) {
          data.waitingReason = waitingReason;
          data.waitingOn = 'official';
        }
        if (nextFollowUpAt) data.nextFollowUpAt = nextFollowUpAt;
      }
      await tx.serviceTask.update({
        where: { id: task.id },
        data,
      });
      await this.appendEventTx(tx, {
        task,
        action: visibility === 'public' ? 'public_update' : 'internal_note',
        actorId: actor.id,
        actorRole: actor.role,
        visibility,
        message,
        dedupeKey: null,
      });
      await this.notifySubmitterTx(tx, task, visibility, message);
    });
    return this.getTaskDetail(taskId);
  }

  /** 公开进展通知提交人；内部备注绝不外发 */
  private async notifySubmitterTx(
    db: Db,
    task: { id: string; ticketNo: string; type: string; refId: string },
    visibility: 'public' | 'internal',
    message: string,
  ) {
    if (visibility !== 'public') return;
    const user = await this.submitterOfWithDb(db, task.type, task.refId);
    if (!user) return;
    await db.notificationRecord.createMany({
      data: [
        {
          userId: user.id,
          severity: 'info',
          title: `工单 ${task.ticketNo} 有新的处理进展`,
          body: message.slice(0, 300),
          eventKey: `ticket:${task.ticketNo}`,
          reminderStage: `public:${randomUUID()}`,
          linkPath: `/me?ticket=${task.type}:${task.refId}`,
          relatedUnitId: user.unitId ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }

  private async submitterOfWithDb(
    db: Db,
    type: string,
    refId: string,
  ): Promise<{ id: string; unitId: string | null } | null> {
    if (type === 'correction') {
      const row = await db.opportunityCorrection.findUnique({
        where: { id: refId },
        select: { userId: true, unitId: true },
      });
      return row ? { id: row.userId, unitId: row.unitId } : null;
    }
    if (type === 'announcement_submission') {
      const row = await db.announcementSubmission.findUnique({
        where: { id: refId },
        select: { userId: true },
      });
      return row ? { id: row.userId, unitId: null } : null;
    }
    return null;
  }

  private async submitterOf(
    type: string,
    refId: string,
  ): Promise<{ id: string; unitId: string | null } | null> {
    if (type === 'correction') {
      const row = await this.prisma.opportunityCorrection.findUnique({
        where: { id: refId },
        select: { userId: true, unitId: true },
      });
      return row ? { id: row.userId, unitId: row.unitId } : null;
    }
    if (type === 'announcement_submission') {
      const row = await this.prisma.announcementSubmission.findUnique({
        where: { id: refId },
        select: { userId: true },
      });
      return row ? { id: row.userId, unitId: null } : null;
    }
    return null;
  }

  // ==================== 员工：请求补充 / 继续核对 / 合法结案 ====================

  async requestSupplement(
    actor: Actor,
    taskId: string,
    body: { question?: unknown },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const question = nonEmptyString(body.question, 500);
    if (!question || question.length < 5) {
      throw new BadRequestException('请求补充必须填写具体问题（至少 5 个字）');
    }
    const task = await this.loadTask(taskId);
    if (task.type !== 'correction' && task.type !== 'announcement_submission') {
      throw new BadRequestException('该任务类型不支持请求用户补充');
    }
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案，不能请求补充');
    }
    const fromStatus = task.status;
    if (!canTransitionTicket(fromStatus, 'need_supplement')) {
      throw new ConflictException('当前状态不允许请求补充');
    }
    const ticketType = task.type;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (ticketType === 'correction') {
        const result = await tx.opportunityCorrection.updateMany({
          where: { id: task.refId, status: fromStatus },
          data: { status: 'need_supplement', reviewNote: question, reviewerId: actor.id, reviewedAt: now },
        });
        if (result.count === 0) throw new ConflictException('工单状态已变化，请刷新后重试');
      } else {
        const result = await tx.announcementSubmission.updateMany({
          where: { id: task.refId, status: fromStatus },
          data: { status: 'need_supplement', reviewNote: question, reviewerId: actor.id, reviewedAt: now },
        });
        if (result.count === 0) throw new ConflictException('工单状态已变化，请刷新后重试');
      }
      await this.syncTransitionTx(tx, {
        type: ticketType,
        refId: task.refId,
        fromStatus,
        toStatus: 'need_supplement',
        action: 'request_supplement',
        actorId: actor.id,
        actorRole: actor.role,
        message: question,
        visibility: 'public',
        createdAt: task.createdAt,
        dedupeKey: `request_supplement:${task.statusVersion}`,
      });
      const user = await this.submitterOf(ticketType, task.refId);
      if (user) {
        await this.notifyTx(tx, {
          recipientIds: [user.id],
          severity: 'must_handle',
          title: `工单 ${task.ticketNo} 需要你补充信息`,
          body: `请补充：${question}`,
          eventKey: `ticket:${task.ticketNo}`,
          reminderStage: `supplement_requested:${task.statusVersion}`,
          linkPath: `/me?ticket=${ticketType}:${task.refId}`,
          relatedUnitId: user.unitId,
        });
      }
    });
    return this.getTaskDetail(taskId);
  }

  async startReview(
    actor: Actor,
    taskId: string,
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const task = await this.loadTask(taskId);
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案，不能继续核对');
    }
    const fromStatus = task.status;
    if (!canTransitionTicket(fromStatus, 'reviewing')) {
      throw new ConflictException('当前状态不允许开始核对');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (task.type === 'correction') {
        await tx.opportunityCorrection.updateMany({
          where: { id: task.refId, status: fromStatus },
          data: { status: 'reviewing', reviewerId: actor.id, reviewedAt: now },
        });
      } else if (task.type === 'announcement_submission') {
        await tx.announcementSubmission.updateMany({
          where: { id: task.refId, status: fromStatus },
          data: { status: 'reviewing', reviewerId: actor.id, reviewedAt: now },
        });
      }
      if (task.type === 'correction' || task.type === 'announcement_submission') {
        await this.syncTransitionTx(tx, {
          type: task.type,
          refId: task.refId,
          fromStatus,
          toStatus: 'reviewing',
          action: 'start_review',
          actorId: actor.id,
          actorRole: actor.role,
          message: null,
          visibility: 'system',
          createdAt: task.createdAt,
          dedupeKey: `start_review:${task.statusVersion}`,
        });
      } else {
        const result = await tx.serviceTask.updateMany({
          where: { id: task.id, statusVersion: task.statusVersion },
          data: { status: 'reviewing', lastHandlerId: actor.id, statusVersion: { increment: 1 } },
        });
        if (result.count === 0) throw new ConflictException('任务状态已变化，请刷新后重试');
        await this.appendEventTx(tx, {
          task,
          action: 'start_review',
          actorId: actor.id,
          actorRole: actor.role,
          visibility: 'system',
          message: '开始核对人工任务',
          beforeValue: { status: fromStatus },
          afterValue: { status: 'reviewing' },
          dedupeKey: `start_review:${task.statusVersion}`,
        });
      }
    });
    return this.getTaskDetail(taskId);
  }

  /** 纠错合法结案：数据类必须关联当前有效已发布修正版本；非数据类必须有处理说明 */
  async resolveCorrection(
    actor: Actor,
    taskId: string,
    body: { status?: unknown; reviewNote?: unknown; resolvedVersionId?: unknown },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理纠错的权限');
    }
    const task = await this.loadTask(taskId);
    if (task.type !== 'correction') throw new BadRequestException('该任务不是纠错工单');
    const row = await this.prisma.opportunityCorrection.findUnique({ where: { id: task.refId } });
    if (!row) throw new NotFoundException('未找到对应纠错记录');
    const to = body.status === 'rejected' ? 'rejected' : 'resolved';
    const review = validateReview({
      from: row.status,
      to,
      reviewNote: body.reviewNote,
      existingNote: row.reviewNote,
    });
    if (!review.ok) throw new ConflictException(review.message);
    const requestedVersionId =
      typeof body.resolvedVersionId === 'string' && body.resolvedVersionId.trim()
        ? body.resolvedVersionId.trim()
        : null;
    const versions = await this.prisma.publishedAnnouncementVersion.findMany({
      where: { announcementId: row.announcementId },
      select: { id: true, versionNumber: true, status: true, supersededAt: true, withdrawnAt: true },
      orderBy: { versionNumber: 'desc' },
      take: 50,
    });
    let resolvedVersionId: string | null = null;
    if (to === 'resolved') {
      const check = validateResolution({
        fieldPath: row.fieldPath,
        submittedVersionId: row.versionId,
        reviewNote: review.note ?? row.reviewNote ?? null,
        resolvedVersionId: requestedVersionId,
        versions: versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          superseded: Boolean(v.supersededAt) || v.status !== 'published' || Boolean(v.withdrawnAt),
        })),
      });
      if (!check.ok) {
        throw check.kind === 'invalid_version' || check.kind === 'version_not_allowed'
          ? new BadRequestException(check.message)
          : new ConflictException(check.message);
      }
      resolvedVersionId = check.resolvedVersionId;
    }
    const effectiveNote = review.note ?? row.reviewNote ?? null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.opportunityCorrection.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: to,
          reviewNote: effectiveNote,
          reviewerId: actor.id,
          reviewedAt: now,
          resolvedVersionId,
        },
      });
      if (result.count === 0) throw new ConflictException('结案冲突：工单状态已变化，请刷新后重试');
      await this.syncTransitionTx(tx, {
        type: 'correction',
        refId: row.id,
        fromStatus: row.status,
        toStatus: to,
        action: to,
        actorId: actor.id,
        actorRole: actor.role,
        message: effectiveNote,
        visibility: 'public',
        createdAt: row.createdAt,
        dedupeKey: `resolved:${task.statusVersion}`,
      });
      const user = await this.submitterOf('correction', row.id);
      if (user) {
        await this.notifyTx(tx, {
          recipientIds: [user.id],
          severity: 'info',
          title:
            to === 'resolved'
              ? `你提交的纠错已处理完成（${task.ticketNo}）`
              : `你提交的纠错核对完成（${task.ticketNo}）`,
          body:
            (effectiveNote ? `处理说明：${effectiveNote}` : '') +
            (resolvedVersionId ? ` 已登记的修正版本：${resolvedVersionId}` : ''),
          eventKey: `ticket:${task.ticketNo}`,
          reminderStage: `correction_final:${now.getTime()}`,
          linkPath: `/me?ticket=correction:${row.id}#ticket-correction-${row.id}`,
          relatedUnitId: row.unitId,
        });
      }
    });
    return this.getTaskDetail(taskId);
  }

  /** 公告补录合法结案：必须关联真实、正式发布、未撤回、未取代的版本 */
  async resolveAnnouncementSubmission(
    actor: Actor,
    taskId: string,
    body: {
      status?: unknown;
      reviewNote?: unknown;
      expectedAnnouncementId?: unknown;
      expectedVersionId?: unknown;
      resolutionBasis?: unknown;
    },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理补录的权限');
    }
    const task = await this.loadTask(taskId);
    if (task.type !== 'announcement_submission') {
      throw new BadRequestException('该任务不是公告补录工单');
    }
    const row = await this.prisma.announcementSubmission.findUnique({ where: { id: task.refId } });
    if (!row) throw new NotFoundException('未找到对应补录记录');
    const to = body.status === 'rejected' ? 'rejected' : 'resolved';
    const review = validateReview({
      from: row.status,
      to,
      reviewNote: body.reviewNote,
      existingNote: row.reviewNote,
    });
    if (!review.ok) throw new ConflictException(review.message);
    let announcementId: string | null = null;
    let versionId: string | null = null;
    let basis: string | null = null;
    let versionNumber: number | null = null;
    let officialUrl: string | null = null;
    let unitId: string | null = null;
    if (to === 'resolved') {
      const expectedAnnouncementId =
        typeof body.expectedAnnouncementId === 'string' ? body.expectedAnnouncementId.trim() : '';
      const expectedVersionId =
        typeof body.expectedVersionId === 'string' ? body.expectedVersionId.trim() : '';
      const version = expectedVersionId
        ? await this.prisma.publishedAnnouncementVersion.findUnique({
            where: { id: expectedVersionId },
          })
        : null;
      // 公告事实来自已发布版本 payload（与用户端目录投影同源，无独立公告主表）。
      const payload = (version?.payload ?? null) as Record<string, unknown> | null;
      const payloadAnnouncement = payload?.announcement as
        | { id?: string; officialUrl?: string; lifecycle?: string }
        | undefined;
      const payloadUnits = (payload?.version as { units?: Array<{ unitId?: string }> } | undefined)
        ?.units;
      const gate = validatePublishedResolution({
        submission: { officialUrl: row.officialUrl, status: row.status },
        announcement: {
          id: version?.announcementId ?? expectedAnnouncementId,
          officialUrl: payloadAnnouncement?.officialUrl ?? null,
          dataset: typeof payload?.dataset === 'string' ? payload.dataset : null,
          lifecycle: payloadAnnouncement?.lifecycle ?? null,
        },
        version: version
          ? {
              id: version.id,
              announcementId: version.announcementId,
              status: version.status,
              supersededAt: version.supersededAt,
              withdrawnAt: version.withdrawnAt,
            }
          : null,
        announcedAnnouncementId: expectedAnnouncementId,
        announcedVersionId: expectedVersionId,
        resolutionBasis:
          typeof body.resolutionBasis === 'string' ? body.resolutionBasis : null,
      });
      if (!gate.ok) {
        throw gate.kind === 'basis_required'
          ? new BadRequestException(gate.message)
          : new ConflictException(gate.message);
      }
      announcementId = gate.announcementId;
      versionId = gate.versionId;
      basis = gate.basis;
      versionNumber = version!.versionNumber;
      officialUrl = payloadAnnouncement?.officialUrl ?? row.officialUrl;
      unitId = Array.isArray(payloadUnits)
        ? (payloadUnits[0]?.unitId ?? null)
        : null;
    }
    const effectiveNote = review.note ?? row.reviewNote ?? null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // 撤回/取代竞态：结案前在同一事务内再次确认版本仍有效
      if (to === 'resolved' && versionId) {
        const current = await tx.publishedAnnouncementVersion.findUnique({
          where: { id: versionId },
        });
        if (
          !current ||
          current.status !== 'published' ||
          current.withdrawnAt ||
          current.supersededAt
        ) {
          throw new ConflictException('关联公告版本已撤回或被取代，不能作为当前有效结果结案');
        }
      }
      const result = await tx.announcementSubmission.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: to,
          reviewNote: effectiveNote,
          reviewerId: actor.id,
          reviewedAt: now,
          resolvedAnnouncementId: announcementId,
          resolvedVersionId: versionId,
          resolutionBasis: basis,
          historyPendingVerification: false,
        },
      });
      if (result.count === 0) throw new ConflictException('结案冲突：工单状态已变化，请刷新后重试');
      await this.syncTransitionTx(tx, {
        type: 'announcement_submission',
        refId: row.id,
        fromStatus: row.status,
        toStatus: to,
        action: to,
        actorId: actor.id,
        actorRole: actor.role,
        message: effectiveNote,
        visibility: 'public',
        createdAt: row.createdAt,
        dedupeKey: `submission_final:${task.statusVersion}`,
      });
      await this.appendEventTx(tx, {
        task,
        action: 'published_result_linked',
        actorId: actor.id,
        actorRole: actor.role,
        visibility: 'internal',
        message: basis,
        beforeValue: null,
        afterValue: {
          announcementId,
          versionId,
          versionNumber,
          officialUrl,
          unitId,
          exactLink: basis === null,
        },
        dedupeKey: `published_link:${versionId ?? 'none'}`,
      });
      const user = await this.submitterOf('announcement_submission', row.id);
      if (user) {
        await this.notifyTx(tx, {
          recipientIds: [user.id],
          severity: 'info',
          title:
            to === 'resolved'
              ? `你补录的公告已收录（${task.ticketNo}）`
              : `你补录的公告核对完成（${task.ticketNo}）`,
          body:
            (effectiveNote ? `处理说明：${effectiveNote} ` : '') +
            (versionId ? '已关联正式发布公告，可点击查看。' : ''),
          eventKey: `ticket:${task.ticketNo}`,
          reminderStage: `submission_final:${now.getTime()}`,
          linkPath:
            versionId && unitId
              ? `/opportunities/${unitId}?version=${versionId}`
              : versionId
                ? `/me?ticket=announcement_submission:${row.id}`
                : `/me?ticket=announcement_submission:${row.id}`,
        });
      }
    });
    return this.getTaskDetail(taskId);
  }

  // ==================== 派生任务 ====================

  async completeDerivedTask(
    actor: Actor,
    taskId: string,
    body: {
      outcome?: unknown;
      note?: unknown;
      extractionRunId?: unknown;
      missingCheckNote?: unknown;
    },
  ): Promise<WorkbenchTaskDetail> {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new ForbiddenException('当前账号没有处理人工任务的权限');
    }
    const task = await this.loadTask(taskId);
    if (isTerminalTicketStatus(task.status)) {
      throw new ConflictException('该任务已结案');
    }
    const note = nonEmptyString(body.note, 2000) ?? '';
    if (task.type === 'parse_manual') {
      const parseRun = await this.prisma.documentParseRun.findUnique({
        where: { id: task.refId },
      });
      if (!parseRun) throw new NotFoundException('未找到对应解析记录');
      const extractionRunId =
        typeof body.extractionRunId === 'string' ? body.extractionRunId.trim() : '';
      const handoff = extractionRunId
        ? await this.prisma.extractionRun.findUnique({ where: { id: extractionRunId } })
        : null;
      const check = validateParseManualCompletion({
        parseStatus: parseRun.status,
        handoffRun: handoff
          ? {
              id: handoff.id,
              status: handoff.status,
              snapshotId: handoff.snapshotId,
            }
          : null,
        parseSnapshotId: parseRun.snapshotId,
        evidenceNote: note,
      });
      if (!check.ok) throw new ConflictException(check.message);
      await this.closeDerivedTask(actor, task, 'resolved', note);
      return this.getTaskDetail(taskId);
    }
    if (task.type === 'source_alert') {
      const alert = await this.prisma.sourcingAlert.findUnique({
        where: { id: task.refId },
        include: { source: true },
      });
      if (!alert) throw new NotFoundException('未找到对应来源告警');
      const check = validateSourceAlertCompletion({
        outcome: body.outcome,
        note,
        sourceHealthStatus: alert.source?.healthStatus ?? null,
        lastCheckedAt: alert.source?.lastCheckedAt ?? null,
        alertFirstSeenAt: alert.firstSeenAt,
        missingCheckNote: body.missingCheckNote,
      });
      if (!check.ok) throw new ConflictException(check.message);
      await this.closeDerivedTask(
        actor,
        task,
        check.outcome === 'limited' ? 'limited' : 'resolved',
        note,
      );
      if (check.outcome === 'limited') {
        await this.prisma.sourcingAlert.update({
          where: { id: alert.id },
          data: {
            resolvedAt: new Date(),
            message: `${alert.message}｜受限/停用结案：${note}`.slice(0, 500),
          },
        });
      }
      return this.getTaskDetail(taskId);
    }
    throw new BadRequestException('纠错和补录必须走合法结案流程');
  }

  private async closeDerivedTask(
    actor: Actor,
    task: { id: string; ticketNo: string; type: string; refId: string },
    outcome: 'resolved' | 'limited',
    note: string,
  ) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.serviceTask.updateMany({
        where: { id: task.id, status: { notIn: ['resolved', 'rejected'] } },
        data: {
          status: 'resolved',
          outcome,
          resolutionNote: note,
          resolvedBy: actor.id,
          resolvedAt: now,
          responseDueAt: null,
          updateDueAt: null,
          escalationDueAt: null,
          waitingOn: null,
          lastHandlerId: actor.id,
          statusVersion: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictException('任务已结案');
      await this.appendEventTx(tx, {
        task,
        action: 'resolved',
        actorId: actor.id,
        actorRole: actor.role,
        visibility: 'internal',
        message: note,
        afterValue: { outcome },
      });
    });
  }

  // ==================== 扫描与追加重建 ====================

  /** 历史纠错/补录无工作项外壳时增量补齐（只补最终摘要，不编造中间动作） */
  private async ensureLegacyTasks(): Promise<void> {
    const [corrections, submissions] = await Promise.all([
      this.prisma.opportunityCorrection.findMany({
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      }),
      this.prisma.announcementSubmission.findMany({
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      }),
    ]);
    const existing = await this.prisma.serviceTask.findMany({
      where: { type: { in: ['correction', 'announcement_submission'] } },
      select: { type: true, refId: true },
      take: 5000,
    });
    const key = new Set(existing.map((row) => `${row.type}:${row.refId}`));
    const missing: Array<{
      type: 'correction' | 'announcement_submission';
      refId: string;
      status: string;
      createdAt: Date;
    }> = [];
    for (const row of corrections) {
      if (!key.has(`correction:${row.id}`)) {
        missing.push({ type: 'correction', refId: row.id, status: row.status, createdAt: row.createdAt });
      }
    }
    for (const row of submissions) {
      if (!key.has(`announcement_submission:${row.id}`)) {
        missing.push({
          type: 'announcement_submission',
          refId: row.id,
          status: row.status,
          createdAt: row.createdAt,
        });
      }
    }
    for (const item of missing) {
      await this.prisma.$transaction(async (tx) => {
        await this.ensureTaskTx(tx, item);
      });
    }
  }

  /** 同步派生任务：同一未恢复故障复用活动待办，恢复后关闭；不重复建任务 */
  private async syncDerivedTx(tx: Db): Promise<{ created: number; closed: number }> {
    let created = 0;
    let closed = 0;
    const parseRuns = await tx.documentParseRun.findMany({
      where: { status: 'pending_manual' },
      select: { id: true, format: true, sourceUrl: true, createdAt: true },
      take: 500,
    });
    for (const run of parseRuns) {
      const refKey = `parse_manual:${run.id}`;
      const existing = await tx.serviceTask.findUnique({ where: { refKey } });
      if (!existing) {
        const task = await this.createTaskTx(tx, {
          type: 'parse_manual',
          refId: run.id,
          status: 'open',
          createdAt: run.createdAt,
          priority: 'medium',
          priorityReason: '扫描件/解析待人工，需真实交接到审核任务',
        });
        await tx.serviceTask.update({ where: { id: task.id }, data: { refKey } });
        await this.appendEventTx(tx, {
          task,
          action: 'derived_created',
          visibility: 'system',
          message: '扫描件/解析待人工任务已登记',
          dedupeKey: `derived:${refKey}`,
        });
        created += 1;
      }
    }
    const alerts = await tx.sourcingAlert.findMany({
      where: { resolvedAt: null },
      select: { id: true, type: true, message: true, firstSeenAt: true, severity: true, sourceId: true },
      take: 500,
    });
    for (const alert of alerts) {
      const refKey = `source_alert:${alert.id}`;
      const existing = await tx.serviceTask.findUnique({ where: { refKey } });
      if (!existing) {
        const task = await this.createTaskTx(tx, {
          type: 'source_alert',
          refId: alert.id,
          status: 'open',
          createdAt: alert.firstSeenAt,
          priority: alert.severity === 'critical' ? 'high' : 'medium',
          priorityReason:
            alert.severity === 'critical'
              ? '关键来源告警，可能影响临期机会覆盖'
              : '持续来源异常，需复查与漏采核对',
        });
        await tx.serviceTask.update({ where: { id: task.id }, data: { refKey } });
        await this.appendEventTx(tx, {
          task,
          action: 'derived_created',
          visibility: 'system',
          message: `来源告警已登记：${alert.message.slice(0, 120)}`,
          dedupeKey: `derived:${refKey}`,
        });
        created += 1;
      }
    }
    // 来源告警已恢复但任务仍活动：系统关闭
    const resolvedAlerts = await tx.serviceTask.findMany({
      where: { type: 'source_alert', status: { notIn: ['resolved', 'rejected'] } },
      take: 500,
    });
    for (const task of resolvedAlerts) {
      const alert = await tx.sourcingAlert.findUnique({ where: { id: task.refId } });
      if (alert?.resolvedAt) {
        await tx.serviceTask.update({
          where: { id: task.id },
          data: {
            status: 'resolved',
            outcome: 'resolved',
            resolvedAt: alert.resolvedAt,
            resolutionNote: '来源告警已由采集流程恢复，系统自动关闭',
            responseDueAt: null,
            updateDueAt: null,
            escalationDueAt: null,
            statusVersion: { increment: 1 },
          },
        });
        await this.appendEventTx(tx, {
          task,
          action: 'derived_auto_closed',
          visibility: 'system',
          message: '来源告警已恢复，系统自动关闭待办',
          dedupeKey: `auto_closed:${task.id}`,
        });
        closed += 1;
      }
    }
    return { created, closed };
  }

  /**
   * 5 分钟扫描（独立 Worker 重复任务调用）：内部时限催办、升级、负责人失效路由。
   * PostgreSQL 事务级 advisory lock 保证多实例互斥；提醒日志唯一键保证重扫/重启不轰炸。
   */
  async runSweep(
    options: { now?: Date; trigger?: string } = {},
  ): Promise<SweepResult> {
    const now = options.now ?? new Date();
    const trigger = options.trigger ?? 'manual';
    let skipped = false;
    let reminders = 0;
    let escalations = 0;
    let routed = 0;
    let derivedCreated = 0;
    let derivedClosed = 0;
    let scanned = 0;

    await this.prisma.$transaction(async (tx) => {
      const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('service_desk_sla_scan')) AS locked
      `;
      if (!lockRows[0]?.locked) {
        skipped = true;
        return;
      }

      // 历史任务补齐 + 派生任务同步
      const corrections = await tx.opportunityCorrection.findMany({
        where: { status: { notIn: ['resolved', 'rejected'] } },
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      const submissions = await tx.announcementSubmission.findMany({
        where: { status: { notIn: ['resolved', 'rejected'] } },
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      for (const row of corrections) {
        await this.ensureTaskTx(tx, { type: 'correction', refId: row.id, status: row.status, createdAt: row.createdAt });
      }
      for (const row of submissions) {
        await this.ensureTaskTx(tx, {
          type: 'announcement_submission',
          refId: row.id,
          status: row.status,
          createdAt: row.createdAt,
        });
      }
      const derived = await this.syncDerivedTx(tx);
      derivedCreated = derived.created;
      derivedClosed = derived.closed;

      const config = await tx.serviceDeskConfig.findUnique({ where: { id: 'default' } });
      const ownerIds = [config?.dutyOwnerId, config?.backupOwnerId].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      );
      const ownerRows = ownerIds.length
        ? await tx.user.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, role: true, isActive: true },
          })
        : [];
      const ownerMap = new Map(ownerRows.map((u) => [u.id, u]));
      const configCheck = validateOwnerPair({
        dutyOwnerId: config?.dutyOwnerId ?? undefined,
        backupOwnerId: config?.backupOwnerId ?? undefined,
        users: ownerMap,
      });
      const backupValid =
        config?.backupOwnerId &&
        ownerMap.get(config.backupOwnerId)?.isActive &&
        REVIEW_ROLES.includes(ownerMap.get(config.backupOwnerId)!.role)
          ? config.backupOwnerId
          : null;
      const admins = await tx.user.findMany({
        where: { role: 'admin', isActive: true },
        select: { id: true },
        take: 20,
      });
      const adminIds = admins.map((a) => a.id);

      const tasks = await tx.serviceTask.findMany({
        where: { status: { notIn: ['resolved', 'rejected'] } },
        orderBy: { updatedAt: 'asc' },
        take: 1000,
      });
      scanned = tasks.length;

      for (const task of tasks) {
        // 负责人失效路由
        const assigneeRow = task.assigneeId
          ? await tx.user.findUnique({ where: { id: task.assigneeId }, select: { id: true, role: true, isActive: true } })
          : null;
        const assigneeValid =
          assigneeRow && assigneeRow.isActive && REVIEW_ROLES.includes(assigneeRow.role);
        if (task.assigneeId && !assigneeValid) {
          const target = backupValid;
          if (target) {
            await tx.serviceTask.updateMany({
              where: { id: task.id, statusVersion: task.statusVersion },
              data: {
                assigneeId: target,
                defaultOwnerId: task.defaultOwnerId ?? target,
                routedToAdmin: false,
                routeIssue: '原负责人账号失效，已路由到备用负责人',
                statusVersion: { increment: 1 },
              },
            });
            await this.appendEventTx(tx, {
              task,
              action: 'rerouted_to_backup',
              visibility: 'system',
              message: '原负责人账号失效，系统路由到备用负责人',
              dedupeKey: `reroute:${task.id}:${target}:${config?.version ?? 0}`,
            });
            routed += 1;
          } else {
            await tx.serviceTask.updateMany({
              where: { id: task.id, statusVersion: task.statusVersion },
              data: {
                assigneeId: null,
                routedToAdmin: true,
                routeIssue: '日常负责人与备用负责人均无效，任务进入管理员未分配队列',
                statusVersion: { increment: 1 },
              },
            });
            await this.appendEventTx(tx, {
              task,
              action: 'routed_to_admin',
              visibility: 'system',
              message: '负责人均无效，任务进入管理员未分配异常队列',
              dedupeKey: `route_admin:${task.id}:${config?.version ?? 0}`,
            });
            if (adminIds.length) {
              await this.notifyTx(tx, {
                recipientIds: adminIds,
                severity: 'must_handle',
                title: `无人认领的人工任务 ${task.ticketNo}`,
                body: '运营负责人未配置完整或账号失效，请立即分配处理人。',
                eventKey: `ticket_admin:${task.id}`,
                reminderStage: `route_admin:${task.id}:${config?.version ?? 0}`,
                linkPath: `/admin/workbench?task=${task.id}`,
              });
            }
            routed += 1;
          }
        } else if (!task.assigneeId && !configCheck.ok && backupValid) {
          await tx.serviceTask.updateMany({
            where: { id: task.id, statusVersion: task.statusVersion, assigneeId: null },
            data: {
              assigneeId: backupValid,
              defaultOwnerId: task.defaultOwnerId ?? backupValid,
              routeIssue: '运营负责人配置不完整，已路由到备用负责人',
              statusVersion: { increment: 1 },
            },
          });
          await this.appendEventTx(tx, {
            task,
            action: 'rerouted_to_backup',
            visibility: 'system',
            message: '运营负责人配置不完整，任务路由到备用负责人',
            dedupeKey: `reroute_unassigned:${task.id}:${config?.version ?? 0}`,
          });
          routed += 1;
        } else if (!task.assigneeId && !configCheck.ok && !backupValid) {
          if (!task.routedToAdmin) {
            await tx.serviceTask.updateMany({
              where: { id: task.id, statusVersion: task.statusVersion },
              data: {
                routedToAdmin: true,
                routeIssue: '运营责任人未配置完整，进入管理员未分配队列',
                statusVersion: { increment: 1 },
              },
            });
            await this.appendEventTx(tx, {
              task,
              action: 'routed_to_admin',
              visibility: 'system',
              message: '运营责任人未配置完整，任务进入管理员未分配队列',
              dedupeKey: `route_unconfigured:${task.id}:${config?.version ?? 0}`,
            });
            if (adminIds.length) {
              await this.notifyTx(tx, {
                recipientIds: adminIds,
                severity: 'must_handle',
                title: `运营责任人未配置完整：${task.ticketNo}`,
                body: '该人工任务无人负责，请配置日常/备用负责人或手动分配。',
                eventKey: `ticket_admin:${task.id}`,
                reminderStage: `route_unconfigured:${task.id}:${config?.version ?? 0}`,
                linkPath: `/admin/workbench?task=${task.id}`,
              });
            }
            routed += 1;
          }
        }

        // 待用户补充：48 小时提醒用户；7 天长期标签在查询时计算
        if (task.status === 'need_supplement') {
          if (!task.pausedAt) continue;
          const waitHours = (now.getTime() - task.pausedAt.getTime()) / (60 * 60 * 1000);
          if (waitHours >= SUPPLEMENT_REMINDER_HOURS) {
            const submitter = await this.submitterOf(task.type, task.refId);
            if (submitter) {
              const cycleKey = reminderCycleKey(task);
              const inserted = await tx.serviceDeskReminder.createMany({
                data: [
                  {
                    taskId: task.id,
                    stage: 'waiting_supplement',
                    level: 'reminder',
                    cycleKey,
                    recipientId: submitter.id,
                  },
                ],
                skipDuplicates: true,
              });
              if (inserted.count > 0) {
                await this.notifyTx(tx, {
                  recipientIds: [submitter.id],
                  severity: 'suggest_handle',
                  title: `工单 ${task.ticketNo} 仍在等待你补充信息`,
                  body: '补充后工作人员才能继续核对；如问题已解决可忽略。',
                  eventKey: `ticket:${task.ticketNo}`,
                  reminderStage: `supplement_reminder:${cycleKey}`,
                  linkPath: `/me?ticket=${task.type}:${task.refId}`,
                  relatedUnitId: submitter.unitId,
                });
                reminders += 1;
              }
            }
          }
          continue;
        }

        // 计时到期催办
        const dueAt =
          task.firstResponseAt === null ? task.responseDueAt : task.updateDueAt;
        const stage = task.firstResponseAt === null ? 'first_response' : 'update';
        if (!dueAt) continue;
        const cycleKey = reminderCycleKey(task);
        if (now.getTime() >= dueAt.getTime()) {
          const recipients = [
            task.assigneeId,
            task.defaultOwnerId,
            backupValid,
          ].filter((v): v is string => typeof v === 'string' && v.length > 0);
          const inserted = await tx.serviceDeskReminder.createMany({
            data: [...new Set(recipients)].map((recipientId) => ({
              taskId: task.id,
              stage,
              level: 'reminder',
              cycleKey,
              recipientId,
            })),
            skipDuplicates: true,
          });
          if (inserted.count > 0) {
            await this.notifyTx(tx, {
              recipientIds: recipients,
              severity: 'suggest_handle',
              title: `人工任务 ${task.ticketNo} 已到期未响应`,
              body: `阶段：${stage === 'first_response' ? '首次有效响应' : '有效处理更新'}。请尽快公开进展、请求补充或合法结案。`,
              eventKey: `ticket_owner:${task.id}`,
              reminderStage: `sla_reminder:${stage}:${cycleKey}`,
              linkPath: `/admin/workbench?task=${task.id}`,
            });
            await tx.serviceTask.update({
              where: { id: task.id },
              data: { lastReminderAt: now },
            });
            reminders += 1;
          }
        }
        if (task.escalationDueAt && now.getTime() >= task.escalationDueAt.getTime()) {
          const recipients = [...new Set([backupValid, ...adminIds].filter(
            (v): v is string => typeof v === 'string' && v.length > 0,
          ))];
          const inserted = await tx.serviceDeskReminder.createMany({
            data: recipients.map((recipientId) => ({
              taskId: task.id,
              stage,
              level: 'escalation',
              cycleKey,
              recipientId,
            })),
            skipDuplicates: true,
          });
          if (inserted.count > 0) {
            await this.notifyTx(tx, {
              recipientIds: recipients,
              severity: 'must_handle',
              title: `人工任务 ${task.ticketNo} 已超时升级`,
              body: `已超过升级宽限仍无有效进展（阶段：${stage === 'first_response' ? '首次响应' : '处理更新'}）。请备用负责人或管理员接手。`,
              eventKey: `ticket_escalation:${task.id}`,
              reminderStage: `sla_escalation:${stage}:${cycleKey}`,
              linkPath: `/admin/workbench?task=${task.id}`,
            });
            await tx.serviceTask.update({
              where: { id: task.id },
              data: { escalationCount: { increment: 1 } },
            });
            await this.appendEventTx(tx, {
              task,
              action: 'escalated',
              visibility: 'system',
              message: '超过升级宽限仍无有效进展，已升级到备用负责人与管理员',
              dedupeKey: `escalation:${stage}:${cycleKey}`,
            });
            escalations += 1;
          }
        }
      }
    });

    return {
      scanned,
      reminders,
      escalations,
      routed,
      derivedCreated,
      derivedClosed,
      skipped,
      trigger,
      finishedAt: new Date().toISOString(),
    };
  }

  // ==================== 指标 ====================

  async metrics(): Promise<Record<string, unknown>> {
    const now = new Date();
    const [activeRows, statusGroups, historyMissingLinks] = await Promise.all([
      this.prisma.serviceTask.findMany({
        where: { status: { notIn: ['resolved', 'rejected'] } },
        select: {
          type: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          firstResponseAt: true,
          responseDueAt: true,
          updateDueAt: true,
          assigneeId: true,
          routedToAdmin: true,
          escalationCount: true,
        },
        take: 2000,
      }),
      this.prisma.serviceTask.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.announcementSubmission.count({
        where: { status: 'resolved', historyPendingVerification: true },
      }),
    ]);
    const resolved = await this.prisma.serviceTask.findMany({
      where: { status: { in: ['resolved', 'rejected'] }, resolvedAt: { not: null } },
      select: {
        type: true,
        priority: true,
        createdAt: true,
        resolvedAt: true,
        totalPausedMs: true,
      },
      orderBy: { resolvedAt: 'desc' },
      take: 1000,
    });
    const responseRows = await this.prisma.serviceTask.findMany({
      where: { firstResponseAt: { not: null } },
      select: { type: true, priority: true, createdAt: true, firstResponseAt: true },
      orderBy: { firstResponseAt: 'desc' },
      take: 1000,
    });
    const waitingRows = await this.prisma.serviceTask.findMany({
      where: { status: 'need_supplement' },
      select: { type: true, pausedAt: true, totalPausedMs: true },
      take: 1000,
    });

    const countByStatus = Object.fromEntries(
      statusGroups.map((g) => [g.status, g._count._all]),
    );
    const active = activeRows.length;
    const unassigned = activeRows.filter((r) => !r.assigneeId).length;
    const overdue = activeRows.filter((r) => {
      if (r.status === 'need_supplement') return false;
      const due = r.firstResponseAt === null ? r.responseDueAt : r.updateDueAt;
      return due ? due.getTime() < now.getTime() : false;
    }).length;
    const escalated = activeRows.filter((r) => r.escalationCount > 0 || r.routedToAdmin).length;
    const waiting = activeRows.filter((r) => r.status === 'need_supplement').length;
    const pendingReview = activeRows.filter((r) => r.status === 'pending_review').length;

    const average = (values: number[]) =>
      values.length === 0
        ? null
        : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

    const byKey = new Map<string, { type: string; priority: string; values: number[] }>();
    for (const row of responseRows) {
      if (!row.firstResponseAt) continue;
      const key = `${row.type}:${row.priority}`;
      const bucket = byKey.get(key) ?? { type: row.type, priority: row.priority, values: [] };
      bucket.values.push((row.firstResponseAt.getTime() - row.createdAt.getTime()) / 60000);
      byKey.set(key, bucket);
    }
    const firstResponseMinutes = [...byKey.values()].map((b) => ({
      type: b.type,
      priority: b.priority,
      averageMinutes: average(b.values),
      samples: b.values.length,
    }));

    const platformHandlingMinutes = (() => {
      const values = resolved
        .filter((r) => r.resolvedAt)
        .map((r) =>
          Math.max(
            0,
            ((r.resolvedAt as Date).getTime() - r.createdAt.getTime() - r.totalPausedMs) / 60000,
          ),
        );
      return { averageMinutes: average(values), samples: values.length };
    })();
    const waitingUserMinutes = {
      currentTotalMinutes: waitingRows.reduce(
        (sum, r) =>
          sum +
          (r.pausedAt ? (now.getTime() - r.pausedAt.getTime()) / 60000 : 0) +
          r.totalPausedMs / 60000,
        0,
      ),
      averageMinutes: average(
        waitingRows.map(
          (r) =>
            (r.pausedAt ? (now.getTime() - r.pausedAt.getTime()) / 60000 : 0) +
            r.totalPausedMs / 60000,
        ),
      ),
      samples: waitingRows.length,
    };

    return {
      generatedAt: now.toISOString(),
      counts: {
        active,
        unassigned,
        processing: countByStatus.reviewing ?? 0,
        pendingReview,
        waitingUser: waiting,
        overdue,
        escalated,
        resolved: countByStatus.resolved ?? 0,
        rejected: countByStatus.rejected ?? 0,
      },
      firstResponseMinutes,
      platformHandling: {
        ...platformHandlingMinutes,
        note: '平台实际处理时长已扣除等待用户时长',
      },
      waitingUser: { ...waitingUserMinutes, note: '用户等待时长不计入平台处理效率' },
      historyMissingPublishedLink: historyMissingLinks,
      samplesNote: '样本不足时不宣称效率提升；以上仅为可重复查询的内部试运行口径',
    };
  }
}
