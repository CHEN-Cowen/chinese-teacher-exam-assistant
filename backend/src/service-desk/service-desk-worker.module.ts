import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma.module.js';
import { ServiceDeskService } from './service-desk.service.js';
import { ServiceDeskSlaProcessor, ServiceDeskSlaScheduler } from './service-desk.worker.js';
import { SERVICE_DESK_QUEUE } from './service-desk.tokens.js';

/** 只由 Worker 进程导入；API 进程不注册 @Processor */
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: SERVICE_DESK_QUEUE })],
  providers: [ServiceDeskService, ServiceDeskSlaProcessor, ServiceDeskSlaScheduler],
})
export class ServiceDeskWorkerModule {}
