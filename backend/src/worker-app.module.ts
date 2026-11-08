/**
 * v7.2 工作包 4：Worker 进程根模块。
 *
 * 独立于 API 的 AppModule：不加载 HTTP 控制器、鉴权守卫与产品业务模块，
 * 只装配 Redis、队列消费与抓取处理器。
 * 与 API 使用**同一个后端镜像**，以 `node dist/worker.js` 作为独立入口运行。
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma.module.js';
import { bullRedisConnection } from './sourcing/redis.js';
import { SourcingWorkerModule } from './sourcing/sourcing-worker.module.js';
import { KnowledgeWorkerModule } from './knowledge/knowledge-worker.module.js';
import { ServiceDeskWorkerModule } from './service-desk/service-desk-worker.module.js';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({ connection: bullRedisConnection() }),
    SourcingWorkerModule,
    // W2：知识索引与抓取共用同一 Worker 进程；解析/向量化只在 Worker 执行
    KnowledgeWorkerModule,
    // 异常转人工内部时限：5 分钟持久化重复任务 + 独立 Worker 扫描
    ServiceDeskWorkerModule,
  ],
})
export class WorkerAppModule {}
