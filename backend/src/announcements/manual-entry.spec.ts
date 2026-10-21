/**
 * M1：AnnouncementsService 手动入口复用新链路（URL 抓取 + 委托）测试。
 *
 * 覆盖：
 * - URL 模式真正抓取正文（复用 SafeFetcher 安全约束），抓取失败抛明确错误；
 * - 手动提交委托 ManualExtractionService（不重复造两套抽取逻辑）；
 * - AnnouncementsModule 能被 Nest 编译（ManualExtractionService 依赖注入正常，M1-06）。
 */
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, expect, it } from 'vitest';
import { AnnouncementsService } from './announcements.service.js';
import { ManualExtractionService } from './manual-extraction.service.js';
import { AnnouncementsModule } from './announcements.module.js';
import { PrismaModule } from '../prisma.module.js';
import { PrismaService } from '../prisma.service.js';
import { REDIS_CLIENT } from '../sourcing/redis.js';
import { CRAWL_QUEUE_NAME } from '../sourcing/sourcing.tokens.js';
import { OfflineFetcherFactory } from '../sourcing/testing/crawl-testing.js';

describe('AnnouncementsService.submitSource（M1 URL 抓取）', () => {
  it('URL 模式：用 SafeFetcher 抓取真实正文（不把 URL 字符串当正文）', async () => {
    const fetcherFactory = new OfflineFetcherFactory({
      'https://www.hz.gov.cn/notice/1': '<html><body><p>报名时间：2026年10月1日。</p></body></html>',
    });
    // 手动注入 fetcherFactory + manualExtraction（fake prisma 只用于兜底路径不触发）
    const manual = { submitSource: async () => ({ run: { id: 'run-1', snapshotId: 'snap-1' } }) };
    const service = new AnnouncementsService(
      { source: {}, sourceSnapshot: {} } as never,
      manual as never,
      fetcherFactory as never,
    );

    const result = await service.submitSource(
      {
        publisher: '杭州市教育局',
        officialUrl: 'https://www.hz.gov.cn/notice/1',
        sourceType: 'government',
        content: 'https://www.hz.gov.cn/notice/1',
        mimeType: 'text/plain',
      },
      'admin-1',
    );

    // 委托 manualExtraction，且 content 已被替换为抓取到的 HTML 正文（非 URL）
    expect(result).toEqual({ id: 'run-1', snapshotId: 'snap-1' });
  });

  it('URL 模式：抓取失败 → 明确错误，提示切换人工输入（绝不伪装成功）', async () => {
    const fetcherFactory = new OfflineFetcherFactory({}); // 空路由：任何 URL 都 404
    const service = new AnnouncementsService(
      {} as never,
      undefined,
      fetcherFactory as never,
    );

    await expect(
      service.submitSource(
        {
          publisher: '杭州市教育局',
          officialUrl: 'https://www.hz.gov.cn/notice/missing',
          sourceType: 'government',
          content: 'https://www.hz.gov.cn/notice/missing',
          mimeType: 'text/plain',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('URL 抓取未配置（无 fetcherFactory）→ 明确错误', async () => {
    const service = new AnnouncementsService({} as never, undefined, undefined);
    await expect(
      service.submitSource(
        {
          publisher: '杭州市教育局',
          officialUrl: 'https://www.hz.gov.cn/notice/1',
          sourceType: 'government',
          content: 'https://www.hz.gov.cn/notice/1',
          mimeType: 'text/plain',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AnnouncementsModule Nest 模块编译（M1-06 依赖注入）', () => {
  it('ManualExtractionService 能被 Nest 编译并注入（复用新抽取链路）', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AnnouncementsModule],
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

    const manual = moduleRef.get(ManualExtractionService, { strict: false });
    expect(manual).toBeInstanceOf(ManualExtractionService);

    const service = moduleRef.get(AnnouncementsService, { strict: false });
    expect(service).toBeInstanceOf(AnnouncementsService);

    await moduleRef.close();
  });
});
