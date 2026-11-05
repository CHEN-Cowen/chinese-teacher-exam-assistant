/**
 * W2：知识索引 Worker 模块（只由 Worker 进程导入）。
 *
 * 注册 @Processor 与解析器依赖，保证 API 进程永不执行解析/向量化。
 */
import { Module } from '@nestjs/common';
import { DocumentProcessingModule } from '../document-processing/document-processing.module.js';
import { KnowledgeCoreModule } from './knowledge-core.module.js';
import { KnowledgeIndexService } from './knowledge-index.service.js';
import { KnowledgeIndexProcessor } from './jobs/knowledge-index.processor.js';

@Module({
  imports: [KnowledgeCoreModule, DocumentProcessingModule],
  providers: [KnowledgeIndexService, KnowledgeIndexProcessor],
})
export class KnowledgeWorkerModule {}
