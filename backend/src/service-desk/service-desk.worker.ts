import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { ServiceDeskService } from './service-desk.service.js';
import {
  SERVICE_DESK_QUEUE,
  SERVICE_DESK_SCAN_INTERVAL_MS,
  SERVICE_DESK_SCAN_JOB,
} from './service-desk.tokens.js';

/**
 * 独立 Worker 内的时限扫描处理器。
 *
 * - 5 分钟重复任务由 BullMQ 持久化，API 进程不注册 Processor；
 * - runSweep 内部用 PostgreSQL advisory lock 保证多实例互斥；
 * - 提醒日志唯一键保证重扫/重启/补跑不重复轰炸。
 */
@Processor(SERVICE_DESK_QUEUE)
export class ServiceDeskSlaProcessor extends WorkerHost {
  private readonly logger = new Logger(ServiceDeskSlaProcessor.name);

  constructor(private readonly service: ServiceDeskService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== SERVICE_DESK_SCAN_JOB) {
      return { skipped: true, reason: 'unknown_job' };
    }
    try {
      const result = await this.service.runSweep({ trigger: 'worker' });
      this.logger.log(
        `service-desk sweep scanned=${result.scanned} reminders=${result.reminders} escalations=${result.escalations} routed=${result.routed}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `service-desk sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}

/** 在 Worker 启动时注册持久化重复任务（多实例 upsert 幂等） */
@Injectable()
export class ServiceDeskSlaScheduler implements OnModuleInit {
  private readonly logger = new Logger(ServiceDeskSlaScheduler.name);

  constructor(@InjectQueue(SERVICE_DESK_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SERVICE_DESK_SCAN_JOB,
        { every: SERVICE_DESK_SCAN_INTERVAL_MS },
        {
          name: SERVICE_DESK_SCAN_JOB,
          data: { source: 'repeat' },
          opts: {
            removeOnComplete: 50,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
          },
        },
      );
    } catch (error) {
      // Redis 不可用时不阻塞 Worker 启动；恢复后由 BullMQ 重连并再次注册
      this.logger.warn(
        `service-desk scheduler registration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
