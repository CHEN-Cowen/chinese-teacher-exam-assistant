/**
 * WB6：审核导出服务（只读）。
 *
 * 职责：从服务端已保存记录（run.candidate + reviewRecords + snapshot.source +
 * publishedVersion.payload）组装导出物，不从当前 UI 状态拼装。
 * 全部规则判定与构造委托 export.ts 纯函数；本服务只负责读取、校验与错误语义：
 * - 任务不存在 → 404（NotFoundException）；
 * - 任务还没有提取结果（无 candidate）→ 400（BadRequestException），
 *   绝不生成空文件冒充成功。
 *
 * 只读：不修改抽取、候选质量判定、发布状态或任何审核决定。
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { ExtractionCandidate } from './domain.js';
import type { ExpectedChecklist } from './expected-checklist.js';
import {
  buildCsv,
  buildExportRows,
  buildJsonExport,
  computeExportMetrics,
  type ExportMetrics,
} from './export.js';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** 读取导出所需的全部服务端记录（统一入口，三个导出共享） */
  private async loadRunOrThrow(runId: string) {
    const run = await this.prisma.extractionRun.findUnique({
      where: { id: runId },
      include: {
        snapshot: { include: { source: true } },
        reviewRecords: { orderBy: { reviewedAt: 'asc' } },
        publishedVersion: true,
        expectedChecklist: true,
      },
    });
    if (!run) throw new NotFoundException('提取任务不存在');
    if (!run.candidate) {
      throw new BadRequestException('该任务还没有提取结果，无法导出');
    }
    return run;
  }

  /** M2：把持久化的清单行还原为领域对象（无清单返回 null） */
  private checklistFromRun(run: {
    expectedChecklist?: {
      version: number;
      snapshotId: string;
      inputHash: string;
      source: string;
      slots: unknown;
      frozenAt: Date;
      frozenBy: string;
      note?: string | null;
    } | null;
  }): ExpectedChecklist | null {
    const row = run.expectedChecklist;
    if (!row) return null;
    const slots = (row.slots ?? {}) as {
      announcementSlots?: ExpectedChecklist['announcementSlots'];
      jobs?: ExpectedChecklist['jobs'];
    };
    return {
      version: row.version,
      snapshotId: row.snapshotId,
      inputHash: row.inputHash,
      source: (row.source === 'retrospective' ? 'retrospective' : 'independent') as ExpectedChecklist['source'],
      announcementSlots: slots.announcementSlots ?? [],
      jobs: slots.jobs ?? [],
      frozenAt: row.frozenAt.toISOString(),
      frozenBy: row.frozenBy,
      note: row.note ?? undefined,
    };
  }

  /** 导出 JSON（结构化 scope、证据、alternatives、审核记录、实测指标） */
  async exportJson(runId: string): Promise<{ body: string; filename: string }> {
    const run = await this.loadRunOrThrow(runId);
    const candidate = run.candidate as unknown as ExtractionCandidate;
    const source = run.snapshot?.source;
    const checklist = this.checklistFromRun(run);

    const metrics = computeExportMetrics({
      runId: run.id,
      status: run.status,
      parserVersion: run.parserVersion,
      candidate,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      reviewTimes: run.reviewRecords.map((r) => r.reviewedAt),
      retryCount: run.retryCount,
      publishedPayload: run.publishedVersion?.payload ?? undefined,
      sourceOfficialUrl: source?.officialUrl ?? null,
      checklist,
    });

    const payload = buildJsonExport({
      exportedAt: new Date(),
      datasetMark: metrics.datasetMark,
      source: {
        publisher: source?.publisher ?? '未知来源',
        officialUrl: source?.officialUrl ?? '',
      },
      run: {
        id: run.id,
        snapshotId: run.snapshotId,
        announcementId: run.announcementId,
        status: run.status,
        parserVersion: run.parserVersion,
        retryCount: run.retryCount,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        finishedAt: run.finishedAt,
      },
      candidate,
      reviewRecords: run.reviewRecords.map((r) => ({
        action: r.action,
        reason: r.reason,
        reviewerId: r.reviewerId,
        reviewerName: r.reviewerName,
        reviewedAt: r.reviewedAt.toISOString(),
      })),
      metrics,
    });

    return {
      body: JSON.stringify(payload, null, 2),
      filename: `workbuddy-run-${run.id}.json`,
    };
  }

  /** 导出 UTF-8 CSV（一行一个「岗位 × 字段」，14 列固定顺序） */
  async exportCsv(runId: string): Promise<{ body: string; filename: string }> {
    const run = await this.loadRunOrThrow(runId);
    const candidate = run.candidate as unknown as ExtractionCandidate;

    const rows = buildExportRows({
      runId: run.id,
      snapshotId: run.snapshotId,
      candidate,
    });

    return {
      body: buildCsv(rows),
      filename: `workbuddy-run-${run.id}.csv`,
    };
  }

  /** 实测指标（按 run + 按公告公共/逐岗位，分子分母与公式齐备） */
  async getMetrics(runId: string): Promise<ExportMetrics> {
    const run = await this.loadRunOrThrow(runId);
    const candidate = run.candidate as unknown as ExtractionCandidate;
    const source = run.snapshot?.source;
    const checklist = this.checklistFromRun(run);

    return computeExportMetrics({
      runId: run.id,
      status: run.status,
      parserVersion: run.parserVersion,
      candidate,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      reviewTimes: run.reviewRecords.map((r) => r.reviewedAt),
      retryCount: run.retryCount,
      publishedPayload: run.publishedVersion?.payload ?? undefined,
      sourceOfficialUrl: source?.officialUrl ?? null,
      checklist,
    });
  }
}
