import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { SessionAuthGuard } from './session.guard.js';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedRequest } from './identity.js';

const COOKIE_NAME = 'sid';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || password.length < 6) {
      throw new BadRequestException('邮箱不能为空，密码至少 6 位');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('该邮箱已注册，请直接登录');
    }
    const user = await this.authService.createUser({
      email,
      name: typeof body.name === 'string' ? body.name : undefined,
      role: 'user',
      password,
    });
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
