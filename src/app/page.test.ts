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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// v7.2 Feature Flag mock：使用 getter 使 mockNewHome 可在测试间动态切换
let mockNewHome = false;
vi.mock("@/lib/flags", () => ({
  FLAGS: {
    get ff_new_home() { return mockNewHome; },
    ff_new_results: false,
    ff_targeted_supplement: false,
    ff_db_catalog: false,
    ff_active_crawl: false,
    ff_post_save_next: false,
  },
  isFeatureEnabled: (key: string) => key === "ff_new_home" ? mockNewHome : false,
  FEATURE_FLAG_KEYS: ["ff_new_home", "ff_new_results", "ff_targeted_supplement", "ff_db_catalog", "ff_active_crawl", "ff_post_save_next"],
  resolveSupplementTarget: (unitId: string) => ({ kind: "inline", unitId, anchor: "supplement" }),
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
  mockNewHome = false;
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

// ===========================================================================
// v7.2 结果先行首页（ff_new_home = true 时渲染）
// ===========================================================================

describe("v7.2 结果先行首页：内容与结构", () => {
  beforeEach(() => {
    mockNewHome = true;
  });

  it("主标题为「哪些教师岗位，你现在就能报？」且只有一个高强调 CTA「开始匹配岗位」", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("哪些教师岗位，你现在就能报？");
    expect(html).toContain("开始匹配岗位");
    // 唯一高强调 CTA：只有一个 start-onboarding 按钮
    expect((html.match(/data-testid="start-onboarding"/g) ?? []).length).toBe(1);
    // 旧首页主按钮文案不再出现
    expect(html).not.toContain("开始资格预筛");
  });

  it("CTA 点击进入 /onboarding 并记录埋点", async () => {
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

  it("结果预览有页面级示例标识，只标注一次", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // aside 有文字化 aria-label，不只靠颜色
    expect(html).toContain('aria-label="结果预览，示例非真实岗位"');
    // "结果预览 · 示例" 文本标识只出现一次
    expect((html.match(/结果预览 · 示例/g) ?? []).length).toBe(1);
  });

  it("预览不渲染完整公告（无主要依据/待确认事项/官方来源/最后核对时间等旧首页字段）", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).not.toContain("主要依据");
    expect(html).not.toContain("待确认事项");
    expect(html).not.toContain("官方来源");
    expect(html).not.toContain("最后核对时间");
    // 旧首页的结果示例卡免责长段落不出现在新首页
    expect(html).not.toContain("示例为虚构数据，仅用于说明判断方式");
  });

  it("预览包含三类结果标签和一个简化岗位", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // 三类互斥标签
    expect(html).toContain("优先机会");
    expect(html).toContain("补充后判断");
    expect(html).toContain("偏好范围外");
    // 一个简化岗位
    expect(html).toContain("杭州某公办初中 · 语文教师");
    expect(html).toContain("初步符合");
    expect(html).toContain("6 天后截止");
    expect(html).toContain("3 项已通过");
    expect(html).toContain("户籍待确认");
  });

  it("信任短句使用系统设计 Token，不重复免责声明", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("真实公告");
    expect(html).toContain("逐条可核对");
    expect(html).toContain("不确定就明确提示");
  });
});

