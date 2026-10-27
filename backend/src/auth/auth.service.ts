import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;
/** M05/F7：密码重置令牌有效期（30 分钟），单次使用 */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** 运行模式：demo 信任 x-user-id 头；invited 走服务端会话 cookie */
export type AuthMode = 'demo' | 'invited';

export function getAuthMode(): AuthMode {
  return process.env.AUTH_MODE === 'invited' ? 'invited' : 'demo';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 受邀用户认证服务（模块 8）。
 *
 * 安全约束：
 * - 密码只保存 bcrypt 哈希，绝不落明文；
 * - 会话 token 只以 HttpOnly Cookie 下发，库内只存 SHA-256 哈希；
 * - 任何日志都不输出密码或 token（含哈希值）。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  /**
   * 校验邮箱+密码，成功返回用户；失败返回 null。
   * 不区分“用户不存在”与“密码错误”，避免账号枚举。
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; name: string | null; role: string } | null> {
    // 按邮箱定位用户（User.id 是 uuid，凭证外键不是邮箱；邮箱唯一约束在 users 表）
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { credential: true },
    });
    // 用户不存在或未设置凭证也走一次哈希比较，保持耗时一致（弱防御时序攻击）
    if (!user?.credential) {
      await bcrypt.compare(password, '$2a$10$invalidhashinvalidhashinvalidhashinval').catch(() => undefined);
      return null;
    }
    const ok = await bcrypt.compare(password, user.credential.passwordHash);
    if (!ok) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  /** 签发会话：返回原始 token（仅用于写 cookie）与过期时间 */
  async createSession(
    userId: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt,
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });
    return { token, expiresAt };
  }

  /** 用原始 token 查会话（内部先哈希再查），返回附带用户的活跃会话或 null */
  async getSessionByToken(
    token: string,
  ): Promise<{ userId: string; role: string; email: string; name: string | null } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return {
      userId: session.userId,
      role: session.user.role,
      email: session.user.email,
      name: session.user.name,
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 管理员创建受邀账号（鉴权在 controller 层完成） */
  async createUser(input: {
    email: string;
    name?: string;
    role: string;
    password: string;
  }): Promise<{ id: string; email: string; name: string | null; role: string }> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await this.hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name?.trim() || null,
        role: input.role,
        credential: { create: { passwordHash } },
      },
    });
    this.logger.log(`created user ${user.id} role=${user.role}`);
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }

  /**
   * M05/F7：发起密码找回。
   * 邮箱不存在时与存在时同样静默（返回 null），由调用方统一响应防枚举；
   * 用户存在则创建限时单次令牌（库内存 SHA-256 哈希），原始 token 只在这里
   * 返回一次（供邮件正文使用），绝不写日志。
   */
  async createPasswordResetToken(email: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (!user) return null;
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });
    return token;
  }

  /**
   * M05/F7：用令牌重置密码。
   * - 令牌不存在 / 已用 / 已过期 → null（统一报错，不区分原因）；
   * - 成功：更新密码哈希、标记令牌已用、撤销该用户全部会话
   *   （密码变更后旧会话立即失效）。
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    const tokenHash = sha256(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return false;
    }
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.credential.update({
        where: { userId: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // 密码更新后旧会话全部失效（M05 验收点）
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.logger.log(`password reset completed for user ${record.userId}`);
    return true;
  }

  async deleteUser(userId: string): Promise<void> {
    // User 级联删除 Credential/Session/UserProfile；Follows/Plans 无外键，需显式清理
    await this.prisma.$transaction([
      this.prisma.followedOpportunity.deleteMany({ where: { userId } }),
      this.prisma.opportunityCorrection.deleteMany({ where: { userId } }),
      this.prisma.timelineEvent.deleteMany({ where: { userId } }),
      this.prisma.notificationRecord.deleteMany({ where: { userId } }),
      this.prisma.dailyPlan.deleteMany({ where: { userId } }),
      this.prisma.taskFeedback.deleteMany({ where: { userId } }),
      this.prisma.weeklyPlan.deleteMany({ where: { userId } }),
      this.prisma.userProfile.deleteMany({ where: { userId } }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.credential.deleteMany({ where: { userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
    this.logger.log(`deleted user ${userId}`);
  }
}
