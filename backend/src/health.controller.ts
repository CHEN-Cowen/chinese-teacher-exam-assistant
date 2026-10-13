import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { CrawlHealthService } from './sourcing/crawl-health.service.js';

/**
 * 健康检查区分三层：
 * - api：本进程（HTTP 可达即 up）；
 * - db：PostgreSQL 连通性；
 * - redis / worker：抓取队列基础设施 —— Worker 是独立进程，故障不影响 API 存活，
 *   因此单独字段上报，不把 API 判成“挂掉”。
 */
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crawlHealth: CrawlHealthService,
  ) {}

  @Get('health')
  async health() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }

    const redis = await this.crawlHealth.redisStatus();
    const worker = await this.crawlHealth.workerStatus();

    const status = db === 'up' && redis === 'up' ? 'ok' : 'degraded';
    return {
      status,
      api: 'up',
      db,
      redis,
      worker: worker.status,
      workerLastSeenAt: worker.lastSeenAt,
      time: new Date().toISOString(),
    };
  }
}
