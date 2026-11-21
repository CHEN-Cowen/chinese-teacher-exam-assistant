import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService, getAuthMode } from './auth.service.js';
import { SessionAuthGuard } from './session.guard.js';
import { PrismaService } from '../prisma.service.js';
import { validateEmail, validatePassword } from './validation.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { MailerService } from './mailer.service.js';
import type { AuthenticatedRequest } from './identity.js';

const COOKIE_NAME = 'sid';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 忘记密码统一响应文案（防账号枚举：注册与否完全一致） */
const RESET_RESPONSE_MESSAGE = '若该邮箱已注册，将收到一封包含重置链接的邮件';

function cookieOptions(req: AuthenticatedRequest) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // secure 仅在真实 HTTPS 请求下开启（由 trust proxy 解析 X-Forwarded-Proto 得到 req.secure）。
    // 不再按 TRUST_PROXY/NODE_ENV 静态判断——否则 HTTP 演示环境登录会因 secure cookie 失效。
    // HTTPS 生产（Caddy 终止 TLS）时 Caddy 会置 X-Forwarded-Proto: https，req.secure 自动为 true。
    secure: req.secure,
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  };
}

/**
 * M03/F5：正式（invited）环境会话必须经可信 HTTPS 链路建立。
 *
 * Caddy 终止 TLS 并覆写 X-Forwarded-Proto；Next.js 反代只转发该可信值；
 * 后端 trust proxy=1 只信任紧邻的 Next.js 一跳——客户端伪造的
 * X-Forwarded-* 无法穿透这条边界。若 req.secure 仍为 false（TRUST_PROXY
 * 误配、反代漏转发或直接明文访问后端），拒绝在 HTTP 上签发会话，
 * 而不是静默下发不安全的 Secure=false cookie。demo 模式仅回环监听，
 * 保留 HTTP 本地开发例外。
 */
