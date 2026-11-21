/**
 * M05/F7：AuthService 密码找回核心逻辑单元测试。
 *
 * 覆盖：createPasswordResetToken（不存在用户 → null；存在 → 建 30 分钟
 * 令牌）；resetPassword（过期/已用/不存在令牌 → false；成功 → 事务内
 * 更新密码 + 标记已用 + 撤销全部旧会话）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService, PASSWORD_RESET_TTL_MS } from './auth.service.js';

class FakeResetPrisma {
  users = new Map<string, { id: string }>();
  resetTokens: Array<{
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  }> = [];
  credentials = new Map<string, { passwordHash: string }>();
  sessions: Array<{ id: string; userId: string; revokedAt: Date | null }> = [];
  transactions: unknown[][] = [];
  private seq = 0;

  readonly user = {
    findUnique: async ({ where }: { where: { email: string } }) =>
      this.users.get(where.email) ?? null,
  };

  readonly passwordResetToken = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `prt-${(this.seq += 1)}`, usedAt: null, ...data } as never;
      this.resetTokens.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      this.resetTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.resetTokens.find((t) => t.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  };

  readonly credential = {
    update: async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
      const row = this.credentials.get(where.userId)!;
      Object.assign(row, data);
      return row;
    },
  };

  readonly session = {
    updateMany: async ({ where, data }: { where: { userId: string; revokedAt: null }; data: Record<string, unknown> }) => {
      let count = 0;
      for (const s of this.sessions) {
        if (s.userId !== where.userId || s.revokedAt !== null) continue;
        s.revokedAt = data.revokedAt as Date;
        count += 1;
      }
      return { count };
    },
  };

  readonly $transaction = async (ops: unknown[]) => {
    this.transactions.push(ops);
    return ops;
  };
}

function makeService(prisma: FakeResetPrisma) {
  return new AuthService(prisma as never);
}

beforeEach(() => {
  process.env.AUTH_PEPPER = 'test-pepper';
});

describe('createPasswordResetToken（M05/F7）', () => {
  it('未注册邮箱 → null（由控制器统一响应防枚举）', async () => {
    const prisma = new FakeResetPrisma();
    const service = makeService(prisma);
    expect(await service.createPasswordResetToken('nobody@b.com')).toBeNull();
    expect(prisma.resetTokens).toHaveLength(0);
  });

  it('已注册邮箱 → 创建限时令牌，库存 SHA-256 哈希而非明文', async () => {
    const prisma = new FakeResetPrisma();
    prisma.users.set('user@b.com', { id: 'user-1' });
    const service = makeService(prisma);
    const token = await service.createPasswordResetToken('USER@b.com');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.resetTokens).toHaveLength(1);
    const row = prisma.resetTokens[0]!;
    expect(row.userId).toBe('user-1');
    expect(row.tokenHash).not.toBe(token); // 只存哈希
    expect(row.tokenHash).toHaveLength(64);
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(PASSWORD_RESET_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(PASSWORD_RESET_TTL_MS);
  });
});

describe('resetPassword（M05/F7）', () => {
  it('成功：事务内更新密码 + 标记令牌已用 + 撤销该用户全部活跃会话', async () => {
    const prisma = new FakeResetPrisma();
    prisma.users.set('user@b.com', { id: 'user-1' });
    prisma.credentials.set('user-1', { passwordHash: 'old-hash' });
    prisma.sessions.push(
      { id: 's1', userId: 'user-1', revokedAt: null },
      { id: 's2', userId: 'user-1', revokedAt: null },
      { id: 's3', userId: 'user-2', revokedAt: null }, // 其他用户不受影响
    );
    const service = makeService(prisma);
    const token = await service.createPasswordResetToken('user@b.com');

    const ok = await service.resetPassword(token!, 'newpass123');
    expect(ok).toBe(true);
    expect(prisma.transactions).toHaveLength(1);
    expect(prisma.credentials.get('user-1')!.passwordHash).not.toBe('old-hash');
    // bcrypt 哈希可验证新密码
    const bcrypt = await import('bcryptjs');
    await expect(
      bcrypt.compare('newpass123', prisma.credentials.get('user-1')!.passwordHash),
    ).resolves.toBe(true);
    expect(prisma.resetTokens[0]!.usedAt).toBeInstanceOf(Date);
    expect(prisma.sessions.find((s) => s.id === 's1')!.revokedAt).toBeInstanceOf(Date);
    expect(prisma.sessions.find((s) => s.id === 's2')!.revokedAt).toBeInstanceOf(Date);
    expect(prisma.sessions.find((s) => s.id === 's3')!.revokedAt).toBeNull();
  });

  it('已使用令牌 → false（单次使用）', async () => {
    const prisma = new FakeResetPrisma();
    prisma.users.set('user@b.com', { id: 'user-1' });
    // 首次 reset 会在事务操作里更新凭证行；缺行会产生 unhandled rejection
    // （假 $transaction 只记录操作，急切创建的 update Promise 无人认领）。
    prisma.credentials.set('user-1', { passwordHash: 'old-hash' });
    const service = makeService(prisma);
    const token = await service.createPasswordResetToken('user@b.com');
    await service.resetPassword(token!, 'newpass123');
    expect(await service.resetPassword(token!, 'again12345')).toBe(false);
  });

  it('过期令牌 → false', async () => {
    const prisma = new FakeResetPrisma();
    prisma.users.set('user@b.com', { id: 'user-1' });
    const service = makeService(prisma);
    const token = await service.createPasswordResetToken('user@b.com');
    // 令牌回拨为已过期
    prisma.resetTokens[0]!.expiresAt = new Date(Date.now() - 1_000);
    expect(await service.resetPassword(token!, 'newpass123')).toBe(false);
  });

  it('不存在的令牌 → false（统一报错不区分原因）', async () => {
    const prisma = new FakeResetPrisma();
    const service = makeService(prisma);
    expect(await service.resetPassword('nonexistent', 'newpass123')).toBe(false);
  });
});
