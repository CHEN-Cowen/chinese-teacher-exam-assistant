import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_CONFIG, type AiConfig } from './ai.config.js';
import { AiError, isRetryableAiError } from './ai.errors.js';

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimension: number;
  /** 供应商返回的 token 用量（无则 null） */
  tokens: number | null;
  mode: 'real' | 'mock';
}

export interface RerankResult {
  index: number;
  score: number;
  mode: 'real' | 'mock';
}

export interface ChatResult {
  text: string;
  model: string;
  tokens: number | null;
  mode: 'real' | 'mock';
}

const TOKEN_SPLIT = /[a-z0-9]+|[\u4e00-\u9fff]/gi;

/** 语言无关的稳定哈希，用于 Mock 向量（不得用于生产语义检索）。 */
function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mockEmbedding(text: string, dimension: number): number[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const tokens = normalized.match(TOKEN_SPLIT) ?? [];
  const chars = Array.from(normalized.replace(/\s/g, ''));
  const features: string[] = [...tokens];
  for (let i = 0; i < chars.length - 1; i += 1) {
    features.push(`${chars[i]}${chars[i + 1]}`);
  }
  const vector = Array.from({ length: dimension }, () => 0);
  for (const feature of features) {
    const hash = hashToken(feature);
    const index = hash % dimension;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function lexicalTokens(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(TOKEN_SPLIT) ?? []).filter(
    (token) => token.length > 0,
  );
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  readonly mode: 'off' | 'mock' | 'real';

  constructor(@Inject(AI_CONFIG) readonly config: AiConfig) {
    if (!config.enabled) {
      this.mode = 'off';
    } else if (config.mockMode) {
      this.mode = 'mock';
    } else if (config.apiKey) {
      this.mode = 'real';
    } else {
      // 开启但缺 Key：保持 off，调用时明确报 not_configured，避免误报接通。
      this.mode = 'off';
    }
  }

  get available(): boolean {
    return this.mode !== 'off';
  }

  /** 供管理端/健康检查展示，不包含密钥。 */
  describe(): Record<string, unknown> {
    return {
      enabled: this.config.enabled,
      mode: this.mode,
      keyConfigured: this.config.apiKey !== null,
      embedding: {
        model: this.config.embedding.model,
        dimension: this.config.embedding.dimension,
        url: this.config.embedding.url,
      },
      rerank: { model: this.config.rerank.model, url: this.config.rerank.url },
      chat: { model: this.config.chat.model, url: this.config.chat.url },
    };
  }

  private requireMode(): 'mock' | 'real' {
    if (this.mode === 'off') {
      throw this.config.enabled
        ? new AiError('not_configured', '已开启 AI 但未配置 DASHSCOPE_API_KEY')
        : new AiError('ai_disabled', 'AI 未启用（AI_ENABLED=false）');
    }
    return this.mode;
  }

  async embed(
    texts: readonly string[],
    textType: 'document' | 'query' = 'document',
  ): Promise<EmbeddingResult> {
    const mode = this.requireMode();
    const { dimension, batchSize } = this.config.embedding;
    const vectors: number[][] = [];
    let tokens = 0;
    if (mode === 'mock') {
      for (const text of texts) {
        vectors.push(mockEmbedding(text, dimension));
      }
      return { vectors, model: 'mock-hash-1024', dimension, tokens: null, mode };
    }
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize);
      const result = await this.requestEmbedding(batch, textType);
      vectors.push(...result.vectors);
      tokens += result.tokens ?? 0;
    }
    return {
      vectors,
      model: this.config.embedding.model,
      dimension,
      tokens: tokens > 0 ? tokens : null,
      mode,
    };
  }

  private async requestEmbedding(
    texts: readonly string[],
    textType: 'document' | 'query',
  ): Promise<{ vectors: number[][]; tokens: number | null }> {
    const payload = {
      model: this.config.embedding.model,
      input: { texts: [...texts] },
      parameters: {
        dimension: this.config.embedding.dimension,
        text_type: textType,
      },
    };
    const body = await this.fetchJson(
      this.config.embedding.url,
      payload,
      this.config.embedding.timeoutMs,
      'embedding',
    );
    const output = body.output as { embeddings?: unknown } | undefined;
    const raw = output?.embeddings;
    if (!Array.isArray(raw) || raw.length !== texts.length) {
      throw new AiError('invalid_response', 'Embedding 返回条数与输入不一致');
    }
    const vectors = raw.map((item, index) => {
      const embedding = (item as { embedding?: unknown })?.embedding;
      if (
        !Array.isArray(embedding) ||
        embedding.length !== this.config.embedding.dimension ||
        !embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        throw new AiError(
          'invalid_response',
          `Embedding 第 ${index + 1} 条维度异常`,
        );
      }
      return embedding as number[];
    });
    const usage = body.usage as { total_tokens?: unknown } | undefined;
    return {
      vectors,
      tokens:
        typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
    };
  }

  async rerank(
    query: string,
    documents: readonly string[],
    topN?: number,
  ): Promise<{ results: RerankResult[]; tokens: number | null }> {
    const mode = this.requireMode();
    if (mode === 'mock') {
      const queryTokens = lexicalTokens(query);
      const results = documents
        .map((document, index) => {
          const tokens = lexicalTokens(document);
          const hit = queryTokens.filter((token) => tokens.includes(token)).length;
          const score =
            queryTokens.length === 0
              ? 0
              : hit / Math.sqrt(tokens.length + 1) / Math.sqrt(queryTokens.length);
          return { index, score, mode } as RerankResult;
        })
        .sort((a, b) => b.score - a.score);
      return {
        results: results.slice(0, topN ?? results.length),
        tokens: null,
      };
    }
    const payload = {
      model: this.config.rerank.model,
      input: { query, documents: [...documents] },
      parameters: { return_documents: false, ...(topN ? { top_n: topN } : {}) },
    };
    const body = await this.fetchJson(
      this.config.rerank.url,
      payload,
      this.config.rerank.timeoutMs,
      'rerank',
    );
    const output = body.output as { results?: unknown } | undefined;
    if (!Array.isArray(output?.results)) {
      throw new AiError('invalid_response', 'Rerank 返回结构异常');
    }
    const results = output.results.map((item) => {
      const hit = item as { index?: unknown; relevance_score?: unknown };
      if (
        typeof hit.index !== 'number' ||
        typeof hit.relevance_score !== 'number'
      ) {
        throw new AiError('invalid_response', 'Rerank 结果字段异常');
      }
      return { index: hit.index, score: hit.relevance_score, mode } as RerankResult;
    });
    const usage = body.usage as { total_tokens?: unknown } | undefined;
    return {
      results,
      tokens:
        typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
    };
  }

  async chat(
    messages: ReadonlyArray<{ role: 'system' | 'user'; content: string }>,
  ): Promise<ChatResult> {
    const mode = this.requireMode();
    if (mode === 'mock') {
      throw new AiError(
        'invalid_response',
        'Mock 模式不调用 Chat；由问答服务使用抽取式回答',
      );
    }
    const payload = {
      model: this.config.chat.model,
      messages: [...messages],
      temperature: this.config.chat.temperature,
      max_tokens: this.config.chat.maxTokens,
    };
    const body = await this.fetchJson(
      this.config.chat.url,
      payload,
      this.config.chat.timeoutMs,
      'chat',
    );
    const choices = body.choices as
      | Array<{ message?: { content?: unknown } }>
      | undefined;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AiError('invalid_response', 'Chat 返回空内容');
    }
    const usage = body.usage as { total_tokens?: unknown } | undefined;
    return {
      text: content.trim(),
      model: this.config.chat.model,
      tokens:
        typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
      mode,
    };
  }

  private async fetchJson(
    url: string,
    payload: unknown,
    timeoutMs: number,
    label: string,
  ): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        return await this.fetchOnce(url, payload, timeoutMs, label);
      } catch (error) {
        lastError = error;
        if (!isRetryableAiError(error) || attempt === this.config.maxRetries) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async fetchOnce(
    url: string,
    payload: unknown,
    timeoutMs: number,
    label: string,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey ?? ''}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status;
        const retryable = status === 429 || status >= 500;
        this.logger.warn(
          `Bailian ${label} failed status=${status} costMs=${Date.now() - startedAt}`,
        );
        throw new AiError(
          status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
          `模型服务返回 HTTP ${status}`,
          retryable,
        );
      }
      const body = (await response.json()) as Record<string, unknown>;
      this.logger.log(
        `Bailian ${label} ok costMs=${Date.now() - startedAt} model=${String(
          this.config[
            label === 'embedding'
              ? 'embedding'
              : label === 'rerank'
                ? 'rerank'
                : 'chat'
          ].model,
        )}`,
      );
      return body;
    } catch (error) {
      if (error instanceof AiError) throw error;
      if ((error as { name?: string }).name === 'AbortError') {
        throw new AiError('provider_timeout', '模型服务请求超时', true);
      }
      throw new AiError('provider_unavailable', '模型服务网络不可用', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
