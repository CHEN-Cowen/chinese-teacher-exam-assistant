import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AiService } from '../../ai/ai.service.js';
import { AiError } from '../../ai/ai.errors.js';
import type {
  KnowledgeSearchService,
  RetrievalResult,
  RetrievedChunk,
} from '../knowledge-search.service.js';
import { QaService, type AskInput } from './qa.service.js';
import { REFUSAL_ANSWER, UNVERIFIED_NOTICE } from './qa-domain.js';

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    versionId: 'ver-1',
    indexVersion: 1,
    chunkIndex: 0,
    content: '报名截止时间为 2026 年 11 月 15 日 17:00。',
    headingPath: ['报名'],
    locator: { anchor: '报名', excerpt: '报名截止时间' },
    documentTitle: '招聘公告',
    officialUrl: 'https://example.gov.cn/notice',
    documentType: 'announcement',
    publishedAt: '2026-10-01T00:00:00.000Z',
    lexicalScore: 1,
    vectorScore: null,
    hybridScore: 1,
    rerankScore: null,
    finalScore: 1,
    ...overrides,
  };
}

function retrieval(chunks: RetrievedChunk[]): RetrievalResult {
  return {
    chunks,
    meta: {
      candidates: chunks.length,
      vectorUsed: false,
      rerankUsed: false,
      rerankFailed: false,
      mode: 'mock',
    },
  };
}

const createdRow = {
  id: 'answer-1',
  createdAt: new Date('2026-11-05T06:00:00.000Z'),
};

