/**
 * 回归测试：SafeFetcherFactory 必须能被 Nest 依赖注入实例化（Worker 启动故障）。
 *
 * 故障背景（生产镜像 sha-9f6164f7 的 Worker 进程）：
 * 构造函数声明了可选参数 `constructor(config?: CrawlEnvConfig)`，
 * CrawlEnvConfig 是 TypeScript 接口，emitDecoratorMetadata 后运行时元数据为
 * Object，Nest 尝试注入 index [0] 的 Object 依赖，抛出：
 *   UnknownDependenciesException: Nest can't resolve dependencies of the
 *   SafeFetcherFactory (?). The dependency at index [0] appears to be undefined.
 *
 * 本测试验证：
 * - Nest 测试模块能把 SafeFetcherFactory 作为 provider 编译并实例化，
 *   不再出现 UnknownDependenciesException；
 * - 未配置 CRAWL_* 环境变量时实例配置等于 readCrawlEnv() 默认值；
 * - 环境变量覆盖经 readCrawlEnv() 生效；
 * - OfflineFetcherFactory 等测试替身仍可继承构造。
 */
import { Test } from '@nestjs/testing';
import {
  SafeFetcherFactory,
  readCrawlEnv,
  type CrawlEnvConfig,
} from './safe-fetcher-factory.js';
import { OfflineFetcherFactory } from '../testing/crawl-testing.js';

const CRAWL_ENV_KEYS = [
  'CRAWL_MAX_REDIRECTS',
  'CRAWL_CONNECT_TIMEOUT_MS',
  'CRAWL_TOTAL_TIMEOUT_MS',
  'CRAWL_MAX_BYTES',
  'CRAWL_USER_AGENT',
  'CRAWL_RETRY_ATTEMPTS',
  'CRAWL_RETRY_BASE_DELAY_MS',
  'CRAWL_CONCURRENCY',
] as const;

function clearCrawlEnv(): void {
  for (const key of CRAWL_ENV_KEYS) {
    vi.stubEnv(key, undefined as unknown as string);
    delete process.env[key];
  }
}

function configOf(factory: SafeFetcherFactory): CrawlEnvConfig {
  // 私有字段仅用于测试断言（TS private 是编译期约束）
  return (factory as unknown as { config: CrawlEnvConfig }).config;
}

describe('SafeFetcherFactory Nest 注入（UnknownDependenciesException 回归）', () => {
  beforeEach(() => {
    clearCrawlEnv();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('作为 provider 被 Nest 编译并实例化，不注入运行时 Object', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SafeFetcherFactory],
    }).compile();
    const factory = moduleRef.get(SafeFetcherFactory);
    expect(factory).toBeInstanceOf(SafeFetcherFactory);
    await moduleRef.close();
  });

  it('未配置抓取参数时使用 readCrawlEnv() 默认配置', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SafeFetcherFactory],
    }).compile();
    const factory = moduleRef.get(SafeFetcherFactory);
    expect(configOf(factory)).toEqual(readCrawlEnv({}));
    await moduleRef.close();
  });

  it('CRAWL_* 环境变量经 readCrawlEnv() 覆盖默认值', async () => {
    vi.stubEnv('CRAWL_MAX_REDIRECTS', '9');
    vi.stubEnv('CRAWL_CONCURRENCY', '4');
    const moduleRef = await Test.createTestingModule({
      providers: [SafeFetcherFactory],
    }).compile();
    const factory = moduleRef.get(SafeFetcherFactory);
    expect(configOf(factory).maxRedirects).toBe(9);
    expect(configOf(factory).concurrency).toBe(4);
    await moduleRef.close();
  });

  it('OfflineFetcherFactory 测试替身仍可继承构造', () => {
    const factory = new OfflineFetcherFactory({
      'https://example.test/': '<html>ok</html>',
    });
    expect(factory).toBeInstanceOf(SafeFetcherFactory);
  });
});
