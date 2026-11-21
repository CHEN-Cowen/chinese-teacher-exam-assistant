/** M05/F7：认证限速器（内存滑动窗口）单元测试。 */
import { describe, expect, it, vi } from 'vitest';
import { AuthRateLimiter } from './auth-rate-limiter.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthRateLimiter', () => {
  it('窗口内未超限 → 允许；达到上限后拒绝', () => {
    const limiter = new AuthRateLimiter({ login: { windowMs: 60_000, max: 3 } });
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(false);
  });

  it('拒绝同样计数：持续尝试不会在窗口内恢复', () => {
    const limiter = new AuthRateLimiter({ login: { windowMs: 60_000, max: 1 } });
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(false);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(false);
  });

  it('窗口滚动后重置', () => {
    vi.useFakeTimers();
    const limiter = new AuthRateLimiter({ login: { windowMs: 60_000, max: 1 } });
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
  });

  it('不同键相互独立（IP 与邮箱分开计数）', () => {
    const limiter = new AuthRateLimiter({ login: { windowMs: 60_000, max: 2 } });
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip2'])).toBe(true);
  });

  it('任一键超限即拒绝（IP 未超但邮箱超 → 拒绝）', () => {
    const limiter = new AuthRateLimiter({ login: { windowMs: 60_000, max: 2 } });
    // 同一邮箱从不同 IP：邮箱键先超限
    expect(limiter.tryConsume('login', ['ip1', 'email:a@b.com'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip2', 'email:a@b.com'])).toBe(true);
    expect(limiter.tryConsume('login', ['ip3', 'email:a@b.com'])).toBe(false);
  });

  it('未知动作直接放行（不误伤）', () => {
    const limiter = new AuthRateLimiter({});
    expect(limiter.tryConsume('unknown', ['ip1'])).toBe(true);
  });

  it('reset() 清空全部窗口', () => {
    const limiter = new AuthRateLimiter({ login: { windowMs: 60_000, max: 1 } });
    limiter.tryConsume('login', ['ip1']);
    limiter.reset();
    expect(limiter.tryConsume('login', ['ip1'])).toBe(true);
  });
});
