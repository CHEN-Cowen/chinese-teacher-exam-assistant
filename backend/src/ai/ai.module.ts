import { Module } from '@nestjs/common';
import { AI_CONFIG, loadAiConfig } from './ai.config.js';
import { AiService } from './ai.service.js';

@Module({
  providers: [
    { provide: AI_CONFIG, useFactory: () => loadAiConfig() },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