function createService(options: {
  mode?: 'mock' | 'real';
  available?: boolean;
  chunks?: RetrievedChunk[];
  chatText?: string;
  userUsage?: number | null;
  ipUsage?: number | null;
  globalUsage?: { requests: number; tokens: number } | null;
}) {
  const prisma = {
    qaAnswer: {
      create: vi.fn().mockImplementation(async (args: { data: unknown }) => ({
        ...createdRow,
        ...(args.data as object),
      })),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    qaFeedback: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'feedback-1' }),
      update: vi.fn().mockResolvedValue({ id: 'feedback-1' }),
    },
    aiUsageDaily: {
      findUnique: vi.fn().mockImplementation(async (args: { where: { scope_subject_day: { scope: string } } }) => {
        if (args.where.scope_subject_day.scope === 'user' && options.userUsage) {
          return { requests: options.userUsage, tokens: 0 };
        }
        if (args.where.scope_subject_day.scope === 'ip' && options.ipUsage) {
          return { requests: options.ipUsage, tokens: 0 };
        }
        if (args.where.scope_subject_day.scope === 'global' && options.globalUsage) {
          return options.globalUsage;
        }
        return null;
      }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;

  const chat = vi.fn().mockResolvedValue({
    text: options.chatText ?? '报名截止时间为 2026 年 11 月 15 日 17:00[1]。',
    model: 'qwen-plus',
    tokens: 120,
  });
  const ai = {
    mode: options.mode ?? 'mock',
    available: options.available ?? true,
    config: {
      limits: {
        questionMaxChars: 200,
        dailyRequestsPerUser: 30,
        dailyRequestsPerIp: 20,
        dailyRequestsGlobal: 2_000,
        dailyTokensGlobal: 500_000,
      },
    },
    embed: vi.fn(),
    rerank: vi.fn(),
    chat,
  } as unknown as AiService;

  const search = {
    retrieve: vi.fn().mockResolvedValue(retrieval(options.chunks ?? [chunk()])),
  } as unknown as KnowledgeSearchService;

  const service = new QaService(prisma, ai, search);
  return { service, prisma, ai: ai as unknown as { chat: typeof chat }, search };
}

const baseInput: AskInput = { question: '报名截止时间是什么时候', userId: 'user-1', ip: '10.0.0.1' };

describe('QaService 编排链路', () => {
  it('命中证据时返回带原文定位的引用，并落库与记账', async () => {
    const { service, prisma } = createService({ mode: 'mock' });

    const answer = await service.ask(baseInput);

    expect(answer.status).toBe('answered');
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]!.locator.anchor).toBe('报名');
    expect(answer.citations[0]!.officialUrl).toContain('example.gov.cn');
    expect(answer.answer).toContain('[1]');
    expect(answer.needsOfficialConfirmation).toBe(false);
    expect(prisma.qaAnswer.create).toHaveBeenCalledTimes(1);
    expect(prisma.aiUsageDaily.upsert).toHaveBeenCalledTimes(3);
  });

  it('没有证据时拒答，不调用生成模型', async () => {
    const { service, ai, prisma } = createService({ chunks: [] });

    const answer = await service.ask(baseInput);

    expect(answer.status).toBe('refused');
    expect(answer.answer).toBe(REFUSAL_ANSWER);
    expect(answer.citations).toEqual([]);
    expect(answer.needsOfficialConfirmation).toBe(true);
    expect(ai.chat).not.toHaveBeenCalled();
    expect(prisma.qaAnswer.create).toHaveBeenCalledTimes(1);
  });

  it('证据分数低于阈值同样拒答，避免弱相关材料被当成答案依据', async () => {
    const { service } = createService({ chunks: [chunk({ finalScore: 0.05, hybridScore: 0.05 })] });

    const answer = await service.ask(baseInput);

    expect(answer.status).toBe('refused');
    expect(answer.citations).toEqual([]);
  });

  it('真实模型回答缺少可回查引用时标记 unverified 并提示核对原文', async () => {
    const { service, ai } = createService({
      mode: 'real',
      chatText: '报名截止时间以公告为准。',
    });

    const answer = await service.ask(baseInput);

    expect(ai.chat).toHaveBeenCalledTimes(1);
    expect(answer.status).toBe('unverified');
    expect(answer.needsOfficialConfirmation).toBe(true);
    expect(answer.answer.endsWith(UNVERIFIED_NOTICE)).toBe(true);
    expect(answer.model).toBe('qwen-plus');
  });

  it('问题超长返回 400，不消耗额度也不写回答记录', async () => {
    const { service, prisma, search } = createService({});

    await expect(
      service.ask({ ...baseInput, question: '啊'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'question_too_long' });
    expect(search.retrieve).not.toHaveBeenCalled();
    expect(prisma.qaAnswer.create).not.toHaveBeenCalled();
  });

  it('当日个人额度用尽时返回 429，不检索', async () => {
    const { service, search } = createService({ userUsage: 30 });

    await expect(service.ask(baseInput)).rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });
    expect(search.retrieve).not.toHaveBeenCalled();
  });

  it('模型未配置时明确失败，不返回伪造答案', async () => {
    const { service } = createService({ available: false });

    await expect(service.ask(baseInput)).rejects.toMatchObject({ code: 'ai_disabled', status: 503 });
  });

  it('当日全局请求额度用尽时返回 429，不检索', async () => {
    const { service, search } = createService({
      globalUsage: { requests: 2_000, tokens: 0 },
    });

    await expect(service.ask(baseInput)).rejects.toMatchObject({
      code: 'quota_exceeded',
      status: 429,
    });
    expect(search.retrieve).not.toHaveBeenCalled();
  });

  it('供应商故障时保留明确错误码，不写回答记录也不计 token', async () => {
    const { service, prisma, ai } = createService({ mode: 'real' });
    (ai.chat as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AiError('provider_unavailable', '模型服务暂不可用', true),
    );

    await expect(
      service.ask(baseInput),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(prisma.qaAnswer.create).not.toHaveBeenCalled();
    expect(prisma.aiUsageDaily.upsert).not.toHaveBeenCalled();
  });

  it('反馈只能作用于本人回答，横向 ID 返回 404 且不写反馈', async () => {
    const { service, prisma } = createService({});
    (prisma.qaAnswer.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'answer-1',
      userId: 'user-2',
    });

    await expect(
      service.feedback({
        answerId: 'answer-2',
        userId: 'user-1',
        type: 'helpful',
      }),
    ).rejects.toMatchObject({ code: 'answer_not_found', status: 404 });
    expect(prisma.qaFeedback.create).not.toHaveBeenCalled();
  });

  it('本人回答可以提交反馈，重复提交走更新', async () => {
    const { service, prisma } = createService({});
    (prisma.qaAnswer.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'answer-1',
      userId: 'user-1',
    });

    const result = await service.feedback({
      answerId: 'answer-1',
      userId: 'user-1',
      type: 'incorrect',
      comment: '截止时间与原文不一致',
    });

    expect(result).toMatchObject({ id: 'feedback-1' });
    expect(prisma.qaFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', type: 'incorrect' }),
    });
  });

  it('历史记录按当前用户过滤，不返回他人回答', async () => {
    const { service, prisma } = createService({});
    (prisma as unknown as { qaAnswer: { findMany: ReturnType<typeof vi.fn> } }).qaAnswer.findMany =
      vi.fn().mockResolvedValue([]);

    const result = await service.history('user-1', 10);

    expect(result.items).toEqual([]);
    expect(
      (prisma.qaAnswer.findMany as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0],
    ).toMatchObject({ where: { userId: 'user-1' } });
  });
});
