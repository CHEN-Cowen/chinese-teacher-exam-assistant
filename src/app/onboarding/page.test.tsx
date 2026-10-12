/**
 * 两屏基础画像（v7.1 M2）页面流程测试。
 *
 * 无 @testing-library 依赖（与 page.test.ts 同约定，用 createRoot + act）：
 * - 第一屏：地区主问题、三档选项、覆盖概览入口（非跳过）、无跳过按钮；
 * - 第二屏：学历/专业/资格主问题、跳过按钮、查看筛选结果；
 * - 恢复：带 step=1 草稿恢复到第二屏；
 * - 已完成访客：effect replace 到 /preview。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let mockStatus: "loading" | "authenticated" | "unauthenticated" = "unauthenticated";
vi.mock("@/lib/auth", () => ({
  useCurrentUser: () => ({ status: mockStatus }),
  AUTH_MODE: "public",
}));

// 部分模拟：纯函数和常量保持真实，只模拟 service 层
let mockSession: {
  draft: Record<string, unknown>;
  step: number;
} | null = null;
let mockIsComplete = false;
let mockIsInProgress = false;

vi.mock("@/lib/guest/guestSession", async () => {
  const actual = await vi.importActual("@/lib/guest/guestSession");
  return {
    ...actual,
    guestSessionService: {
      load: () => mockSession,
      save: vi.fn(() => true),
      isComplete: () => mockIsComplete,
      isInProgress: () => mockIsInProgress,
      clear: vi.fn(),
    },
  };
});

vi.mock("@/lib/analytics/eventService", () => ({
  track: vi.fn(),
  trackOncePerUser: vi.fn(),
}));

vi.mock("@/lib/profile/profileApi", () => ({
  profileApi: { saveProfile: vi.fn().mockResolvedValue(undefined) },
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParams,
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

import OnboardingPage from "./page";

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(OnboardingPage));
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

beforeEach(() => {
  localStorage.clear();
  mockStatus = "unauthenticated";
  mockSession = null;
  mockIsComplete = false;
  mockIsInProgress = false;
  searchParams = new URLSearchParams();
  pushMock.mockClear();
  replaceMock.mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("第一屏：地区意向（v7.1 M2）", () => {
  it("显示地区主问题标题", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    expect(page.html()).toContain("你想优先查看哪些地区的教师招聘？");
  });

  it("三档接受程度选项文案一致", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    // 先添加一个地区，才能看到三档选项
    const addBtn = Array.from(page.container.querySelectorAll("button")).find(
      (b) => b.textContent === "添加第一个地区",
    );
    expect(addBtn).toBeDefined();
    await act(async () => {
      addBtn!.click();
    });
    const html = page.html();
    expect(html).toContain("只考虑");
    expect(html).toContain("优先考虑");
    expect(html).toContain("也可以考虑");
  });

  it("有覆盖概览入口，不是跳过按钮", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    // 覆盖概览是 Disclosure 触发器，文案为"还没想好，先看看当前覆盖范围"
    expect(html).toContain("还没想好，先看看当前覆盖范围");
    // 不出现"暂不提供"跳过按钮（第一屏不允许跳过地区）
    expect(html).not.toContain("暂不提供");
  });

  it("未选地区时下一步按钮禁用", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    // 找到下一步/查看筛选结果按钮（非地区选项按钮）
    const buttons = Array.from(page.container.querySelectorAll("button"));
    const nextBtn = buttons.find((b) => b.textContent === "下一步");
    expect(nextBtn).toBeDefined();
    expect(nextBtn!.disabled).toBe(true);
  });

  it("提示文案引导用户选择地区或查看覆盖范围", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("请至少选择一个地区");
    expect(html).toContain("先看看当前覆盖范围");
  });
});

describe("第二屏：基础资格（v7.1 M2）", () => {
  beforeEach(() => {
    // 模拟第一屏已完成的草稿，恢复到第二屏
    mockSession = {
      draft: {
        regions: [
          { code: "330000", province: "浙江省", level: "required" },
        ],
        acceptedEmploymentNatures: ["public_institution_staff"],
      },
      step: 1,
    };
  });

  it("显示学历/专业/资格主问题标题", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    expect(page.html()).toContain("你的学历、专业和教师资格情况？");
  });

  it("有暂不提供跳过按钮", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    // 第二屏无实质内容时出现"暂不提供"按钮
    expect(html).toContain("暂不提供");
  });

  it("按钮文案为查看筛选结果", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("查看筛选结果");
  });

  it("不出现已被移出的就业状态/用工偏好字段", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    // 就业状态、用工偏好已从首次流程移出
    expect(html).not.toContain("就业状态");
    expect(html).not.toContain("用工形式");
  });
});

describe("恢复与跳转（v7.1 M2 不回归）", () => {
  it("已完成画像的访客被 replace 到 /preview", async () => {
    mockIsComplete = true;
    mockSession = {
      draft: {
        regions: [{ code: "330000", province: "浙江省", level: "required" }],
        educationLevel: "bachelor",
        acceptedEmploymentNatures: ["public_institution_staff"],
      },
      step: 2,
    };
    const page = await renderPage();
    cleanup = page.unmount;
    expect(replaceMock).toHaveBeenCalledWith("/preview");
  });

  it("已登录用户被 replace 到 /opportunities", async () => {
    mockStatus = "authenticated";
    const page = await renderPage();
    cleanup = page.unmount;
    expect(replaceMock).toHaveBeenCalledWith("/opportunities");
  });

  it("带 from= 参数进入不触发自动跳转（明确修改意图）", async () => {
    mockIsComplete = true;
    mockSession = {
      draft: {
        regions: [{ code: "330000", province: "浙江省", level: "required" }],
        educationLevel: "bachelor",
        acceptedEmploymentNatures: ["public_institution_staff"],
      },
      step: 2,
    };
    searchParams = new URLSearchParams("from=preview");
    const page = await renderPage();
    cleanup = page.unmount;
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
