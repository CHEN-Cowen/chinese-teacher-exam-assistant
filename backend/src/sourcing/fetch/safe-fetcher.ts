/**
 * v7.2 工作包 3：官方来源安全获取（SafeFetcher，R-WP3-03）。
 *
 * 目标：在抓取官方公告前拦截 SSRF 与不安全响应（PRD 7.10 / 7.12）：
 * - 来源 host allowlist、协议校验、禁止带凭据 URL；
 * - 阻止 localhost/环回/私网/链路本地/云元数据地址，**DNS 解析后复查**；
 * - 每次重定向重新校验并把重定向次数限制在上限内；
 * - 连接超时与整体总超时、响应体大小上限、Content-Type 与 magic bytes 校验；
 * - 明确 User-Agent，记录 status/ETag/Last-Modified/哈希/耗时/字节数；
 * - 日志不写凭据或敏感 query 参数；
 * - 429/408/502/503/504 按策略退避重试，普通 4xx 不盲目重试。
 *
 * 依赖可注入（DNS 解析器 / fetch / sleep），以便在无网络的测试中确定性验证全部策略。
 */
import { createHash } from 'node:crypto';
import { lookup as defaultLookup } from 'node:dns/promises';

export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'PROTOCOL_NOT_ALLOWED'
  | 'URL_HAS_CREDENTIALS'
  | 'HOST_NOT_ALLOWED'
  | 'BLOCKED_HOST'
  | 'BLOCKED_IP'
  | 'DNS_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BAD_CONTENT_TYPE'
  | 'MAGIC_BYTES_MISMATCH'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(
    code: SafeFetchErrorCode,
    message: string,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface FetchResult {
  status: number;
  finalUrl: string;
  headers: {
    etag?: string;
    lastModified?: string;
    contentType?: string;
    contentEncoding?: string;
  };
  body: string;
  /** 原始响应字节：二进制附件（PDF/Excel）必须用它存储，body 仅用于文本处理 */
  bodyBytes: Buffer;
  /** SHA-256 内容指纹（对原始字节计算，同一内容哈希相同） */
  contentHash: string;
  mimeType: string;
  durationMs: number;
  redirects: number;
  bytes: number;
}

/** 条件请求头：命中 304 时不生成新快照 */
export interface ConditionalHeaders {
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

export interface SafeFetcherOptions {
  /** 来源 host allowlist；host 等于或为其子域时放行 */
  allowedHosts: readonly string[];
  maxRedirects?: number;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /** 'html'（默认）时校验 Content-Type 与 magic bytes；'any' 跳过内容类型校验 */
  expect?: 'html' | 'any';
  /** 请求 Accept 头（默认只接受 HTML；附件抓取应放宽，如 *斜杠星* 通配） */
  accept?: string;
  resolveDns?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
  retry?: { attempts: number; baseDelayMs: number };
  sleep?: (ms: number) => Promise<void>;
  /** 日志出口（默认丢弃）；只接收已脱敏文案 */
  log?: (line: string) => void;
  /** 跨 SafeFetcher 实例共享的进程内 host permit；不跨进程同步 */
  acquireHostPermit?: (
    host: string,
    concurrency: number,
  ) => Promise<() => void>;
  hostConcurrency?: number;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
]);

/** IPv4/IPv6 是否属于环回 / 私网 / 链路本地 / 元数据等封禁范围 */
export function isBlockedIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value.includes(':')) {
    if (value === '::1' || value === '::') return true;
    const first = value.split(':')[0];
    if (first.startsWith('fc') || first.startsWith('fd')) return true; // fc00::/7
    if (/^fe[89ab]/.test(first)) return true; // fe80::/10
    if (first.startsWith('ff')) return true; // ff00::/8
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  const parts = value.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n)))
    return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8,10/8,127/8
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a >= 224) return true; // 组播/保留
  return false;
}

