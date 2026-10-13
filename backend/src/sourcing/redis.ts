/**
 * v7.2 工作包 4：Redis 连接、BullMQ 连接配置与 Worker 心跳。
 *
 * - BullMQ 生产者（API）与消费者（Worker）共用同一个 REDIS_URL；
 * - 健康检查与 Worker 心跳使用**独立** ioredis 连接：不占用 BullMQ 连接，
 *   且其失败可被单独观测，不会把 API 进程拖垮；
 * - 采用懒连接，Redis 暂时不可达时不阻塞进程启动；
 * - REDIS_URL 未配置时回退本地默认值，便于开发。
 */
import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

/** 独立 Redis 连接的注入令牌（健康检查 / 心跳用） */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Worker 心跳键：Worker 进程周期性续期，API 健康检查读取 */
export const WORKER_HEARTBEAT_KEY = 'crawl:worker:heartbeat';

/** 心跳有效期（秒）：超过即视为 Worker 不在线 */
export const WORKER_HEARTBEAT_TTL_SECONDS = 30;

/** Redis 连接地址；未配置时回退本地默认，便于开发 */
export function readRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? 'redis://127.0.0.1:6379';
}

/**
 * BullMQ 连接配置：直接使用 REDIS_URL。
 * maxRetriesPerRequest 置空是 BullMQ Worker 的硬性要求（阻塞式命令需要）。
 */
export function bullRedisConnection(
  env: NodeJS.ProcessEnv = process.env,
): ConnectionOptions {
  return { url: readRedisUrl(env), maxRetriesPerRequest: null };
}

/**
 * 健康检查 / 心跳用的独立连接：命令快速失败（离线队列关闭 + 有限重试），
 * 但 retryStrategy 仍会在后台重连，Redis 恢复后可继续续期心跳。
 */
export function createRedisClient(env: NodeJS.ProcessEnv = process.env): Redis {
  return new Redis(readRedisUrl(env), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

/** 给 Promise 加超时；超时或失败一律由调用方按“不可用”处理 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
