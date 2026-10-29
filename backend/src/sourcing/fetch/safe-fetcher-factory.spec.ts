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
    vi.unstubAllGlobals();
  });

  // Nest 测试模块编译在本机高并发下可能超过 vitest 默认 5 秒（D00 基线，断言不变）
  it('作为 provider 被 Nest 编译并实例化，不注入运行时 Object', { timeout: 60_000 }, async () => {
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

  it('不同 factory 创建的 fetcher 共享同 host 并发上限', async () => {
    vi.stubEnv('CRAWL_CONCURRENCY', '1');
    const firstFactory = new SafeFetcherFactory();
    const secondFactory = new SafeFetcherFactory();
    let active = 0;
    let peak = 0;
    const fetchImpl: typeof fetch = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response('<html>ok</html>', {
        headers: { 'content-type': 'text/html' },
      });
    };
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubEnv('CRAWL_MAX_REDIRECTS', '3');
    const source = {
      officialUrl: 'https://93.184.216.34/',
      allowedHosts: ['93.184.216.34'],
    } as never;
    const fetchers = [
      firstFactory.create(source),
      secondFactory.create(source),
    ];

    await Promise.all(
      fetchers.map((fetcher) => fetcher.fetch('https://93.184.216.34/')),
    );
    expect(peak).toBe(1);
  });

  it('同 host 许可持续覆盖响应体读取', async () => {
    vi.stubEnv('CRAWL_CONCURRENCY', '1');
    let finishBody!: () => void;
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    const bodyReady = new Promise<void>((resolve) => {
      finishBody = resolve;
    });
    let requests = 0;
    vi.stubGlobal('fetch', async () => {
      requests += 1;
      if (requests > 1)
        return new Response('<html>second</html>', {
          headers: { 'content-type': 'text/html' },
        });
      return new Response(
        new ReadableStream({
          async pull(controller) {
            bodyStarted();
            await bodyReady;
            controller.enqueue(new TextEncoder().encode('<html>first</html>'));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/html' } },
      );
    });
    const source = {
      officialUrl: 'https://93.184.216.34/',
      allowedHosts: ['93.184.216.34'],
    } as never;
    const factory = new SafeFetcherFactory();
    const first = factory.create(source).fetch('https://93.184.216.34/first');
    await started;
    const second = factory.create(source).fetch('https://93.184.216.34/second');
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(requests).toBe(1);
    } finally {
      finishBody();
      await Promise.all([first, second]);
    }
    expect(requests).toBe(2);
  });

  it('OfflineFetcherFactory 测试替身仍可继承构造', () => {
    const factory = new OfflineFetcherFactory({
      'https://example.test/': '<html>ok</html>',
    });
    expect(factory).toBeInstanceOf(SafeFetcherFactory);
  });
});
