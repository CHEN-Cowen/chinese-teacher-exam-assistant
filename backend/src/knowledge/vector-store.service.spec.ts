import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import { VectorStoreService, vectorLiteral } from './vector-store.service.js';

describe('vectorLiteral', () => {
  it('按 pgvector 字面量格式输出', () => {
    expect(vectorLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });

  it('空向量与非有限数值直接拒绝', () => {
    expect(() => vectorLiteral([])).toThrow('空向量');
    expect(() => vectorLiteral([Number.NaN])).toThrow('非有限');
  });
});

describe('VectorStoreService 降级', () => {
  it('扩展不存在时判定不可用，写入与检索都不执行 SQL', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn(),
    };
    const service = new VectorStoreService(prisma as unknown as PrismaService);
    await expect(service.isAvailable()).resolves.toBe(false);
    await expect(service.upsert({ chunkId: 'c1', embedding: [0.1], model: 'm', dim: 1 })).resolves.toBe(false);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('扩展存在时可用并缓存探测结果', async () => {
    const prisma = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ present: 1 }])
        .mockResolvedValueOnce([{ present: 'knowledge_chunk_vectors' }]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
    const service = new VectorStoreService(prisma as unknown as PrismaService);
    await expect(service.isAvailable()).resolves.toBe(true);
    await expect(service.isAvailable()).resolves.toBe(true);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
});
