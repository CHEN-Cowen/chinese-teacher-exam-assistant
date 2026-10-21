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
 */
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
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
  } as unknown as AuthService & {
    calls: { createUser?: unknown; createSession?: string };
  };
}

/** 构造可用的 req（cookie 由 res 替身承接） */
function makeReq() {
  return { headers: {}, secure: false } as never;
}
function makeRes() {
  const cookies: Record<string, string> = {};
  return {
    cookies,
    cookie: (name: string, value: string) => {
      cookies[name] = value;
    },
  } as never;
}

afterEach(() => {
  delete process.env.PUBLIC_REGISTRATION;
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
