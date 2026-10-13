/**
 * 后台角色守卫权限测试（v7.2 工作包 0，测试边界：关键接口权限）。
 *
 * 覆盖链路③的高影响端点所依赖的三个守卫（此前无直接测试）：
 * - AdminGuard：/announcements/runs*、extract、retry（全体工作人员）；
 * - StrictAdminGuard：POST /announcements/sources（仅 admin，提交来源改写真实台账）；
 * - ReviewGuard：/announcements/runs/:id/review、publish（审核与发布职责分离）。
 *
 * demo 模式身份来自 x-user-id/x-user-role 请求头；
 * invited 模式身份只认服务端会话（req.user），绝不信任请求头角色。
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdminGuard,
  ReviewGuard,
  StrictAdminGuard,
} from './admin.guard.js';

function contextOf(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function demoReq(headers: Record<string, string>) {
  return { headers };
}

afterEach(() => {
  delete process.env.AUTH_MODE;
});

describe('AdminGuard（全体工作人员）', () => {
  const guard = new AdminGuard();

  it('未携带身份 → 401', () => {
    expect(() => guard.canActivate(contextOf(demoReq({})))).toThrow(UnauthorizedException);
  });

  it('普通用户角色 → 403', () => {
    expect(() =>
      guard.canActivate(contextOf(demoReq({ 'x-user-id': 'u1', 'x-user-role': 'user' }))),
    ).toThrow(ForbiddenException);
  });

  it.each(['admin', 'exam_reviewer', 'resource_reviewer'])('工作人员角色 %s → 放行', (role) => {
    const req = demoReq({ 'x-user-id': 'u1', 'x-user-role': role });
    expect(guard.canActivate(contextOf(req))).toBe(true);
    expect((req as Record<string, unknown>).user).toEqual({ id: 'u1', role });
  });
});

describe('StrictAdminGuard（提交公告来源仅限 admin）', () => {
  const guard = new StrictAdminGuard();

  it('admin → 放行', () => {
    expect(
      guard.canActivate(contextOf(demoReq({ 'x-user-id': 'u1', 'x-user-role': 'admin' }))),
    ).toBe(true);
  });

  it.each(['exam_reviewer', 'resource_reviewer'])('审核角色 %s 不可提交来源 → 403（职责分离）', (role) => {
    expect(() =>
      guard.canActivate(contextOf(demoReq({ 'x-user-id': 'u1', 'x-user-role': role }))),
    ).toThrow(ForbiddenException);
  });
});

describe('ReviewGuard（审核与发布）', () => {
  const guard = new ReviewGuard();

  it.each(['admin', 'exam_reviewer'])('审核角色 %s → 放行', (role) => {
    expect(
      guard.canActivate(contextOf(demoReq({ 'x-user-id': 'u1', 'x-user-role': role }))),
    ).toBe(true);
  });

  it('resource_reviewer 无审核权限 → 403', () => {
    expect(() =>
      guard.canActivate(
        contextOf(demoReq({ 'x-user-id': 'u1', 'x-user-role': 'resource_reviewer' })),
      ),
    ).toThrow(ForbiddenException);
  });

  it('未携带身份 → 401', () => {
    expect(() => guard.canActivate(contextOf(demoReq({})))).toThrow(UnauthorizedException);
  });
});

describe('invited 模式：身份只认服务端会话', () => {
  const guard = new AdminGuard();

  it('invited 模式下伪造 x-user-role 请求头不被采信 → 401', () => {
    process.env.AUTH_MODE = 'invited';
    const req = demoReq({ 'x-user-id': 'u1', 'x-user-role': 'admin' });
    expect(() => guard.canActivate(contextOf(req))).toThrow(UnauthorizedException);
  });

  it('invited 模式下服务端会话身份生效 → 放行', () => {
    process.env.AUTH_MODE = 'invited';
    const req = { headers: {}, user: { id: 'u1', role: 'admin' } };
    expect(guard.canActivate(contextOf(req))).toBe(true);
  });
});
