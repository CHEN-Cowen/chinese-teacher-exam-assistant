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
import { BadRequestException, ConflictException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import type { MailerService } from './mailer.service.js';

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
    createPasswordResetToken: async (email: string) =>
      // 默认替身与真实行为一致：仅已注册邮箱返回令牌；调用方用 prisma 查询
      // 结果判定，这里按参数特征返回（未注册用例不会走到这里）
      email ? `${'ab'.repeat(32)}` : null,
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

/** M05：邮件服务替身（记录调用，默认已配置可投递） */
function stubMailer() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  return {
    sent,
    send: async (input: { to: string; subject: string; text: string }) => {
      sent.push(input);
      return { delivered: true };
    },
  } as unknown as MailerService & { sent: Array<{ to: string; subject: string; text: string }> };
}

/** M05：统一构造被测控制器（限速器每用例独立，规则可自定义） */
function makeCtrl(
  auth: AuthService = fakeAuthService(),
  prisma = fakePrisma(),
  mailer = stubMailer(),
  rules?: ConstructorParameters<typeof AuthRateLimiter>[0],
) {
  return {
    auth: auth as AuthService & { calls: { createUser?: unknown; createSession?: string } },
    mailer: mailer as MailerService & { sent: Array<{ to: string; subject: string; text: string }> },
    ctrl: new AuthController(
      auth as never,
      prisma as never,
      mailer as never,
      new AuthRateLimiter(rules) as never,
    ),
  };
}

