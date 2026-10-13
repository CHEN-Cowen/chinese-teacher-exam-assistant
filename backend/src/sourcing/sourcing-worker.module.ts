/**
 * v7.2 工作包 4：抓取 Worker 模块（只由 Worker 进程导入）。
 *
 * 这里注册 @Processor，因此**只有 Worker 进程**会消费队列、执行抓取与解析；
 * API 进程导入 SourcingModule（不含本模块），永不执行抓取/解析。
 */
import { Module } from '@nestjs/common';
import { SourcingCoreModule } from './sourcing-core.module.js';
import { DocumentProcessingModule } from '../document-processing/document-processing.module.js';
import { CrawlProcessor } from './jobs/crawl.worker.js';
import { DocumentFetchService } from './jobs/document-fetch.service.js';
import { SourceDiscoverService } from './jobs/source-discover.service.js';
import { AnnouncementExtractService } from '../announcements/jobs/announcement-extract.service.js';

@Module({
  imports: [SourcingCoreModule, DocumentProcessingModule],
  providers: [
    CrawlProcessor,
    SourceDiscoverService,
    DocumentFetchService,
    AnnouncementExtractService,
  ],
})
export class SourcingWorkerModule {}
