import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';
import { ExportService } from './export.service.js';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, ExportService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
