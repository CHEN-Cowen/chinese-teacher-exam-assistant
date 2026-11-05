/**
 * 百炼（阿里云 Model Studio）三路独立配置（W2）。
 *
 * Embedding / Rerank / Chat 各自有 URL、模型、超时，不做“一个开关全开”。
 * 密钥只从环境变量读取，不写入仓库、日志、前端产物。
 * 具体模型与接入点以账号实际开通为准；未配置时明确失败，不伪造接通。
 */
export const AI_CONFIG = Symbol('AI_CONFIG');

export interface AiConfig {
  enabled: boolean;
  /** 仅测试/演示可用；真实质量结论不得基于该模式 */
  mockMode: boolean;
  apiKey: string | null;
  embedding: {
    url: string;
    model: string;
    dimension: number;
    batchSize: number;
    timeoutMs: number;
  };
  rerank: {
    url: string;
    model: string;
    timeoutMs: number;
  };
  chat: {
    url: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
  };
  maxRetries: number;
  limits: {
    questionMaxChars: number;
    dailyRequestsPerUser: number;
    dailyRequestsPerIp: number;
    dailyRequestsGlobal: number;
    dailyTokensGlobal: number;
  };
}

function boolFromEnv(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function floatFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    enabled: boolFromEnv(env.AI_ENABLED),
    mockMode: boolFromEnv(env.AI_MOCK_MODE),
    apiKey: env.DASHSCOPE_API_KEY?.trim() || null,
    embedding: {
      url:
        env.BAILIAN_EMBEDDING_URL?.trim() ||
        'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
      model: env.BAILIAN_EMBEDDING_MODEL?.trim() || 'text-embedding-v4',
      dimension: intFromEnv(env.BAILIAN_EMBEDDING_DIM, 1024),
      batchSize: intFromEnv(env.BAILIAN_EMBEDDING_BATCH, 10),
      timeoutMs: intFromEnv(env.BAILIAN_EMBEDDING_TIMEOUT_MS, 20_000),
    },
    rerank: {
      url:
        env.BAILIAN_RERANK_URL?.trim() ||
        'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
      model: env.BAILIAN_RERANK_MODEL?.trim() || 'qwen3-rerank',
      timeoutMs: intFromEnv(env.BAILIAN_RERANK_TIMEOUT_MS, 15_000),
    },
    chat: {
      url:
        env.BAILIAN_CHAT_URL?.trim() ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: env.BAILIAN_CHAT_MODEL?.trim() || 'qwen-plus',
      temperature: floatFromEnv(env.BAILIAN_CHAT_TEMPERATURE, 0.1),
      maxTokens: intFromEnv(env.BAILIAN_CHAT_MAX_TOKENS, 900),
      timeoutMs: intFromEnv(env.BAILIAN_CHAT_TIMEOUT_MS, 30_000),
    },
    maxRetries: intFromEnv(env.BAILIAN_MAX_RETRIES, 1),
    limits: {
      questionMaxChars: intFromEnv(env.QA_QUESTION_MAX_CHARS, 200),
      dailyRequestsPerUser: intFromEnv(env.QA_DAILY_REQUESTS_PER_USER, 30),
      dailyRequestsPerIp: intFromEnv(env.QA_DAILY_REQUESTS_PER_IP, 20),
      dailyRequestsGlobal: intFromEnv(env.QA_DAILY_REQUESTS_GLOBAL, 2_000),
      dailyTokensGlobal: intFromEnv(env.QA_DAILY_TOKENS_GLOBAL, 500_000),
    },
  };
}
