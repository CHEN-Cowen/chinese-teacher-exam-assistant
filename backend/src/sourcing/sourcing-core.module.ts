/**
 * v7.2 工作包 4：抓取核心模块（API 与 Worker 共用）。
 *
 * 只提供与进程角色无关的能力：存储访问、适配器注册表、安全获取工厂、
 * 对象存储、队列端口、Redis 连接与健康观测。
 * **不包含任何 @Processor**，因此即便被 API 进程导入也不会执行抓取/解析。
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CRAWL_QUEUE_NAME, CRAWL_TASK_QUEUE } from './sourcing.tokens.js';
import { OBJECT_STORE } from './storage/storage.tokens.js';
import { LocalObjectStore } from './storage/object-store.js';
import {
  OssObjectStore,
  readOssConfigFromEnv,
} from './storage/oss-object-store.js';
import { CrawlRunStore } from './crawl-run-store.js';
import { SourceDocumentStore } from './source-document-store.js';
import { CrawlHealthService } from './crawl-health.service.js';
import { SourcingMetrics } from './observability.js';
import { REDIS_CLIENT, createRedisClient } from './redis.js';
import { SafeFetcherFactory } from './fetch/safe-fetcher-factory.js';
import { AdapterRegistry } from './adapter-registry.js';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';
import { NingboEducationAdapter } from './adapters/ningbo-education.adapter.js';
import { YinzhouGovernmentAdapter } from './adapters/yinzhou-government.adapter.js';
import { NanjingEducationAdapter } from './adapters/nanjing-education.adapter.js';
import { BullmqTaskQueue } from './jobs/bullmq-task-queue.js';

@Module({
  imports: [BullModule.registerQueue({ name: CRAWL_QUEUE_NAME })],
  providers: [
    HangzhouEducationAdapter,
    NingboEducationAdapter,
    YinzhouGovernmentAdapter,
    NanjingEducationAdapter,
    AdapterRegistry,
    SafeFetcherFactory,
    CrawlRunStore,
    SourceDocumentStore,
    CrawlHealthService,
    SourcingMetrics,
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient() },
    {
      provide: OBJECT_STORE,
      // 生产（配置 OSS_* 环境变量）→ 私有版本化 OSS；开发/测试 → 本地内容寻址快照
      useFactory: () => {
        const oss = readOssConfigFromEnv();
        return oss ? new OssObjectStore(oss) : new LocalObjectStore();
      },
    },
    BullmqTaskQueue,
    { provide: CRAWL_TASK_QUEUE, useExisting: BullmqTaskQueue },
  ],
  exports: [
    AdapterRegistry,
    SafeFetcherFactory,
    CrawlRunStore,
    SourceDocumentStore,
    CrawlHealthService,
    SourcingMetrics,
    REDIS_CLIENT,
    OBJECT_STORE,
    CRAWL_TASK_QUEUE,
  ],
})
export class SourcingCoreModule {}
