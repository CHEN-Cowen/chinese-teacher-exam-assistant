/**
 * 回归测试：API 与 Worker 的**完整模块图**必须能被 Nest 真实编译。
 *
 * 背景：本次生产启动故障连续暴露多个同类问题，而单点单元测试每次都全绿——
 * 因为单测直接 `new`（绕过 DI）或用替身覆盖。真实进程启动在冒烟中依次抓到：
 *   1. SourcingModule 直接导出非自身 provider（UnknownExportException）；
 *   2. SafeFetcherFactory 可选接口构造参数（UnknownDependenciesException）；
 *   3. DocumentParserService 可选匿名对象构造参数（同上）；
 *   4. PublishedCatalogRepository 用 `import type` 注入类（同上，API 进程）；
 *   5. AnnouncementExtractService 用 `import type` 注入类（同上，Worker 进程）。
 *
 * 本测试直接编译与生产入口完全相同的根模块（AppModule / WorkerAppModule），
 * 一次性覆盖整张依赖图：任何模块导出错误或注入元数据退化都会在此失败，
 * 而不必等到容器里启动进程才发现。
 *
 * 编译期用替身覆盖 Prisma / Redis / 队列：不触网、不需要真实 PostgreSQL/Redis。
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from './app.module.js';
import { WorkerAppModule } from './worker-app.module.js';
import { PrismaService } from './prisma.service.js';
import { HealthController } from './health.controller.js';
import { MembershipController } from './membership/membership.controller.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsCallbacksController } from './payments/payments-callbacks.controller.js';
import { CrawlHealthService } from './sourcing/crawl-health.service.js';
import { CrawlProcessor } from './sourcing/jobs/crawl.worker.js';
import { AnnouncementExtractService } from './announcements/jobs/announcement-extract.service.js';
import { DocumentParseStore } from './document-processing/document-parse-store.js';
import { REDIS_CLIENT } from './sourcing/redis.js';
import { CRAWL_QUEUE_NAME } from './sourcing/sourcing.tokens.js';

/** 与 CI 冒烟一致的安全配置：invited 鉴权、关闭定时投递、Worker 暂停消费 */
function applySmokeEnv(): void {
  process.env.AUTH_MODE = 'invited';
  process.env.INTERNAL_TOKEN = 'ci-smoke-token';
  process.env.CRAWL_SCHEDULER_ENABLED = 'false';
  process.env.CRAWL_WORKER_PAUSED = 'true';
}

const fakePrisma = {
  $queryRaw: async () => [{ ok: 1 }],
  $connect: async () => undefined,
  $disconnect: async () => undefined,
};

const fakeRedis = {
  ping: async () => 'PONG',
  get: async () => null,
  set: async () => 'OK',
  disconnect: () => undefined,
  quit: async () => 'OK',
};

const fakeQueue = {
  add: async () => ({ id: 'fake-job' }),
  getJob: async () => null,
  close: async () => undefined,
};

function compileGraph(rootModule: unknown) {
  return Test.createTestingModule({ imports: [rootModule as never] })
    .overrideProvider(PrismaService)
    .useValue(fakePrisma)
    .overrideProvider(REDIS_CLIENT)
    .useValue(fakeRedis)
    .overrideProvider(getQueueToken(CRAWL_QUEUE_NAME))
    .useValue(fakeQueue)
    .compile();
}

describe('API/Worker 完整模块图 Nest 编译（启动故障回归）', () => {
  beforeEach(applySmokeEnv);

  it('AppModule（API 入口）能被编译，HealthController 与 CrawlHealthService 可解析', async () => {
    const moduleRef = await compileGraph(AppModule);
    expect(moduleRef.get(HealthController, { strict: false })).toBeInstanceOf(
      HealthController,
    );
    expect(moduleRef.get(CrawlHealthService, { strict: false })).toBeInstanceOf(
      CrawlHealthService,
    );
    // M11：会员模块挂在 AppModule 上，控制器可经 DI 解析
    expect(moduleRef.get(MembershipController, { strict: false })).toBeInstanceOf(
      MembershipController,
    );
    // M12：支付模块（用户侧 + 渠道回调）可经 DI 解析，渠道适配层装配成功
    expect(moduleRef.get(PaymentsController, { strict: false })).toBeInstanceOf(
      PaymentsController,
    );
    expect(
      moduleRef.get(PaymentsCallbacksController, { strict: false }),
    ).toBeInstanceOf(PaymentsCallbacksController);
    await moduleRef.close();
  });

  it('WorkerAppModule（Worker 入口）能被编译，处理器与抽取服务可解析', async () => {
    const moduleRef = await compileGraph(WorkerAppModule);
    expect(moduleRef.get(CrawlProcessor, { strict: false })).toBeInstanceOf(
      CrawlProcessor,
    );
    const extract = moduleRef.get(AnnouncementExtractService, { strict: false });
    expect(extract).toBeInstanceOf(AnnouncementExtractService);
    // AnnouncementExtractService 的 parseStore 必须由 DI 注入为真实 store
    expect(
      moduleRef.get(DocumentParseStore, { strict: false }),
    ).toBeInstanceOf(DocumentParseStore);
    await moduleRef.close();
  });
});
