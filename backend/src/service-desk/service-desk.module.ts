import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { ServiceDeskController } from './service-desk.controller.js';
import { ServiceDeskService } from './service-desk.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ServiceDeskController],
  providers: [ServiceDeskService],
  exports: [ServiceDeskService],
})
export class ServiceDeskModule {}
