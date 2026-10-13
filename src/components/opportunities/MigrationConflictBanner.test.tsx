/**
 * MigrationConflictBanner 组件测试（v7.2 登录迁移冲突确认 UI）。
 *
 * 验证：
 * - 展示冲突说明与两个选择按钮；
 * - 「使用本次填写的信息」：以最新 updatedAt PATCH 白名单字段，成功后 onResolved("guest")；
 * - PATCH 409：显示可重试提示，不调用 onResolved；
 * - 「保留已保存的信息」：清除本机补充事实并 onResolved("server")，不发 PATCH；
 * - 无 guestFacts 时只提供「保留已保存的信息」。
 *
 * 无 @testing-library 依赖，使用 createRoot + act + dispatchEvent。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { getProfileWithMetaMock, patchProfileMock } = vi.hoisted(() => ({
  getProfileWithMetaMock: vi.fn(),
  patchProfileMock: vi.fn(),
}));

vi.mock("@/lib/profile/profileApi", () => ({
  profileApi: {
    getProfileWithMeta: getProfileWithMetaMock,
    patchProfile: patchProfileMock,
  },
}));

import { MigrationConflictBanner } from "./MigrationConflictBanner";

const SUPPLEMENT_KEY = "kb_profile_supplement_v61";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("MigrationConflictBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    getProfileWithMetaMock.mockReset();
    patchProfileMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("展示冲突说明与两个按钮", () => {
    render(
      createElement(MigrationConflictBanner, {
        guestFacts: { birthDate: "1995-06-15" },
        onResolved: () => {},
      }),
    );
    expect(container.textContent).toContain("不确认前不会覆盖任何一边");
    expect(buttonByText("使用本次填写的信息")).toBeDefined();
    expect(buttonByText("保留已保存的信息")).toBeDefined();
  });

  it("使用本次填写的信息：PATCH 白名单字段 + 最新 updatedAt，成功回调 guest", async () => {
    getProfileWithMetaMock.mockResolvedValue({
      profile: { regions: [] },
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    patchProfileMock.mockResolvedValue({ profile: {}, updatedAt: "t2" });
    const onResolved = vi.fn();
    render(
      createElement(MigrationConflictBanner, {
        guestFacts: { birthDate: "1995-06-15", socialSecurityMonths: 6 },
        onResolved,
      }),
    );

    await click(buttonByText("使用本次填写的信息")!);

    expect(patchProfileMock).toHaveBeenCalledWith(
      { birthDate: "1995-06-15", socialSecurityMonths: 6 },
      "2026-10-13T00:00:00.000Z",
    );
    expect(onResolved).toHaveBeenCalledWith("guest");
  });

  it("PATCH 409：提示重试，不回调 onResolved", async () => {
    getProfileWithMetaMock.mockResolvedValue({ profile: {}, updatedAt: "t1" });
    const conflict = Object.assign(new Error("画像已在其他设备更新"), { status: 409 });
    patchProfileMock.mockRejectedValue(conflict);
    const onResolved = vi.fn();
    render(
      createElement(MigrationConflictBanner, {
        guestFacts: { birthDate: "1995-06-15" },
        onResolved,
      }),
    );

    await click(buttonByText("使用本次填写的信息")!);

    expect(onResolved).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("请");
  });

  it("保留已保存的信息：清除本机补充事实，回调 server，不发 PATCH", async () => {
    localStorage.setItem(SUPPLEMENT_KEY, JSON.stringify({ birthDate: "1995-06-15" }));
    const onResolved = vi.fn();
    render(
      createElement(MigrationConflictBanner, {
        guestFacts: { birthDate: "1995-06-15" },
        onResolved,
      }),
    );

    await click(buttonByText("保留已保存的信息")!);

    expect(onResolved).toHaveBeenCalledWith("server");
    expect(patchProfileMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(SUPPLEMENT_KEY)).toBe("{}");
  });

  it("无 guestFacts：只提供保留已保存的信息", () => {
    render(
      createElement(MigrationConflictBanner, {
        guestFacts: undefined,
        onResolved: () => {},
      }),
    );
    expect(buttonByText("使用本次填写的信息")).toBeUndefined();
    expect(buttonByText("保留已保存的信息")).toBeDefined();
  });
});
