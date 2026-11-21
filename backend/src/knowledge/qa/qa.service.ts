/**
 * W3：公告级问答编排。
 *
 * 流程：问题校验 → 当日预算 → 混合检索（仅已发布版本）→ 重排 → 证据阈值
 * → 生成（真实模式百炼 Chat / 演示模式抽取式）→ 引用校验 → 落库 → 用量记账。
 *
 * 诚实边界：
 * - 证据不足一律拒答，不让模型自由发挥；
 * - 回答没有有效引用时标记 `unverified` 并要求核对官方原文；
 * - 模型未配置/失败返回明确错误码，不返回伪造答案；
 * - 只记录问题、回答、引用与用量，不记录密钥。
 */
import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { AiError } from '../../ai/ai.errors.js';
import { AiService } from '../../ai/ai.service.js';
import type { DocumentLocator } from '../../document-processing/parsed-document.js';
import {
  KnowledgeSearchService,
  type KnowledgeScope,
  type RetrievedChunk,
} from '../knowledge-search.service.js';
import {
  CONFLICT_NOTICE,
  NOT_YET_EFFECTIVE_NOTICE,
  NO_COVERAGE_ANSWER,
  detectAnnouncementPolicyConflicts,
  normalizeRegionCode,
  regionLabel,
  scopeNotice,
  validityOf,
  type MaterialValidity,
  type PolicyConflict,
} from '../policy/policy-domain.js';
import {
  PolicyCoverageService,
  type PolicyCoverageResult,
} from '../policy/policy-coverage.service.js';
import {
  REFUSAL_ANSWER,
  UNVERIFIED_NOTICE,
  extractiveAnswer,
  validateCitations,
} from './qa-domain.js';

export const QA_PROMPT_VERSION = 'qa-prompt-v1';

export class QaError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
  ) {
    super({ code, message }, status);
    this.name = 'QaError';
  }
}

export interface QaCitation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  officialUrl: string | null;
  locator: DocumentLocator;
  snippet: string;
  score: number;
  /** W5：材料适用范围与有效期；公告问答也返回，便于核对 */
  regionCode: string | null;
  year: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  validity: MaterialValidity;
  applicableAudience: string | null;
  applicableSubjects: string[];
  applicableStages: string[];
}

export interface QaAnswerDTO {
  id: string;
  question: string;
  answer: string;
  status: 'answered' | 'unverified' | 'refused' | 'no_coverage' | 'error';
  needsOfficialConfirmation: boolean;
  citations: QaCitation[];
  model: string | null;
  mode: string;
  latencyMs: number;
  createdAt: string;
  retrieval?: {
    candidates: number;
    vectorUsed: boolean;
    rerankUsed: boolean;
    rerankFailed: boolean;
  };
}

export interface PolicyAnswerDTO extends QaAnswerDTO {
  scope: {
    regionCode: string;
    regionLabel: string;
    year: number;
    applicableSubjects: string[];
    applicableAudience: string | null;
  };
  coverage: PolicyCoverageResult;
  conflicts: PolicyConflict[];
}

export interface PolicyQuestionInput {
  question: string;
  regionCode: string;
  year: number;
  applicableSubjects?: string[];
  applicableAudience?: string;
  userId: string;
  ip?: string | null;
}

export interface AskInput {
  question: string;
  scope?: KnowledgeScope;
  userId: string;
  ip?: string | null;
}

