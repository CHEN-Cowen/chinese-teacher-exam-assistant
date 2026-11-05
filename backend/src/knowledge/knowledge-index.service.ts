/**
 * W2：知识版本索引（解析 → 切分 → 向量化 → 落库）。
 *
 * 只在 Worker 进程执行（依赖 DocumentProcessingModule 的解析器）：
 * - 同一索引任务幂等：重复消费直接复用 ready 结果；
 * - 失败分类明确（原件缺失/待人工/无可检索文本/模型未配置/供应商异常），
 *   失败任务保留 chunk 之外的现场，可人工重试；
 * - 重新索引先清理同索引版本的旧 chunk，避免残留半成品；
 * - 向量落 Float[]；pgvector 可用时同时写向量表，不可用时明确降级。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { OBJECT_STORE } from '../sourcing/storage/storage.tokens.js';
import type { ObjectStore } from '../sourcing/storage/object-store.js';
import { extensionOf } from '../document-processing/format-detector.js';
import { DocumentParserService, GuardError } from '../document-processing/document-parser.service.js';
import { DocumentParseStore } from '../document-processing/document-parse-store.js';
import type { ParsedBlock } from '../document-processing/parsed-document.js';
import { AiError } from '../ai/ai.errors.js';
import { AiService } from '../ai/ai.service.js';
import { CHUNKER_VERSION, chunkParsedBlocks, textToBlocks } from './chunker.js';
import { VectorStoreService } from './vector-store.service.js';

/** 文本直传格式：不经过格式解析器，避免把纯文本误判为不支持格式 */
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'text']);

export class KnowledgeIndexError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeIndexError';
  }
}

export interface KnowledgeIndexOutcome {
  status: 'ready' | 'failed' | 'reused';
  jobId: string;
  indexVersion: number;
  chunkCount: number;
  embeddedCount: number;
  errorClass?: string;
  errorMessage?: string;
  vectorStore: 'pgvector' | 'float-array';
}

@Injectable()
export class KnowledgeIndexService {
  private readonly logger = new Logger(KnowledgeIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: DocumentParserService,
    private readonly parseStore: DocumentParseStore,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    private readonly ai: AiService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  async run(jobId: string): Promise<KnowledgeIndexOutcome> {
    const job = await this.prisma.knowledgeIndexJob.findUnique({
      where: { id: jobId },
      include: { version: true },
    });
    if (!job) {
      return {
        status: 'failed',
        jobId,
        indexVersion: 0,
        chunkCount: 0,
        embeddedCount: 0,
        errorClass: 'job_not_found',
        errorMessage: '索引任务不存在',
        vectorStore: 'float-array',
      };
    }
    if (job.status === 'ready') {
      return {
        status: 'reused',
        jobId,
        indexVersion: job.indexVersion,
        chunkCount: job.chunkCount,
        embeddedCount: job.embeddedCount,
        vectorStore: await this.vectorStore.isAvailable() ? 'pgvector' : 'float-array',
      };
    }

    await this.prisma.knowledgeIndexJob.update({
      where: { id: jobId },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        startedAt: job.startedAt ?? new Date(),
        errorClass: null,
        errorMessage: null,
      },
    });

    const version = job.version;
    try {
      if (!version.storageKey) {
        throw new KnowledgeIndexError('storage_unavailable', '版本缺少原件存储引用');
      }
      if (!this.ai.available) {
        throw new KnowledgeIndexError(
          'ai_not_configured',
          '未启用或未配置 Embedding（AI_ENABLED / DASHSCOPE_API_KEY）',
        );
      }

      const ext = extensionOf(version.sourceUrl ?? version.storageKey);
      const loaded = await this.loadBlocks(version, ext);
      const chunks = chunkParsedBlocks(loaded.blocks);
      if (chunks.length === 0) {
        throw new KnowledgeIndexError('no_text', '未切分出可检索文本');
      }

      // 重新索引：清理同版本旧 chunk（级联清理向量引用）
      await this.prisma.knowledgeChunk.deleteMany({
        where: { versionId: version.id, indexVersion: job.indexVersion },
      });

      const embedding = await this.ai.embed(
        chunks.map((chunk) => chunk.content),
        'document',
      );
      if (embedding.vectors.length !== chunks.length) {
        throw new KnowledgeIndexError(
          'embedding_mismatch',
          'Embedding 返回条数与切分片段不一致',
        );
      }

      const unitIds = Array.isArray(version.unitIds)
        ? (version.unitIds as string[])
        : null;
      const vectorAvailable = await this.vectorStore.isAvailable();
      let embeddedCount = 0;

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]!;
        const vector = embedding.vectors[index]!;
        const row = await this.prisma.knowledgeChunk.create({
          data: {
            documentId: version.documentId,
            versionId: version.id,
            indexVersion: job.indexVersion,
            chunkIndex: chunk.chunkIndex,
            kind: chunk.kind,
            content: chunk.content,
            headingPath: chunk.headingPath as Prisma.InputJsonValue,
            locator: chunk.locator as unknown as Prisma.InputJsonValue,
            spans: chunk.spans as unknown as Prisma.InputJsonValue,
            ...(unitIds ? { unitIds: unitIds as Prisma.InputJsonValue } : {}),
            charCount: chunk.charCount,
            embeddingModel: embedding.model,
            embeddingDim: embedding.dimension,
            embedding: vector,
          },
        });
        embeddedCount += 1;
        if (vectorAvailable) {
          await this.vectorStore.upsert({
            chunkId: row.id,
            embedding: vector,
            model: embedding.model,
            dim: embedding.dimension,
          });
        }
      }

