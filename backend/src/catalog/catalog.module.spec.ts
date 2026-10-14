/**
 * 回归测试：CatalogModule 必须能被 Nest 真实编译（API 启动故障）。
 *
 * 故障背景（真实启动冒烟在 CI 中捕获）：
 * PublishedCatalogRepository 用 `import type { PrismaService }` 导入依赖，
 * 运行时元数据退化为 Function，Nest 抛：
 *   UnknownDependenciesException: Nest can't resolve dependencies of the
 *   PublishedCatalogRepository (?). Please make sure that the argument Function
 *   at index [0] is available in the CatalogModule module.
 * CatalogModule 经 OpportunitiesModule 进入 API 进程模块图，导致 API 无法启动。
 *
 * 本测试通过 @nestjs/testing 真实编译验证：
 * - CatalogModule 能被 Nest 编译并实例化 PublishedCatalogRepository；
 * - 不再出现 UnknownDependenciesException。
 */
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma.module.js';
import { PrismaService } from '../prisma.service.js';
import { CatalogModule } from './catalog.module.js';
import { PublishedCatalogRepository } from './published-catalog.repository.js';

describe('CatalogModule Nest 模块编译（UnknownDependenciesException 回归）', () => {
  it('PublishedCatalogRepository 能被 Nest 编译并实例化', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CatalogModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ publishedAnnouncementVersion: {} })
      .compile();
    const repo = moduleRef.get(PublishedCatalogRepository, { strict: false });
    expect(repo).toBeInstanceOf(PublishedCatalogRepository);
    await moduleRef.close();
  });
});
