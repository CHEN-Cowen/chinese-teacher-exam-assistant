/**
 * W3：公告级混合检索。
 *
 * - 只检索 `version.status = published` 的 chunk：草稿/待审/撤回的版本绝不进入候选；
 * - 混合打分：向量余弦（真实 Embedding）+ 中文二元组词法覆盖；
 * - 可选重排：调用百炼 Rerank 对前 N 条重排；重排失败明确降级，不伪装成功；
 * - 检索范围可按公告、岗位、地区、材料类型收窄。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import type { DocumentLocator } from '../document-processing/parsed-document.js';
import { cosineSimilarity, hybridScore, lexicalScore } from './qa/qa-domain.js';

const MAX_CANDIDATES = 400;
const RERANK_INPUT_LIMIT = 30;
const DEFAULT_LIMIT = 8;

export interface KnowledgeScope {
  announcementId?: string;
  unitId?: string;
  regionCode?: string;
  /** W5：适用年份；显式传入时只取该年份材料，避免跨年混用 */
  year?: number;
  /** W5：地区检索时纳入全国性政策（regionCode 为空或 000000） */
  includeNational?: boolean;
  /** W5：学科限定；材料未标注学科视为通用，但不冒充已匹配 */
  applicableSubjects?: string[];
  /** W5：适用对象限定（自由文本，匹配材料标注） */
  applicableAudience?: string;
  /** W5：以该日期判断有效期；失效材料不进入候选 */
  asOf?: string;
  documentTypes?: string[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  versionId: string;
  indexVersion: number;
  chunkIndex: number;
  content: string;
  headingPath: string[];
  locator: DocumentLocator;
  documentTitle: string;
  officialUrl: string | null;
  documentType: string;
  publishedAt: string | null;
  /** W5：材料适用范围与有效期，供回答标注和冲突展示 */
  regionCode: string | null;
  year: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  applicableAudience: string | null;
  applicableSubjects: string[];
  applicableStages: string[];
  lexicalScore: number;
  vectorScore: number | null;
  hybridScore: number;
  rerankScore: number | null;
  finalScore: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  meta: {
    candidates: number;
    vectorUsed: boolean;
    rerankUsed: boolean;
    rerankFailed: boolean;
    mode: 'real' | 'mock';
  };
}

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async retrieve(
    question: string,
    scope: KnowledgeScope = {},
    limit = DEFAULT_LIMIT,
  ): Promise<RetrievalResult> {
    const asOf = parseAsOf(scope.asOf);
    const conditions: Prisma.KnowledgeDocumentWhereInput[] = [];
    if (scope.regionCode) {
      // 公告只取本地区；政策可额外纳入全国性文本（regionCode 为空或 000000）
      conditions.push({
        OR: [
          { regionCode: scope.regionCode },
          ...(scope.includeNational
            ? [
                {
                  AND: [
                    { documentType: 'policy' },
                    { OR: [{ regionCode: '000000' }, { regionCode: null }] },
                  ],
                },
              ]
            : []),
        ],
      });
    }
    if (scope.year !== undefined) {
      // 只取声明为该年份的材料；未标年份的材料不冒充本年度适用
      conditions.push({ year: scope.year });
    }
    // 失效材料不得作为回答依据；生效日期未到仍可展示，但由回答标注
    conditions.push({ OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] });

    const rows = await this.prisma.knowledgeChunk.findMany({
      where: {
        version: {
          status: 'published',
          // 文档级撤回/权限变更与版本状态双保险：任一未发布都不进入检索
          document: {
            status: 'published',
            ...(scope.announcementId ? { announcementId: scope.announcementId } : {}),
            ...(scope.documentTypes?.length
              ? { documentType: { in: scope.documentTypes } }
              : {}),
            ...(conditions.length > 0 ? { AND: conditions } : {}),
          },
        },
      },
      include: { version: { include: { document: true } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATES,
    });

    // 只采用当前有效索引版本：重建索引完成前的旧 chunk、迟到任务的产物都不能进入回答
    const activeRows = rows.filter(
      (row) => row.version.activeIndexVersion === row.indexVersion,
    );

    // 岗位范围：未绑定岗位的公告/政策级材料对该公告下所有岗位可见；
    // 显式绑定其他岗位的片段必须排除，避免岗位条件串用。
    const filtered = activeRows.filter((row) => {
      if (scope.unitId) {
        const unitIds = Array.isArray(row.unitIds) ? (row.unitIds as string[]) : [];
        if (unitIds.length > 0 && !unitIds.includes(scope.unitId)) return false;
      }
      // 学科/适用对象在应用层做精确过滤：材料未标注视为通用，
      // 标注了其他学科/对象时不得用于本次回答。
      const document = row.version.document;
      const subjects = arrayOfStrings(document.applicableSubjects);
      if (
        scope.applicableSubjects?.length &&
        subjects.length > 0 &&
        !subjects.some((item) => scope.applicableSubjects!.includes(item))
      ) {
        return false;
      }
      if (
        scope.applicableAudience &&
        document.applicableAudience &&
        !document.applicableAudience.includes(scope.applicableAudience)
      ) {
        return false;
      }
      // 双重校验有效期，避免数据库条件遗漏
      const effectiveTo = document.effectiveTo;
      if (effectiveTo && effectiveTo.getTime() < asOf.getTime()) return false;
      return true;
    });

    let queryVector: number[] | null = null;
    let vectorUsed = false;
    if (this.ai.available && filtered.length > 0) {
      try {
        const embedding = await this.ai.embed([question], 'query');
        queryVector = embedding.vectors[0] ?? null;
        vectorUsed = queryVector !== null;
      } catch (error) {
        this.logger.warn(
          `查询向量化失败，降级词法检索：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const scored = filtered
      .map((row) => {
        const embedding = Array.isArray(row.embedding) ? row.embedding : [];
        const vectorScore =
          queryVector && embedding.length === queryVector.length
            ? cosineSimilarity(queryVector, embedding)
            : null;
        const lexical = lexicalScore(question, row.content);
        const hybrid = hybridScore(lexical, vectorScore);
        const candidate: RetrievedChunk = {
          chunkId: row.id,
          documentId: row.documentId,
          versionId: row.versionId,
          indexVersion: row.indexVersion,
          chunkIndex: row.chunkIndex,
          content: row.content,
          headingPath: Array.isArray(row.headingPath) ? (row.headingPath as string[]) : [],
          locator: row.locator as unknown as DocumentLocator,
          documentTitle: row.version.document.title,
          officialUrl: row.version.document.officialUrl,
          documentType: row.version.document.documentType,
          publishedAt: row.version.publishedAt?.toISOString() ?? null,
          regionCode: row.version.document.regionCode ?? null,
          year: row.version.document.year ?? null,
          effectiveFrom: row.version.document.effectiveFrom?.toISOString() ?? null,
          effectiveTo: row.version.document.effectiveTo?.toISOString() ?? null,
          applicableAudience: row.version.document.applicableAudience ?? null,
          applicableSubjects: arrayOfStrings(row.version.document.applicableSubjects),
          applicableStages: arrayOfStrings(row.version.document.applicableStages),
          lexicalScore: lexical,
          vectorScore,
          hybridScore: hybrid,
          rerankScore: null,
          finalScore: hybrid,
        };
        return candidate;
      })
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, RERANK_INPUT_LIMIT);

    let rerankUsed = false;
    let rerankFailed = false;
    if (this.ai.available && scored.length > 1) {
      try {
        const rerank = await this.ai.rerank(
          question,
          scored.map((item) => item.content),
          scored.length,
        );
        const scores = new Map<number, number>();
        for (const item of rerank.results) scores.set(item.index, item.score);
        for (let index = 0; index < scored.length; index += 1) {
          const rerankScore = scores.get(index) ?? null;
          scored[index]!.rerankScore = rerankScore;
          if (rerankScore !== null) {
            // 重排分与混合分各占一半，避免重排把完全无关材料抬到前面
            scored[index]!.finalScore = 0.5 * rerankScore + 0.5 * scored[index]!.hybridScore;
          }
        }
        scored.sort((a, b) => b.finalScore - a.finalScore);
        rerankUsed = true;
      } catch (error) {
        rerankFailed = true;
        this.logger.warn(
          `重排失败，保留混合排序：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      chunks: scored.slice(0, Math.min(Math.max(limit, 1), 20)),
      meta: {
        candidates: filtered.length,
        vectorUsed,
        rerankUsed,
        rerankFailed,
        mode: this.ai.mode === 'mock' ? 'mock' : 'real',
      },
    };
  }

  /** 管理端检索调试：返回完整分数明细 */
  async debugSearch(question: string, scope: KnowledgeScope, limit = 10) {
    const result = await this.retrieve(question, scope, limit);
    return {
      items: result.chunks,
      meta: result.meta,
      scope: scope as Prisma.JsonObject,
    };
  }
}

function parseAsOf(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
