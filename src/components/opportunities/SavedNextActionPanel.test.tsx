/**
 * SavedNextActionPanel 组件测试（v7.2 FR-4）。
 *
 * 验证：保存区明确「这不是报名」；唯一主动作按 href 类型渲染为页内锚点/
 * 路由/外链；强调态焦点落到主动作、安静态不抢焦点；动作曝光随 key 变化只记一次；
 * action=null 不硬造动作；撤销可点且 busy 时禁用。
 *
 * 无 @testing-library 依赖，使用 createRoot + act + dispatchEvent。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest }, children),
}));

import { SavedNextActionPanel } from "./SavedNextActionPanel";
import type { SavedNextAction } from "@/lib/opportunities/next-action-selector";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function action(over: Partial<SavedNextAction> = {}): SavedNextAction {
  return {
    tier: 1,
    kind: "resolve_blocker",
    key: "dim:sz-major",
    label: "先确认专业口径",
    detail: "公告使用「相关专业」开放表述，需向招聘单位确认。",
    href: "#to-confirm",
    ...over,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(props: Parameters<typeof SavedNextActionPanel>[0]) {
  act(() => {
    root.render(createElement(SavedNextActionPanel, props));
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SavedNextActionPanel", () => {
  it("强调态渲染保存事实与唯一主动作，明确不是报名", () => {
    render({
      action: action(),
      emphasized: true,
      syncedEventCount: 3,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
    });
    const panel = container.querySelector('[data-testid="saved-next-action-panel"]')!;
    expect(panel.getAttribute("data-emphasized")).toBe("true");
    expect(panel.textContent).toContain("已保存，并加入报考日程");
    expect(panel.textContent).toContain("这不是报名，报名须在官方入口完成。");
    expect(panel.textContent).toContain("已同步 3 个官方日程节点");

    const primaries = container.querySelectorAll('[data-testid="saved-next-action-primary"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe("先确认专业口径");
  });

  it("强调态挂载后焦点落在主动作上，屏幕阅读器状态区可见", () => {
    render({
      action: action(),
      emphasized: true,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
    });
    const panel = container.querySelector('[data-testid="saved-next-action-panel"]')!;
    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.getAttribute("aria-live")).toBe("polite");
    const primary = container.querySelector('[data-testid="saved-next-action-primary"]')!;
    expect(document.activeElement).toBe(primary);
  });

  it("安静态不显示收起按钮、不抢焦点，仍保留保存事实与撤销", () => {
    render({
      action: action(),
      emphasized: false,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
    });
    expect(
      container.querySelector('[data-testid="saved-next-action-dismiss"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="saved-next-action-panel"]')!.getAttribute(
        "data-emphasized",
      ),
    ).toBe("false");
    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector('[data-testid="saved-next-action-undo"]')).not.toBeNull();
  });

  it("页内锚点主动作点击时打开目标并阻止默认跳转", async () => {
    const onAnchor = vi.fn();
    render({
      action: action({ href: "#to-confirm" }),
      emphasized: true,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor,
    });
    const primary = container.querySelector<HTMLAnchorElement>(
      '[data-testid="saved-next-action-primary"]',
    )!;
    expect(primary.tagName).toBe("A");
    expect(primary.getAttribute("href")).toBe("#to-confirm");
    await click(primary);
    expect(onAnchor).toHaveBeenCalledWith("to-confirm");
  });

  it("路由动作渲染为同站链接、外链带 target/rel", () => {
    render({
      action: action({
        kind: "schedule_node",
        key: "evt:written_exam",
        href: "/schedule",
        label: "查看报考日程",
        external: false,
      }),
      emphasized: false,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
    });
    const internal = container.querySelector<HTMLAnchorElement>(
      '[data-testid="saved-next-action-primary"]',
    )!;
    expect(internal.getAttribute("href")).toBe("/schedule");
    expect(internal.getAttribute("target")).toBeNull();

    render({
      action: action({
        kind: "urgent_node",
        key: "evt:registration_end",
        href: "https://rsks.example.gov.cn/signup",
        external: true,
        label: "去官方入口报名",
      }),
      emphasized: false,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
    });
    const external = container.querySelector<HTMLAnchorElement>(
      '[data-testid="saved-next-action-primary"]',
    )!;
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toContain("noopener");
  });

  it("action=null 时不硬造动作，只给安静说明与撤销", () => {
    render({
      action: null,
      emphasized: false,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
    });
    expect(
      container.querySelector('[data-testid="saved-next-action-primary"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="saved-next-action-empty"]')!.textContent,
    ).toContain("当前没有需要立即处理的事项");
  });

  it("撤销保存点击回调，busy 时禁用；收起按钮回调", async () => {
    const onUnfollow = vi.fn();
    const onDismiss = vi.fn();
    const props = {
      action: action(),
      emphasized: true,
      onUnfollow,
      onDismiss,
      onAnchor: vi.fn(),
    };
    render(props);
    await click(container.querySelector('[data-testid="saved-next-action-undo"]')!);
    expect(onUnfollow).toHaveBeenCalledTimes(1);
    await click(container.querySelector('[data-testid="saved-next-action-dismiss"]')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    render({ ...props, busy: true });

    const undo = container.querySelector<HTMLButtonElement>(
      '[data-testid="saved-next-action-undo"]',
    )!;
    expect(undo.disabled).toBe(true);
  });

  it("动作曝光随 key 变化只记一次，不随无关重渲染重复", () => {
    const onActionOpened = vi.fn();
    const baseProps = {
      action: action(),
      emphasized: false,
      onUnfollow: vi.fn(),
      onDismiss: vi.fn(),
      onAnchor: vi.fn(),
      onActionOpened,
    };
    render(baseProps);
    expect(onActionOpened).toHaveBeenCalledTimes(1);
    expect(onActionOpened).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 1, kind: "resolve_blocker" }),
    );

    // 同一 key 重渲染（如 detail 文案更新）不重复曝光
    render({ ...baseProps, syncedEventCount: 2 });
    expect(onActionOpened).toHaveBeenCalledTimes(1);

    // 机会变化导致动作重算（新 key）→ 再次曝光
    render({
      ...baseProps,
      action: action({
        tier: 3,
        kind: "supplement_info",
        key: "missing:major",
        href: "#missing-info",
        label: "补全专业信息",
      }),
    });
    expect(onActionOpened).toHaveBeenCalledTimes(2);
  });
});