describe("v7.2 结果先行首页：移动端顺序与响应式", () => {
  beforeEach(() => {
    mockNewHome = true;
  });

  it("移动端 DOM 顺序：CTA 在结果预览之前", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const cta = page.container.querySelector('[data-testid="start-onboarding"]');
    const preview = page.container.querySelector('[data-testid="result-preview"]');
    expect(cta).not.toBeNull();
    expect(preview).not.toBeNull();
    // CTA 在 DOM 中出现在 preview 之前
    const allElements = Array.from(page.container.querySelectorAll("*"));
    const ctaIndex = allElements.indexOf(cta!);
    const previewIndex = allElements.indexOf(preview!);
    expect(ctaIndex).toBeLessThan(previewIndex);
  });

  it("移动端 DOM 顺序：信任短句在结果预览之后", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const preview = page.container.querySelector('[data-testid="result-preview"]');
    const trust = page.container.querySelector('[data-testid="home-trust-chips"]');
    expect(preview).not.toBeNull();
    expect(trust).not.toBeNull();
    const allElements = Array.from(page.container.querySelectorAll("*"));
    const previewIndex = allElements.indexOf(preview!);
    const trustIndex = allElements.indexOf(trust!);
    expect(previewIndex).toBeLessThan(trustIndex);
  });

  // jsdom 不计算布局，通过验证响应式 CSS 类是否存在来覆盖四档视口
  it("320px 宽度：内容容器和 CTA 在 HTML 中可访问", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 320;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // 内容容器 max-w-[1280px] 始终在 HTML 中
    expect(html).toContain("max-w-[1280px]");
    // CTA 按钮可访问
    expect(html).toContain('data-testid="start-onboarding"');
    // 桌面网格类存在（由 CSS 媒体查询决定是否生效）
    expect(html).toContain("lg:grid-cols-12");
  });

  it("768px 宽度：内容容器和预览在 HTML 中可访问", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 768;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("max-w-[1280px]");
    expect(html).toContain('data-testid="result-preview"');
    // sm: 断点类存在
    expect(html).toContain("sm:flex-row");
  });

  it("1024px 宽度：桌面网格类 lg:grid-cols-12 存在", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 1024;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("lg:grid-cols-12");
    expect(html).toContain("lg:col-span-5");
    expect(html).toContain("lg:col-span-7");
    expect(html).toContain("lg:col-start-1");
  });

  it("1440px 宽度：内容容器 max-w-1280px 不随屏幕无限增长", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 1440;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("max-w-[1280px]");
    // 标题不随屏幕无限增长（有 clamp 或 max-w 限制）
    expect(html).toContain("max-w-[30em]");
  });
});

describe("v7.2 结果先行首页：无障碍与依赖", () => {
  beforeEach(() => {
    mockNewHome = true;
  });

  it("键盘可操作：CTA 是 button 元素，登录是 a 元素", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const cta = page.container.querySelector('[data-testid="start-onboarding"]');
    expect(cta?.tagName).toBe("BUTTON");
    const loginLink = page.container.querySelector('a[href="/login"]');
    expect(loginLink?.tagName).toBe("A");
  });

  it("结果预览 aside 有文字化 aria-label", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const aside = page.container.querySelector('[data-testid="result-preview"]');
    expect(aside?.getAttribute("aria-label")).toContain("示例");
    expect(aside?.getAttribute("aria-label")).toContain("非真实岗位");
  });

  it("不加载远程字体和图标（HTML 中无 http(s) 外链）", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // 不出现远程字体 CDN 引用
    expect(html).not.toMatch(/https?:\/\/[^"'\s]+\.(woff2?|ttf|otf|eot)/i);
    // 不出现远程图标 CDN 引用
    expect(html).not.toMatch(/https?:\/\/[^"'\s]+(googleapis|gstatic|cdnjs|jsdelivr|unpkg)/i);
    // 不出现 @import 或 @font-face
    expect(html).not.toMatch(/@font-face/i);
    expect(html).not.toMatch(/@import/i);
    // SVG 使用 inline viewBox，不引用外部图片
    expect(html).not.toMatch(/<img[^>]+src="https?:\/\//i);
  });

  it("reduced motion：globals.css 包含 prefers-reduced-motion 规则", async () => {
    // 验证全局 CSS 中有 reduced motion 规则（通过 fs 读取 globals.css）
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "globals.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("焦点可见：globals.css 包含 focus-visible 样式", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "globals.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("focus-visible");
  });
});

describe("v7.2 Feature Flag 回退：ff_new_home 关闭时旧首页可回退", () => {
  // mockNewHome 默认 false（afterEach 重置），不修改它

  it("Flag 关闭时渲染旧首页「开始资格预筛」", async () => {
    // 确保 flag 关闭
    mockNewHome = false;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("开始资格预筛");
    expect(html).not.toContain("开始匹配岗位");
    expect(html).not.toContain("哪些教师岗位，你现在就能报？");
  });

  it("Flag 关闭时旧首页主按钮仍进入 /onboarding", async () => {
    mockNewHome = false;
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
  });
});
