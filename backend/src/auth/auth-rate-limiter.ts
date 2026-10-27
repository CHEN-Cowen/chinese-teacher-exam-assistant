/**
 * M05/F7：认证接口限速（内存滑动窗口）。
 *
 * 粒度：按「动作 + IP」与「动作 + 邮箱」双键计数（任一超限即拒绝），
 * 防单 IP 撞库，也防分布式攻击者集中对同一邮箱尝试。
 *
 * 已知限制（如实记录）：实现为单实例内存窗口，当前部署形态为单实例
 * backend（docker-compose 单容器），多副本部署时需换 Redis 共享窗口；
 * 进程重启计数清零，属于可接受的限速衰减而非安全依赖（认证本身仍由
 * 密码/令牌保护）。
 */

interface WindowState {
  /** 窗口起点（毫秒） */
  windowStart: number;
  count: number;
}

export interface RateLimitRule {
  /** 窗口时长（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大次数 */
  max: number;
}

/** 默认规则：登录 10/分钟；注册 5/分钟；忘记密码 3/10 分钟 */
export const AUTH_RATE_LIMITS: Record<'login' | 'register' | 'forgotPassword', RateLimitRule> = {
  login: { windowMs: 60_000, max: 10 },
  register: { windowMs: 60_000, max: 5 },
  forgotPassword: { windowMs: 600_000, max: 3 },
};

export class AuthRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(private readonly rules: Record<string, RateLimitRule> = AUTH_RATE_LIMITS) {}

  /**
   * 记一次尝试；任一键超限返回 false（调用方应抛 429）。
   * 拒绝时同样计数——持续攻击不会被「失败不计数」绕过。
   */
  tryConsume(action: string, keys: string[]): boolean {
    const rule = this.rules[action];
    if (!rule) return true;
    const now = Date.now();
    let allowed = true;
    for (const key of keys) {
      const mapKey = `${action}:${key}`;
      const state = this.windows.get(mapKey);
      if (!state || now - state.windowStart >= rule.windowMs) {
        this.windows.set(mapKey, { windowStart: now, count: 1 });
        continue;
      }
      state.count += 1;
      if (state.count > rule.max) allowed = false;
    }
    this.evict(now);
    return allowed;
  }

  /** 测试与运维辅助：清空全部窗口 */
  reset(): void {
    this.windows.clear();
  }

  /** 粗清理：窗口早已过期的条目按需移除，防内存无界增长 */
  private evict(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, state] of this.windows) {
      const rule = this.rules[key.split(':', 1)[0] ?? ''];
      if (rule && now - state.windowStart >= rule.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}
