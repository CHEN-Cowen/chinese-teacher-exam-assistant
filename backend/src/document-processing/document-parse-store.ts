/**
 * v7.2 附件解析：DocumentParseRun 持久化访问（Seam）。
 *
 * - 幂等键 = snapshotId + parserVersion：同快照同解析器版本最多一条记录；
 * - 已成功解析（parsed）的记录永不覆盖：同版本重放直接复用；
 * - 失败/pending 记录可被同版本重跑更新（重试语义）；
 * - 解析器版本升级产生新记录，旧记录保留可审计。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { DocumentParseStatus } from './parsed-document.js';

export interface DocumentParseRunRecord {
  id: string;
  snapshotId: string;
  documentId: string | null;
  format: string;
  parserVersion: string;
  status: DocumentParseStatus;
  blocks: unknown;
  tableHeaders: unknown;
  blockCount: number;
  warningCount: number;
  warnings: unknown;
  errorSummary: string | null;
  scanned: boolean;
  ocrRequired: boolean;
  ocrStatus: string | null;
  sourceUrl: string | null;
  contentHash: string;
}

export interface UpsertParseRunInput {
  snapshotId: string;
  documentId?: string | null;
  format: string;
  parserVersion: string;
  contentHash: string;
  sourceUrl: string | null;
}

@Injectable()
export class DocumentParseStore {
  constructor(private readonly prisma: PrismaService) {}

  parseIdempotencyKey(snapshotId: string, parserVersion: string): string {
    return `${snapshotId}:${parserVersion}`;
  }

  async findRun(
    snapshotId: string,
    parserVersion: string,
  ): Promise<DocumentParseRunRecord | null> {
    const row = await this.prisma.documentParseRun.findUnique({
      where: {
        snapshotId_parserVersion: { snapshotId, parserVersion },
      },
    });
    return (row as DocumentParseRunRecord) ?? null;
  }

  /** 同快照最近一次成功解析的标准文档（供业务抽取读取） */
  async findLatestParsedRun(snapshotId: string): Promise<DocumentParseRunRecord | null> {
    const rows = await this.prisma.documentParseRun.findMany({
      where: { snapshotId, status: 'parsed' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return (rows[0] as DocumentParseRunRecord) ?? null;
  }

  /** 同快照最近一条记录（含 pending_manual / failed，供"待人工处理"落提取任务） */
  async findLatestRun(snapshotId: string): Promise<DocumentParseRunRecord | null> {
    const rows = await this.prisma.documentParseRun.findMany({
      where: { snapshotId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return (rows[0] as DocumentParseRunRecord) ?? null;
  }

  /** 创建 pending 记录；同键已存在（pending/failed/pending_manual）则复用 */
  async ensureRun(input: UpsertParseRunInput): Promise<{ run: DocumentParseRunRecord; created: boolean }> {
    const idempotencyKey = this.parseIdempotencyKey(input.snapshotId, input.parserVersion);
    const existing = await this.findRun(input.snapshotId, input.parserVersion);
    if (existing) {
      if (existing.status === 'parsed') {
        // 已成功解析：不覆盖（幂等重放）
        return { run: existing, created: false };
      }
      // pending/failed/pending_manual：重跑覆盖为 pending（重试语义）
      const row = await this.prisma.documentParseRun.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          blocks: Prisma.DbNull,
          tableHeaders: Prisma.DbNull,
          blockCount: 0,
          warningCount: 0,
          warnings: Prisma.DbNull,
          errorSummary: null,
          finishedAt: null,
        },
      });
      return { run: row as DocumentParseRunRecord, created: false };
    }
    const row = await this.prisma.documentParseRun.create({
      data: {
        snapshotId: input.snapshotId,
        documentId: input.documentId ?? null,
        format: input.format,
        parserVersion: input.parserVersion,
        idempotencyKey,
        status: 'pending',
        contentHash: input.contentHash,
        sourceUrl: input.sourceUrl,
      },
    });
    return { run: row as DocumentParseRunRecord, created: true };
  }

  /** 写入成功/终态结果（只更新 pending 或 failed/pending_manual 重跑记录） */
  async completeRun(
    runId: string,
    result: {
      status: DocumentParseStatus;
      blocks?: unknown;
      tableHeaders?: unknown;
      blockCount?: number;
      warnings?: string[];
      errorSummary?: string;
      format?: string;
      scanned?: boolean;
      ocrRequired?: boolean;
      ocrStatus?: string | null;
    },
  ): Promise<DocumentParseRunRecord> {
    const row = await this.prisma.documentParseRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        ...(result.blocks !== undefined
          ? { blocks: result.blocks as Prisma.InputJsonValue }
          : {}),
        ...(result.tableHeaders !== undefined
          ? { tableHeaders: result.tableHeaders as Prisma.InputJsonValue }
          : {}),
        ...(result.blockCount !== undefined ? { blockCount: result.blockCount } : {}),
        ...(result.warnings !== undefined
          ? { warnings: result.warnings, warningCount: result.warnings.length }
          : {}),
        ...(result.errorSummary !== undefined ? { errorSummary: result.errorSummary } : {}),
        ...(result.format !== undefined ? { format: result.format } : {}),
        ...(result.scanned !== undefined ? { scanned: result.scanned } : {}),
        ...(result.ocrRequired !== undefined ? { ocrRequired: result.ocrRequired } : {}),
        ...(result.ocrStatus !== undefined ? { ocrStatus: result.ocrStatus } : {}),
        finishedAt: new Date(),
      },
    });
    return row as DocumentParseRunRecord;
  }
}
