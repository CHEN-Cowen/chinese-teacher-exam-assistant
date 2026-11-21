/**
 * R01 教育经历页资料隔离与保存行为测试。
 *
 * 约定与 onboarding/page.test.tsx 一致：无 @testing-library，createRoot + act。
 *
 * 覆盖：
 * - 已登录且服务端有经历：服务端为准，本机不同的经历不自动替换，只提示导入；
 * - 已登录且服务端无经历：本机经历只提示，不静默写入服务端；
 * - 读取失败：显示错误并禁止保存（不把“没读到”当“没有画像”）；
 * - 保存冲突 409：保留页面输入并给出可恢复提示。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const getProfileWithMeta = vi.fn();
const patchProfile = vi.fn();
const saveProfile = vi.fn();

vi.mock("@/lib/auth", () => ({
  AUTH_MODE: "invited",
  useCurrentUser: () => ({ status: "authenticated", user: { id: "user-a" } }),
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

vi.mock("@/lib/profile/profileApi", () => ({
  profileApi: {
    getProfileWithMeta: (...args: unknown[]) => getProfileWithMeta(...args),
    patchProfile: (...args: unknown[]) => patchProfile(...args),
    saveProfile: (...args: unknown[]) => saveProfile(...args),
  },
}));

import EducationPage from "./page";

const SERVER_EXPERIENCE = {
  id: "server-1",
  stage: "master",
  majorFullName: "学科教学（语文）",
  teacherTraining: "unknown",
  majorConfirmed: true,
  source: "user",
};
const LOCAL_EXPERIENCE = {
  id: "local-1",
  stage: "bachelor",
  majorFullName: "汉语言文学（师范）",
  teacherTraining: "yes",
  majorConfirmed: true,
  source: "user",
};

let container: HTMLDivElement;
let root: Root;

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(EducationPage));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

/** 页面上所有输入框的当前值（受控输入的值不在 textContent 里） */
function inputValues(): string[] {
  return [...container.querySelectorAll("input")].map((input) => input.value);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  getProfileWithMeta.mockReset();
  patchProfile.mockReset();
  saveProfile.mockReset();
  localStorage.setItem("kb_profile_education_v1", JSON.stringify([LOCAL_EXPERIENCE]));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("已登录：服务端经历为准", () => {
  it("服务端有经历时不用本机经历替换，提示用户确认导入", async () => {
    getProfileWithMeta.mockResolvedValue({
      profile: {
        regions: [],
        educationExperiences: [SERVER_EXPERIENCE],
        legacyEducation: { confirmed: true },
      },
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    render();
    await flush();

    const text = container.textContent ?? "";
    expect(inputValues()).toContain("学科教学（语文）");
    expect(text).toContain("本机草稿与账号里保存的经历不一致");
    expect(text).toContain("汉语言文学（师范）");
    // 未经过用户确认，不得写入服务端
    expect(patchProfile).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("服务端无经历时只提示，不静默写入；确认后才导入", async () => {
    getProfileWithMeta.mockResolvedValue({
      profile: { regions: [], educationExperiences: [] },
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    patchProfile.mockResolvedValue({
      profile: { regions: [], educationExperiences: [LOCAL_EXPERIENCE] },
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    render();
    await flush();

    expect(container.textContent).toContain("本机还有登录前填写的教育经历");
    expect(patchProfile).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText("导入到账号")?.click();
      await Promise.resolve();
    });
    await flush();

    expect(patchProfile).toHaveBeenCalledTimes(1);
    const [patch] = patchProfile.mock.calls[0]!;
    expect(patch.educationExperiences.map((item: { id: string }) => item.id)).toEqual([
      "local-1",
    ]);
  });

  it("选择不使用本机草稿时不发请求，并清掉本机经历", async () => {
    getProfileWithMeta.mockResolvedValue({
      profile: { regions: [], educationExperiences: [] },
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    render();
    await flush();

    await act(async () => {
      buttonByText("不使用本机草稿")?.click();
      await Promise.resolve();
    });
    expect(patchProfile).not.toHaveBeenCalled();
    expect(localStorage.getItem("kb_profile_education_v1")).toBeNull();
  });
});

describe("读取失败与冲突", () => {
  it("读取失败提示错误且禁止保存", async () => {
    getProfileWithMeta.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    render();
    await flush();

    expect(container.textContent).toContain("没能读取账号里的教育经历");
    // 本机草稿仍在：说明不是“没有画像”
    expect(localStorage.getItem("kb_profile_education_v1")).not.toBeNull();
  });

  it("保存冲突 409：保留输入并给出可恢复提示", async () => {
    getProfileWithMeta
      .mockResolvedValueOnce({
        profile: {
          regions: [],
          educationExperiences: [SERVER_EXPERIENCE],
          legacyEducation: { confirmed: true },
        },
        updatedAt: "2026-10-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        profile: {
          regions: [],
          educationExperiences: [SERVER_EXPERIENCE],
          legacyEducation: { confirmed: true },
        },
        updatedAt: "2026-10-05T00:00:00.000Z",
      });
    patchProfile.mockRejectedValue(
      Object.assign(new Error("conflict"), { status: 409 }),
    );
    render();
    await flush();

    await act(async () => {
      buttonByText("保存")?.click();
      await Promise.resolve();
    });
    await flush();

    expect(container.textContent).toContain("保存时发现版本冲突");
    expect(inputValues()).toContain("学科教学（语文）");
  });
});