const DEFAULT_MIN_SCORE = 0.16;
const CONTEXT_LIMIT = 6;
const CITATION_LIMIT = 4;

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly search: KnowledgeSearchService,
    private readonly coverage: PolicyCoverageService,
  ) {}

  async ask(input: AskInput): Promise<QaAnswerDTO> {
    const startedAt = Date.now();
    const question = (input.question ?? '').trim();
    if (!question) throw new QaError('question_empty', '请输入问题', 400);
    const maxChars = this.ai.config.limits.questionMaxChars;
    if (question.length > maxChars) {
      throw new QaError(
        'question_too_long',
        `问题最多 ${maxChars} 个字符，请拆分后再问`,
        400,
      );
    }
    if (!this.ai.available) {
      throw new QaError(
        'ai_disabled',
        '问答模型未启用或未配置，暂不能回答（请管理员配置后使用）',
        503,
      );
    }

    const day = dayKey(new Date());
    const ipHash = input.ip ? hashIp(input.ip) : null;
    try {
      await this.assertQuota(day, input.userId, ipHash);
    } catch (error) {
      if (error instanceof QaError && error.code === 'quota_exceeded') {
        this.logger.warn(
          `问答预算拒绝 scope=${scopeTypeOf(input.scope)} code=${error.code}`,
        );
      }
      throw error;
    }

    const scope: KnowledgeScope = normalizeScope(input.scope);
    const retrieval = await this.search.retrieve(question, scope, CONTEXT_LIMIT);
    const minScore = minEvidenceScore();
    const evidence = retrieval.chunks.filter(
      (chunk) => chunk.finalScore >= minScore && chunk.content.trim().length > 0,
    );

    let answerText = REFUSAL_ANSWER;
    let status: QaAnswerDTO['status'] = 'refused';
    let needsOfficialConfirmation = true;
    let citations: QaCitation[] = [];
    let model: string | null = null;
    let tokens = 0;

    if (evidence.length > 0) {
      const context = evidence.slice(0, CITATION_LIMIT);
      const citationAsOf = new Date();
      citations = context.map((chunk, index) => ({
        index: index + 1,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        documentType: chunk.documentType,
        officialUrl: chunk.officialUrl,
        locator: chunk.locator,
        snippet: snippetOf(chunk),
        score: round(chunk.finalScore),
        regionCode: chunk.regionCode,
        year: chunk.year,
        effectiveFrom: chunk.effectiveFrom,
        effectiveTo: chunk.effectiveTo,
        validity: validityOf(chunk.effectiveFrom, chunk.effectiveTo, citationAsOf),
        applicableAudience: chunk.applicableAudience,
        applicableSubjects: chunk.applicableSubjects,
        applicableStages: chunk.applicableStages,
      }));

      if (this.ai.mode === 'mock') {
        answerText = extractiveAnswer(context.map((item) => ({ content: item.content })));
        model = 'mock-extractive';
      } else {
        let chat: Awaited<ReturnType<AiService['chat']>>;
        try {
          chat = await this.ai.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(question, context) },
          ]);
        } catch (error) {
          // 生成失败明确返回，不落“空回答”，也不影响检索与原有招聘功能
          this.logger.warn(
            `问答生成失败 scope=${scopeTypeOf(scope)} code=${
              error instanceof AiError ? error.code : 'qa_error'
            }`,
          );
          throw error;
        }
        answerText = chat.text.trim();
        model = chat.model;
        tokens = chat.tokens ?? 0;
      }

      const validation = validateCitations(answerText, citations.length);
      if (validation.valid.length === 0) {
        status = 'unverified';
        needsOfficialConfirmation = true;
        if (!answerText.includes(UNVERIFIED_NOTICE)) {
          answerText = `${answerText}${UNVERIFIED_NOTICE}`;
        }
      } else {
        status = 'answered';
        needsOfficialConfirmation = validation.invalid.length > 0;
        if (validation.invalid.length > 0) {
          this.logger.warn(`回答包含越界引用：${validation.invalid.join(',')}`);
        }
      }
    }

    const latencyMs = Date.now() - startedAt;
    const record = await this.prisma.qaAnswer.create({
      data: {
        scopeType: scopeTypeOf(scope),
        announcementId: scope.announcementId ?? null,
        unitId: scope.unitId ?? null,
        regionCode: scope.regionCode ?? null,
        question,
        answer: answerText,
        status,
        citations: citations as unknown as Prisma.InputJsonValue,
        needsOfficialConfirmation,
        model,
        mode: this.ai.mode,
        promptVersion: QA_PROMPT_VERSION,
        indexVersions: evidence.map((item) => ({
          documentId: item.documentId,
          indexVersion: item.indexVersion,
        })) as unknown as Prisma.InputJsonValue,
        usage: {
          promptTokens: null,
          completionTokens: tokens || null,
          mode: this.ai.mode,
        } as Prisma.InputJsonValue,
        latencyMs,
        userId: input.userId,
        ipHash,
      },
    });

    await this.consumeUsage(day, input.userId, ipHash, tokens);

    // 运维日志只记录范围/状态/用量，不记录问题正文、用户标识或密钥
    this.logger.log(
      `qa ask scope=${scopeTypeOf(scope)} status=${status} mode=${this.ai.mode} ` +
        `candidates=${retrieval.meta.candidates} citations=${citations.length} ` +
        `tokens=${tokens} latencyMs=${latencyMs}`,
    );

    return {
      id: record.id,
      question,
      answer: answerText,
      status,
      needsOfficialConfirmation,
      citations,
      model,
      mode: this.ai.mode,
      latencyMs,
      createdAt: record.createdAt.toISOString(),
      retrieval: {
        candidates: retrieval.meta.candidates,
        vectorUsed: retrieval.meta.vectorUsed,
        rerankUsed: retrieval.meta.rerankUsed,
        rerankFailed: retrieval.meta.rerankFailed,
      },
    };
  }

  /**
   * W5：范围明确的政策问答。
   *
   * - 必须先确定地区与年份；全国用 `000000`；
   * - 先做覆盖查询：无覆盖返回 `no_coverage`，查询失败抛 503，二者不混用；
   * - 只采用该地区 + 全国性政策（公告仅本地区）且未失效的材料；
   * - 公告与政策同时命中时并列展示冲突候选，不自动认定覆盖关系。
   */
  async askPolicy(input: PolicyQuestionInput): Promise<PolicyAnswerDTO> {
    const startedAt = Date.now();
    const question = (input.question ?? '').trim();
    if (!question) throw new QaError('question_empty', '请输入问题', 400);
    const maxChars = this.ai.config.limits.questionMaxChars;
    if (question.length > maxChars) {
      throw new QaError(
        'question_too_long',
        `问题最多 ${maxChars} 个字符，请拆分后再问`,
        400,
      );
    }
    const regionCode = normalizeRegionCode(input.regionCode);
    if (!regionCode) {
      throw new QaError('region_invalid', '请选择有效的地区（全国或 6 位行政区划代码）', 400);
    }
    if (
      !Number.isInteger(input.year) ||
      input.year < 2000 ||
      input.year > 2100
    ) {
      throw new QaError('year_invalid', '请选择有效的适用年份（2000—2100）', 400);
    }
    const subjects = uniqueStrings(input.applicableSubjects).slice(0, 5);
    const audience = (input.applicableAudience ?? '').trim().slice(0, 50) || null;
    if (!this.ai.available) {
      throw new QaError(
        'ai_disabled',
        '问答模型未启用或未配置，暂不能回答（请管理员配置后使用）',
        503,
      );
    }

    const day = dayKey(new Date());
    const ipHash = input.ip ? hashIp(input.ip) : null;
    try {
      await this.assertQuota(day, input.userId, ipHash);
    } catch (error) {
      if (error instanceof QaError && error.code === 'quota_exceeded') {
        this.logger.warn(`政策问答预算拒绝 code=${error.code}`);
      }
      throw error;
    }

    let coverage: PolicyCoverageResult;
    try {
      coverage = await this.coverage.coverage({
        regionCode,
        year: input.year,
        subjects,
      });
    } catch (error) {
      // 覆盖查询失败是系统故障，不能回答成“无覆盖”
      this.logger.warn(
        `政策覆盖查询失败 region=${regionCode} year=${input.year}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new QaError(
        'coverage_unavailable',
        '覆盖查询暂不可用，无法判断该地区是否有材料，请稍后再试',
        503,
      );
    }

    const scopeView = {
      regionCode,
      regionLabel: regionLabel(regionCode),
      year: input.year,
      applicableSubjects: subjects,
      applicableAudience: audience,
    };

    if (coverage.status === 'no_coverage') {
      const answerText = noCoverageText(coverage);
      const latencyMs = Date.now() - startedAt;
      const record = await this.prisma.qaAnswer.create({
        data: {
          scopeType: 'policy',
          regionCode,
          year: input.year,
          question,
          answer: answerText,
          status: 'no_coverage',
          citations: [] as unknown as Prisma.InputJsonValue,
          needsOfficialConfirmation: true,
          model: null,
          mode: this.ai.mode,
          promptVersion: QA_PROMPT_VERSION,
          indexVersions: [],
          usage: {
            promptTokens: null,
            completionTokens: null,
            mode: this.ai.mode,
            scope: scopeView,
          } as Prisma.InputJsonValue,
          latencyMs,
          userId: input.userId,
          ipHash,
        },
      });
      await this.consumeUsage(day, input.userId, ipHash, 0);
      this.logger.log(
        `qa policy scope=${regionCode} year=${input.year} ` +
          `subjects=${subjects.join(',') || '-'} audience=${audience || '-'} ` +
          `coverage=${coverage.status} sources=${coverage.sources.map((item) => item.publisher).join('|') || '-'} ` +
          `status=no_coverage mode=${this.ai.mode} latencyMs=${latencyMs}`,
      );
      return {
        id: record.id,
        question,
        answer: answerText,
        status: 'no_coverage',
        needsOfficialConfirmation: true,
        citations: [],
        model: null,
        mode: this.ai.mode,
        latencyMs,
        createdAt: record.createdAt.toISOString(),
        scope: scopeView,
        coverage,
        conflicts: [],
        retrieval: { candidates: 0, vectorUsed: false, rerankUsed: false, rerankFailed: false },
      };
    }

    const scope: KnowledgeScope = {
      regionCode,
      year: input.year,
      includeNational: true,
      documentTypes: ['policy', 'announcement'],
      asOf: new Date().toISOString(),
      ...(subjects.length ? { applicableSubjects: subjects } : {}),
      ...(audience ? { applicableAudience: audience } : {}),
    };

    let retrieval: Awaited<ReturnType<KnowledgeSearchService['retrieve']>>;
    try {
      retrieval = await this.search.retrieve(question, scope, CONTEXT_LIMIT);
    } catch (error) {
      this.logger.warn(
        `政策检索失败 region=${regionCode} year=${input.year}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new QaError(
        'retrieval_failed',
        '检索暂不可用，不能确认该问题是否有材料依据，请稍后再试',
        503,
      );
    }

    const minScore = minEvidenceScore();
    const evidence = retrieval.chunks.filter(
      (chunk) => chunk.finalScore >= minScore && chunk.content.trim().length > 0,
    );
    const citationAsOf = new Date();
    let citations: QaCitation[] = [];
    let answerText = `${REFUSAL_ANSWER}${scopeNotice(scopeView.regionLabel, input.year)}`;
    let status: QaAnswerDTO['status'] = 'refused';
    let needsOfficialConfirmation = true;
    let model: string | null = null;
    let tokens = 0;
    let conflicts: PolicyConflict[] = [];

    if (evidence.length > 0) {
      const context = evidence.slice(0, CITATION_LIMIT);
      citations = context.map((chunk, index) => ({
        index: index + 1,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        documentType: chunk.documentType,
        officialUrl: chunk.officialUrl,
        locator: chunk.locator,
        snippet: snippetOf(chunk),
        score: round(chunk.finalScore),
        regionCode: chunk.regionCode,
        year: chunk.year,
        effectiveFrom: chunk.effectiveFrom,
        effectiveTo: chunk.effectiveTo,
        validity: validityOf(chunk.effectiveFrom, chunk.effectiveTo, citationAsOf),
        applicableAudience: chunk.applicableAudience,
        applicableSubjects: chunk.applicableSubjects,
        applicableStages: chunk.applicableStages,
      }));
      conflicts = detectAnnouncementPolicyConflicts(citations);

      if (this.ai.mode === 'mock') {
        answerText = extractiveAnswer(context.map((item) => ({ content: item.content })));
        model = 'mock-extractive';
      } else {
        let chat: Awaited<ReturnType<AiService['chat']>>;
        try {
          chat = await this.ai.chat([
            { role: 'system', content: POLICY_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildPolicyPrompt(question, context, scopeView, conflicts.length > 0),
            },
          ]);
        } catch (error) {
          this.logger.warn(
            `政策问答生成失败 region=${regionCode} code=${
              error instanceof AiError ? error.code : 'qa_error'
            }`,
          );
          throw error;
        }
        answerText = chat.text.trim();
        model = chat.model;
        tokens = chat.tokens ?? 0;
      }

      const validation = validateCitations(answerText, citations.length);
      if (validation.valid.length === 0) {
        status = 'unverified';
        needsOfficialConfirmation = true;
        if (!answerText.includes(UNVERIFIED_NOTICE)) {
          answerText = `${answerText}${UNVERIFIED_NOTICE}`;
        }
      } else {
        status = 'answered';
        needsOfficialConfirmation = validation.invalid.length > 0;
      }
      if (validation.valid.length > 0 && validation.invalid.length > 0) {
        this.logger.warn(`政策回答包含越界引用：${validation.invalid.join(',')}`);
      }
    }

    answerText = `${answerText}${scopeNotice(scopeView.regionLabel, input.year)}`;
    if (conflicts.length > 0) {
      answerText = `${answerText}${CONFLICT_NOTICE}`;
      needsOfficialConfirmation = true;
    }
    if (citations.some((item) => item.validity === 'not_yet_effective')) {
      answerText = `${answerText}${NOT_YET_EFFECTIVE_NOTICE}`;
    }
    if (coverage.status === 'partial') {
      answerText = `${answerText}${partialCoverageNotice(coverage)}`;
    }

    const latencyMs = Date.now() - startedAt;
    const record = await this.prisma.qaAnswer.create({
      data: {
        scopeType: 'policy',
        regionCode,
        year: input.year,
        question,
        answer: answerText,
        status,
        citations: citations as unknown as Prisma.InputJsonValue,
        needsOfficialConfirmation,
        model,
        mode: this.ai.mode,
        promptVersion: QA_PROMPT_VERSION,
        indexVersions: evidence.map((item) => ({
          documentId: item.documentId,
          indexVersion: item.indexVersion,
        })) as unknown as Prisma.InputJsonValue,
        usage: {
          promptTokens: null,
          completionTokens: tokens || null,
          mode: this.ai.mode,
          scope: scopeView,
        } as Prisma.InputJsonValue,
        latencyMs,
        userId: input.userId,
        ipHash,
      },
    });

    await this.consumeUsage(day, input.userId, ipHash, tokens);

    this.logger.log(
      `qa policy scope=${regionCode} year=${input.year} ` +
        `subjects=${subjects.join(',') || '-'} audience=${audience || '-'} status=${status} ` +
        `mode=${this.ai.mode} coverage=${coverage.status} ` +
        `sources=${coverage.sources.map((item) => item.publisher).join('|') || '-'} ` +
        `candidates=${retrieval.meta.candidates} citations=${citations.length} ` +
        `conflicts=${conflicts.length} tokens=${tokens} latencyMs=${latencyMs}`,
    );

    return {
      id: record.id,
      question,
      answer: answerText,
      status,
      needsOfficialConfirmation,
      citations,
      model,
      mode: this.ai.mode,
      latencyMs,
      createdAt: record.createdAt.toISOString(),
      scope: scopeView,
      coverage,
      conflicts,
      retrieval: {
        candidates: retrieval.meta.candidates,
        vectorUsed: retrieval.meta.vectorUsed,
        rerankUsed: retrieval.meta.rerankUsed,
        rerankFailed: retrieval.meta.rerankFailed,
      },
    };
  }

  async feedback(input: {
    answerId: string;
    userId: string;
    type: 'helpful' | 'not_helpful' | 'incorrect';
    comment?: string;
  }) {
    const answer = await this.prisma.qaAnswer.findUnique({
      where: { id: input.answerId },
    });
    // 横向越权保护：只能对本人提问产生的回答打标；不向他人暴露回答是否存在
    if (!answer || answer.userId !== input.userId) {
      throw new QaError('answer_not_found', '回答不存在', 404);
    }
    const existing = await this.prisma.qaFeedback.findFirst({
      where: { answerId: input.answerId, userId: input.userId },
    });
    if (existing) {
      return this.prisma.qaFeedback.update({
        where: { id: existing.id },
        data: { type: input.type, comment: input.comment?.slice(0, 500) ?? null },
      });
    }
    return this.prisma.qaFeedback.create({
      data: {
        answerId: input.answerId,
        userId: input.userId,
        type: input.type,
        comment: input.comment?.slice(0, 500) ?? null,
      },
    });
  }

  async history(userId: string, limit = 10) {
    const take = Math.min(Math.max(1, Math.floor(limit)), 30);
    const rows = await this.prisma.qaAnswer.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        question: row.question,
        answer: row.answer,
        status: row.status,
        citations: row.citations,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async assertQuota(day: string, userId: string, ipHash: string | null) {
    const limits = this.ai.config.limits;
    const checks: Array<Promise<void>> = [];
    checks.push(
      (async () => {
        const row = await this.prisma.aiUsageDaily.findUnique({
          where: { scope_subject_day: { scope: 'user', subject: userId, day } },
        });
        if (row && row.requests >= limits.dailyRequestsPerUser) {
          throw new QaError(
            'quota_exceeded',
            `今天的问题次数已达上限（${limits.dailyRequestsPerUser} 次），请明天再试`,
            429,
          );
        }
      })(),
    );
    if (ipHash) {
      checks.push(
        (async () => {
          const row = await this.prisma.aiUsageDaily.findUnique({
            where: { scope_subject_day: { scope: 'ip', subject: ipHash, day } },
          });
          if (row && row.requests >= limits.dailyRequestsPerIp) {
            throw new QaError(
              'quota_exceeded',
              `当前网络今日问题次数已达上限（${limits.dailyRequestsPerIp} 次）`,
              429,
            );
          }
        })(),
      );
    }
    checks.push(
      (async () => {
        const row = await this.prisma.aiUsageDaily.findUnique({
          where: { scope_subject_day: { scope: 'global', subject: 'all', day } },
        });
        if (row && row.requests >= limits.dailyRequestsGlobal) {
          throw new QaError(
            'quota_exceeded',
            '今日问答总额度已用完，请明天再试',
            429,
          );
        }
        if (row && row.tokens >= limits.dailyTokensGlobal) {
          throw new QaError(
            'quota_exceeded',
            '今日问答额度已用完，请明天再试',
            429,
          );
        }
      })(),
    );
    await Promise.all(checks);
  }

  private async consumeUsage(
    day: string,
    userId: string,
    ipHash: string | null,
    tokens: number,
  ) {
    const ops: Array<Promise<unknown>> = [
      this.upsertUsage('user', userId, day, tokens),
      this.upsertUsage('global', 'all', day, tokens),
    ];
    if (ipHash) ops.push(this.upsertUsage('ip', ipHash, day, tokens));
    try {
      await Promise.all(ops);
    } catch (error) {
      // 记账失败不影响已经产生的回答，但必须留痕
      this.logger.warn(
        `AI 用量记账失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private upsertUsage(scope: string, subject: string, day: string, tokens: number) {
    return this.prisma.aiUsageDaily.upsert({
      where: { scope_subject_day: { scope, subject, day } },
      create: { scope, subject, day, requests: 1, tokens },
      update: { requests: { increment: 1 }, tokens: { increment: tokens } },
    });
  }
}

export function toQaError(error: unknown): QaError {
  if (error instanceof QaError) return error;
  if (error instanceof AiError) {
    const status =
      error.code === 'ai_disabled' || error.code === 'not_configured' ? 503 : 502;
    return new QaError(error.code, error.message, status);
  }
  return new QaError(
    'qa_error',
    error instanceof Error ? error.message : '问答处理失败',
    500,
  );
}

const SYSTEM_PROMPT = [
  '你是教师招聘公告解读助手。',
  '只能依据下方【材料】回答，不得使用材料之外的知识或常识补充。',
  '每条结论后必须标注材料编号，如 [1]；同一结论可标注多个编号。',
  '材料不足以回答时，直接回答“材料不足，无法据此回答”，不要猜测。',
  '涉及时间、人数、资格条件时逐字引用原文表述，不得换算或推断。',
  '回答用简体中文，先给结论，再给一句依据说明，不超过 300 字。',
].join('\n');

const POLICY_SYSTEM_PROMPT = [
  '你是教师招聘政策检索助手。',
  '只能依据下方【材料】回答；材料不足时直接说明不足，不得使用外部知识。',
  '每条结论后必须标注材料编号，如 [1]。',
  '公告与政策可能同时出现：分别引用各自原文，不要把“更新”“层级更高”当作自动覆盖理由。',
  '涉及具体招聘条件时，提示用户以本次公告和招聘单位确认为准。',
  '涉及有效期、适用对象时逐字引用材料标注，不得推断。',
  '回答用简体中文，先给结论，再给一句依据说明，不超过 300 字。',
].join('\n');

function buildUserPrompt(question: string, context: readonly RetrievedChunk[]): string {
  const materials = context
    .map((chunk, index) => {
      const title = chunk.documentTitle;
      const content = chunk.content.replace(/\s+/g, ' ').trim().slice(0, 500);
      return `[${index + 1}] ${title}｜${content}`;
    })
    .join('\n');
  return `【材料】\n${materials}\n\n【问题】${question}`;
}

function buildPolicyPrompt(
  question: string,
  context: readonly RetrievedChunk[],
  scope: {
    regionLabel: string;
    year: number;
    applicableSubjects: string[];
    applicableAudience: string | null;
  },
  hasConflict: boolean,
): string {
  const materials = context
    .map((chunk, index) => {
      const type = chunk.documentType === 'policy' ? '政策' : '公告';
      const validity = chunk.effectiveTo ? `有效期至 ${chunk.effectiveTo.slice(0, 10)}` : '有效期未标注';
      const audience = chunk.applicableAudience ? `；适用对象：${chunk.applicableAudience}` : '';
      const content = chunk.content.replace(/\s+/g, ' ').trim().slice(0, 500);
      return `[${index + 1}]（${type}）${chunk.documentTitle}｜${validity}${audience}｜${content}`;
    })
    .join('\n');
  const scopeLine = `【检索范围】${scope.regionLabel} · ${scope.year} 年${
    scope.applicableSubjects.length ? ` · 学科：${scope.applicableSubjects.join('、')}` : ''
  }${scope.applicableAudience ? ` · 适用对象：${scope.applicableAudience}` : ''}`;
  const conflictLine = hasConflict
    ? '\n【注意】材料同时包含公告与政策，请分别引用；不要断言其中一方覆盖另一方。'
    : '';
  return `${scopeLine}\n【材料】\n${materials}\n\n【问题】${question}${conflictLine}`;
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))];
}

function noCoverageText(coverage: PolicyCoverageResult): string {
  const scope = scopeNotice(regionLabel(coverage.regionCode), coverage.year);
  if (coverage.exact.documents > 0 && coverage.exact.queryable === 0) {
    return `该地区/年份已有 ${coverage.exact.documents} 份已发布材料，但索引尚未完成，暂不能回答。请稍后重试或联系管理员。${scope}`;
  }
  if (coverage.descendants.some((item) => item.queryable > 0)) {
    return `只检索到所属城市/区县材料，不能作为该地区整体结论；请选择具体城市或核对官方公告。${scope}`;
  }
  const otherYears = coverage.years.filter(
    (item) => item.year !== null && item.year !== coverage.year && item.queryable > 0,
  );
  if (otherYears.length > 0) {
    return `${NO_COVERAGE_ANSWER}（其他年份有可检索材料：${otherYears
      .map((item) => `${item.year} 年 ${item.documents} 份`)
      .join('、')}；未用于本年度回答。）${scope}`;
  }
  return `${NO_COVERAGE_ANSWER}${scope}`;
}

function partialCoverageNotice(coverage: PolicyCoverageResult): string {
  if (coverage.national.queryable > 0) {
    return '（本次仅命中全国性政策，不能替代该地区具体招聘公告；请结合当地公告核实。）';
  }
  return '（本次仅有其他地区或城市材料，不能作为该地区整体结论。）';
}

function normalizeScope(scope: KnowledgeScope | undefined): KnowledgeScope {
  if (!scope) return {};
  return {
    ...(scope.announcementId ? { announcementId: scope.announcementId } : {}),
    ...(scope.unitId ? { unitId: scope.unitId } : {}),
    ...(scope.regionCode ? { regionCode: scope.regionCode } : {}),
    ...(scope.documentTypes?.length ? { documentTypes: scope.documentTypes } : {}),
  };
}

function scopeTypeOf(scope: KnowledgeScope | undefined): string {
  if (scope?.announcementId) return 'announcement';
  if (scope?.unitId) return 'unit';
  if (scope?.regionCode) return 'region';
  return 'general';
}

function snippetOf(chunk: RetrievedChunk): string {
  const text = chunk.content.replace(/\s+/g, ' ').trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function minEvidenceScore(): number {
  const parsed = Number(process.env.QA_MIN_EVIDENCE_SCORE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_SCORE;
}

function dayKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function hashIp(ip: string): string {
  const salt = process.env.QA_IP_HASH_SALT ?? 'teacher-exam-qa';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
