import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { MembershipController } from './membership.controller.js';
import { MembershipService } from './membership.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [MembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
