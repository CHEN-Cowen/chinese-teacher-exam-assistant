/**
 * v7.2 来源管理页测试。
 *
 * 无 @testing-library 依赖（与 onboarding/page.test.tsx 同约定，createRoot + act）：
 * - 五档健康状态徽标、四计数、连续失败强调、待审核积压；
 * - 「立即检查」成功 / deduplicated / 网络失败反馈；
 * - 暂停 / 恢复二次确认流程；
 * - 响应式：桌面表格与移动卡片两套结构同时存在且按钮均可操作。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/auth", () => ({
  AUTH_MODE: "public",
  authService: { getSession: () => null },
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

import AdminSourcesPage from "./page";

// ==================== 测试数据 ====================

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "succeeded",
    trigger: "schedule",
    startedAt: "2026-10-13T08:00:00.000Z",
    finishedAt: "2026-10-13T08:01:00.000Z",
    discoveredCount: 12,
    downloadedCount: 3,
    unchangedCount: 9,
    failedCount: 0,
    adapterVersion: "wp4-v1",
    errorSummary: null,
    ...overrides,
  };
}

function makeSource(overrides: Record<string, unknown>) {
  return {
    id: "s-x",
    publisher: "某市教育局",
    officialUrl: "https://edu.example.gov.cn/list",
    enabled: true,
    adapterKey: "gov-list",
    healthStatus: "healthy",
    consecutiveFailures: 0,
    lastCheckedAt: "2026-10-13T08:00:00.000Z",
    lastSuccessAt: "2026-10-13T08:00:00.000Z",
    nextCheckAt: "2026-10-13T09:00:00.000Z",
    lastFailReason: null,
    latestRun: makeRun(),
    parserVersion: "parser-v3",
    pendingReviewCount: 0,
    ...overrides,
  };
}

const FIVE_SOURCES = [
  makeSource({ id: "s1", publisher: "杭州市教育局", healthStatus: "healthy", pendingReviewCount: 2 }),
  makeSource({
    id: "s2",
    publisher: "宁波市教育局",
    healthStatus: "degraded",
    consecutiveFailures: 3,
    latestRun: makeRun({ id: "run-2", failedCount: 1 }),
  }),
  makeSource({
    id: "s3",
    publisher: "温州市教育局",
    healthStatus: "structure_changed",
    consecutiveFailures: 1,
  }),
  makeSource({
    id: "s4",
    publisher: "绍兴市教育局",
    healthStatus: "blocked",
    consecutiveFailures: 5,
    lastFailReason: "验证码拦截",
  }),
  makeSource({
    id: "s5",
    publisher: "台州市教育局",
    healthStatus: "paused",
    latestRun: null,
    parserVersion: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    nextCheckAt: null,
  }),
];

const HEALTH_BODY = {
  sources: FIVE_SOURCES,
  queue: { waiting: 2, delayed: 1, active: 3 },
};

// ==================== fetch mock ====================

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as Response;
}

type CheckResult =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "reject"; error: Error };

let checkQueue: CheckResult[] = [];

const fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
  void init; // 保留参数位以便断言调用签名
  const u = String(url);
  if (u.includes("/check")) {
    const next = checkQueue.shift() ?? {
      kind: "ok" as const,
      body: {
        runId: "run-new-123456",
        sourceId: "s1",
        trigger: "admin",
        status: "queued",
        jobId: "job-1",
        deduplicated: false,
      },
    };
    if (next.kind === "reject") return Promise.reject(next.error);
    return Promise.resolve(jsonResponse(next.body));
  }
  if (u.includes("/pause")) return Promise.resolve(jsonResponse({ sourceId: "s1", paused: true }));
  if (u.includes("/resume")) return Promise.resolve(jsonResponse({ sourceId: "s5", paused: false }));
  if (u.includes("/runs")) return Promise.resolve(jsonResponse({ runs: [] }));
  if (u.includes("/documents")) return Promise.resolve(jsonResponse({ documents: [] }));
  return Promise.resolve(jsonResponse(HEALTH_BODY));
});

// ==================== 渲染辅助 ====================

let cleanup: (() => void) | null = null;

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AdminSourcesPage));
  });
  const page = {
    container,
    html: () => container.innerHTML,
  };
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return page;
}

function findButton(container: HTMLElement, text: string, scope?: Element): HTMLButtonElement {
  const root = scope ?? container;
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`按钮不存在：${text}`);
  return btn as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  checkQueue = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

// ==================== 测试 ====================

describe("来源管理页：列表渲染", () => {
  it("五档健康状态徽标、四计数、连续失败强调、待审核积压与队列摘要", async () => {
    const { container, html } = await renderPage();

    // 五档健康状态徽标
    for (const status of ["healthy", "degraded", "structure_changed", "blocked", "paused"]) {
      expect(container.querySelector(`[data-testid="health-badge-${status}"]`)).toBeTruthy();
    }
    expect(html()).toContain("健康");
    expect(html()).toContain("延迟");
    expect(html()).toContain("结构变化");
    expect(html()).toContain("被阻止");
    expect(html()).toContain("人工暂停");

    // 最近一次运行四计数（发现 / 新增 / 未变化 / 失败）
    expect(html()).toContain("发现");
    expect(html()).toContain("新增");
    expect(html()).toContain("未变化");
    expect(html()).toContain("失败");

    // 连续失败 >0 时红色强调
    const redSpans = Array.from(container.querySelectorAll("span")).filter(
      (el) => el.textContent === "5" && el.className.includes("text-red-600")
    );
    expect(redSpans.length).toBeGreaterThan(0);

    // 待审核积压：amber 强调并链接 /admin/pipeline
    const pendingLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/admin/pipeline"
    );
    expect(pendingLink).toBeTruthy();
    expect(pendingLink!.textContent).toContain("2 待审核");
    expect(pendingLink!.className).toContain("bg-amber-100");

    // 队列积压摘要
    expect(html()).toContain("抓取队列积压");

    // null 时间显示占位
    expect(html()).toContain("—");
  });
});

describe("来源管理页：立即检查", () => {
  it("成功触发：调用 check 接口并显示成功提示", async () => {
    const { container, html } = await renderPage();
    const table = container.querySelector('[data-testid="sources-table"]') as HTMLElement;

    await click(findButton(container, "立即检查", table));

    const checkCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/s1/check"));
    expect(checkCall).toBeTruthy();
    expect((checkCall![1] as RequestInit)?.method).toBe("POST");
    expect(html()).toContain("已触发检查");
  });

  it("deduplicated=true：提示已有进行中的检查", async () => {
    checkQueue.push({
      kind: "ok",
      body: {
        runId: "run-existing",
        sourceId: "s1",
        trigger: "admin",
        status: "already_running",
        jobId: null,
        deduplicated: true,
      },
    });
    const { container, html } = await renderPage();
    const table = container.querySelector('[data-testid="sources-table"]') as HTMLElement;

    await click(findButton(container, "立即检查", table));

    expect(html()).toContain("该来源已有进行中的检查");
  });

  it("网络失败：显示错误条，按钮恢复可重试", async () => {
    checkQueue.push({ kind: "reject", error: new Error("network down") });
    const { container } = await renderPage();
    const table = container.querySelector('[data-testid="sources-table"]') as HTMLElement;
    const btn = findButton(container, "立即检查", table);

    await click(btn);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("检查触发失败");
    expect(alert!.textContent).toContain("请重试");
    // 失败后按钮恢复可用（可重试）
    expect(findButton(container, "立即检查", table).disabled).toBe(false);
  });
});

describe("来源管理页：暂停与恢复", () => {
  it("暂停：需二次确认，确认后调用 pause 并提示", async () => {
    const { container, html } = await renderPage();
    const table = container.querySelector('[data-testid="sources-table"]') as HTMLElement;

    // 未确认前不会发请求
    await click(findButton(container, "暂停", table));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/pause"))).toBe(false);

    await click(findButton(container, "确认暂停", table));
    const pauseCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/s1/pause"));
    expect(pauseCall).toBeTruthy();
    expect((pauseCall![1] as RequestInit)?.method).toBe("POST");
    expect(html()).toContain("已暂停「杭州市教育局」的自动抓取");
  });

  it("恢复：二次确认后调用 resume 并提示", async () => {
    const { container, html } = await renderPage();
    const table = container.querySelector('[data-testid="sources-table"]') as HTMLElement;

    await click(findButton(container, "恢复", table));
    await click(findButton(container, "确认恢复", table));

    const resumeCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/s5/resume"));
    expect(resumeCall).toBeTruthy();
    expect(html()).toContain("已恢复「台州市教育局」的抓取");
  });
});

describe("来源管理页：响应式双结构", () => {
  it("桌面表格与移动卡片同时存在，两套「立即检查」按钮均可操作", async () => {
    const { container } = await renderPage();

    const desktopWrap = container.querySelector('[data-testid="sources-table"]');
    const mobileWrap = container.querySelector('[data-testid="sources-cards"]');
    expect(desktopWrap).toBeTruthy();
    expect(mobileWrap).toBeTruthy();
    // 桌面容器带断点隐藏类，移动容器反之
    expect(desktopWrap!.parentElement?.className).toContain("hidden md:block");
    expect((mobileWrap as HTMLElement).className).toContain("md:hidden");

    // 两套结构各有 5 个「立即检查」按钮，且均可聚焦/可操作
    for (const scope of [desktopWrap as HTMLElement, mobileWrap as HTMLElement]) {
      const buttons = Array.from(scope.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("立即检查")
      ) as HTMLButtonElement[];
      expect(buttons.length).toBe(5);
      for (const b of buttons) {
        expect(b.disabled).toBe(false);
        expect(b.tabIndex).not.toBe(-1);
      }
    }
  });
});
