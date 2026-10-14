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
  providers: [
    // DocumentParserService 构造函数带可选匿名 options 对象（测试用来注入
    // limits/flags 替身），其运行时元数据为 Object；若作为类 provider 注册，
    // Nest 会把 index [0] 当依赖注入并在 Worker 启动时抛
    // UnknownDependenciesException。改为显式工厂 provider：生产路径无参构造，
    // 配置内部经 readParseLimits()/readFeatureFlags()/readOcrConfig() 读取；
    // 测试仍可 new DocumentParserService({...})，构造签名不变。
    { provide: DocumentParserService, useFactory: () => new DocumentParserService() },
    DocumentParseStore,
    DocumentParseService,
  ],
  exports: [DocumentParserService, DocumentParseStore, DocumentParseService],
})
export class DocumentProcessingModule {}
