/**
 * W2：知识核心模块（API 与 Worker 共用）。
 *
 * 只包含入库/审核/索引任务与向量存储访问，不含解析器与 @Processor；
 * 因此 API 进程导入本模块也不会执行文档解析或模型调用。
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SourcingCoreModule } from '../sourcing/sourcing-core.module.js';
import { AiModule } from '../ai/ai.module.js';
import { KNOWLEDGE_QUEUE_NAME } from './knowledge.tokens.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeQueueService } from './knowledge-queue.service.js';
import { VectorStoreService } from './vector-store.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { QaService } from './qa/qa.service.js';
import { PolicyCoverageService } from './policy/policy-coverage.service.js';

@Module({
  imports: [
    SourcingCoreModule,
    AiModule,
    BullModule.registerQueue({ name: KNOWLEDGE_QUEUE_NAME }),
  ],
  providers: [
    KnowledgeService,
    KnowledgeQueueService,
    VectorStoreService,
    KnowledgeSearchService,
    QaService,
    PolicyCoverageService,
  ],
  // 转出解析所需的对象存储与模型依赖（转出模块，Worker 复用同一实例）
  exports: [
    KnowledgeService,
    KnowledgeQueueService,
    VectorStoreService,
    KnowledgeSearchService,
    QaService,
    PolicyCoverageService,
    SourcingCoreModule,
    AiModule,
  ],
})
export class KnowledgeCoreModule {}
