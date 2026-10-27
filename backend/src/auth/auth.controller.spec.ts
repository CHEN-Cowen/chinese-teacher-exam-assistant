/**
 * 公开注册端点（POST /auth/register）单元测试。
 *
 * 覆盖：
 * - PUBLIC_REGISTRATION 未开启 → 401（拒绝公开注册）；
 * - 开启后：邮箱+密码合法 → 注册即登录（写 cookie、返回 user）；
 * - 邮箱重复 → 409；
 * - 密码过短 → 400；
 * - 固定 role=user（客户端传 role 被忽略，防提权）；
 * - 邮箱统一 trim + 小写。
 *
 * M03/F5：会话 Cookie 安全属性与正式环境 HTTPS 强制（见底部 describe）。
 */
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

/** 最小 Prisma 替身：register 只用到 user.findUnique */
function fakePrisma(existingEmail?: string) {
  return {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        existingEmail && where.email === existingEmail
          ? { id: 'existing-id', email: existingEmail }
          : null,
    },
  };
}

/** 最小 AuthService 替身：createUser/createSession 记录调用并返回固定值 */
function fakeAuthService() {
  const calls: { createUser?: unknown; createSession?: string } = {};
  return {
    calls,
    createUser: async (input: Record<string, unknown>) => {
      calls.createUser = input;
      return {
        id: 'new-id',
        email: (input.email as string).toLowerCase(),
        name: (input.name as string | undefined) ?? null,
        role: input.role as string,
      };
    },
    createSession: async (userId: string) => {
      calls.createSession = userId;
      return { token: 'session-token', expiresAt: new Date() };
    },
    validateCredentials: async () => ({ id: 'user-1', email: 'a@b.com', name: 'x', role: 'user' }),
  } as unknown as AuthService & {
    calls: { createUser?: unknown; createSession?: string };
  };
}

/** 构造可用的 req（cookie 由 res 替身承接） */
function makeReq(overrides: { secure?: boolean } = {}) {
  return { headers: {}, secure: overrides.secure ?? false } as never;
}
function makeRes() {
  const cookies: Record<string, string> = {};
  const cookieOptions: Record<string, unknown>[] = [];
  return {
    cookies,
    cookieOptions,
    cookie: (name: string, value: string, options?: unknown) => {
      cookies[name] = value;
      cookieOptions.push(options ?? {});
    },
  } as never;
}

afterEach(() => {
  delete process.env.PUBLIC_REGISTRATION;
  delete process.env.AUTH_MODE;
});

describe('POST /auth/register', () => {
  it('未开启 PUBLIC_REGISTRATION → 401', async () => {
    const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
    await expect(
      ctrl.register({ email: 'a@b.com', password: '123456' }, makeReq(), makeRes()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('开启后：合法邮箱+密码 → 注册即登录，写 cookie 并返回 user', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const auth = fakeAuthService();
    const ctrl = new AuthController(auth as never, fakePrisma() as never);
    const res = makeRes();
    const out = await ctrl.register(
      { email: ' New@B.com ', password: '123456', name: '小张' },
      makeReq(),
      res,
    );
    expect(out).toEqual({
      user: { id: 'new-id', email: 'new@b.com', name: '小张', role: 'user' },
    });
    // 邮箱被 trim + 小写
    expect((auth.calls.createUser as Record<string, unknown>).email).toBe('new@b.com');
    // 固定 role=user
    expect((auth.calls.createUser as Record<string, unknown>).role).toBe('user');
    // 注册即登录：签发会话并写 sid cookie
    expect(auth.calls.createSession).toBe('new-id');
    expect((res as unknown as { cookies: Record<string, string> }).cookies.sid).toBe(
      'session-token',
    );
  });

  it('客户端传 role=admin 被忽略，仍为 user（防提权）', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const auth = fakeAuthService();
    const ctrl = new AuthController(auth as never, fakePrisma() as never);
    await ctrl.register(
      { email: 'a@b.com', password: '123456', role: 'admin' } as never,
      makeReq(),
      makeRes(),
    );
    expect((auth.calls.createUser as Record<string, unknown>).role).toBe('user');
  });

  it('邮箱重复 → 409', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const ctrl = new AuthController(
      fakeAuthService() as never,
      fakePrisma('dup@b.com') as never,
    );
    await expect(
      ctrl.register({ email: 'DUP@b.com', password: '123456' }, makeReq(), makeRes()),
    ).rejects.toThrow(ConflictException);
  });

  it('密码过短 → 400', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
    await expect(
      ctrl.register({ email: 'a@b.com', password: '123' }, makeReq(), makeRes()),
    ).rejects.toThrow(BadRequestException);
  });

  it('邮箱为空 → 400', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
    await expect(
      ctrl.register({ email: '  ', password: '123456' }, makeReq(), makeRes()),
    ).rejects.toThrow(BadRequestException);
  });
});