function requireSecureSession(req: AuthenticatedRequest): void {
  if (getAuthMode() === 'invited' && !req.secure) {
    throw new ForbiddenException(
      '正式环境会话必须经 HTTPS 建立：请检查 TRUST_PROXY 配置与反代的 X-Forwarded-Proto 转发。',
    );
  }
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly rateLimiter: AuthRateLimiter,
  ) {}

  /** 客户端标识：trust proxy 启用时 req.ip 已是真实 IP（M03 可信链） */
  private clientKeys(req: AuthenticatedRequest, email?: string): string[] {
    const keys = [req.ip ?? req.socket?.remoteAddress ?? 'unknown'];
    if (email) keys.push(`email:${email.toLowerCase()}`);
    return keys;
  }

  private tooManyRequests(): HttpException {
    return new HttpException('尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }

  @Post('login')
  async login(
    @Body() body: { email?: unknown; password?: unknown },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      throw new UnauthorizedException('邮箱和密码不能为空');
    }
    // M05/F7：登录限速（IP + 邮箱双键），防撞库
    if (!this.rateLimiter.tryConsume('login', this.clientKeys(req, email))) {
      throw this.tooManyRequests();
    }
    requireSecureSession(req);
    const user = await this.authService.validateCredentials(email, password);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码不正确');
    }
    const { token } = await this.authService.createSession(
      user.id,
      req.headers['user-agent'] as string | undefined,
    );
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * 公开注册（比赛现场开放体验用）。
   *
   * - 仅当环境变量 PUBLIC_REGISTRATION=true 时开放（默认关闭，kbzs 试用环境不设）；
   * - 固定 role=user（杜绝客户端传 role 提权）；
   * - 邮箱查重，重复直接引导登录；
   * - 注册即登录：签发会话并写 HttpOnly cookie，与 login 同一套会话语义。
   */
  @Post('register')
  async register(
    @Body() body: { email?: unknown; name?: unknown; password?: unknown },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (process.env.PUBLIC_REGISTRATION !== 'true') {
      throw new UnauthorizedException('当前环境未开放公开注册');
    }
    requireSecureSession(req);
    const emailCheck = validateEmail(body.email);
    if (!emailCheck.ok) {
      throw new BadRequestException(emailCheck.reason);
    }
    const passwordCheck = validatePassword(body.password);
    if (!passwordCheck.ok) {
      throw new BadRequestException(passwordCheck.reason);
    }
    const email = emailCheck.email;
    // M05/F7：注册限速（IP 键），防批量占号
    if (!this.rateLimiter.tryConsume('register', this.clientKeys(req))) {
      throw this.tooManyRequests();
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('该邮箱已注册，请直接登录');
    }
    let user: { id: string; email: string; name: string | null; role: string };
    try {
      user = await this.authService.createUser({
        email,
        name: typeof body.name === 'string' ? body.name : undefined,
        role: 'user',
        password: passwordCheck.password,
      });
    } catch (error) {
      // M05/F7：并发重复注册竞态——查重与创建之间另一请求已建号（P2002）
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('该邮箱已注册，请直接登录');
      }
      throw error;
    }
    const { token } = await this.authService.createSession(
      user.id,
      req.headers['user-agent'] as string | undefined,
    );
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  session(@Req() req: AuthenticatedRequest) {
    if (!req.user) throw new UnauthorizedException('未登录');
    return {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
      },
    };
  }

  /**
   * M05/F7：忘记密码（匿名可达，限速 IP+邮箱双键 3 次/10 分钟）。
   *
   * 无论邮箱是否注册，响应完全一致（防账号枚举）：「若该邮箱已注册，
   * 将收到一封包含重置链接的邮件」。
   * 邮件服务未配置（EMAIL_ENABLED!=true）时不伪装发送成功——令牌不会
   * 被投递，照常返回统一文案，并在服务端日志记录受控状态。
   * 找回邮件本身即邮箱所有权验证：能读取该邮箱的人才能完成重置。
   */
  @Post('forgot-password')
  async forgotPassword(
    @Body() body: { email?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const emailCheck = validateEmail(body.email);
    if (!emailCheck.ok) {
      // 与成功响应同文案，不泄露邮箱格式是否命中真实账号
      return { ok: true, message: RESET_RESPONSE_MESSAGE };
    }
    if (!this.rateLimiter.tryConsume('forgotPassword', this.clientKeys(req, emailCheck.email))) {
      throw this.tooManyRequests();
    }
    const token = await this.authService.createPasswordResetToken(emailCheck.email);
    if (!token) {
      this.logger.log(`password reset requested for unknown email (suppressed)`);
      return { ok: true, message: RESET_RESPONSE_MESSAGE };
    }
    const result = await this.mailer.send({
      to: emailCheck.email,
      subject: '教招有据：重置您的登录密码',
      text: [
        '您（或他人）刚刚请求重置教招有据账号密码。',
        `重置链接（30 分钟内有效，仅可使用一次）：`,
        `${process.env.PUBLIC_BASE_URL ?? ''}/reset-password?token=${token}`,
        '',
        '若非本人操作，请忽略本邮件；您的密码不会被修改。',
      ].join('\n'),
    });
    if (!result.delivered) {
      // 受控状态：邮件未投递（未配置或投递失败）。令牌已在库中但未送达，
      // 到期自动失效。日志留痕供运维排查，响应不变。
      this.logger.warn(
        `password reset token created but NOT delivered (reason=${result.reason ?? 'unknown'})；email=***`,
      );
    }
    return { ok: true, message: RESET_RESPONSE_MESSAGE };
  }

  /**
   * M05/F7：重置密码（匿名可达，令牌限时单次使用）。
   * 成功后该用户全部旧会话立即失效（含正在用的登录态）。
   */
  @Post('reset-password')
  async resetPassword(
    @Body() body: { token?: unknown; password?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const token = typeof body.token === 'string' && body.token.length > 0 ? body.token : '';
    if (!token) {
      throw new BadRequestException('重置令牌不能为空');
    }
    // 令牌本身是 64 位 hex 随机值，重置接口同样限速防爆破
    if (!this.rateLimiter.tryConsume('login', this.clientKeys(req))) {
      throw this.tooManyRequests();
    }
    const passwordCheck = validatePassword(body.password);
    if (!passwordCheck.ok) {
      throw new BadRequestException(passwordCheck.reason);
    }
    const ok = await this.authService.resetPassword(token, passwordCheck.password);
    if (!ok) {
      throw new BadRequestException('重置链接无效或已过期，请重新申请');
    }
    return { ok: true, message: '密码已重置，请使用新密码重新登录' };
  }

  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (token) {
      await this.authService.revokeSession(token);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  /** 注销账号：删除用户及其全部级联数据（凭证、会话、画像、关注、计划、通知） */
  @Delete('account')
  @UseGuards(SessionAuthGuard)
  async deregister(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.user) throw new UnauthorizedException('未登录');
    await this.authService.deleteUser(req.user.id);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  /**
   * 删除测试数据但保留账号：清空画像、关注、计划、反馈、通知、日程、纠错，
   * 便于受邀测试用户重置环境而无需重新建号。
   */
  @Delete('test-data')
  @UseGuards(SessionAuthGuard)
  async deleteTestData(@Req() req: AuthenticatedRequest) {
    if (!req.user) throw new UnauthorizedException('未登录');
    const userId = req.user.id;
    await this.prisma.$transaction([
      this.prisma.userProfile.deleteMany({ where: { userId } }),
      this.prisma.followedOpportunity.deleteMany({ where: { userId } }),
      this.prisma.opportunityCorrection.deleteMany({ where: { userId } }),
      this.prisma.timelineEvent.deleteMany({ where: { userId } }),
      this.prisma.notificationRecord.deleteMany({ where: { userId } }),
      this.prisma.taskFeedback.deleteMany({ where: { userId } }),
      this.prisma.dailyPlan.deleteMany({ where: { userId } }),
      this.prisma.weeklyPlan.deleteMany({ where: { userId } }),
    ]);
    return { ok: true };
  }
}
