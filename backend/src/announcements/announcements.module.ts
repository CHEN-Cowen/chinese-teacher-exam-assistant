import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';
import { ExportService } from './export.service.js';
import { ManualExtractionService } from './manual-extraction.service.js';
import { DocumentProcessingModule } from '../document-processing/document-processing.module.js';
import { SourcingCoreModule } from '../sourcing/sourcing-core.module.js';

@Module({
  imports: [SourcingCoreModule, DocumentProcessingModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, ExportService, ManualExtractionService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
