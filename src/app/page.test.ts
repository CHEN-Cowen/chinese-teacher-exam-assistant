/**
 * 首页单一入口（v7.1 M1）渲染与恢复跳转测试。
 *
 * 无 @testing-library 依赖（与 BottomNav.test.ts 同约定，用 createRoot + act）：
 * - 内容断言：首屏唯一主按钮、次级示例锚点、结果示例卡五要素、登录次级入口；
 * - 恢复跳转：mock useCurrentUser / guestSessionService，断言 router.replace 不回归；
 * - 主按钮行为：模拟点击，断言埋点 home_start_match_clicked 与 /onboarding 跳转。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 的 act 需要显式声明测试环境
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let mockStatus: "loading" | "authenticated" | "unauthenticated" = "unauthenticated";
vi.mock("@/lib/auth", () => ({
  useCurrentUser: () => ({ status: mockStatus }),
}));

let mockInProgress = false;
let mockComplete = false;
vi.mock("@/lib/guest/guestSession", () => ({
  guestSessionService: {
    isInProgress: () => mockInProgress,
    isComplete: () => mockComplete,
  },
}));

vi.mock("@/lib/analytics/eventService", () => ({
  track: vi.fn(),
  trackOncePerUser: vi.fn(),
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
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

import Home from "./page";

async function renderHome() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Home));
  });
  return {
    container,
    html: () => container.innerHTML,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  mockStatus = "unauthenticated";
  mockInProgress = false;
  mockComplete = false;
  pushMock.mockClear();
  replaceMock.mockClear();
});

describe("首页单一入口（v7.1 M1）", () => {
  it("首屏只有一个高强调主按钮「开始资格预筛」", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("开始资格预筛");
    expect((html.match(/data-testid="start-onboarding"/g) ?? []).length).toBe(1);
    // 不再出现右侧重复主操作与旧文案
    expect(html).not.toContain("开始匹配机会");
    expect(html).not.toContain("hero-question-start");
  });

  it("次级文字入口「先看结果示例」锚向结果示例卡", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("先看结果示例");
    expect(html).toContain('href="#result-example"');
    expect(html).toContain('id="result-example"');
    // 旧的 /preview 直链文案不再出现（新访客访问 /preview 会被弹回表单，属于误导入口）
    expect(html).not.toContain("先看看匹配示例");
  });

  it("结果示例卡明确标注，并展示五要素", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // 明确标注，不能被误认为真实岗位
    expect(html).toContain("结果示例 · 非真实岗位");
    // 五要素：匹配状态 / 主要依据 / 待确认事项 / 官方来源 / 最后核对时间
    expect(html).toContain("初步符合");
    expect(html).toContain("主要依据");
    expect(html).toContain("待确认事项");
    expect(html).toContain("官方来源");
    expect(html).toContain("最后核对时间");
    // 可访问性：示例卡有文字化 aria-label，标注不只靠颜色
    expect(html).toContain('aria-label="结果示例，非真实岗位"');
  });

  it("顶部「登录」保持次级入口", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain('href="/login"');
    expect(html).toContain("登录");
  });

  it("点击唯一主按钮记录埋点并进入 /onboarding", async () => {
    const { track } = await import("@/lib/analytics/eventService");
    const page = await renderHome();
    cleanup = page.unmount;
    const button = page.container.querySelector(
      '[data-testid="start-onboarding"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    expect(pushMock).toHaveBeenCalledWith("/onboarding");
    expect(track).toHaveBeenCalledWith("home_start_match_clicked", "home");
  });
});

describe("首页恢复跳转（v7.1 M1 不回归）", () => {
  it("已登录用户进入 /opportunities", async () => {
    mockStatus = "authenticated";
    const page = await renderHome();
    cleanup = page.unmount;
    expect(replaceMock).toHaveBeenCalledWith("/opportunities");
  });

  it("填写中访客回到 /onboarding", async () => {
    mockInProgress = true;
    const page = await renderHome();
    cleanup = page.unmount;
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("已完成预览访客回到 /preview", async () => {
    mockComplete = true;
    const page = await renderHome();
    cleanup = page.unmount;
    expect(replaceMock).toHaveBeenCalledWith("/preview");
  });

  it("全新访客停留在首页，不发生跳转", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(page.html()).toContain("开始资格预筛");
  });

  it("会话状态加载中只渲染加载页，不跳转", async () => {
    mockStatus = "loading";
    const page = await renderHome();
    cleanup = page.unmount;
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
