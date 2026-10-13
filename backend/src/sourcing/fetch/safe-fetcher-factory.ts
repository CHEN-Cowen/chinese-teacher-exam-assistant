/**
 * v7.2 工作包 4：SafeFetcher 工厂。
 *
 * 按来源策略（allowedHosts）与环境配置（超时、重定向、大小、重试）构造
 * SafeFetcher，保证所有来源共用同一套安全获取策略，而不是各写一套。
 */
import { Injectable } from '@nestjs/common';
import type { SourceRecord } from '../crawl-run-store.js';
import { SafeFetcher } from './safe-fetcher.js';

export interface CrawlEnvConfig {
  maxRedirects: number;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
  maxBytes: number;
  userAgent: string;
  retryAttempts: number;
  retryBaseDelayMs: number;
  /** 同域并发上限（默认 1） */
  concurrency: number;
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readCrawlEnv(env: NodeJS.ProcessEnv = process.env): CrawlEnvConfig {
  return {
    maxRedirects: intFromEnv(env.CRAWL_MAX_REDIRECTS, 3),
    connectTimeoutMs: intFromEnv(env.CRAWL_CONNECT_TIMEOUT_MS, 5000),
    totalTimeoutMs: intFromEnv(env.CRAWL_TOTAL_TIMEOUT_MS, 15000),
    maxBytes: intFromEnv(env.CRAWL_MAX_BYTES, 8 * 1024 * 1024),
    userAgent:
      env.CRAWL_USER_AGENT ?? 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)',
    retryAttempts: intFromEnv(env.CRAWL_RETRY_ATTEMPTS, 3),
    retryBaseDelayMs: intFromEnv(env.CRAWL_RETRY_BASE_DELAY_MS, 200),
    concurrency: intFromEnv(env.CRAWL_CONCURRENCY, 1),
  };
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 来源允许抓取的 host：显式声明优先，否则由 officialUrl 推导 */
export function resolveAllowedHosts(source: SourceRecord): string[] {
  if (source.allowedHosts && source.allowedHosts.length > 0) {
    return source.allowedHosts;
  }
  const host = hostOf(source.officialUrl);
  return host ? [host] : [];
}

@Injectable()
export class SafeFetcherFactory {
  private readonly config: CrawlEnvConfig;

  constructor(config?: CrawlEnvConfig) {
    this.config = config ?? readCrawlEnv();
  }

  create(source: SourceRecord): SafeFetcher {
    return new SafeFetcher({
      allowedHosts: resolveAllowedHosts(source),
      maxRedirects: this.config.maxRedirects,
      connectTimeoutMs: this.config.connectTimeoutMs,
      totalTimeoutMs: this.config.totalTimeoutMs,
      maxBytes: this.config.maxBytes,
      userAgent: this.config.userAgent,
      retry: {
        attempts: this.config.retryAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
      },
    });
  }
}
