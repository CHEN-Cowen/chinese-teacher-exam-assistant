import { Module } from '@nestjs/common';
import { PublishedCatalogRepository } from './published-catalog.repository.js';

/**
 * 数据库已发布目录模块（v7.2 工作包 3）。
 *
 * 只提供“从数据库读已发布版本”的仓库；不提供任何静态目录，
 * 静态演示/台账目录仅由 opportunities 服务在 flag 关闭时（Demo/测试）使用。
 */
@Module({
  providers: [PublishedCatalogRepository],
  exports: [PublishedCatalogRepository],
})
export class CatalogModule {}
