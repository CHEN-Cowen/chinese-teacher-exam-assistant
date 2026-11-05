/**
 * W2：向量存储（可选 pgvector）。
 *
 * - Prisma 不原生表达 vector 类型：通过显式迁移 + 参数化 SQL 访问；
 * - 部署镜像可能没有 pgvector：迁移安全跳过建表，本服务检测扩展后
 *   自动降级——chunk 仍保存 Float[]，检索层用应用余弦（W3）；
 * - 任何 SQL 失败都不伪装成功：写入返回 false 并由索引任务记录降级状态。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

const VECTOR_TABLE = 'knowledge_chunk_vectors';

export interface VectorSearchHit {
  chunkId: string;
  score: number;
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private available: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 扩展与向量表是否真实可用（结果缓存；迁移后需重启或 rebuild 才重新探测） */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ present: number }>>(
        `SELECT 1 AS present FROM pg_extension WHERE extname = 'vector' LIMIT 1`,
      );
      if (rows.length === 0) {
        this.available = false;
      } else {
        const table = await this.prisma.$queryRawUnsafe<Array<{ present: string }>>(
          `SELECT to_regclass('"${VECTOR_TABLE}"') AS present`,
        );
        this.available = table[0]?.present !== null;
      }
    } catch (error) {
      this.logger.warn(
        `pgvector 探测失败，降级为 Float[]：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.available = false;
    }
    if (!this.available) {
      this.logger.warn('pgvector 不可用：向量仅落 Float[]，检索走应用余弦（需真实环境复测）');
    }
    return this.available;
  }

  /** 写入/更新单个 chunk 向量；未启用 pgvector 时幂等返回 false */
  async upsert(input: {
    chunkId: string;
    embedding: number[];
    model: string;
    dim: number;
  }): Promise<boolean> {
    if (!(await this.isAvailable())) return false;
    const literal = vectorLiteral(input.embedding);
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "${VECTOR_TABLE}" ("chunk_id", "embedding", "model", "dim")
         VALUES ($1::uuid, $2::vector, $3, $4)
         ON CONFLICT ("chunk_id") DO UPDATE
           SET "embedding" = EXCLUDED."embedding",
               "model" = EXCLUDED."model",
               "dim" = EXCLUDED."dim"`,
        input.chunkId,
        literal,
        input.model,
        input.dim,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `向量写入失败（chunk=${input.chunkId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /** 撤回/重建时清理该版本的向量 */
  async deleteForVersion(versionId: string): Promise<void> {
    if (!(await this.isAvailable())) return;
    try {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "${VECTOR_TABLE}"
         WHERE "chunk_id" IN (SELECT "id" FROM "knowledge_chunks" WHERE "version_id" = $1::uuid)`,
        versionId,
      );
    } catch (error) {
      this.logger.warn(
        `向量清理失败（version=${versionId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 余弦检索（W3 使用；limit 有上限，避免一次拉取全库） */
  async search(embedding: number[], limit = 20): Promise<VectorSearchHit[]> {
    if (!(await this.isAvailable())) return [];
    const take = Math.min(Math.max(1, Math.floor(limit)), 100);
    const literal = vectorLiteral(embedding);
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ chunk_id: string; distance: number }>
      >(
        `SELECT "chunk_id", ("embedding" <=> $1::vector) AS distance
         FROM "${VECTOR_TABLE}"
         ORDER BY "embedding" <=> $1::vector
         LIMIT $2`,
        literal,
        take,
      );
      return rows
        .filter((row) => Number.isFinite(Number(row.distance)))
        .map((row) => ({ chunkId: row.chunk_id, score: 1 - Number(row.distance) }));
    } catch (error) {
      this.logger.warn(
        `向量检索失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}

/** 数字数组转 pgvector 字面量；非有限值直接拒绝，避免把坏向量写入库 */
export function vectorLiteral(embedding: readonly number[]): string {
  if (embedding.length === 0) throw new Error('空向量不能写入');
  return `[${embedding
    .map((value) => {
      if (!Number.isFinite(value)) throw new Error('向量含非有限数值');
      return String(value);
    })
    .join(',')}]`;
}
