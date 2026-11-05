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
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: {
        version: {
          status: 'published',
          // 文档级撤回/权限变更与版本状态双保险：任一未发布都不进入检索
          document: {
            status: 'published',
            ...(scope.announcementId ? { announcementId: scope.announcementId } : {}),
            ...(scope.regionCode ? { regionCode: scope.regionCode } : {}),
            ...(scope.documentTypes?.length
              ? { documentType: { in: scope.documentTypes } }
              : {}),
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
    const filtered = scope.unitId
      ? activeRows.filter((row) => {
          const unitIds = Array.isArray(row.unitIds) ? (row.unitIds as string[]) : [];
          return unitIds.length === 0 || unitIds.includes(scope.unitId!);
        })
      : activeRows;

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
