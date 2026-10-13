/**
 * v7.2：抓取可观测性（脱敏结构化日志）。
 *
 * 统一输出 sourcing 域关键事件，便于检索、看板与告警；
 * 全部 fire-and-forget：同步写日志、不抛错、不阻塞抓取主流程。
 *
 * 脱敏边界（严禁越界）：
 * - 禁止传入画像正文、密钥、完整签名 URL；
 * - URL 只允许记录 host（用 sanitizeHost 提取后再传入）；
 * - contentHash 只记录前 12 字符前缀。
 */
import { Injectable, Logger } from '@nestjs/common';

/** 从 URL 提取 host；解析失败返回 'unknown'（绝不回传原始 URL） */
export function sanitizeHost(url: string): string {
  try {
    return new URL(url).host || 'unknown';
  } catch {
    return 'unknown';
  }
}

@Injectable()
export class SourcingMetrics {
  private readonly logger = new Logger('SourcingMetrics');

  /** 来源检查完成（succeeded / no_new / zero_suspect / failed 统一出口） */
  sourceCheckCompleted(fields: {
    sourceId: string;
    runId: string;
    trigger: string;
    durationMs: number;
    httpStatus?: number;
    notModified: boolean;
    discovered: number;
    downloaded: number;
    unchanged: number;
    failed: number;
  }): void {
    this.emit('source_check_completed', fields);
  }

  /** 新快照创建（contentHash 只记前 12 字符前缀） */
  snapshotCreated(fields: {
    sourceId: string;
    documentId?: string;
    contentHashPrefix: string;
  }): void {
    this.emit('snapshot_created', fields);
  }

  /** 文档格式解析完成（含 pending_manual / unsupported_format / failed） */
  parseCompleted(fields: {
    snapshotId: string;
    format: string;
    parserVersion: string;
    status: string;
    warningCount: number;
    durationMs?: number;
  }): void {
    this.emit('parse_completed', fields);
  }

  /** 投影失败（告警级，便于及时发现发布链路问题） */
  projectionFailed(fields: {
    publishedVersionId: string;
    fieldPath?: string;
    message: string;
  }): void {
    this.emit('projection_failed', fields, 'warn');
  }

  /** 来源连续失败计数增长（告警级） */
  consecutiveFailures(fields: { sourceId: string; count: number }): void {
    this.emit('consecutive_failures', fields, 'warn');
  }

  /** 队列积压快照（waiting/delayed/active） */
  queueBacklog(fields: { waiting: number; delayed: number; active: number }): void {
    this.emit('queue_backlog', fields);
  }

  private emit(
    event: string,
    fields: Record<string, unknown>,
    level: 'log' | 'warn' = 'log',
  ): void {
    const line = { event, ...fields };
    if (level === 'warn') {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
