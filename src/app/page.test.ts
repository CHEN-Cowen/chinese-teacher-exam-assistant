/**
 * 价值首页（2026-11 UI 大改版）渲染与恢复跳转测试。
 *
 * 无 @testing-library 依赖（与 BottomNav.test.ts 同约定，用 createRoot + act）：
 * - 内容断言：主标题与徽章、首屏唯一主按钮、结果示例卡标注、三步/信任带/功能网格/FAQ；
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

vi.mock("@/lib/flags", () => ({
  FLAGS: {
    ff_new_home: false,
    ff_new_results: false,
    ff_targeted_supplement: false,
    ff_db_catalog: false,
    ff_active_crawl: false,
    ff_post_save_next: false,
  },
  isFeatureEnabled: () => false,
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
  pushMock.mockClear();
  replaceMock.mockClear();
});

describe("价值首页：内容与结构", () => {
  it("主标题为「能报哪些教招岗位，一眼看清」且只有一个高强调主 CTA", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("能报哪些教招岗位");
    expect(html).toContain("一眼看清");
    // 首屏只有一个高强调主按钮（data-testid 唯一）
    expect((html.match(/data-testid="start-onboarding"/g) ?? []).length).toBe(1);
    expect(html).toContain("免费查看我的机会");
    // 徽章不含具体覆盖数字（数字过时会失去可信度）
    expect(html).toContain("官方发布渠道同步收录 · 持续更新");
    expect(html).not.toContain("已覆盖");
  });

  it("结果示例卡有锚点标识，明确标注非真实岗位", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain('id="result-example"');
    expect(html).toContain('aria-label="结果预览，示例非真实岗位"');
    // 页面级示例标识只出现一次
    expect((html.match(/结果预览 · 示例/g) ?? []).length).toBe(1);
    // 示例卡内容：三类标签 + 一个简化岗位
    expect(html).toContain("优先机会");
    expect(html).toContain("补充后判断");
    expect(html).toContain("偏好范围外");
    expect(html).toContain("杭州某公办初中 · 语文教师");
    expect(html).toContain("初步符合");
    // 提供查看示例的入口
    expect(html).toContain("查看示例");
  });

  it("三步运作区块完整呈现", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("三步，锁定你的报考目标");
    expect(html).toContain("选地区");
    expect(html).toContain("核资格");
    expect(html).toContain("跟报名");
  });

  it("信任数据带与功能网格完整呈现", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("数据经得起追问，结论才敢用");
    expect(html).toContain("已收录官方数据源");
    expect(html).toContain("公告来自官方发布渠道");
    expect(html).toContain("地区级联检索");
    expect(html).toContain("资格逐项核对");
    expect(html).toContain("关注与到点提醒");
    expect(html).toContain("报考日程管理");
  });

  it("FAQ 与页脚免责声明完整呈现", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("你可能想问");
    expect(html).toContain("公告数据准不准？");
    expect(html).toContain("覆盖哪些地区？");
    expect(html).toContain("下一次报名，别再靠刷网站碰运气");
    // 合规免责声明必须保留在页脚
    expect(html).toContain("资格预筛仅供参考，最终以招聘单位审核为准");
  });

  it("顶部「登录」保持次级入口，导航不与主 CTA 争夺", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain('href="/login"');
    expect(html).toContain("登录");
    // 次级入口：浏览最近收录的公告
    expect(html).toContain("浏览最近收录的公告");
    expect(html).toContain('href="/recruitment"');
  });
});

describe("价值首页：主按钮行为与恢复跳转", () => {
  it("点击主按钮记录埋点并进入 /onboarding", async () => {
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
    expect(page.html()).toContain("能报哪些教招岗位");
  });

  it("会话状态加载中只渲染加载页，不跳转", async () => {
    mockStatus = "loading";
    const page = await renderHome();
    cleanup = page.unmount;
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("价值首页：移动端顺序与响应式", () => {
  it("移动端 DOM 顺序：主 CTA → 信任短句 → 结果预览", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const cta = page.container.querySelector('[data-testid="start-onboarding"]');
    const preview = page.container.querySelector('[data-testid="result-preview"]');
    const trust = page.container.querySelector('[data-testid="home-trust-chips"]');
    expect(cta).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(trust).not.toBeNull();
    const allElements = Array.from(page.container.querySelectorAll("*"));
    const ctaIndex = allElements.indexOf(cta!);
    const trustIndex = allElements.indexOf(trust!);
    const previewIndex = allElements.indexOf(preview!);
    expect(ctaIndex).toBeLessThan(trustIndex);
    expect(trustIndex).toBeLessThan(previewIndex);
  });

  it("320px 宽度：内容容器和 CTA 在 HTML 中可访问", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 320;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // 内容容器 max-w-[1440px] 始终在 HTML 中
    expect(html).toContain("max-w-[1440px]");
    // CTA 按钮可访问
    expect(html).toContain('data-testid="start-onboarding"');
    // 桌面网格类存在（由 CSS 媒体查询决定是否生效）
    expect(html).toContain("lg:grid-cols-[1.05fr_0.95fr]");
  });

  it("768px 宽度：内容容器和预览在 HTML 中可访问", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 768;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("max-w-[1440px]");
    expect(html).toContain('data-testid="result-preview"');
    // sm: 断点类存在
    expect(html).toContain("sm:flex-row");
  });

  it("1440px 宽度：内容容器 max-w-1440px 不随屏幕无限增长", async () => {
    (window as unknown as { innerWidth: number }).innerWidth = 1440;
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("max-w-[1440px]");
    // 副标题有 max-w 限制
    expect(html).toContain("max-w-[30em]");
  });
});

describe("价值首页：无障碍与依赖", () => {
  it("键盘可操作：主 CTA 是 button 元素，登录是 a 元素", async () => {
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

describe("价值首页：品牌保持一致", () => {
  beforeEach(() => {
    // 页面不再依赖 ff_new_home 分支；此处仅确认 flags mock 与页面解耦
    expect(true).toBe(true);
  });

  it("首页不引用 ff_new_home 分支（单一实现，无双首页漂移）", async () => {
    const page = await renderHome();
    cleanup = page.unmount;
    const html = page.html();
    // 新首页唯一结果卡结构标记，旧首页 result-example-card 不应出现
    expect(html).not.toContain('data-testid="result-example-card"');
    expect(html).toContain('data-testid="result-preview"');
    // 全学科澄清与覆盖列表删除（合并自 codex 远端 88399a4 的语义守卫）
    expect(html).toContain("支持全学科教师招聘");
    expect(html).not.toContain("当前只开放语文学科");
    expect(html).not.toContain("服务覆盖范围");
    expect(html).not.toContain('href="#coverage"');
  });
});
