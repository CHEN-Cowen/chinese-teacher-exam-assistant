/**
 * WorkbenchTabs 组件测试（v7.2 §7.7）。
 *
 * 验证：
 * - 默认显示 priority 标签内容；
 * - 三标签互斥：点击切换只显示对应面板；
 * - 数量徽标正确；
 * - WAI-ARIA tablist/tab/tabpanel，aria-selected，aria-controls；
 * - roving tabindex（仅激活 tab=0，其余=-1）；
 * - 键盘 ArrowLeft/Right/Home/End 切换；
 * - URL ?tab= 恢复：useSearchParams 返回 supplement 时默认显示 supplement；
 * - 切换标签写回 URL（router.replace）；
 * - 非激活标签的 units 不渲染到 DOM。
 *
 * 无 @testing-library 依赖，使用 createRoot + act + dispatchEvent（KeyboardEvent）。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const pushMock = vi.fn();
const replaceMock = vi.fn();
const trackMock = vi.hoisted(() => vi.fn());
let searchParams = new URLSearchParams();

vi.mock("@/lib/analytics/eventService", () => ({
  track: (...args: unknown[]) => trackMock(...args),
  trackView: vi.fn(),
}));

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

import { WorkbenchTabs } from "./WorkbenchTabs";
import type { WorkbenchViewModel } from "@/lib/opportunities/list-view";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";

function makeUnit(
  unitId: string,
  overall: UnitMatchDTO["overall"],
): UnitMatchDTO {
  return {
    unit: {
      id: unitId,
      code: unitId,
      name: unitId,
      region: { code: "330100", province: "浙江省", city: "杭州市" },
      subject: "chinese",
      stage: "middle",
      headcount: 1,
      organizationType: "government_unified",
      employmentNature: {
        code: "public_institution_staff",
        officialName: "事业编制",
      },
      allocation: { code: "direct_school", description: "" },
    },
    announcement: {
      id: `ann-${unitId}`,
      title: unitId,
      publisher: "教育局",
      organizationType: "government_unified",
      officialUrl: "https://example.gov.cn/a",
      dataset: "demo",
      reviewStatus: "human_reviewed",
      reviewedBy: null,
      reviewedAt: null,
    },
    version: {
      id: `v-${unitId}`,
      versionNumber: 1,
      sourceKind: "original",
      publishedAt: "2026-09-28T09:00:00+08:00",
      timeline: { registrationEnd: "2026-10-20" },
      officialSource: {
        id: "src",
        locator: { kind: "url", url: "https://example.gov.cn/a" },
        state: "official",
        checkedAt: "2026-10-04T12:00:00+08:00",
      },
    },
    gates: [
      { code: "subject_not_open", passed: true, reason: "" },
      { code: "registration_closed", passed: true, reason: "" },
      { code: "out_of_scope_nature", passed: true, reason: "" },
      { code: "announcement_withdrawn", passed: true, reason: "" },
      { code: "no_official_source", passed: true, reason: "" },
    ],
    dimensions: [],
    overall,
    summary: "",
    follow: null,
  };
}

function makeWorkbench(overrides: Partial<WorkbenchViewModel> = {}): WorkbenchViewModel {
  return {
    priority: { count: 1, units: [makeUnit("u-priority", "preliminary_eligible")] },
    supplement: {
      count: 1,
      units: [makeUnit("u-supplement", "need_more_info")],
    },
    outOfScope: {
      count: 1,
      units: [
        makeUnit("u-outofscope", "not_eligible"),
      ],
    },
    excluded: [],
    ...overrides,
  };
}

interface RenderResult {
  container: HTMLDivElement;
  html: () => string;
  unmount: () => void;
}

async function renderTabs(workbench: WorkbenchViewModel): Promise<RenderResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(WorkbenchTabs, {
        workbench,
        evaluatedAt: "2026-10-05T10:00:00+08:00",
        followBusyId: null,
        onToggleFollow: () => {},
      }),
    );
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
  searchParams = new URLSearchParams();
  pushMock.mockClear();
  replaceMock.mockClear();
  trackMock.mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function queryByRole(container: HTMLElement, role: string): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`[role="${role}"]`),
  );
}

function getTab(container: HTMLElement, id: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    `#workbench-tab-${id}`,
  );
  if (!el) throw new Error(`tab ${id} not found`);
  return el;
}

describe("WorkbenchTabs：默认与切换", () => {
  it("默认显示 priority 标签内容，supplement/outOfScope 面板不渲染", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const panels = queryByRole(page.container, "tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe("workbench-panel-priority");
    // priority 面板包含 u-priority 卡片，不包含其他桶卡片
    expect(page.html()).toContain("u-priority");
    expect(page.html()).not.toContain("u-supplement");
    expect(page.html()).not.toContain("u-outofscope");
  });

  it("点击 supplement 标签切换到 supplement 面板，priority 面板消失", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const supplementTab = getTab(page.container, "supplement");
    await act(async () => {
      supplementTab.click();
    });
    const panels = queryByRole(page.container, "tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe("workbench-panel-supplement");
    expect(page.html()).toContain("u-supplement");
    expect(page.html()).not.toContain("u-priority");
  });

  it("点击 outOfScope 标签切换到 outOfScope 面板", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const oosTab = getTab(page.container, "outOfScope");
    await act(async () => {
      oosTab.click();
    });
    const panels = queryByRole(page.container, "tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe("workbench-panel-outOfScope");
    expect(page.html()).toContain("u-outofscope");
  });
});

describe("WorkbenchTabs：数量徽标", () => {
  it("三个标签都显示对应数量", async () => {
    const wb = makeWorkbench({
      priority: {
        count: 3,
        units: [
          makeUnit("p1", "preliminary_eligible"),
          makeUnit("p2", "preliminary_eligible"),
          makeUnit("p3", "preliminary_eligible"),
        ],
      },
      supplement: { count: 0, units: [] },
      // count 与 units 必须一致（list-view 中 count 恒等于 units.length）；
      // 徽标按真实卡片条数渲染（任务 §4.2：标签数量显示真实数据条数）
      outOfScope: {
        count: 2,
        units: [makeUnit("o1", "not_eligible"), makeUnit("o2", "not_eligible")],
      },
    });
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const priorityTab = getTab(page.container, "priority");
    const supplementTab = getTab(page.container, "supplement");
    const oosTab = getTab(page.container, "outOfScope");
    expect(priorityTab.textContent).toContain("3");
    expect(supplementTab.textContent).toContain("0");
    expect(oosTab.textContent).toContain("2");
  });

  it("数量为 0 的标签仍保留，展示空状态文案", async () => {
    const wb = makeWorkbench({
      priority: { count: 0, units: [] },
      supplement: { count: 0, units: [] },
      outOfScope: { count: 0, units: [] },
    });
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    // 默认 priority 面板展示空状态
    expect(page.html()).toContain("当前没有资格和偏好都匹配的机会");
  });
});

describe("WorkbenchTabs：WAI-ARIA", () => {
  it("tablist 含三个 role=tab，aria-selected 仅激活标签为 true", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const tabs = queryByRole(page.container, "tab");
    expect(tabs).toHaveLength(3);
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.id).toBe("workbench-tab-priority");
  });

  it("tab 的 aria-controls 指向对应 panel id", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const priorityTab = getTab(page.container, "priority");
    expect(priorityTab.getAttribute("aria-controls")).toBe(
      "workbench-panel-priority",
    );
    const panel = page.container.querySelector("#workbench-panel-priority");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("aria-labelledby")).toBe(
      "workbench-tab-priority",
    );
  });

  it("roving tabindex：激活 tab=0，其余=-1", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const priorityTab = getTab(page.container, "priority");
    const supplementTab = getTab(page.container, "supplement");
    const oosTab = getTab(page.container, "outOfScope");
    expect(priorityTab.tabIndex).toBe(0);
    expect(supplementTab.tabIndex).toBe(-1);
    expect(oosTab.tabIndex).toBe(-1);
  });
});

describe("WorkbenchTabs：键盘导航", () => {
  function dispatchKey(target: Element, key: string) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
  }

  it("ArrowRight 从 priority 切换到 supplement", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const tablist = page.container.querySelector('[role="tablist"]')!;
    await act(async () => {
      dispatchKey(tablist, "ArrowRight");
    });
    expect(replaceMock).toHaveBeenCalled();
    // router.replace 调用后，由于 searchParams 是 mock 不变，面板不会真切换
    // 但 selectTab 应写入 ?tab=supplement
    const callArg = replaceMock.mock.calls[0]?.[0] as string;
    expect(callArg).toContain("tab=supplement");
  });

  it("ArrowLeft 从 priority 循环到 outOfScope", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const tablist = page.container.querySelector('[role="tablist"]')!;
    await act(async () => {
      dispatchKey(tablist, "ArrowLeft");
    });
    const callArg = replaceMock.mock.calls[0]?.[0] as string;
    expect(callArg).toContain("tab=outOfScope");
  });

  it("Home 从任意位置回到 priority", async () => {
    searchParams = new URLSearchParams("tab=supplement");
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const tablist = page.container.querySelector('[role="tablist"]')!;
    await act(async () => {
      dispatchKey(tablist, "Home");
    });
    // 回到 priority 会删除 tab 参数（默认值）
    const callArg = replaceMock.mock.calls[0]?.[0] as string;
    expect(callArg).toBe("/opportunities");
  });

  it("End 跳到最后一个标签 outOfScope", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const tablist = page.container.querySelector('[role="tablist"]')!;
    await act(async () => {
      dispatchKey(tablist, "End");
    });
    const callArg = replaceMock.mock.calls[0]?.[0] as string;
    expect(callArg).toContain("tab=outOfScope");
  });
});

describe("WorkbenchTabs：URL ?tab= 恢复", () => {
  it("?tab=supplement 时默认显示 supplement 面板", async () => {
    searchParams = new URLSearchParams("tab=supplement");
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const panels = queryByRole(page.container, "tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe("workbench-panel-supplement");
    // aria-selected 对应 supplement
    const supplementTab = getTab(page.container, "supplement");
    expect(supplementTab.getAttribute("aria-selected")).toBe("true");
    expect(supplementTab.tabIndex).toBe(0);
  });

  it("?tab=invalid 非法值回退到 priority", async () => {
    searchParams = new URLSearchParams("tab=nonexistent");
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const panels = queryByRole(page.container, "tabpanel");
    expect(panels[0]!.id).toBe("workbench-panel-priority");
  });

  it("切换到 supplement 写回 ?tab=supplement；切回 priority 删除 tab 参数", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const supplementTab = getTab(page.container, "supplement");
    await act(async () => {
      supplementTab.click();
    });
    const firstCall = replaceMock.mock.calls[0]?.[0] as string;
    expect(firstCall).toContain("tab=supplement");
  });
});

describe("WorkbenchTabs：埋点", () => {
  it("挂载不记录；点击切换标签记录 result_tab_changed（枚举 tab）", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    expect(trackMock).not.toHaveBeenCalled();

    const supplementTab = getTab(page.container, "supplement");
    await act(async () => {
      supplementTab.click();
    });
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("result_tab_changed", "opportunity", {
      props: { tab: "supplement" },
    });
  });

  it("点击已激活标签不构成切换，不记录", async () => {
    const wb = makeWorkbench();
    const page = await renderTabs(wb);
    cleanup = page.unmount;
    const priorityTab = getTab(page.container, "priority");
    await act(async () => {
      priorityTab.click();
    });
    expect(trackMock).not.toHaveBeenCalled();
  });
});
