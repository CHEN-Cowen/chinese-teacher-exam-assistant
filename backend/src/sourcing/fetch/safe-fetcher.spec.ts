/**
 * SafeFetcher 单元测试（v7.2 工作包 3 / R-WP3-03）。
 *
 * 全部依赖注入（fetch / DNS / sleep / log），不触网、不放任真等待，
 * 逐条验证 SSRF 拦截、重定向逐跳复查、超时、限流、内容校验与脱敏。
 */
import { describe, expect, it } from 'vitest';
import {
  SafeFetcher,
  SafeFetchError,
  isBlockedIp,
  redactUrl,
  type SafeFetcherOptions,
} from './safe-fetcher.js';

const PUBLIC_IP = '93.184.216.34';
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

const htmlResponse = (
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) =>
  new Response(body, {
    status: init.status ?? 200,
    headers: { ...HTML_HEADERS, ...init.headers },
  });

const redirectResponse = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

type Responder = (
  url: string,
  init: RequestInit,
) => Response | Promise<Response>;

/** 用响应工厂构造 fetchImpl，并记录每次请求的 URL */
function makeFetch(responder: Responder) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    return responder(url, init ?? {});
  };
  return { impl, calls };
}

function makeFetcher(overrides: Partial<SafeFetcherOptions> = {}): SafeFetcher {
  return new SafeFetcher({
    allowedHosts: ['allow.host'],
    resolveDns: async () => [PUBLIC_IP],
    sleep: async () => {},
    ...overrides,
  });
}

/** 捕获 fetch() 抛出的 SafeFetchError（不匹配时直接让测试失败） */
async function captureError(
  promise: Promise<unknown>,
): Promise<SafeFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafeFetchError) return error;
    throw error;
  }
  throw new Error('期望 fetch() 抛出 SafeFetchError，但调用成功返回');
}

describe('isBlockedIp（纯函数：环回/私网/链路本地/元数据/组播）', () => {
  it.each([
    '169.254.169.254', // 云元数据
    '127.0.0.1', // 环回
    '10.0.0.5', // 私网 10/8
    '192.168.1.10', // 私网 192.168/16
    '172.16.0.1', // 私网 172.16/12
    '100.64.0.1', // CGNAT
    '224.0.0.1', // 组播
  ])('封禁 IPv4 %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
  ])('封禁 IPv6 %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['203.0.113.10', '8.8.8.8', '93.184.216.34', '2606:4700::1111'])(
    '放行公网地址 %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it('识别 IPv4-mapped IPv6 私网地址', () => {
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
  });
});

describe('URL 校验（validateUrl）', () => {
  it('host 不在 allowlist → HOST_NOT_ALLOWED', async () => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({ fetchImpl: impl }).fetch('https://other.host/'),
    );
    expect(error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('非 http/https 协议 → PROTOCOL_NOT_ALLOWED', async () => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({ fetchImpl: impl }).fetch('ftp://allow.host/'),
    );
    expect(error.code).toBe('PROTOCOL_NOT_ALLOWED');
  });

  it('URL 携带凭据 → URL_HAS_CREDENTIALS', async () => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({ fetchImpl: impl }).fetch('https://u:p@allow.host/'),
    );
    expect(error.code).toBe('URL_HAS_CREDENTIALS');
  });

  it.each([
    'http://localhost/',
    'http://metadata.google.internal/',
    'http://x.localhost/',
  ])('本地/元数据主机即使被 allowlist 命中仍拒绝：%s', async (url) => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const host = new URL(url).hostname;
    const error = await captureError(
      makeFetcher({ allowedHosts: [host], fetchImpl: impl }).fetch(url),
    );
    expect(error.code).toBe('BLOCKED_HOST');
  });
});

