/**
 * useActiveProfile 的 isGuest 判定回归测试（v7.1 M10 修复）。
 *
 * 背景：M8 引入登录后置后，demo 模式下 isGuest 曾被硬编码为 true，
 * 导致已登录演示账号在详情页「保存机会 / 设为重点准备」被反复重定向到
 * 登录页，原动作永远无法完成（违反 M8「登录后原动作可以继续完成」）。
 *
 * 本测试锁定：demo 模式下 isGuest 跟随认证状态；会话恢复中先等待。
 */
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import type { ActiveProfileLoadState } from "./useOpportunities";

// React 19 的 act 需要显式声明测试环境
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let mockAuthMode: "demo" | "invited" = "demo";
let mockStatus: "loading" | "authenticated" | "unauthenticated" = "unauthenticated";
vi.mock("@/lib/auth", () => ({
  get AUTH_MODE() {
    return mockAuthMode;
  },
  useCurrentUser: () => ({ status: mockStatus }),
}));

const READY_PROFILE = { userId: "u-001" } as unknown as UserRecruitmentProfile;
let mockActive:
  | { ready: true; profile: UserRecruitmentProfile }
  | { ready: false; reason: "incomplete" } = {
  ready: true,
  profile: READY_PROFILE,
};
vi.mock("@/lib/profile/activeProfile", () => ({
  buildActiveProfile: () => mockActive,
}));

vi.mock("@/lib/profile/profileApi", () => ({
  profileApi: { getProfile: vi.fn() },
}));

vi.mock("@/lib/analytics/eventService", () => ({
  trackOncePerUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { useActiveProfile } from "./useOpportunities";

// 在 effect 中写回 hook 状态（渲染期不允许副作用；act 会同步刷新 effects）
const capturedRef: { current: ActiveProfileLoadState | null } = { current: null };
function Probe() {
  const state = useActiveProfile();
  useEffect(() => {
    capturedRef.current = state;
  }, [state]);
  return null;
}

let cleanup: (() => void) | null = null;

async function renderProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  capturedRef.current = null;
  mockAuthMode = "demo";
  mockStatus = "unauthenticated";
  mockActive = { ready: true, profile: READY_PROFILE };
});

describe("useActiveProfile · demo 模式 isGuest 跟随认证状态（M10 回归）", () => {
  it("已登录演示账号：isGuest=false，不再触发登录跳转", async () => {
    mockStatus = "authenticated";
    cleanup = await renderProbe();
    expect(capturedRef.current).toMatchObject({ status: "ready", isGuest: false });
  });

  it("未登录访客：isGuest=true，保存/设主要目标时才触发登录", async () => {
    mockStatus = "unauthenticated";
    cleanup = await renderProbe();
    expect(capturedRef.current).toMatchObject({ status: "ready", isGuest: true });
  });

  it("会话恢复中：保持 loading，不把已登录用户短暂误判为访客", async () => {
    mockStatus = "loading";
    cleanup = await renderProbe();
    expect(capturedRef.current?.status).toBe("loading");
  });

  it("画像未完成时仍返回 no-profile", async () => {
    mockStatus = "authenticated";
    mockActive = { ready: false, reason: "incomplete" };
    cleanup = await renderProbe();
    expect(capturedRef.current).toMatchObject({ status: "no-profile" });
  });
});
