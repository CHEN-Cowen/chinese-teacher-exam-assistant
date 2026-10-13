import { Module } from '@nestjs/common';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { ScheduleModule } from '../schedule/schedule.module.js';

@Module({
  imports: [CatalogModule, ProfileModule, ScheduleModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
