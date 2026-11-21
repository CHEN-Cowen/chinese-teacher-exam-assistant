/**
 * 试跑预算的 PostgreSQL 实现。
 *
 * 所有扣减都在数据库内原子完成：
 * - 额度扣减用条件 UPDATE（status = 'active' AND used < max），并发行锁天然串行；
 * - 准入先占唯一键（run_id + kind + canonical_url），再扣额度，重放/重投幂等；
 * - 附件额外按父文档计数，同时受每篇与整轮额度约束；
 * - HTTP 请求次数在每次实际请求前扣减，重试与重定向同样计入。
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import {
  remainingOf,
  type AdmissionResult,
  type BudgetGate,
  type CrawlBudgetPort,
  type DeferrableKind,
  type TrialBudgetLimits,
  type TrialBudgetSnapshot,
  type TrialBudgetStatus,
} from './crawl-budget.js';

interface BudgetRow {
  run_id: string;
  source_id: string;
  max_list_pages: number;
  max_details: number;
  max_attachments_per_document: number;
  max_attachments_total: number;
  max_http_requests: number;
  list_pages_used: number;
  details_used: number;
  attachments_used: number;
  http_requests_used: number;
  list_pages_deferred: number;
  details_deferred: number;
  attachments_deferred: number;
  status: string;
  stop_reason: string | null;
  stopped_at: Date | null;
}

const BUDGET_COLUMNS = `
  run_id, source_id, max_list_pages, max_details,
  max_attachments_per_document, max_attachments_total, max_http_requests,
  list_pages_used, details_used, attachments_used, http_requests_used,
  list_pages_deferred, details_deferred, attachments_deferred,
  status, stop_reason, stopped_at
`;

function toSnapshot(row: BudgetRow): TrialBudgetSnapshot {
  return {
    runId: row.run_id,
    sourceId: row.source_id,
    maxListPages: row.max_list_pages,
    maxDetails: row.max_details,
    maxAttachmentsPerDocument: row.max_attachments_per_document,
    maxAttachmentsTotal: row.max_attachments_total,
    maxHttpRequests: row.max_http_requests,
    listPagesUsed: row.list_pages_used,
    detailsUsed: row.details_used,
    attachmentsUsed: row.attachments_used,
    httpRequestsUsed: row.http_requests_used,
    listPagesDeferred: row.list_pages_deferred,
    detailsDeferred: row.details_deferred,
    attachmentsDeferred: row.attachments_deferred,
    status: row.status as TrialBudgetStatus,
    stopReason: row.stop_reason,
    stoppedAt: row.stopped_at ? row.stopped_at.toISOString() : null,
    remaining: remainingOf({
      maxListPages: row.max_list_pages,
      maxDetails: row.max_details,
      maxAttachmentsTotal: row.max_attachments_total,
      maxHttpRequests: row.max_http_requests,
      listPagesUsed: row.list_pages_used,
      detailsUsed: row.details_used,
      attachmentsUsed: row.attachments_used,
      httpRequestsUsed: row.http_requests_used,
    }),
  };
}

function gateForRow(row: BudgetRow | undefined): BudgetGate | null {
  if (!row) return 'unbudgeted';
  if (row.status === 'stopped') return 'stopped';
  return 'exhausted';
}

const DEFERRED_COLUMN: Record<DeferrableKind, string> = {
  listPages: 'list_pages_deferred',
  details: 'details_deferred',
  attachments: 'attachments_deferred',
};

@Injectable()
export class PrismaCrawlBudgetStore implements CrawlBudgetPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    runId: string,
    sourceId: string,
    limits: TrialBudgetLimits,
  ): Promise<TrialBudgetSnapshot> {
    try {
      await this.prisma.crawlRunBudget.create({
        data: {
          runId,
          sourceId,
          maxListPages: limits.maxListPages,
          maxDetails: limits.maxDetails,
          maxAttachmentsPerDocument: limits.maxAttachmentsPerDocument,
          maxAttachmentsTotal: limits.maxAttachmentsTotal,
          maxHttpRequests: limits.maxHttpRequests,
        },
      });
    } catch (error) {
      // 幂等：同一运行重复创建预算返回已有行
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
    const snapshot = await this.get(runId);
    if (!snapshot) throw new Error(`试跑预算创建失败：${runId}`);
    return snapshot;
  }

  async get(runId: string): Promise<TrialBudgetSnapshot | null> {
    const rows = await this.prisma.$queryRawUnsafe<BudgetRow[]>(
      `SELECT ${BUDGET_COLUMNS} FROM crawl_run_budgets WHERE run_id = $1`,
      runId,
    );
    return rows[0] ? toSnapshot(rows[0]) : null;
  }

  async consumeListPage(runId: string): Promise<BudgetGate> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ used: number }>>(
        `UPDATE crawl_run_budgets
            SET list_pages_used = list_pages_used + 1, updated_at = now()
          WHERE run_id = $1 AND status = 'active'
            AND list_pages_used < max_list_pages
          RETURNING list_pages_used AS used`,
        runId,
      );
      if (rows.length > 0) return 'ok';
      return gateForRow(await this.row(runId)) ?? 'unbudgeted';
    } catch (error) {
      // 表不存在等基础设施错误不应静默放行
      throw error;
    }
  }

  async admitDocument(
    runId: string,
    canonicalUrl: string,
  ): Promise<AdmissionResult> {
    return this.admit(runId, 'document', canonicalUrl, null);
  }

  async admitAttachment(
    runId: string,
    parentDocumentId: string,
    canonicalUrl: string,
  ): Promise<AdmissionResult> {
    return this.admit(runId, 'attachment', canonicalUrl, parentDocumentId);
  }

  async isAdmitted(
    runId: string,
    kind: 'document' | 'attachment',
    canonicalUrl: string,
  ): Promise<boolean | 'unbudgeted'> {
    const budget = await this.row(runId);
    if (!budget) return 'unbudgeted';
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM crawl_run_admissions
        WHERE run_id = $1 AND kind = $2 AND canonical_url = $3
        LIMIT 1`,
      runId,
      kind,
      canonicalUrl,
    );
    return rows.length > 0;
  }

  async consumeHttpAttempt(runId: string): Promise<BudgetGate> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ used: number }>>(
      `UPDATE crawl_run_budgets
          SET http_requests_used = http_requests_used + 1, updated_at = now()
        WHERE run_id = $1 AND status = 'active'
          AND http_requests_used < max_http_requests
        RETURNING http_requests_used AS used`,
      runId,
    );
    if (rows.length > 0) return 'ok';
    return gateForRow(await this.row(runId)) ?? 'unbudgeted';
  }

  async markDeferred(
    runId: string,
    kind: DeferrableKind,
    count: number,
  ): Promise<void> {
    if (count <= 0) return;
    await this.prisma.$executeRawUnsafe(
      `UPDATE crawl_run_budgets
          SET ${DEFERRED_COLUMN[kind]} = ${DEFERRED_COLUMN[kind]} + $2,
              updated_at = now()
        WHERE run_id = $1`,
      runId,
      count,
    );
  }

  async stop(
    runId: string,
    reason: string,
  ): Promise<TrialBudgetSnapshot | null> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE crawl_run_budgets
          SET status = 'stopped', stop_reason = $2, stopped_at = now(),
              updated_at = now()
        WHERE run_id = $1 AND status <> 'stopped'`,
      runId,
      reason,
    );
    return this.get(runId);
  }

  async isStopped(runId: string): Promise<boolean> {
    const row = await this.row(runId);
    return row?.status === 'stopped';
  }

  private async row(runId: string): Promise<BudgetRow | undefined> {
    const rows = await this.prisma.$queryRawUnsafe<BudgetRow[]>(
      `SELECT ${BUDGET_COLUMNS} FROM crawl_run_budgets WHERE run_id = $1`,
      runId,
    );
    return rows[0];
  }

  /**
   * 准入事务：锁预算行 → 占唯一键 → 校验额度 → 扣减。
   * 锁保证并发任务不会同时越过每篇/整轮上限；唯一键保证重放不重复占用。
   */
  private async admit(
    runId: string,
    kind: 'document' | 'attachment',
    canonicalUrl: string,
    parentDocumentId: string | null,
  ): Promise<AdmissionResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<BudgetRow[]>(
        `SELECT ${BUDGET_COLUMNS} FROM crawl_run_budgets
          WHERE run_id = $1 FOR UPDATE`,
        runId,
      );
      const budget = locked[0];
      if (!budget) return 'unbudgeted';
      if (budget.status !== 'active') {
        return budget.status === 'stopped' ? 'stopped' : 'exhausted';
      }

      const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO crawl_run_admissions (id, run_id, kind, canonical_url, parent_document_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, kind, canonical_url) DO NOTHING
         RETURNING id`,
        randomUUID(),
        runId,
        kind,
        canonicalUrl,
        parentDocumentId,
      );
      if (inserted.length === 0) return 'duplicate';

      let allowed = false;
      if (kind === 'document') {
        allowed = budget.details_used < budget.max_details;
      } else {
        const perDocument = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*)::bigint AS count FROM crawl_run_admissions
            WHERE run_id = $1 AND kind = 'attachment' AND parent_document_id = $2`,
          runId,
          parentDocumentId,
        );
        const countForParent = Number(perDocument[0]?.count ?? 0);
        allowed =
          budget.attachments_used < budget.max_attachments_total &&
          countForParent <= budget.max_attachments_per_document;
      }

      if (!allowed) {
        // 撤销刚占的准入，避免重放时把“被拒”误认为“已准入”
        await tx.$executeRawUnsafe(
          `DELETE FROM crawl_run_admissions
            WHERE run_id = $1 AND kind = $2 AND canonical_url = $3`,
          runId,
          kind,
          canonicalUrl,
        );
        await tx.$executeRawUnsafe(
          `UPDATE crawl_run_budgets
              SET ${DEFERRED_COLUMN[kind === 'document' ? 'details' : 'attachments']}
                    = ${DEFERRED_COLUMN[kind === 'document' ? 'details' : 'attachments']} + 1,
                  updated_at = now()
            WHERE run_id = $1`,
          runId,
        );
        return 'exhausted';
      }

      const column = kind === 'document' ? 'details_used' : 'attachments_used';
      await tx.$executeRawUnsafe(
        `UPDATE crawl_run_budgets
            SET ${column} = ${column} + 1, updated_at = now()
          WHERE run_id = $1`,
        runId,
      );
      return 'admitted';
    });
  }
}
