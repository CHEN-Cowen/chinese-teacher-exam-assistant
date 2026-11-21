import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import type { AiService } from '../ai/ai.service.js';
import type { ObjectStore } from '../sourcing/storage/object-store.js';
import type { VectorStoreService } from './vector-store.service.js';
import type { DocumentParserService } from '../document-processing/document-parser.service.js';
import type { DocumentParseStore } from '../document-processing/document-parse-store.js';
import { KnowledgeIndexService } from './knowledge-index.service.js';
import { indexJobKey, bullJobId } from './knowledge.service.js';

const versionRow = {
  id: 'ver-1',
  documentId: 'doc-1',
  versionNumber: 1,
  status: 'approved',
  contentHash: 'hash-1',
  parserVersion: 'pending',
  chunkerVersion: 'w2-chunker-v1',
  snapshotId: null as string | null,
  storageKey: 'snapshots/ab/hash-1' as string | null,
  mimeType: 'text/plain',
  sourceUrl: 'knowledge://text/hash-1.txt',
  sourceCapturedAt: new Date(),
  unitIds: null,
  activeIndexVersion: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  publishedAt: null,
  withdrawnAt: null,
  withdrawReason: null,
  createdAt: new Date(),
};

const jobRow = {
  id: 'job-1',
  documentId: 'doc-1',
  versionId: 'ver-1',
  idempotencyKey: 'key-1',
  indexVersion: 1,
  status: 'queued',
  embeddingModel: 'mock-hash-1024',
  embeddingDim: 1024,
  chunkCount: 0,
  embeddedCount: 0,
  attempts: 0,
  errorClass: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date(),
  version: versionRow,
};

function createService(options: {
  job?: typeof jobRow | null;
  aiAvailable?: boolean;
  text?: string;
  vectorAvailable?: boolean;
  activationCount?: number;
}) {
  const prisma = {
    knowledgeIndexJob: {
      findUnique: vi.fn().mockResolvedValue(options.job === undefined ? jobRow : options.job),
      update: vi.fn().mockImplementation(async () => jobRow),
    },
    knowledgeChunk: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockImplementation(async (args: { data: unknown }) => ({
        id: `chunk-${(args.data as { chunkIndex: number }).chunkIndex + 1}`,
      })),
    },
    knowledgeDocumentVersion: {
      updateMany: vi.fn().mockResolvedValue({ count: options.activationCount ?? 1 }),
    },
    knowledgeDocument: {
      update: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    },
  };

  const ai = {
    available: options.aiAvailable ?? true,
    mode: 'mock',
    config: { embedding: { model: 'text-embedding-v4', dimension: 1024 } },
    embed: vi.fn().mockResolvedValue({
      vectors: [[0.1, 0.2, 0.3]],
      model: 'mock-hash-1024',
      dimension: 3,
    }),
  };

  const objectStore = {
    get: vi.fn().mockResolvedValue(options.text ?? '第一段内容。\n\n第二段内容。'),
    getBinary: vi.fn(),
  };

  const vectorStore = {
    isAvailable: vi.fn().mockResolvedValue(options.vectorAvailable ?? false),
    upsert: vi.fn().mockResolvedValue(true),
    deleteForVersion: vi.fn(),
  };

  const service = new KnowledgeIndexService(
    prisma as unknown as PrismaService,
    {} as DocumentParserService,
    { ensureRun: vi.fn(), completeRun: vi.fn() } as unknown as DocumentParseStore,
    objectStore as unknown as ObjectStore,
    ai as unknown as AiService,
    vectorStore as unknown as VectorStoreService,
  );
  return { service, prisma, ai, objectStore, vectorStore };
}