      await this.prisma.$transaction([
        this.prisma.knowledgeDocumentVersion.update({
          where: { id: version.id },
          data: {
            parserVersion: loaded.parserVersion,
            chunkerVersion: CHUNKER_VERSION,
            activeIndexVersion: job.indexVersion,
          },
        }),
        this.prisma.knowledgeDocument.update({
          where: { id: version.documentId },
          data: { activeIndexVersion: job.indexVersion },
        }),
        this.prisma.knowledgeIndexJob.update({
          where: { id: jobId },
          data: {
            status: 'ready',
            chunkCount: chunks.length,
            embeddedCount,
            embeddingModel: embedding.model,
            embeddingDim: embedding.dimension,
            finishedAt: new Date(),
          },
        }),
      ]);

      this.logger.log(
        `知识索引完成 job=${jobId} version=${version.id} chunks=${chunks.length} model=${embedding.model}`,
      );
      return {
        status: 'ready',
        jobId,
        indexVersion: job.indexVersion,
        chunkCount: chunks.length,
        embeddedCount,
        vectorStore: vectorAvailable ? 'pgvector' : 'float-array',
      };
    } catch (error) {
      const { code, message } = classifyIndexError(error);
      await this.prisma.knowledgeIndexJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorClass: code,
          errorMessage: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      this.logger.warn(`知识索引失败 job=${jobId} code=${code} message=${message}`);
      return {
        status: 'failed',
        jobId,
        indexVersion: job.indexVersion,
        chunkCount: 0,
        embeddedCount: 0,
        errorClass: code,
        errorMessage: message,
        vectorStore: await this.vectorStore.isAvailable() ? 'pgvector' : 'float-array',
      };
    }
  }

  private async loadBlocks(
    version: {
      id: string;
      snapshotId: string | null;
      storageKey: string | null;
      mimeType: string | null;
      sourceUrl: string | null;
      contentHash: string;
    },
    ext: string,
  ): Promise<{ blocks: ParsedBlock[]; parserVersion: string }> {
    const storageKey = version.storageKey!;

    if (TEXT_EXTENSIONS.has(ext)) {
      const text = await this.objectStore.get(storageKey);
      if (!text.trim()) {
        throw new KnowledgeIndexError('no_text', '原件文本为空');
      }
      return { blocks: textToBlocks(text), parserVersion: 'text-passthrough@1.0.0' };
    }

    let bytes: Buffer;
    try {
      bytes = await this.objectStore.getBinary(storageKey);
    } catch (error) {
      throw new KnowledgeIndexError(
        'storage_unavailable',
        `原件读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let parseRunId: string | null = null;
    if (version.snapshotId) {
      try {
        const { run } = await this.parseStore.ensureRun({
          snapshotId: version.snapshotId,
          format: 'unknown',
          parserVersion: 'knowledge-parse@1.0.0',
          contentHash: version.contentHash,
          sourceUrl: version.sourceUrl,
        });
        parseRunId = run.id;
      } catch {
        // 解析留痕失败不影响索引本身；不伪造留痕。
        parseRunId = null;
      }
    }

    let parseRecorded = false;
    try {
      const parsed = await this.parser.parse({
        snapshotId: version.snapshotId ?? `knowledge-${version.id}`,
        sourceUrl: version.sourceUrl,
        storageKey,
        contentHash: version.contentHash,
        declaredMime: version.mimeType ?? '',
        bytes,
      });
      if (parseRunId) {
        await this.parseStore.completeRun(parseRunId, {
          status:
            parsed.pendingManualReason || parsed.ocr?.status === 'pending_manual'
              ? 'pending_manual'
              : 'parsed',
          format: parsed.format,
          blocks: parsed.blocks,
          tableHeaders: parsed.tableHeaders ?? null,
          blockCount: parsed.blocks.length,
          warnings: parsed.warnings,
          scanned: parsed.scanned,
          ocrRequired: parsed.ocr?.required ?? false,
          ocrStatus: parsed.ocr?.status ?? null,
        });
        parseRecorded = true;
      }
      if (parsed.pendingManualReason || parsed.ocr?.status === 'pending_manual') {
        throw new KnowledgeIndexError(
          'pending_manual',
          parsed.pendingManualReason ?? '扫描件/未启用格式，待人工处理',
        );
      }
      if (parsed.blocks.length === 0) {
        throw new KnowledgeIndexError('no_text', '解析未得到可检索文本块');
      }
      return { blocks: parsed.blocks, parserVersion: parsed.parserVersion };
    } catch (error) {
      // 解析已成功落痕时，后续“待人工/无文本”判定不覆盖解析记录本身
      if (parseRunId && !parseRecorded) {
        const code = error instanceof GuardError ? error.code : 'PARSE_ERROR';
        const message = error instanceof Error ? error.message : String(error);
        await this.parseStore.completeRun(parseRunId, {
          status:
            code === 'UNKNOWN_FORMAT' ? 'unsupported_format' : 'failed',
          format: 'unknown',
          errorSummary: `${code}:${message}`,
        });
      }
      throw error;
    }
  }
}

function classifyIndexError(error: unknown): { code: string; message: string } {
  if (error instanceof KnowledgeIndexError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof GuardError) {
    return {
      code:
        error.code === 'UNKNOWN_FORMAT' ? 'unsupported_format' : 'parse_error',
      message: `${error.code}:${error.message}`,
    };
  }
  if (error instanceof AiError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'index_error',
    message: error instanceof Error ? error.message : String(error),
  };
}
