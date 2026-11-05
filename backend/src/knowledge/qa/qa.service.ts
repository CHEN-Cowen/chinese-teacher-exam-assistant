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
  officialUrl: string | null;
  locator: DocumentLocator;
  snippet: string;
  score: number;
}

export interface QaAnswerDTO {
  id: string;
  question: string;
  answer: string;
  status: 'answered' | 'unverified' | 'refused' | 'error';
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
      citations = context.map((chunk, index) => ({
        index: index + 1,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        officialUrl: chunk.officialUrl,
        locator: chunk.locator,
        snippet: snippetOf(chunk),
        score: round(chunk.finalScore),
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
