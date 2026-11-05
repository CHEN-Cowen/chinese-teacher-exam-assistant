import { Module } from '@nestjs/common';
import { KnowledgeCoreModule } from './knowledge-core.module.js';
import { KnowledgeController } from './knowledge.controller.js';

@Module({
  imports: [KnowledgeCoreModule],
  controllers: [KnowledgeController],
  exports: [KnowledgeCoreModule],
})
export class KnowledgeModule {}