describe('KnowledgeIndexService', () => {
  it('模型未配置时失败并记录 ai_not_configured，不写 chunk', async () => {
    const ctx = createService({ aiAvailable: false });
    const outcome = await ctx.service.run('job-1');

    expect(outcome.status).toBe('failed');
    expect(outcome.errorClass).toBe('ai_not_configured');
    expect(ctx.prisma.knowledgeChunk.create).not.toHaveBeenCalled();
    expect(ctx.prisma.knowledgeIndexJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', errorClass: 'ai_not_configured' }),
      }),
    );
  });

  it('已完成的索引任务直接复用，不重复向量化', async () => {
    const ctx = createService({
      job: { ...jobRow, status: 'ready', chunkCount: 5, embeddedCount: 5 } as unknown as typeof jobRow,
    });
    const outcome = await ctx.service.run('job-1');

    expect(outcome.status).toBe('reused');
    expect(outcome.chunkCount).toBe(5);
    expect(ctx.ai.embed).not.toHaveBeenCalled();
  });

  it('纯文本版本完成切分与向量写入，pgvector 不可用时降级 Float[]', async () => {
    const ctx = createService({ vectorAvailable: false, text: '公告正文第一段。\n\n公告正文第二段。' });
    ctx.ai.embed.mockImplementationOnce(async (texts: string[]) => ({
      vectors: texts.map((_, index) => [index + 0.1, 0.2, 0.3]),
      model: 'mock-hash-1024',
      dimension: 3,
    }));

    const outcome = await ctx.service.run('job-1');

    expect(outcome.status).toBe('ready');
    expect(outcome.vectorStore).toBe('float-array');
    expect(ctx.prisma.knowledgeChunk.deleteMany).toHaveBeenCalled();
    expect(ctx.prisma.knowledgeChunk.create.mock.calls.length).toBe(outcome.chunkCount);
    expect(ctx.prisma.knowledgeIndexJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ready' }),
      }),
    );
    expect(ctx.vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('原件存储引用缺失时失败，不伪装成功', async () => {
    const ctx = createService({
      job: { ...jobRow, version: { ...versionRow, storageKey: null } } as unknown as typeof jobRow,
    });
    const outcome = await ctx.service.run('job-1');

    expect(outcome.status).toBe('failed');
    expect(outcome.errorClass).toBe('storage_unavailable');
  });

  it('旧任务晚到时直接标记 superseded，不重复向量化、不覆盖新索引', async () => {
    const ctx = createService({
      job: {
        ...jobRow,
        version: { ...versionRow, activeIndexVersion: 2 },
      } as unknown as typeof jobRow,
    });
    const outcome = await ctx.service.run('job-1');

    expect(outcome.status).toBe('superseded');
    expect(ctx.ai.embed).not.toHaveBeenCalled();
    expect(ctx.prisma.knowledgeDocumentVersion.updateMany).not.toHaveBeenCalled();
    expect(ctx.prisma.knowledgeIndexJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'superseded' }),
      }),
    );
  });

  it('索引完成时若已有更新版本生效，不切换有效索引并清理本次产物', async () => {
    const ctx = createService({ activationCount: 0 });

    const outcome = await ctx.service.run('job-1');

    expect(outcome.status).toBe('superseded');
    expect(ctx.prisma.knowledgeDocumentVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { activeIndexVersion: { lt: jobRow.indexVersion } },
          ]),
        }),
      }),
    );
    expect(ctx.prisma.knowledgeDocument.update).not.toHaveBeenCalled();
    expect(ctx.prisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { versionId: versionRow.id, indexVersion: jobRow.indexVersion },
      }),
    );
  });
});

describe('索引任务幂等键', () => {
  it('同内容/切分器/模型生成相同键，模型或内容变化生成新键', () => {
    const base = { id: 'ver-1', contentHash: 'h1', chunkerVersion: 'w2-chunker-v1' };
    const key = indexJobKey(base, 'text-embedding-v4', 1024);

    expect(indexJobKey(base, 'text-embedding-v4', 1024)).toBe(key);
    expect(indexJobKey({ ...base, contentHash: 'h2' }, 'text-embedding-v4', 1024)).not.toBe(key);
    expect(indexJobKey(base, 'qwen3-embedding', 1024)).not.toBe(key);
    expect(indexJobKey(base, 'text-embedding-v4', 768)).not.toBe(key);
  });

  it('BullMQ jobId 稳定且只含安全字符', () => {
    const id = bullJobId('job/with:colon');
    expect(bullJobId('job/with:colon')).toBe(id);
    expect(id).toMatch(/^kidx-[a-f0-9]{32}$/);
  });
});
