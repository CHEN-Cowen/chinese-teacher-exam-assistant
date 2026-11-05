import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import type { AiService } from '../ai/ai.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';

interface RowOptions {
  id?: string;
  indexVersion?: number;
  activeIndexVersion?: number | null;
  unitIds?: string[] | null;
  content?: string;
  status?: string;
  documentStatus?: string;
}

function row(options: RowOptions = {}) {
  const {
    id = 'chunk-1',
    indexVersion = 1,
    activeIndexVersion = 1,
    unitIds = null,
    content = '报名截止时间为 2026 年 11 月 15 日 17:00。',
    status = 'published',
    documentStatus = 'published',
  } = options;
  return {
    id,
    documentId: 'doc-1',
    versionId: 'ver-1',
    indexVersion,
    chunkIndex: 0,
    content,
    headingPath: ['报名'],
    locator: { anchor: '报名', excerpt: '报名截止时间' },
    unitIds,
    embedding: null,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    version: {
      id: 'ver-1',
      documentId: 'doc-1',
      status,
      activeIndexVersion,
      publishedAt: new Date('2026-10-01T00:00:00.000Z'),
      document: {
        id: 'doc-1',
        title: '招聘公告',
        officialUrl: 'https://example.gov.cn/notice',
        documentType: 'announcement',
        status: documentStatus,
      },
    },
  };
}

function createService(rows: ReturnType<typeof row>[]) {
  const prisma = {
    knowledgeChunk: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaService;
  const ai = {
    mode: 'mock',
    available: false,
    config: { embedding: { model: 'text-embedding-v4', dimension: 1024 } },
    embed: vi.fn(),
    rerank: vi.fn(),
  } as unknown as AiService;
  const service = new KnowledgeSearchService(prisma, ai);
  return { service, prisma, ai };
}

describe('KnowledgeSearchService 检索范围加固', () => {
  it('AI 关闭时仍可用词法检索已发布材料，不调用向量接口', async () => {
    const { service, ai } = createService([row()]);

    const result = await service.retrieve('报名截止时间', {});

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.documentTitle).toBe('招聘公告');
    expect(result.meta.vectorUsed).toBe(false);
    expect(ai.embed).not.toHaveBeenCalled();
  });

  it('只检索已发布版本与已发布文档，撤回/权限变更立即退出候选', async () => {
    const { service, prisma } = createService([row()]);

    await service.retrieve('报名截止时间', { announcementId: 'ann-1' });

    expect(
      (prisma.knowledgeChunk.findMany as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0],
    ).toMatchObject({
      where: {
        version: {
          status: 'published',
          document: {
            status: 'published',
            announcementId: 'ann-1',
          },
        },
      },
    });
  });

  it('只采用 activeIndexVersion 对应的 chunk，旧索引产物不参与回答', async () => {
    const { service } = createService([
      row({ id: 'old', indexVersion: 1, activeIndexVersion: 2 }),
      row({ id: 'new', indexVersion: 2, activeIndexVersion: 2 }),
      row({ id: 'pending', indexVersion: 3, activeIndexVersion: 2 }),
    ]);

    const result = await service.retrieve('报名截止时间', {});

    expect(result.chunks.map((item) => item.chunkId)).toEqual(['new']);
  });

  it('岗位范围包含未绑定岗位的公告级材料，排除显式绑定其他岗位的片段', async () => {
    const { service } = createService([
      row({ id: 'common', unitIds: [] }),
      row({ id: 'mine', unitIds: ['unit-1'] }),
      row({ id: 'other', unitIds: ['unit-2'] }),
    ]);

    const result = await service.retrieve('报名截止时间', { unitId: 'unit-1' });

    expect(result.chunks.map((item) => item.chunkId).sort()).toEqual([
      'common',
      'mine',
    ]);
    expect(result.meta.candidates).toBe(2);
  });
});
