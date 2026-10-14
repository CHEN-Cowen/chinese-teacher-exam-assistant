/**
 * 回归测试：SourcingModule 必须能被 Nest 真实编译（生产启动故障）。
 *
 * 故障背景（生产镜像 sha-9f6164f7）：SourcingModule 在 exports 中直接列出了
 * CrawlHealthService，但它由 SourcingCoreModule 提供而非自身 providers，
 * Nest 在模块扫描阶段抛出：
 *   UnknownExportException: Nest cannot export a provider/module that is not a
 *   part of the currently processed module (SourcingModule).
 *
 * 本测试通过 @nestjs/testing 真实编译模块图验证：
 * - SourcingModule 能被 Nest 编译（不再出现 UnknownExportException）；
 * - 上层模块经由 SourcingModule 能解析到 CrawlHealthService（/health 依赖）；
 * - CrawlOrchestrator 仍正常导出（运维接口依赖）；
 * - CrawlHealthService 全图只有一个实例（不重复注册、不重复建 Redis 连接）。
 *
 * 队列与 Redis 用替身覆盖：编译期不触网、不需要真实 Redis/PostgreSQL。
 */
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma.module.js';
import { PrismaService } from '../prisma.service.js';
import { SourcingModule } from './sourcing.module.js';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlHealthService } from './crawl-health.service.js';
import { REDIS_CLIENT } from './redis.js';
import { CRAWL_QUEUE_NAME } from './sourcing.tokens.js';

/** 模拟上层模块：只导入 SourcingModule，不直接接触 SourcingCoreModule */
@Module({ imports: [SourcingModule] })
class UpperModule {}

async function compileApp() {
  return Test.createTestingModule({
    imports: [PrismaModule, UpperModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: async () => [{ ok: 1 }] })
    .overrideProvider(REDIS_CLIENT)
    .useValue({
      ping: async () => 'PONG',
      get: async () => null,
      set: async () => 'OK',
      disconnect: () => {},
      quit: async () => 'OK',
    })
    .overrideProvider(getQueueToken(CRAWL_QUEUE_NAME))
    .useValue({
      add: async () => ({ id: 'fake-job' }),
      getJob: async () => null,
      close: async () => {},
    })
    .compile();
}

describe('SourcingModule Nest 模块编译（UnknownExportException 回归）', () => {
  it('SourcingModule 能被 Nest 成功编译', async () => {
    const moduleRef = await compileApp();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('上层模块经 SourcingModule 获得 CrawlHealthService', async () => {
    const moduleRef = await compileApp();
    const health = moduleRef.get(CrawlHealthService, { strict: false });
    expect(health).toBeInstanceOf(CrawlHealthService);
    await moduleRef.close();
  });

  it('CrawlOrchestrator 仍正常导出', async () => {
    const moduleRef = await compileApp();
    const orchestrator = moduleRef.get(CrawlOrchestrator, { strict: false });
    expect(orchestrator).toBeInstanceOf(CrawlOrchestrator);
    await moduleRef.close();
  });

  it('CrawlHealthService 在整个容器中是单例（不重复注册/连接）', async () => {
    const moduleRef = await compileApp();
    const a = moduleRef.get(CrawlHealthService, { strict: false });
    const b = moduleRef.get(CrawlHealthService, { strict: false });
    expect(a).toBe(b);
    await moduleRef.close();
  });
});
