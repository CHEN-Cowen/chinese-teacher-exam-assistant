/**
 * W4：Worker 重启恢复。
 *
 * Worker 进程启动后扫描仍处于 queued/running 的索引任务并重新投递，
 * 避免进程异常退出后任务永久停在 running、材料长时间无法检索。
 * 恢复是幂等的：BullMQ 中仍存在的任务由 enqueue 去重。
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service.js';

@Injectable()
export class KnowledgeIndexRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeIndexRecoveryService.name);

  constructor(private readonly knowledge: KnowledgeService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.knowledge.recoverPendingIndexJobs();
      if (result.scanned > 0) {
        this.logger.log(
          `索引任务恢复 scanned=${result.scanned} requeued=${result.requeued} ` +
            `deduplicated=${result.deduplicated} failed=${result.failed}`,
        );
      }
    } catch (error) {
      // 恢复失败不阻塞 Worker 启动；后续仍可手动重建索引
      this.logger.warn(
        `索引任务恢复失败：${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
