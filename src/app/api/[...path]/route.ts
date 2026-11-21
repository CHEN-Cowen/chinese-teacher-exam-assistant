import { NextRequest, NextResponse } from 'next/server';

// 始终动态执行，不缓存任何上游响应
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
const INVITED_PROXY_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_MODE === 'invited' &&
  process.env.NEXT_PUBLIC_APP_ENV !== 'demo' &&
  process.env.NEXT_PUBLIC_DEMO_MODE !== 'true';

type ForwardMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
  // 公开 demo 的身份只在浏览器本机有效，绝不能拿它调用受保护的后端。
  if (!INVITED_PROXY_ENABLED || !BACKEND_URL || !INTERNAL_TOKEN) {
    return NextResponse.json(
      { error: 'proxy not configured' },
      { status: 503 },
    );
  }

  const { path: segments } = await context.params;
  const target = `${BACKEND_URL.replace(/\/$/, '')}/${(segments ?? []).join('/')}`;

  // 透传查询参数
  const search = request.nextUrl.search;
  const url = `${target}${search}`;

  // 仅转发必要的请求头，避免 host/content-length 等污染上游
  const headers = new Headers();
  const passthrough = [
    'content-type',
    'accept',
    'accept-language',
    'cookie',
    'user-agent',
  ];
  for (const name of passthrough) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // M03/F5：把可信代理链的转发头传给后端，让 trust proxy 解析出真实
  // 协议与客户端 IP（req.secure → 会话 cookie 的 Secure 标志）。
  // 到达这里的 x-forwarded-* 已由 Caddy 重写（proto 覆写、for 追加），
  // 浏览器伪造值不会存活；后端 trust proxy=1 只信任 Next.js 这一跳。
  // 缺省（如本地明文直跑）则不转发，后端按非安全链路拒绝正式登录。
  for (const name of ['x-forwarded-proto', 'x-forwarded-for']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-internal-token', INTERNAL_TOKEN);

  const method = request.method.toUpperCase() as ForwardMethod;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(url, { method, headers, body, cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'upstream unreachable' }, { status: 502 });
  }

  // fetch 已自动解压，删除可能导致二次解码错误的头
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  const buffer = Buffer.from(await upstream.arrayBuffer());
  return new NextResponse(buffer, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
