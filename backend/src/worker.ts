/**
 * v7.2 工作包 4：Worker 进程入口（独立于 API 的 go-live 入口）。
 *
 * 与 API 共用同一后端镜像，只是改用本入口启动：
 *   node dist/worker.js
 *
 * - 只消费队列、执行抓取与解析，不监听 HTTP 端口；
 * - enableShutdownHooks 让 BullMQ Worker 优雅关闭（避免任务半途被丢弃）；
 * - Redis 暂时不可达时进程保持重连，不崩溃、不拖垮 API；
 * - Worker 崩溃后 BullMQ 按 attempts/backoff 重投，任务幂等可重放。
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module.js';

const logger = new Logger('CrawlWorker');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  logger.log('抓取 Worker 已启动，等待队列任务');
}

await bootstrap();
