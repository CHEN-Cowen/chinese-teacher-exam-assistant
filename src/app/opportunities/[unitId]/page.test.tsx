/**
 * v7.2 保存流程「失败显真 + 原地重试」页面级组件测试。
 *
 * 规格 FR-1.3：await 成功后才允许出现成功面板；失败只显示行内错误与「重试」，
 * 不出现任何成功 UI；重试成功后才出现 SavedNextActionPanel。
 *
 * 无 @testing-library（同仓库约定）：createRoot + act + 轮询等待。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// v7.2：ff_post_save_next 默认关闭会隐藏「保存后的下一步」面板（FLAGS 为构建期快照，
// 必须在模块求值前开启）；本文件锁定面板的失败显真与原地重试行为
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_FF_POST_SAVE_NEXT = "true";
});

/** vi.mock 会被提升，模块实现通过这个持有者在 beforeEach 中注入 */
const holders = vi.hoisted(() => ({
  follow: (() => Promise.resolve(undefined)) as (...args: unknown[]) => Promise<unknown>,
  unitDetail: (() =>
    Promise.resolve(undefined)) as (...args: unknown[]) => Promise<unknown>,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, useCurrentUser: () => ({ status: "authenticated" as const }) };
});

vi.mock("@/lib/opportunities/useOpportunities", () => {
  // 必须返回稳定引用：详情页 effect 依赖 profileState，新对象会导致无限重跑
  const ready = { status: "ready" as const, profile: null, isGuest: false };
  return { useActiveProfile: () => ready };
});

vi.mock("@/lib/opportunities/api", () => ({
  opportunitiesApi: {
    follow: (...args: unknown[]) => holders.follow(...args),
    unitDetail: (...args: unknown[]) => holders.unitDetail(...args),
  },
}));

vi.mock("@/lib/analytics/eventService", () => ({
  track: vi.fn(),
  trackView: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ unitId: "unit-hangzhou-01" }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest }, children),
}));

import { authService } from "@/lib/auth";
import { V61_SEED_PROFILE } from "@/lib/seed/v61-opportunities";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { demoOpportunitiesApi } from "@/lib/opportunities/demoApi";
import OpportunityDetailPage from "./page";

const UNIT_ID = "unit-hangzhou-01";
const GUEST_KEY = "kb_guest_profile_v61";

/** 与 E2E 相同、被匹配引擎接受的完整访客会话（refreshDetail 的 buildActiveProfile 读取） */
function seedGuestSession() {
  const now = Date.now();
  localStorage.setItem(
    GUEST_KEY,
    JSON.stringify({
      draft: {
        regions: [
          { code: "330000", province: "浙江省", level: "required" },
          { code: "320000", province: "江苏省", level: "consider" },
        ],
        educationLevel: "bachelor",
        degree: "bachelor",
        majorFullName: "汉语言文学（师范）",
        graduationDate: "2026-06-30",
        employmentStatus: "fresh_unemployed",
        socialSecurityMonths: 0,
        teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
        intendedSubject: "chinese",
        acceptedEmploymentNatures: [
          "public_institution_staff",
          "record_filing",
          "post_quota",
          "headcount_control",
          "other",
        ],
      },
      step: 2,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    }),
  );
}

async function flush(ms = 5) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await flush(10);
    if (predicate()) return;
  }
  throw new Error("waitFor 超时");
}

describe("v7.2 详情页：保存失败显真与原地重试", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    localStorage.clear();
    seedGuestSession();
    await authService.login({ account: "student@demo.app", password: "demo1234" });
    holders.unitDetail = (id) =>
      demoOpportunitiesApi.unitDetail(
        id as string,
        V61_SEED_PROFILE as UserRecruitmentProfile,
      );
    pushMock.mockClear();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    // 不向同 worker 的其他测试文件泄漏 flag 环境
    delete process.env.NEXT_PUBLIC_FF_POST_SAVE_NEXT;
  });

  it("follow 首次失败：不出现成功面板，显示行内错误与重试；重试成功后才出现面板", async () => {
    const followMock = vi.fn();
    followMock
      .mockRejectedValueOnce(new Error("网络异常，请稍后再试"))
      .mockImplementation(() => demoOpportunitiesApi.follow(UNIT_ID));
    holders.follow = followMock;

    await act(async () => {
      root.render(createElement(OpportunityDetailPage));
    });
    await waitFor(() =>
      Boolean(
        container.querySelector<HTMLElement>("#follow")?.querySelector("button"),
      ),
    );

    // 初始未保存：没有下一步面板
    expect(container.querySelector('[data-testid="saved-next-action-panel"]')).toBeNull();

    const saveButton = container
      .querySelector("#follow")!
      .querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      saveButton.click();
    });

    // 失败显真：错误条 + 重试，成功面板仍不出现
    await waitFor(() => container.textContent?.includes("网络异常，请稍后再试") === true);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="action-retry"]');
    expect(retry).not.toBeNull();
    expect(retry?.textContent?.trim()).toBe("重试");
    expect(container.querySelector('[data-testid="saved-next-action-panel"]')).toBeNull();

    // 重试：第二次 follow 成功（幂等接口），刷新后才出现成功面板，错误消失
    await act(async () => {
      retry!.click();
    });
    await waitFor(() =>
      Boolean(container.querySelector('[data-testid="saved-next-action-panel"]')),
    );
    expect(followMock).toHaveBeenCalledTimes(2);
    expect(container.textContent?.includes("网络异常")).toBe(false);
    expect(container.textContent).toContain("这不是报名");
  }, 30000);
});
