import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthService, getAuthMode } from './auth.service.js';
import type { AuthenticatedRequest } from './identity.js';

/** 无需登录即可访问的精确路径（invited 模式下跳过会话校验） */
const PUBLIC_PATHS = new Set([
  '/health',
  '/auth/login',
  '/auth/session',
  // 公开注册（比赛现场自助注册体验）：开关 PUBLIC_REGISTRATION 未开启时
  // 由控制器层拒绝（401），守卫只负责放行匿名可达
  '/auth/register',
  // 引导首个管理员的前提是系统尚无任何账号；无人持有会话，必须匿名可达；
  // 安全性由控制器内 ADMIN_BOOTSTRAP_TOKEN 校验 + 已有管理员时接口自动关闭保证
  '/admin/bootstrap-admin',
]);

/**
 * 无需登录即可访问的路径正则（v7.1 M8）。
 * 匹配与详情是访客预筛的核心价值——用户先体验结果再决定是否登录；
 * 其余接口（关注/订阅/目标/纠错）仍需登录。
 */
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/opportunities\/match$/,
  /^\/opportunities\/units\/[^/]+\/detail$/,
];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return PUBLIC_PATTERNS.some((re) => re.test(path));
}

/**
 * 全局会话守卫（模块 8）。
 *
 * - invited 模式：读取 HttpOnly `sid` cookie，调用 AuthService 校验会话，
 *   将用户信息挂载到 request.user；无有效会话时仅在非公开路径抛 401。
 * - demo 模式：直接放行（身份由各控制器的 UserGuard/AdminGuard 从 x-user-* 头读取）。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (getAuthMode() !== 'invited') return true;

    const req = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    // 只要有有效会话就挂载 req.user（包括 /auth/session 这类公开路径——
    // 会话恢复接口依赖 req.user 判断登录态）；公开路径在无会话时允许匿名通过。
    const token = req.cookies?.['sid'] as string | undefined;
    if (token) {
      const session = await this.authService.getSessionByToken(token);
      if (session) {
        req.user = {
          id: session.userId,
          role: session.role,
          email: session.email,
          name: session.name,
        };
        return true;
      }
    }

    const path = req.route?.path ?? req.path;
    if (isPublicPath(path)) return true;
    return false;
  }
}
