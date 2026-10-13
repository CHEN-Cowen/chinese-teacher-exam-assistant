/**
 * v7.2 工作包 4：抓取拓扑健康观测（区分 API / Redis / Worker）。
 *
 * - API 自身的存活由 HTTP 可达性体现（health.controller 的 api 字段）；
 * - Redis 可达性用独立连接 PING；
 * - Worker 存活用 Redis 心跳键：Worker 进程周期性续期，键过期即视为不在线。
 *
 * 所有探测带超时；Redis 不可达时返回 down 而不是抛错，保证健康检查本身
 * 不会成为 API 的故障源。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  REDIS_CLIENT,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  withTimeout,
} from './redis.js';

export type UpDown = 'up' | 'down';

export interface WorkerStatus {
  status: UpDown;
  lastSeenAt: string | null;
  ageMs: number | null;
}

@Injectable()
export class CrawlHealthService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async redisStatus(timeoutMs = 1000): Promise<UpDown> {
    try {
      const pong = await withTimeout(this.redis.ping(), timeoutMs);
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  /** Worker 侧调用：续期心跳（带 TTL，进程退出后键自动过期） */
  async markWorkerAlive(now: Date = new Date()): Promise<void> {
    await this.redis.set(
      WORKER_HEARTBEAT_KEY,
      now.toISOString(),
      'EX',
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
  }

  /** API 侧调用：读取 Worker 心跳并判断是否新鲜 */
  async workerStatus(
    now: Date = new Date(),
    timeoutMs = 1000,
  ): Promise<WorkerStatus> {
    let raw: string | null = null;
    try {
      raw = await withTimeout(this.redis.get(WORKER_HEARTBEAT_KEY), timeoutMs);
    } catch {
      return { status: 'down', lastSeenAt: null, ageMs: null };
    }
    if (!raw) return { status: 'down', lastSeenAt: null, ageMs: null };
    const seen = new Date(raw);
    if (Number.isNaN(seen.getTime())) {
      return { status: 'down', lastSeenAt: raw, ageMs: null };
    }
    const ageMs = now.getTime() - seen.getTime();
    return {
      status: ageMs <= WORKER_HEARTBEAT_TTL_SECONDS * 1000 ? 'up' : 'down',
      lastSeenAt: raw,
      ageMs,
    };
  }
}