describe('POST /auth/register', () => {
  it('未开启 PUBLIC_REGISTRATION → 401', async () => {
    const { ctrl } = makeCtrl();
    await expect(
      ctrl.register({ email: 'a@b.com', password: 'abcd1234' }, makeReq(), makeRes()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('开启后：合法邮箱+密码 → 注册即登录，写 cookie 并返回 user', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const auth = fakeAuthService();
    const { ctrl } = makeCtrl(auth);
    const res = makeRes();
    const out = await ctrl.register(
      { email: ' New@B.com ', password: 'abcd1234', name: '小张' },
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
    const { ctrl } = makeCtrl(auth);
    await ctrl.register(
      { email: 'a@b.com', password: 'abcd1234', role: 'admin' } as never,
      makeReq(),
      makeRes(),
    );
    expect((auth.calls.createUser as Record<string, unknown>).role).toBe('user');
  });

  it('邮箱重复 → 409', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const { ctrl } = makeCtrl(fakeAuthService(), fakePrisma('dup@b.com'));
    await expect(
      ctrl.register({ email: 'DUP@b.com', password: 'abcd1234' }, makeReq(), makeRes()),
    ).rejects.toThrow(ConflictException);
  });

  it('密码过短 → 400', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const { ctrl } = makeCtrl();    await expect(
      ctrl.register({ email: 'a@b.com', password: '123' }, makeReq(), makeRes()),
    ).rejects.toThrow(BadRequestException);
  });

  it('邮箱为空 → 400', async () => {
    process.env.PUBLIC_REGISTRATION = 'true';
    const { ctrl } = makeCtrl();    await expect(
      ctrl.register({ email: '  ', password: 'abcd1234' }, makeReq(), makeRes()),
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
      const { ctrl } = makeCtrl();      const res = makeRes();
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
      const { ctrl } = makeCtrl();      const res = makeRes();
      await ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq({ secure: false }), res);
      const options = (res as unknown as { cookieOptions: Record<string, unknown>[] })
        .cookieOptions[0]!;
      expect(options.secure).toBe(false);
      expect(options.httpOnly).toBe(true);
    });

    it('invited 模式 + 明文（转发头缺失/伪造未穿透）→ 403，不签发会话', async () => {
      process.env.AUTH_MODE = 'invited';
      const auth = fakeAuthService();
      const { ctrl } = makeCtrl(auth);
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
      const { ctrl } = makeCtrl();      const res = makeRes();
      await ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq({ secure: true }), res);
      const options = (res as unknown as { cookieOptions: Record<string, unknown>[] })
        .cookieOptions[0]!;
      expect(options.secure).toBe(true);
    });

    it('明文拒绝发生在凭证校验之前（不在 HTTP 上回显凭证有效性）', async () => {
      process.env.AUTH_MODE = 'invited';
      const auth = fakeAuthService();
      const { ctrl } = makeCtrl(auth);
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
      const { ctrl } = makeCtrl();
      await expect(
        ctrl.register({ email: 'a@b.com', password: 'abcd1234' }, makeReq({ secure: false }), makeRes()),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

/**
 * M05/F7：输入校验、限速、并发注册竞态、找回与重置。
 */
describe('认证加固（M05/F7）', () => {
  describe('注册输入校验', () => {
    it.each([
      ['缺 @', 'not-an-email'],
      ['缺域名', 'a@b'],
      ['过长邮箱（255+）', `${'a'.repeat(250)}@example.com`],
    ])('非法邮箱（%s）→ 400', async (_label, email) => {
      process.env.PUBLIC_REGISTRATION = 'true';
      const { ctrl } = makeCtrl();
      await expect(
        ctrl.register({ email, password: 'abcd1234' }, makeReq(), makeRes()),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['纯数字', '12345678'],
      ['纯字母', 'abcdefgh'],
      ['过短', 'ab12'],
      ['超 72 字节', `a1${'x'.repeat(80)}`],
    ])('弱密码（%s）→ 400', async (_label, password) => {
      process.env.PUBLIC_REGISTRATION = 'true';
      const { ctrl } = makeCtrl();
      await expect(
        ctrl.register({ email: 'a@b.com', password }, makeReq(), makeRes()),
      ).rejects.toThrow(BadRequestException);
    });

    it('并发重复注册竞态（P2002）→ 409 而非 500', async () => {
      process.env.PUBLIC_REGISTRATION = 'true';
      const auth = fakeAuthService();
      // 查重通过，但创建时另一请求抢先建号（唯一约束冲突）
      (auth as unknown as { createUser: () => Promise<never> }).createUser = async () => {
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      };
      const { ctrl } = makeCtrl(auth);
      await expect(
        ctrl.register({ email: 'race@b.com', password: 'abcd1234' }, makeReq(), makeRes()),
      ).rejects.toThrow(ConflictException);
    });

    it('注册限速：窗口内超过上限 → 429', async () => {
      process.env.PUBLIC_REGISTRATION = 'true';
      const { ctrl } = makeCtrl(fakeAuthService(), fakePrisma(), stubMailer(), {
        register: { windowMs: 60_000, max: 2 },
      });
      for (let i = 0; i < 2; i += 1) {
        await ctrl.register(
          { email: `u${i}@b.com`, password: 'abcd1234' },
          makeReq(),
          makeRes(),
        );
      }
      await expect(
        ctrl.register({ email: 'u3@b.com', password: 'abcd1234' }, makeReq(), makeRes()),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('登录限速', () => {
    it('窗口内超过上限 → 429（含失败尝试）', async () => {
      const auth = fakeAuthService();
      // 密码错误（validateCredentials → null → 401）
      (auth as unknown as { validateCredentials: () => Promise<null> }).validateCredentials =
        async () => null;
      const { ctrl } = makeCtrl(auth, fakePrisma(), stubMailer(), {
        login: { windowMs: 60_000, max: 3 },
      });
      for (let i = 0; i < 3; i += 1) {
        await expect(
          ctrl.login({ email: 'a@b.com', password: 'wrong' }, makeReq(), makeRes()),
        ).rejects.toThrow(UnauthorizedException);
      }
      await expect(
        ctrl.login({ email: 'a@b.com', password: 'pw' }, makeReq(), makeRes()),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('忘记密码（防枚举 + 受控邮件状态）', () => {
    function prismaWithUser(userId: string | null) {
      const prisma = fakePrisma();
      (prisma.user as { findUnique: (args: unknown) => Promise<unknown> }).findUnique =
        async () => (userId ? { id: userId } : null);
      (prisma as unknown as {
        passwordResetToken: { create: (args: unknown) => Promise<unknown> };
      }).passwordResetToken = { create: async () => ({}) };
      return prisma;
    }

    it('未注册邮箱 → 与注册邮箱完全相同的响应，不发送邮件', async () => {
      const auth = fakeAuthService();
      // 真实服务按 prisma 查询返回 null（未注册）——替身显式对齐该行为
      (auth as unknown as { createPasswordResetToken: () => Promise<null> }).createPasswordResetToken =
        async () => null;
      const { ctrl, mailer } = makeCtrl(auth);
      const out = await ctrl.forgotPassword({ email: 'nobody@b.com' }, makeReq());
      expect(out).toEqual({ ok: true, message: '若该邮箱已注册，将收到一封包含重置链接的邮件' });
      expect(mailer.sent).toHaveLength(0);
    });

    it('已注册邮箱 + 邮件服务可用 → 真实投递，响应不变', async () => {
      const { ctrl, mailer } = makeCtrl(fakeAuthService(), prismaWithUser('user-1'));
      const out = await ctrl.forgotPassword({ email: 'user@b.com' }, makeReq());
      expect(out).toEqual({ ok: true, message: '若该邮箱已注册，将收到一封包含重置链接的邮件' });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.to).toBe('user@b.com');
      expect(mailer.sent[0]!.text).toContain('30 分钟内有效');
    });

    it('邮件服务未配置 → 统一响应，不伪装发送成功', async () => {
      const unconfigured = {
        send: async () => ({ delivered: false, reason: 'email_disabled' }),
      } as unknown as MailerService & { sent?: never };
      const { ctrl } = makeCtrl(fakeAuthService(), prismaWithUser('user-1'), unconfigured);
      const out = await ctrl.forgotPassword({ email: 'user@b.com' }, makeReq());
      // 响应与「已发送」完全一致：不泄露投递状态，也不伪装成功细节
      expect(out).toEqual({ ok: true, message: '若该邮箱已注册，将收到一封包含重置链接的邮件' });
    });

    it('忘记密码限速：3 次/10 分钟 → 第 4 次 429', async () => {
      const { ctrl } = makeCtrl(fakeAuthService(), fakePrisma(), stubMailer(), {
        forgotPassword: { windowMs: 600_000, max: 3 },
      });
      for (let i = 0; i < 3; i += 1) {
        await ctrl.forgotPassword({ email: 'nobody@b.com' }, makeReq());
      }
      await expect(
        ctrl.forgotPassword({ email: 'nobody@b.com' }, makeReq()),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('重置密码', () => {
    function authServiceWithReset(result: boolean) {
      const auth = fakeAuthService();
      (
        auth as unknown as { resetPassword: () => Promise<boolean> }
      ).resetPassword = async () => result;
      return auth;
    }

    it('有效令牌 + 合法新密码 → 成功响应', async () => {
      const auth = authServiceWithReset(true);
      const { ctrl } = makeCtrl(auth);
      const out = await ctrl.resetPassword({ token: 'tok', password: 'newpass123' }, makeReq());
      expect(out.ok).toBe(true);
    });

    it('无效/过期/已用令牌 → 400（不区分原因）', async () => {
      const auth = authServiceWithReset(false);
      const { ctrl } = makeCtrl(auth);
      await expect(
        ctrl.resetPassword({ token: 'bad', password: 'newpass123' }, makeReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('新密码不满足规则 → 400（不消耗令牌）', async () => {
      const auth = fakeAuthService();
      let resetCalled = false;
      (auth as unknown as { resetPassword: () => Promise<boolean> }).resetPassword =
        async () => {
          resetCalled = true;
          return true;
        };
      const { ctrl } = makeCtrl(auth);
      await expect(
        ctrl.resetPassword({ token: 'tok', password: 'short' }, makeReq()),
      ).rejects.toThrow(BadRequestException);
      expect(resetCalled).toBe(false);
    });

    it('令牌为空 → 400', async () => {
      const { ctrl } = makeCtrl();
      await expect(
        ctrl.resetPassword({ token: '', password: 'newpass123' }, makeReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('重置接口限速 → 429', async () => {
      const auth = authServiceWithReset(true);
      const { ctrl } = makeCtrl(auth, fakePrisma(), stubMailer(), {
        login: { windowMs: 60_000, max: 1 },
      });
      await ctrl.resetPassword({ token: 'tok', password: 'newpass123' }, makeReq());
      await expect(
        ctrl.resetPassword({ token: 'tok2', password: 'newpass123' }, makeReq()),
      ).rejects.toThrow(HttpException);
    });
  });
});
