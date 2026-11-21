export type AiErrorCode =
  | 'ai_disabled'
  | 'not_configured'
  | 'provider_rejected'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_response';

/** 可被上层映射为 HTTP 状态与用户可读提示；不包含密钥或材料正文。 */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function isRetryableAiError(error: unknown): boolean {
  return error instanceof AiError && error.retryable;
}
