import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from './auth.service.js';
import { SessionAuthGuard } from './session.guard.js';

function mockContext(
  path: string,
  cookies: Record<string, string> = {},
): ExecutionContext {
  const req: Record<string, unknown> = { cookies, path, route: { path } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const authService = {
  getSessionByToken: async (token: string) =>
    token === 'valid-sid'
      ? { userId: 'u-1', role: 'admin', email: 'admin@example.com', name: null }
      : null,
} as unknown as AuthService;

describe('SessionAuthGuard（invited 模式）', () => {
  const originalMode = process.env.AUTH_MODE;

  beforeEach(() => {
    process.env.AUTH_MODE = 'invited';
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalMode;
  });

  it('无会话时放行 /admin/bootstrap-admin：引导首个管理员必须匿名可达', async () => {
    const guard = new SessionAuthGuard(authService);
    await expect(
      guard.canActivate(mockContext('/admin/bootstrap-admin')),
    ).resolves.toBe(true);
  });

  it('无会话时放行既有公开路径 /health、/auth/login、/auth/session、/auth/register', async () => {
    const guard = new SessionAuthGuard(authService);
    for (const path of ['/health', '/auth/login', '/auth/session', '/auth/register']) {
      await expect(guard.canActivate(mockContext(path))).resolves.toBe(true);
    }
  });

  it('v7.1 M8：无会话时放行机会匹配与详情路径（访客预筛价值优先）', async () => {
    const guard = new SessionAuthGuard(authService);
    await expect(guard.canActivate(mockContext('/opportunities/match'))).resolves.toBe(true);
    await expect(
      guard.canActivate(mockContext('/opportunities/units/abc-123/detail')),
    ).resolves.toBe(true);
  });

  it('M01/F1：无会话时放行公开覆盖摘要 /opportunities/coverage', async () => {
    const guard = new SessionAuthGuard(authService);
    await expect(guard.canActivate(mockContext('/opportunities/coverage'))).resolves.toBe(true);
  });

  it('M01/F1：公开路径为精确匹配，类似前缀不得误放行', async () => {
    const guard = new SessionAuthGuard(authService);
    await expect(
      guard.canActivate(mockContext('/opportunities/coverage-other')),
    ).resolves.toBe(false);
    await expect(
      guard.canActivate(mockContext('/opportunities/coverage/admin')),
    ).resolves.toBe(false);
  });

  it('v7.1 M8：无会话时仍拦截需登录的机会接口（关注/订阅/目标/纠错）', async () => {
    const guard = new SessionAuthGuard(authService);
    await expect(guard.canActivate(mockContext('/opportunities/follows'))).resolves.toBe(false);
    await expect(
      guard.canActivate(mockContext('/opportunities/units/u-1/follow')),
    ).resolves.toBe(false);
    await expect(guard.canActivate(mockContext('/opportunities/subscription'))).resolves.toBe(false);
    await expect(
      guard.canActivate(mockContext('/opportunities/units/u-1/role')),
    ).resolves.toBe(false);
  });

  it('无会话访问受保护路径返回 false（Nest 转为 403）', async () => {
    const guard = new SessionAuthGuard(authService);
    await expect(guard.canActivate(mockContext('/profile'))).resolves.toBe(false);
  });

  it('有效会话 cookie 挂载 req.user 并放行受保护路径', async () => {
    const guard = new SessionAuthGuard(authService);
    const context = mockContext('/profile', { sid: 'valid-sid' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    const req = context.switchToHttp().getRequest() as {
      user?: { id: string; role: string };
    };
    expect(req.user).toMatchObject({ id: 'u-1', role: 'admin' });
  });

  it('demo 模式直接放行（身份由各控制器 UserGuard/AdminGuard 处理）', async () => {
    process.env.AUTH_MODE = 'demo';
    const guard = new SessionAuthGuard(authService);
    await expect(guard.canActivate(mockContext('/profile'))).resolves.toBe(true);
  });
});
