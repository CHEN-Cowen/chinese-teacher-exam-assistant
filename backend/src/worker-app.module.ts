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

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({ connection: bullRedisConnection() }),
    SourcingWorkerModule,
  ],
})
export class WorkerAppModule {}