describe('DNS 解析后复查（SSRF / DNS rebinding）', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.10',
    '172.16.0.1',
    '169.254.169.254',
    '::1',
  ])('解析到受限地址即拒绝：%s → BLOCKED_IP', async (ip) => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({ fetchImpl: impl, resolveDns: async () => [ip] }).fetch(
        'https://allow.host/',
      ),
    );
    expect(error.code).toBe('BLOCKED_IP');
  });

  it('allowlist 合法域名解析到私网 → BLOCKED_IP（解析后复查，防 rebinding）', async () => {
    const { impl, calls } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({
        fetchImpl: impl,
        resolveDns: async () => ['169.254.169.254'],
      }).fetch('https://allow.host/'),
    );
    expect(error.code).toBe('BLOCKED_IP');
    expect(calls).toHaveLength(0); // 未通过复查，绝不发起请求
  });

  it('DNS 无解析结果 → DNS_FAILED', async () => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({ fetchImpl: impl, resolveDns: async () => [] }).fetch(
        'https://allow.host/',
      ),
    );
    expect(error.code).toBe('DNS_FAILED');
  });

  it('IP 字面量 host：命中 allowlist 仍因私网被拒 → BLOCKED_IP', async () => {
    const { impl } = makeFetch(() => htmlResponse('<html></html>'));
    const error = await captureError(
      makeFetcher({ allowedHosts: ['127.0.0.1'], fetchImpl: impl }).fetch(
        'http://127.0.0.1/',
      ),
    );
    expect(error.code).toBe('BLOCKED_IP');
  });
});

describe('重定向逐跳复查与次数上限', () => {
  it('302 跟随到跨子域 allowlist host 的 200 → status/redirects 正确', async () => {
    let call = 0;
    const { impl } = makeFetch(() =>
      call++ === 0
        ? redirectResponse('https://sub.allow.host/dest')
        : htmlResponse('<html>ok</html>'),
    );
    const result = await makeFetcher({ fetchImpl: impl }).fetch(
      'https://allow.host/start',
    );
    expect(result.status).toBe(200);
    expect(result.redirects).toBe(1);
    expect(result.finalUrl).toBe('https://sub.allow.host/dest');
  });

  it('302 跳到非 allowlist host → HOST_NOT_ALLOWED', async () => {
    let call = 0;
    const { impl } = makeFetch(() =>
      call++ === 0
        ? redirectResponse('https://outside.example/')
        : htmlResponse('<html>ok</html>'),
    );
    const error = await captureError(
      makeFetcher({ fetchImpl: impl }).fetch('https://allow.host/'),
    );
    expect(error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('302 跳到解析为私网的主机 → BLOCKED_IP（逐跳复查）', async () => {
    const { impl } = makeFetch(() =>
      redirectResponse('https://private.allow.host/'),
    );
    const error = await captureError(
      makeFetcher({
        fetchImpl: impl,
        resolveDns: async (host) =>
          host === 'allow.host' ? [PUBLIC_IP] : ['10.0.0.5'],
      }).fetch('https://allow.host/'),
    );
    expect(error.code).toBe('BLOCKED_IP');
  });

  it('重定向超过 maxRedirects 上限 → TOO_MANY_REDIRECTS', async () => {
    const { impl, calls } = makeFetch(() =>
      redirectResponse('https://allow.host/next'),
    );
    const error = await captureError(
      makeFetcher({ fetchImpl: impl, maxRedirects: 2 }).fetch(
        'https://allow.host/',
      ),
    );
    expect(error.code).toBe('TOO_MANY_REDIRECTS');
    expect(calls).toHaveLength(3); // 首跳 + 2 次跟随后第 3 跳越界
  });
});

describe('超时控制', () => {
  it('连接超时 → TIMEOUT（signal abort 触发）', async () => {
    const hangUntilAbort = ((_url: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      })) as typeof fetch;
    const error = await captureError(
      makeFetcher({ fetchImpl: hangUntilAbort, connectTimeoutMs: 20 }).fetch(
        'https://allow.host/',
      ),
    );
    expect(error.code).toBe('TIMEOUT');
  });

  it('总超时：读体永不 yield → TIMEOUT', async () => {
    const hangingBody = () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: HTML_HEADERS,
      });
    const { impl } = makeFetch(() => hangingBody());
    const error = await captureError(
      makeFetcher({
        fetchImpl: impl,
        totalTimeoutMs: 30,
        connectTimeoutMs: 5000,
      }).fetch('https://allow.host/'),
    );
    expect(error.code).toBe('TIMEOUT');
  });
});