function isIpLiteral(host: string): boolean {
  if (host.includes(':')) return true;
  return /^(\d{1,3})(\.\d{1,3}){3}$/.test(host);
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export class SafeFetcher {
  private readonly allowedHosts: string[];
  private readonly maxRedirects: number;
  private readonly connectTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly expect: 'html' | 'any';
  private readonly accept: string;
  private readonly resolveDns: (host: string) => Promise<string[]>;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: { attempts: number; baseDelayMs: number };
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly acquireHostPermit?: SafeFetcherOptions['acquireHostPermit'];
  private readonly hostConcurrency: number;

  constructor(options: SafeFetcherOptions) {
    this.allowedHosts = options.allowedHosts.map((h) => h.toLowerCase());
    this.maxRedirects = options.maxRedirects ?? 3;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 15000;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.userAgent =
      options.userAgent ?? 'JiaozhaoYoujuBot/1.0 (+official-source-fetch)';
    this.expect = options.expect ?? 'html';
    this.accept = options.accept ?? 'text/html,application/xhtml+xml';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.resolveDns =
      options.resolveDns ??
      (async (host) => {
        const records = await defaultLookup(host, {
          all: true,
          verbatim: true,
        });
        return records.map((r) => r.address);
      });
    this.retry = options.retry ?? { attempts: 3, baseDelayMs: 200 };
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? (() => undefined);
    this.acquireHostPermit = options.acquireHostPermit;
    this.hostConcurrency = options.hostConcurrency ?? 1;
  }

  async fetch(
    input: string,
    conditional: ConditionalHeaders = {},
  ): Promise<FetchResult> {
    const startedAt = Date.now();
    const deadline = startedAt + this.totalTimeoutMs;
    const attempts = Math.max(1, this.retry.attempts);
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.withDeadline(
          this.followOnce(input, deadline, startedAt, conditional),
          deadline,
        );
      } catch (error) {
        lastError = error;
        if (!this.isRetriable(error) || attempt === attempts - 1) throw error;
        const delay = this.retryDelay(error, attempt);
        this.log(`重试 ${attempt + 1}/${attempts - 1}（等待 ${delay}ms）`);
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  private isRetriable(error: unknown): boolean {
    return (
      error instanceof SafeFetchError &&
      error.code === 'HTTP_ERROR' &&
      error.status !== undefined &&
      RETRY_STATUS.has(error.status)
    );
  }

  private retryDelay(error: unknown, attempt: number): number {
    if (
      error instanceof SafeFetchError &&
      typeof error.retryAfterMs === 'number'
    ) {
      return error.retryAfterMs;
    }
    return this.retry.baseDelayMs * 2 ** attempt;
  }

  /** 沿重定向链逐跳校验；每一跳都重新执行全部安全检查 */
  private async followOnce(
    startUrl: string,
    deadline: number,
    startedAt: number,
    conditional: ConditionalHeaders,
  ): Promise<FetchResult> {
    let currentUrl = startUrl;
    let redirects = 0;

    for (;;) {
      const parsed = this.validateUrl(currentUrl);
      await this.assertHostSafe(parsed.hostname, deadline);

      const releasePermit = this.acquireHostPermit
        ? await this.acquireHostPermit(
            parsed.hostname.toLowerCase(),
            this.hostConcurrency,
          )
        : undefined;
      try {
        if (Date.now() >= deadline)
          throw new SafeFetchError('TIMEOUT', '等待同域许可超时');
        const response = await this.doFetch(
          currentUrl,
          deadline,
          currentUrl === startUrl ? conditional : {},
        );
        const status = response.status;

        if (REDIRECT_STATUS.has(status)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new SafeFetchError(
              'HTTP_ERROR',
              `重定向响应缺少 Location（${status}）`,
              status,
            );
          }
          redirects += 1;
          if (redirects > this.maxRedirects) {
            throw new SafeFetchError(
              'TOO_MANY_REDIRECTS',
              `重定向超过上限 ${this.maxRedirects} 次`,
            );
          }
          currentUrl = this.resolveRedirect(currentUrl, location);
          this.log(`重定向 ${redirects} 次 → ${redactUrl(currentUrl)}`);
          continue;
        }

        if (status === 304) {
          return {
            status,
            finalUrl: currentUrl,
            headers: this.pickHeaders(response),
            body: '',
            bodyBytes: Buffer.alloc(0),
            contentHash: sha256(''),
            mimeType: '',
            durationMs: Date.now() - startedAt,
            redirects,
            bytes: 0,
          };
        }

        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(
            response.headers.get('retry-after'),
          );
          throw new SafeFetchError(
            'HTTP_ERROR',
            `上游返回 ${status}`,
            status,
            retryAfterMs,
          );
        }

        const { buffer, body, bytes } = await this.readBody(response, deadline);
        const headers = this.pickHeaders(response);
        const mimeType = (headers.contentType ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        this.assertContentLooksHtml(body, mimeType);

        return {
          status,
          finalUrl: currentUrl,
          headers,
          body,
          bodyBytes: buffer,
          contentHash: sha256(buffer),
          mimeType,
          durationMs: Date.now() - startedAt,
          redirects,
          bytes,
        };
      } finally {
        releasePermit?.();
      }
    }
  }

  private validateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SafeFetchError('INVALID_URL', `不是合法 URL：${raw}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SafeFetchError(
        'PROTOCOL_NOT_ALLOWED',
        `仅允许 http/https：${url.protocol}`,
      );
    }
    if (url.username || url.password) {
      throw new SafeFetchError('URL_HAS_CREDENTIALS', 'URL 禁止携带凭据');
    }
    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
      throw new SafeFetchError(
        'BLOCKED_HOST',
        `禁止访问本地/元数据主机：${host}`,
      );
    }
    if (!this.hostAllowed(host)) {
      throw new SafeFetchError(
        'HOST_NOT_ALLOWED',
        `host 不在 allowlist：${host}`,
      );
    }
    return url;
  }

  private hostAllowed(host: string): boolean {
    return this.allowedHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  }

  /** DNS 解析后复查全部 A/AAAA 记录，任一命中封禁网段即拒绝 */
  private async assertHostSafe(host: string, deadline: number): Promise<void> {
    const addresses = isIpLiteral(host)
      ? [host]
      : await this.withDeadline(
          this.resolveDns(host).catch((error) => {
            throw new SafeFetchError(
              'DNS_FAILED',
              `DNS 解析失败（${host}）：${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }),
          deadline,
        );
    if (addresses.length === 0) {
      throw new SafeFetchError('DNS_FAILED', `DNS 无解析结果：${host}`);
    }
    for (const address of addresses) {
      if (isBlockedIp(address)) {
        throw new SafeFetchError(
          'BLOCKED_IP',
          `解析到受限地址 ${address}（${host}）`,
        );
      }
    }
  }

  private resolveRedirect(base: string, location: string): string {
    try {
      return new URL(location, base).toString();
    } catch {
      throw new SafeFetchError('INVALID_URL', `非法的重定向目标：${location}`);
    }
  }

  private async doFetch(
    url: string,
    deadline: number,
    conditional: ConditionalHeaders = {},
  ): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SafeFetchError('TIMEOUT', '整体请求超时');
    }
    const controller = new AbortController();
    const timeout = Math.min(this.connectTimeoutMs, remaining);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': this.userAgent,
          accept: this.accept,
          ...(conditional.ifNoneMatch
            ? { 'if-none-match': conditional.ifNoneMatch }
            : {}),
          ...(conditional.ifModifiedSince
            ? { 'if-modified-since': conditional.ifModifiedSince }
            : {}),
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SafeFetchError(
          'TIMEOUT',
          `连接或读取超时（timeout=${timeout}ms）`,
        );
      }
      throw new SafeFetchError(
        'NETWORK_ERROR',
        `网络请求失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async readBody(
    response: Response,
    deadline: number,
  ): Promise<{ buffer: Buffer; body: string; bytes: number }> {
    const stream = response.body as
      ReadableStream<Uint8Array> | null | undefined;
    const chunks: Uint8Array[] = [];
    let total = 0;

    if (stream && typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await this.withDeadline(
            reader.read(),
            deadline,
          );
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > this.maxBytes) {
            throw new SafeFetchError(
              'TOO_LARGE',
              `响应体超过上限 ${this.maxBytes} 字节`,
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock?.();
      }
    } else if (typeof response.arrayBuffer === 'function') {
      const buffer = Buffer.from(
        await this.withDeadline(response.arrayBuffer(), deadline),
      );
      total = buffer.byteLength;
      if (total > this.maxBytes) {
        throw new SafeFetchError(
          'TOO_LARGE',
          `响应体超过上限 ${this.maxBytes} 字节`,
        );
      }
      chunks.push(buffer);
    } else {
      throw new SafeFetchError('NETWORK_ERROR', '响应没有可读的响应体');
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return { buffer, body: buffer.toString('utf8'), bytes: total };
  }

  /** Content-Type 与 magic bytes 校验：明显非 HTML 立即失败 */
  private assertContentLooksHtml(body: string, mimeType: string): void {
    if (this.expect === 'any') return;
    const htmlMimes = ['text/html', 'application/xhtml+xml'];
    if (!htmlMimes.includes(mimeType)) {
      throw new SafeFetchError(
        'BAD_CONTENT_TYPE',
        `期望 HTML，实际 Content-Type=${mimeType || '(缺失)'}`,
      );
    }
    const head = body.slice(0, 512).trimStart().toLowerCase();
    if (!head.startsWith('<')) {
      throw new SafeFetchError(
        'MAGIC_BYTES_MISMATCH',
        '响应内容不以 HTML 标签开头，疑似二进制或错误页',
      );
    }
  }

  private pickHeaders(response: Response): FetchResult['headers'] {
    return {
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      contentType: response.headers.get('content-type') ?? undefined,
      contentEncoding: response.headers.get('content-encoding') ?? undefined,
    };
  }

  private async withDeadline<T>(
    promise: Promise<T>,
    deadline: number,
  ): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SafeFetchError('TIMEOUT', '整体请求超时');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SafeFetchError('TIMEOUT', '整体请求超时')),
            remaining,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** 日志脱敏：只保留协议 + host + path，丢弃 query 中的敏感参数与凭据 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '(非法 URL)';
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return undefined;
}
