import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';
import { InternalTokenGuard } from './internal-token.guard.js';
import { PrismaModule } from './prisma.module.js';
import { AnnouncementsModule } from './announcements/announcements.module.js';
import { OpportunitiesModule } from './opportunities/opportunities.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SessionAuthGuard } from './auth/session.guard.js';
import { ProfileModule } from './profile/profile.module.js';
import { PlansModule } from './plans/plans.module.js';
import { MembershipModule } from './membership/membership.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { TrialModule } from './trial/trial.module.js';
import { SourcingModule } from './sourcing/sourcing.module.js';
import { bullRedisConnection } from './sourcing/redis.js';

@Module({
  imports: [
    PrismaModule,
    // 抓取队列生产者：API 只投递任务，不消费、不执行抓取/解析（独立 Worker 进程消费）
    BullModule.forRoot({ connection: bullRedisConnection() }),
    AnnouncementsModule,
    OpportunitiesModule,
    ScheduleModule,
    AuthModule,
    ProfileModule,
    PlansModule,
    MembershipModule,
    PaymentsModule,
    TrialModule,
    SourcingModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: InternalTokenGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
})
export class AppModule {}
