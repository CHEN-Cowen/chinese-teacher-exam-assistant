/**
 * 回归测试：DocumentProcessingModule 必须能被 Nest 真实编译（Worker 启动故障）。
 *
 * 故障背景（真实启动冒烟在 CI 中捕获）：
 * DocumentParserService 构造函数带可选匿名对象参数（options?: {...}），
 * 运行时元数据为 Object，Nest 当作待注入依赖，抛：
 *   UnknownDependenciesException: Nest can't resolve dependencies of the
 *   DocumentParserService (?). The dependency at index [0] appears to be
 *   undefined at runtime.
 * DocumentProcessingModule 只在 Worker 进程导入，导致 Worker 启动即退出。
 *
 * 本测试通过 @nestjs/testing 真实编译验证：
 * - DocumentProcessingModule 能被 Nest 编译，DocumentParserService 可注入；
 * - 生产路径使用 readParseLimits()/readFeatureFlags() 的默认配置；
 * - 测试仍可 `new DocumentParserService({ limits, ... })` 注入替身（构造签名不变）。
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma.module.js';
import { PrismaService } from '../prisma.service.js';
import { DocumentProcessingModule } from './document-processing.module.js';
import { DocumentParserService } from './document-parser.service.js';
import { REDIS_CLIENT } from '../sourcing/redis.js';
import { CRAWL_QUEUE_NAME } from '../sourcing/sourcing.tokens.js';

describe('DocumentProcessingModule Nest 模块编译（UnknownDependenciesException 回归）', () => {
  it('DocumentParserService 能被 Nest 编译并实例化（生产默认配置）', { timeout: 60_000 }, async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, DocumentProcessingModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(REDIS_CLIENT)
      .useValue({
        ping: async () => 'PONG',
        get: async () => null,
        set: async () => 'OK',
        quit: async () => 'OK',
      })
      .overrideProvider(getQueueToken(CRAWL_QUEUE_NAME))
      .useValue({
        add: async () => ({ id: 'fake-job' }),
        getJob: async () => null,
        close: async () => {},
      })
      .compile();
    const parser = moduleRef.get(DocumentParserService, { strict: false });
    expect(parser).toBeInstanceOf(DocumentParserService);
    // 生产默认配置来自 env 读取（未配置时给出安全默认值）
    expect(parser.limits.maxBytes).toBeGreaterThan(0);
    await moduleRef.close();
  });

  it('测试替身仍可直接 new 带 options 构造（签名不变）', () => {
    const service = new DocumentParserService({
      limits: {
        maxBytes: 1024,
        maxPages: 1,
        maxRows: 1,
        maxCells: 1,
        maxTextChars: 100,
        timeoutMs: 1000,
      },
    });
    expect(service.limits.maxBytes).toBe(1024);
  });
});