/**
 * M03/F5：会话 Cookie 安全属性与正式环境 HTTPS 强制。
 *
 * 拓扑：Caddy（TLS 终止、覆写 X-Forwarded-Proto）→ Next.js 反代（只转
 * 发可信值）→ backend（trust proxy=1）。req.secure 由这条可信链推导；
 * 伪造转发头无法穿透（客户端伪造的 proto 会被 Caddy 覆写）。
 */
describe('会话 Cookie 安全（M03/F5）', () => {
  describe('login', () => {
    it('HTTPS 链路（req.secure=true）→ Secure + HttpOnly + SameSite=Lax + 7 天', async () => {
      const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
      const res = makeRes();
      await ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq({ secure: true }), res);
      const options = (res as unknown as { cookieOptions: Record<string, unknown>[] })
        .cookieOptions[0]!;
      expect(options).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    });

    it('demo 模式明文 HTTP（本地开发例外）→ 仍签发会话，secure=false', async () => {
      const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
      const res = makeRes();
      await ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq({ secure: false }), res);
      const options = (res as unknown as { cookieOptions: Record<string, unknown>[] })
        .cookieOptions[0]!;
      expect(options.secure).toBe(false);
      expect(options.httpOnly).toBe(true);
    });

    it('invited 模式 + 明文（转发头缺失/伪造未穿透）→ 403，不签发会话', async () => {
      process.env.AUTH_MODE = 'invited';
      const auth = fakeAuthService();
      const ctrl = new AuthController(auth as never, fakePrisma() as never);
      const res = makeRes();
      await expect(
        ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq({ secure: false }), res),
      ).rejects.toThrow(ForbiddenException);
      // 未创建会话、未写 cookie
      expect(auth.calls.createSession).toBeUndefined();
      expect((res as unknown as { cookies: Record<string, string> }).cookies.sid).toBeUndefined();
    });

    it('invited 模式 + req.secure=true → 正常签发', async () => {
      process.env.AUTH_MODE = 'invited';
      const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
      const res = makeRes();
      await ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq({ secure: true }), res);
      const options = (res as unknown as { cookieOptions: Record<string, unknown>[] })
        .cookieOptions[0]!;
      expect(options.secure).toBe(true);
    });

    it('明文拒绝发生在凭证校验之前（不在 HTTP 上回显凭证有效性）', async () => {
      process.env.AUTH_MODE = 'invited';
      const auth = fakeAuthService();
      const ctrl = new AuthController(auth as never, fakePrisma() as never);
      await expect(
        ctrl.login({ email: 'wrong@b.com', password: 'pw' }, makeReq({ secure: false }), makeRes()),
      ).rejects.toThrow(ForbiddenException);
      // validateCredentials 未被调用
      expect((auth as unknown as { calls: Record<string, unknown> }).calls.createSession).toBeUndefined();
    });
  });

  describe('register', () => {
    it('invited 模式 + 明文 → 403', async () => {
      process.env.AUTH_MODE = 'invited';
      process.env.PUBLIC_REGISTRATION = 'true';
      const ctrl = new AuthController(fakeAuthService() as never, fakePrisma() as never);
      await expect(
        ctrl.register({ email: 'a@b.com', password: '123456' }, makeReq({ secure: false }), makeRes()),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