describe('响应体大小与内容校验', () => {
  it('响应体超过 maxBytes → TOO_LARGE', async () => {
    const long = `<html>${'a'.repeat(200)}</html>`;
    const { impl } = makeFetch(() => htmlResponse(long));
    const error = await captureError(
      makeFetcher({ fetchImpl: impl, maxBytes: 64 }).fetch(
        'https://allow.host/',
      ),
    );
    expect(error.code).toBe('TOO_LARGE');
  });

  it('错误 MIME（application/json）→ BAD_CONTENT_TYPE', async () => {
    const { impl } = makeFetch(
      () =>
        new Response('<html>ok</html>', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const error = await captureError(
      makeFetcher({ fetchImpl: impl }).fetch('https://allow.host/'),
    );
    expect(error.code).toBe('BAD_CONTENT_TYPE');
  });

  it.each(['PK\u0003\u0004binary', 'plain text not html'])(
    'magic bytes 非 HTML 开头 → MAGIC_BYTES_MISMATCH：%j',
    async (body) => {
      const { impl } = makeFetch(() => htmlResponse(body));
      const error = await captureError(
        makeFetcher({ fetchImpl: impl }).fetch('https://allow.host/'),
      );
      expect(error.code).toBe('MAGIC_BYTES_MISMATCH');
    },
  );

  it("expect:'any' 跳过内容校验并成功返回", async () => {
    const { impl } = makeFetch(
      () =>
        new Response('PK\u0003\u0004binary', {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    );
    const result = await makeFetcher({ fetchImpl: impl, expect: 'any' }).fetch(
      'https://allow.host/',
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe('PK\u0003\u0004binary');
  });

  it('304 特判：status=304、空体、bytes=0', async () => {
    const { impl } = makeFetch(() => new Response(null, { status: 304 }));
    const result = await makeFetcher({ fetchImpl: impl }).fetch(
      'https://allow.host/',
    );
    expect(result.status).toBe(304);
    expect(result.body).toBe('');
    expect(result.bytes).toBe(0);
  });
});

describe('重试策略', () => {
  it('429 带 Retry-After:1 退避重试，第二次成功', async () => {
    const waits: number[] = [];
    let call = 0;
    const { impl, calls } = makeFetch(() => {
      call += 1;
      return call === 1
        ? new Response('retry later', {
            status: 429,
            headers: { 'retry-after': '1' },
          })
        : htmlResponse('<html>ok</html>');
    });
    const result = await makeFetcher({
      fetchImpl: impl,
      retry: { attempts: 3, baseDelayMs: 1 },
      sleep: async (ms) => {
        waits.push(ms);
      },
    }).fetch('https://allow.host/');

    expect(result.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it.each([408, 502, 503, 504])(
    '对可重试状态 %i 按退避策略重试后成功',
    async (status) => {
      const waits: number[] = [];
      let call = 0;
      const { impl, calls } = makeFetch(() => {
        call += 1;
        return call === 1
          ? new Response('err', { status })
          : htmlResponse('<html>ok</html>');
      });
      const result = await makeFetcher({
        fetchImpl: impl,
        retry: { attempts: 3, baseDelayMs: 1 },
        sleep: async (ms) => {
          waits.push(ms);
        },
      }).fetch('https://allow.host/');

      expect(result.status).toBe(200);
      expect(calls).toHaveLength(2);
      expect(waits).toEqual([1]); // baseDelayMs * 2^0
    },
  );

  it('普通 4xx（404）不重试，只调用一次', async () => {
    const { impl, calls } = makeFetch(
      () => new Response('not found', { status: 404 }),
    );
    const error = await captureError(
      makeFetcher({
        fetchImpl: impl,
        retry: { attempts: 3, baseDelayMs: 1 },
      }).fetch('https://allow.host/'),
    );
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

describe('结果记录与脱敏', () => {
  it('相同内容 contentHash 相同，不同内容哈希不同', async () => {
    const bodies: Record<string, string> = {
      'https://allow.host/one': '<html>one</html>',
      'https://allow.host/two': '<html>two</html>',
    };
    const { impl } = makeFetch((url) => htmlResponse(bodies[url] ?? '<html/>'));
    const fetcher = makeFetcher({ fetchImpl: impl });

    const first = await fetcher.fetch('https://allow.host/one');
    const again = await fetcher.fetch('https://allow.host/one');
    const other = await fetcher.fetch('https://allow.host/two');

    expect(first.contentHash).toBe(again.contentHash);
    expect(first.contentHash).not.toBe(other.contentHash);
    expect(first.mimeType).toBe('text/html');
    expect(first.bytes).toBe(
      Buffer.byteLength(bodies['https://allow.host/one'], 'utf8'),
    );
  });

  it('记录 etag / last-modified 头', async () => {
    const { impl } = makeFetch(
      () =>
        new Response('<html>ok</html>', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            etag: '"abc123"',
            'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT',
          },
        }),
    );
    const result = await makeFetcher({ fetchImpl: impl }).fetch(
      'https://allow.host/',
    );
    expect(result.headers.etag).toBe('"abc123"');
    expect(result.headers.lastModified).toBe('Wed, 01 Jan 2026 00:00:00 GMT');
  });

  it('日志脱敏：重定向日志不泄露 query token，且保留 host', async () => {
    const logs: string[] = [];
    let call = 0;
    const { impl } = makeFetch(() =>
      call++ === 0
        ? redirectResponse('https://allow.host/page?token=SECRET123')
        : htmlResponse('<html>ok</html>'),
    );
    const result = await makeFetcher({
      fetchImpl: impl,
      log: (line) => logs.push(line),
    }).fetch('https://allow.host/start');

    const joined = logs.join('\n');
    expect(result.status).toBe(200);
    expect(joined).not.toContain('SECRET123');
    expect(joined).toContain('allow.host');
  });

  it('redactUrl 丢弃凭据与 query，仅保留协议+host+path', () => {
    expect(
      redactUrl('https://user:pass@allow.host/notice?id=1&token=SECRET123'),
    ).toBe('https://allow.host/notice');
    expect(redactUrl('not a url')).toBe('(非法 URL)');
  });
});

describe('Referer 头（附件防盗链）', () => {
  it('同源 Referer 原样透传', async () => {
    let seen: Record<string, string> = {};
    const { impl } = makeFetch((_url, init) => {
      seen = (init.headers ?? {}) as Record<string, string>;
      return htmlResponse('<html>ok</html>');
    });
    await makeFetcher({ fetchImpl: impl }).fetch(
      'https://allow.host/uploadfile/a.xlsx',
      {},
      { referer: 'https://allow.host/html/notice.html' },
    );
    expect(seen.referer).toBe('https://allow.host/html/notice.html');
  });

  it('跨源 Referer 被丢弃，不外发本站路径', async () => {
    let seen: Record<string, string> = {};
    const { impl } = makeFetch((_url, init) => {
      seen = (init.headers ?? {}) as Record<string, string>;
      return htmlResponse('<html>ok</html>');
    });
    await makeFetcher({ fetchImpl: impl }).fetch(
      'https://allow.host/uploadfile/a.xlsx',
      {},
      { referer: 'https://evil.host/page' },
    );
    expect(seen.referer).toBeUndefined();
  });

  it('非法 Referer 字符串被丢弃且不影响正常抓取', async () => {
    let seen: Record<string, string> = {};
    const { impl } = makeFetch((_url, init) => {
      seen = (init.headers ?? {}) as Record<string, string>;
      return htmlResponse('<html>ok</html>');
    });
    const result = await makeFetcher({ fetchImpl: impl }).fetch(
      'https://allow.host/uploadfile/a.xlsx',
      {},
      { referer: 'not-a-url' },
    );
    expect(result.status).toBe(200);
    expect(seen.referer).toBeUndefined();
  });

  it('未提供 Referer 时不发送该头', async () => {
    let seen: Record<string, string> = {};
    const { impl } = makeFetch((_url, init) => {
      seen = (init.headers ?? {}) as Record<string, string>;
      return htmlResponse('<html>ok</html>');
    });
    await makeFetcher({ fetchImpl: impl }).fetch('https://allow.host/page');
    expect(seen.referer).toBeUndefined();
  });
});
