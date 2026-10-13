/**
 * v7.2：抓取可观测性（脱敏结构化日志）测试。
 *
 * 覆盖：各指标方法只输出约定的结构化标量字段；
 * sanitizeHost 只保留 host、对非法 URL 返回 'unknown'；
 * 日志内容绝不包含签名 URL 原文（signature 等敏感 query 参数）。
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourcingMetrics, sanitizeHost } from './observability.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeHost', () => {
  it('合法 URL 只保留 host（含端口），丢弃路径与签名参数', () => {
    expect(sanitizeHost('https://oss.example.com:8443/a/b?signature=secret&x=1')).toBe(
      'oss.example.com:8443',
    );
    expect(sanitizeHost('http://edu.hangzhou.gov.cn/col/col123/index.html')).toBe(
      'edu.hangzhou.gov.cn',
    );
  });

  it('非法 URL 返回 unknown，绝不回传原文', () => {
    expect(sanitizeHost('not a url ?signature=secret')).toBe('unknown');
    expect(sanitizeHost('')).toBe('unknown');
  });
});

describe('SourcingMetrics', () => {
  it('sourceCheckCompleted 输出结构化字段（event + 标量）', () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const metrics = new SourcingMetrics();

    metrics.sourceCheckCompleted({
      sourceId: 's1',
      runId: 'r1',
      trigger: 'admin',
      durationMs: 12,
      httpStatus: 200,
      notModified: false,
      discovered: 3,
      downloaded: 2,
      unchanged: 1,
      failed: 0,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toEqual({
      event: 'source_check_completed',
      sourceId: 's1',
      runId: 'r1',
      trigger: 'admin',
      durationMs: 12,
      httpStatus: 200,
      notModified: false,
      discovered: 3,
      downloaded: 2,
      unchanged: 1,
      failed: 0,
    });
  });

  it('304 未修改轮次：notModified=true、httpStatus 可省略', () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const metrics = new SourcingMetrics();

    metrics.sourceCheckCompleted({
      sourceId: 's1',
      runId: 'r2',
      trigger: 'schedule',
      durationMs: 5,
      notModified: true,
      discovered: 0,
      downloaded: 0,
      unchanged: 0,
      failed: 0,
    });

    const arg = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({ notModified: true, discovered: 0 });
    expect('httpStatus' in arg).toBe(false);
  });

  it('snapshotCreated 只记录哈希前缀（12 字符），不记录完整哈希', () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const metrics = new SourcingMetrics();

    metrics.snapshotCreated({
      sourceId: 's1',
      documentId: 'd1',
      contentHashPrefix: 'abcdef123456',
    });

    const arg = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toEqual({
      event: 'snapshot_created',
      sourceId: 's1',
      documentId: 'd1',
      contentHashPrefix: 'abcdef123456',
    });
    expect(String(arg.contentHashPrefix)).toHaveLength(12);
  });

  it('parseCompleted / queueBacklog 输出结构化字段', () => {
    const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const metrics = new SourcingMetrics();

    metrics.parseCompleted({
      snapshotId: 'snap-1',
      format: 'pdf',
      parserVersion: 'wp4-v1',
      status: 'parsed',
      warningCount: 2,
      durationMs: 30,
    });
    metrics.queueBacklog({ waiting: 4, delayed: 1, active: 2 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toEqual({
      event: 'parse_completed',
      snapshotId: 'snap-1',
      format: 'pdf',
      parserVersion: 'wp4-v1',
      status: 'parsed',
      warningCount: 2,
      durationMs: 30,
    });
    expect(spy.mock.calls[1][0]).toEqual({
      event: 'queue_backlog',
      waiting: 4,
      delayed: 1,
      active: 2,
    });
  });

  it('projectionFailed 与 consecutiveFailures 走 warn 级别', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const metrics = new SourcingMetrics();

    metrics.projectionFailed({ publishedVersionId: 'pv-1', fieldPath: 'jobs', message: '字段缺失' });
    metrics.consecutiveFailures({ sourceId: 's1', count: 3 });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toEqual({
      event: 'projection_failed',
      publishedVersionId: 'pv-1',
      fieldPath: 'jobs',
      message: '字段缺失',
    });
    expect(warnSpy.mock.calls[1][0]).toEqual({
      event: 'consecutive_failures',
      sourceId: 's1',
      count: 3,
    });
  });

  it('日志内容不包含签名 URL 原文（接入点只传 sanitizeHost 提取的 host）', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const metrics = new SourcingMetrics();

    // 模拟接入点：先 sanitizeHost 再把 host 作为标量字段记录
    const host = sanitizeHost('https://files.example.com/doc.pdf?signature=secret&Expires=999');
    metrics.sourceCheckCompleted({
      sourceId: host,
      runId: 'r1',
      trigger: 'admin',
      durationMs: 1,
      notModified: false,
      discovered: 0,
      downloaded: 0,
      unchanged: 0,
      failed: 0,
    });

    const serialized = JSON.stringify([
      ...logSpy.mock.calls.map((call) => call[0]),
      ...warnSpy.mock.calls.map((call) => call[0]),
    ]);
    expect(serialized).toContain('files.example.com');
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('doc.pdf');
  });
});
