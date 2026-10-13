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
    // v7.1 PRD §5.2：添加地区后必须询问「你对这个地区的考虑程度是？」
    expect(html).toContain("你对这个地区的考虑程度是？");
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

  it("不出现已被移出的就业状态字段；v7.2 用工偏好已进入第二屏", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    // 就业状态仍不在首次流程（按机会补问）
    expect(html).not.toContain("就业状态");
    // v7.2：用工偏好三档已进入第二屏末尾（PRD 7.4.2）
    expect(html).toContain("你想看哪类用工形式？");
    expect(html).toContain("只看事业编");
    expect(html).toContain("事业编优先，也看其他官方岗位");
    expect(html).toContain("暂不确定，先全部看看");
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

describe("第二屏：用工偏好（v7.2 PRD 7.4.2）", () => {
  beforeEach(() => {
    // 第一屏已完成 + 第二屏已有学历（满足 stepHasContent，按钮可点）
    mockSession = {
      draft: {
        regions: [{ code: "330000", province: "浙江省", level: "required" }],
        educationLevel: "bachelor",
        acceptedEmploymentNatures: [],
      },
      step: 1,
    };
  });

  it("三档偏好选项文案与 PRD 7.4.2 一致", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("只看事业编");
    expect(html).toContain("事业编优先，也看其他官方岗位");
    expect(html).toContain("暂不确定，先全部看看");
  });

  it("未选择偏好时不影响继续（行为等同 undecided，不阻断）", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const buttons = Array.from(page.container.querySelectorAll("button"));
    const nextBtn = buttons.find((b) => b.textContent?.includes("查看筛选结果"));
    expect(nextBtn).toBeDefined();
    // 第二屏已有一项实质内容（来自 beforeEach 的草稿不算实质；但 button 仍应可点）
    // 用工偏好未选择不阻断流程
    expect(nextBtn!.disabled).toBe(false);
  });

  it("已知偏好自动回填（旧画像兼容，已保存 public_only 高亮该项）", async () => {
    mockSession = {
      draft: {
        regions: [{ code: "330000", province: "浙江省", level: "required" }],
        educationLevel: "bachelor",
        acceptedEmploymentNatures: [],
        employmentNaturePreference: "public_only",
      },
      step: 1,
    };
    const page = await renderPage();
    cleanup = page.unmount;
    const publicBtn = page.container.querySelector(
      '[data-testid="employment-preference-public_only"]',
    ) as HTMLButtonElement;
    expect(publicBtn).not.toBeNull();
    expect(publicBtn.getAttribute("aria-pressed")).toBe("true");
    // 其他两项不高亮
    const openBtn = page.container.querySelector(
      '[data-testid="employment-preference-official_open"]',
    ) as HTMLButtonElement;
    expect(openBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("旧画像无 employmentNaturePreference 字段时不报错（向后兼容）", async () => {
    mockSession = {
      draft: {
        regions: [{ code: "330000", province: "浙江省", level: "required" }],
        educationLevel: "bachelor",
        // 故意不设置 employmentNaturePreference / acceptedEmploymentNatures
      },
      step: 1,
    };
    const page = await renderPage();
    cleanup = page.unmount;
    // 三个偏好按钮都不高亮
    const group = page.container.querySelector(
      '[data-testid="employment-preference-group"]',
    );
    expect(group).not.toBeNull();
    const pressed = group!.querySelectorAll('[aria-pressed="true"]');
    expect(pressed).toHaveLength(0);
  });

  it("选择偏好只记动作枚举（不记偏好正文），写入草稿", async () => {
    const trackMock = (await import("@/lib/analytics/eventService")).track;
    const page = await renderPage();
    cleanup = page.unmount;
    const openBtn = page.container.querySelector(
      '[data-testid="employment-preference-official_open"]',
    ) as HTMLButtonElement;
    await act(async () => {
      openBtn.click();
    });
    expect(trackMock).toHaveBeenCalledWith(
      "nature_preference_changed",
      "profile",
      { props: { value: "official_open" } },
    );
    // 选中后高亮
    expect(openBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("用工偏好出现在教师资格之后（PRD 7.4.2 顺序）", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    const certIdx = html.indexOf("教师资格");
    const prefIdx = html.indexOf("你想看哪类用工形式？");
    expect(certIdx).toBeGreaterThan(-1);
    expect(prefIdx).toBeGreaterThan(-1);
    expect(prefIdx).toBeGreaterThan(certIdx);
  });

  it("偏好不改变资格判断：未选偏好也能查看筛选结果", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("这只影响结果的筛选和排序，不会被当作资格不符合");
  });

  it("保存失败时偏好选择保留在页面（不丢输入）", async () => {
    const { guestSessionService } = await import("@/lib/guest/guestSession");
    const saveMock = guestSessionService.save as ReturnType<typeof vi.fn>;
    // goNext 调用 persist → save 抛错 → 停在本步、显示错误、输入不丢
    saveMock.mockImplementation(() => {
      throw new Error("storage full");
    });
    const page = await renderPage();
    cleanup = page.unmount;
    // 先选一个偏好
    const publicBtn = page.container.querySelector(
      '[data-testid="employment-preference-public_only"]',
    ) as HTMLButtonElement;
    await act(async () => {
      publicBtn.click();
    });
    expect(publicBtn.getAttribute("aria-pressed")).toBe("true");
    // 点击下一步（查看筛选结果）触发 persist 失败
    const buttons = Array.from(page.container.querySelectorAll("button"));
    const nextBtn = buttons.find((b) => b.textContent?.includes("查看筛选结果"));
    await act(async () => {
      nextBtn!.click();
    });
    // 没有跳转（保存失败拦截）
    expect(pushMock).not.toHaveBeenCalled();
    // 偏好选择仍在页面（不丢输入）
    expect(publicBtn.getAttribute("aria-pressed")).toBe("true");
    // 显示保存错误提示
    const errBanner = page.container.querySelector('[data-testid="save-error"]');
    expect(errBanner).not.toBeNull();
  });

  it("最终提交防止重复请求（submitting 标记后再次 goNext 不触发）", async () => {
    const { guestSessionService } = await import("@/lib/guest/guestSession");
    const saveMock = guestSessionService.save as ReturnType<typeof vi.fn>;
    saveMock.mockReturnValue(true);
    const page = await renderPage();
    cleanup = page.unmount;
    const buttons = Array.from(page.container.querySelectorAll("button"));
    const nextBtn = buttons.find((b) => b.textContent?.includes("查看筛选结果"));
    await act(async () => {
      nextBtn!.click();
    });
    const callsBefore = pushMock.mock.calls.length;
    await act(async () => {
      nextBtn!.click(); // 重复点击
    });
    // submitting 后重复点击不应再触发新的 push
    expect(pushMock.mock.calls.length).toBe(callsBefore);
  });

  it("键盘可达：偏好按钮为原生 button，aria-pressed 反映选中态", async () => {
    const page = await renderPage();
    cleanup = page.unmount;
    const buttons = page.container.querySelectorAll(
      '[data-testid^="employment-preference-"]:not([data-testid="employment-preference-group"])',
    );
    expect(buttons.length).toBe(3);
    buttons.forEach((b) => {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
    });
  });
});

describe("onboarding 职责边界（v7.2 PRD 7.4.2）", () => {
  it("第一屏只收地区意向和考虑程度，不出现学历/资格/偏好字段", async () => {
    // 不预设第二屏草稿，默认进入第一屏
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("你想优先查看哪些地区的教师招聘？");
    expect(html).not.toContain("最高学历");
    expect(html).not.toContain("教师资格");
    expect(html).not.toContain("你想看哪类用工形式？");
  });

  it("第二屏同时出现学历/毕业时间/专业/教师资格/用工偏好（PRD 7.4.2 完整字段）", async () => {
    mockSession = {
      draft: {
        regions: [{ code: "330000", province: "浙江省", level: "required" }],
        acceptedEmploymentNatures: [],
      },
      step: 1,
    };
    const page = await renderPage();
    cleanup = page.unmount;
    const html = page.html();
    expect(html).toContain("最高学历");
    expect(html).toContain("毕业（或预计毕业）时间");
    expect(html).toContain("专业全称");
    expect(html).toContain("教师资格");
    expect(html).toContain("你想看哪类用工形式？");
  });
});
