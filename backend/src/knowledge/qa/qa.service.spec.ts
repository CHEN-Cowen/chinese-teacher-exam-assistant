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
    regionCode: '320100',
    year: 2026,
    effectiveFrom: null,
    effectiveTo: null,
    applicableAudience: null,
    applicableSubjects: [],
    applicableStages: [],
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
  coverageStatus?: 'covered' | 'partial' | 'no_coverage';
  coverageResult?: Record<string, unknown>;
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

  const coverage = {
    coverage: vi.fn().mockResolvedValue(
      options.coverageResult ?? {
        status: options.coverageStatus ?? 'covered',
        regionCode: '320100',
        regionLabel: '江苏省（320100）',
        year: 2026,
        exact: {
          documents: 1,
          policy: 1,
          announcement: 0,
          queryable: options.coverageStatus === 'no_coverage' ? 0 : 1,
          publishedNotIndexed: 0,
          undated: 0,
        },
        national: {
          documents: 0,
          policy: 0,
          announcement: 0,
          queryable: 0,
          publishedNotIndexed: 0,
          undated: 0,
        },
        descendants: [],
        sources: [],
        years: [{ year: 2026, documents: 1, queryable: 1 }],
        subjectExcluded: 0,
        note: '',
        generatedAt: '2026-11-05T00:00:00.000Z',
      },
    ),
  };

  const service = new QaService(prisma, ai, search, coverage as never);
  return { service, prisma, ai: ai as unknown as { chat: typeof chat }, search, coverage };
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

describe('QaService 政策问答（W5）', () => {
  const policyInput = {
    question: '2026 年南京教师招聘对语文教师有什么政策要求？',
    regionCode: '320100',
    year: 2026,
    applicableSubjects: ['chinese'],
    userId: 'user-1',
    ip: '10.0.0.1',
  };

  it('地区或年份不明确时返回 400，不查询覆盖也不检索', async () => {
    const { service, coverage, search } = createService({});

    await expect(
      service.askPolicy({ ...policyInput, regionCode: 'Nanjing' }),
    ).rejects.toMatchObject({ code: 'region_invalid', status: 400 });
    await expect(
      service.askPolicy({ ...policyInput, year: 1999 }),
    ).rejects.toMatchObject({ code: 'year_invalid', status: 400 });
    expect(coverage.coverage).not.toHaveBeenCalled();
    expect(search.retrieve).not.toHaveBeenCalled();
  });

  it('无覆盖时返回 no_coverage，不检索、不调用模型，并落库记录', async () => {
    const { service, prisma, search, ai, coverage } = createService({
      coverageStatus: 'no_coverage',
    });

    const answer = await service.askPolicy(policyInput);

    expect(answer.status).toBe('no_coverage');
    expect(answer.answer).toContain('暂不能回答');
    expect(answer.scope).toMatchObject({ regionCode: '320100', year: 2026 });
    expect(search.retrieve).not.toHaveBeenCalled();
    expect(ai.chat).not.toHaveBeenCalled();
    expect(coverage.coverage).toHaveBeenCalledWith(
      expect.objectContaining({ regionCode: '320100', year: 2026, subjects: ['chinese'] }),
    );
    expect(prisma.qaAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scopeType: 'policy', status: 'no_coverage', year: 2026 }),
    });
  });

  it('覆盖查询失败返回 503 coverage_unavailable，不伪装成无覆盖', async () => {
    const { service, coverage, search } = createService({});
    coverage.coverage.mockRejectedValueOnce(new Error('db down'));

    await expect(service.askPolicy(policyInput)).rejects.toMatchObject({
      code: 'coverage_unavailable',
      status: 503,
    });
    expect(search.retrieve).not.toHaveBeenCalled();
  });

  it('检索失败返回 503 retrieval_failed，不返回无覆盖结论', async () => {
    const { service, search } = createService({});
    search.retrieve.mockRejectedValueOnce(new Error('search down'));

    await expect(service.askPolicy(policyInput)).rejects.toMatchObject({
      code: 'retrieval_failed',
      status: 503,
    });
  });

  it('用明确范围检索，并把年份/学科/全国政策开关传给检索层', async () => {
    const { service, search } = createService({});

    await service.askPolicy(policyInput);

    expect(search.retrieve).toHaveBeenCalledWith(
      policyInput.question,
      expect.objectContaining({
        regionCode: '320100',
        year: 2026,
        includeNational: true,
        documentTypes: ['policy', 'announcement'],
        applicableSubjects: ['chinese'],
      }),
      6,
    );
  });

  it('公告与政策同时命中时并列展示冲突候选并建议核实，不自动判定覆盖', async () => {
    const { service } = createService({
      chunks: [
        chunk({ chunkId: 'policy-1', documentId: 'policy-doc', documentType: 'policy', documentTitle: '教师招聘政策' }),
        chunk({ chunkId: 'ann-1', documentId: 'ann-doc', documentType: 'announcement', documentTitle: '招聘公告' }),
      ],
    });

    const answer = await service.askPolicy(policyInput);

    expect(answer.status).toBe('answered');
    expect(answer.conflicts).toHaveLength(1);
    expect(answer.conflicts[0]!.announcement.documentType).toBe('announcement');
    expect(answer.conflicts[0]!.policy.documentType).toBe('policy');
    expect(answer.needsOfficialConfirmation).toBe(true);
    expect(answer.answer).toContain('不会自动认定');
  });

  it('引用会标注有效期与适用范围，未到生效日期给出提示', async () => {
    const { service } = createService({
      chunks: [
        chunk({
          documentType: 'policy',
          effectiveFrom: '2027-01-01T00:00:00.000Z',
          effectiveTo: null,
          applicableSubjects: ['chinese'],
          applicableStages: ['小学'],
        }),
      ],
      coverageResult: {
        status: 'partial',
        regionCode: '320100',
        regionLabel: '江苏省（320100）',
        year: 2026,
        exact: { documents: 0, policy: 0, announcement: 0, queryable: 0, publishedNotIndexed: 0, undated: 0 },
        national: { documents: 1, policy: 1, announcement: 0, queryable: 1, publishedNotIndexed: 0, undated: 0 },
        descendants: [],
        sources: [],
        years: [{ year: 2026, documents: 1, queryable: 1 }],
        subjectExcluded: 0,
        note: '',
        generatedAt: '2026-11-05T00:00:00.000Z',
      },
    });

    const answer = await service.askPolicy(policyInput);

    expect(answer.citations[0]!.validity).toBe('not_yet_effective');
    expect(answer.citations[0]!.applicableSubjects).toEqual(['chinese']);
    expect(answer.answer).toContain('尚未到生效日期');
    expect(answer.answer).toContain('仅命中全国性政策');
  });
});
