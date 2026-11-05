import { Module } from '@nestjs/common';
import { KnowledgeCoreModule } from './knowledge-core.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { QaController } from './qa/qa.controller.js';

@Module({
  imports: [KnowledgeCoreModule],
  controllers: [KnowledgeController, QaController],
  exports: [KnowledgeCoreModule],
})
export class KnowledgeModule {}
