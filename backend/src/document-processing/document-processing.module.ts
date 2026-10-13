/**
 * v7.2 附件解析：文档处理模块（层 3：文件格式解析）。
 *
 * - 只在 Worker 进程导入执行解析；API 进程不导入（解析不在 API 进程内运行）；
 * - 依赖 SourcingCoreModule 提供的对象存储与队列端口；
 * - 对外只暴露 DocumentParserService / DocumentParseStore / DocumentParseService。
 */
import { Module } from '@nestjs/common';
import { SourcingCoreModule } from '../sourcing/sourcing-core.module.js';
import { DocumentParserService } from './document-parser.service.js';
import { DocumentParseStore } from './document-parse-store.js';
import { DocumentParseService } from './jobs/document-parse.service.js';

@Module({
  imports: [SourcingCoreModule],
  providers: [DocumentParserService, DocumentParseStore, DocumentParseService],
  exports: [DocumentParserService, DocumentParseStore, DocumentParseService],
})
export class DocumentProcessingModule {}
