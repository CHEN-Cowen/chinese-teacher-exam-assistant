/**
 * SupplementPageView 定向补充返回链接回归测试（v7.2 链路 B：返回 tab + focus 对应分类）。
 *
 * 覆盖：
 * - origin=opportunities + 重算后进入优先机会 → 顶部与底部返回链接为 /opportunities?tab=priority；
 * - origin=opportunities + 重算后仍是需补充信息 → /opportunities?tab=supplement；
 * - origin=opportunities + 重算后为需人工确认 → /opportunities?tab=supplement（与 classify.ts 一致）；
 * - origin=preview / detail / 未发生重算 → 保持原行为，不带 ?tab=；
 * - P0 不变量：任何分支下返回链接都不指向 /onboarding。
 *
 * 无 @testing-library 依赖，使用 createRoot + act + dispatchEvent（同仓库约定，
 * 参照 ConsultationPanel.test.tsx 与 app/opportunities/[unitId]/page.test.tsx）。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** vi.mock 会被提升，模块实现通过这个持有者在每个用例中注入单元详情 */
const holders = vi.hoisted(() => ({
  unitDetail: (() =>
    Promise.resolve(undefined)) as (...args: unknown[]) => Promise<unknown>,
  match: (() =>
    Promise.resolve({
      groups: {
        preliminary: [],
        needInfo: [],
        manualReview: [],
        notEligible: [],
        closed: [],
      },
    })) as (...args: unknown[]) => Promise<unknown>,
  /** useActiveProfile 返回值；默认访客就绪，用例可覆盖为已登录演示账号 */
  profileState: { status: "ready" as const, profile: {}, isGuest: true },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

// 必须返回稳定引用：详情 effect 依赖 profileState，新对象会导致无限重跑；
// 经持有者在用例间切换访客（isGuest=true）/已登录演示账号（isGuest=false）
vi.mock("@/lib/opportunities/useOpportunities", () => ({
  useActiveProfile: () => holders.profileState,
}));

vi.mock("@/lib/auth", () => ({
  useCurrentUser: () => ({ status: "authenticated" as const }),
}));

vi.mock("@/lib/opportunities/api", () => ({
  opportunitiesApi: {
    unitDetail: (...args: unknown[]) => holders.unitDetail(...args),
    match: (...args: unknown[]) => holders.match(...args),
  },
}));

vi.mock("@/lib/analytics/eventService", () => ({
  track: vi.fn(),
  trackView: vi.fn(),
}));

vi.mock("@/lib/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
  isForbiddenError: () => false,
}));

vi.mock("@/lib/profile/activeProfile", () => ({
  supplementFactsService: {
    load: () => ({}),
    save: (facts: unknown) => facts,
    clear: vi.fn(),
  },
  buildActiveProfile: () => ({ ready: true as const, profile: {} }),
  profileToSupplementFacts: () => ({}),
}));

vi.mock("@/lib/profile/profileRepository", () => ({
  createProfileRepository: vi.fn(),
  ProfileConflictError: class ProfileConflictError extends Error {},
}));

import { SupplementPageView } from "./SupplementPageView";
import type { UnitMatchDTO, UnitDetailResponse } from "@/lib/opportunities/api-types";

const UNIT_ID = "unit-hangzhou-01";

function makeUnit(overall: UnitMatchDTO["overall"]): UnitMatchDTO {
  return {
    unit: {
      id: UNIT_ID,
      code: UNIT_ID,
      name: "杭州市某小学语文岗",
      region: { code: "330100", province: "浙江省", city: "杭州市" },
      subject: "chinese",
      stage: "primary",
      headcount: 2,
      organizationType: "government_unified",
      employmentNature: {
        code: "public_institution_staff",
        officialName: "事业编制",
      },
      allocation: { code: "direct_school", description: "" },
    },
    announcement: {
      id: `ann-${UNIT_ID}`,
      title: "招聘公告",
      publisher: "杭州市教育局",
      organizationType: "government_unified",
      officialUrl: "https://example.gov.cn/a",
      region: { code: "330100", province: "浙江省", city: "杭州市" },
      dataset: "demo",
      reviewStatus: "human_reviewed",
      reviewedBy: null,
      reviewedAt: null,
    },
    version: {
      id: `v-${UNIT_ID}`,
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
      { code: "registration_closed", passed: true, reason: "" },
      { code: "announcement_withdrawn", passed: true, reason: "" },
    ],
    dimensions: [
      {
        requirementId: "sz-age",
        dimension: "age",
        value: "UNKNOWN",
        reason: "公告未明确年龄上限",
        hard: true,
      },
    ],
    overall,
    summary: "",
    follow: null,
  };
}

function makeDetail(overall: UnitMatchDTO["overall"]): UnitDetailResponse {
  return {
    meta: {
      ruleVersion: "r1",
      majorAliasVersion: "a1",
      catalogVersion: "c1",
      realCatalogVersion: "rc1",
      evaluatedAt: "2026-10-04T12:00:00+08:00",
    },
    unit: makeUnit(overall),
    previousVersions: [],
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function flush(ms = 5) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await flush(10);
    if (predicate()) return;
  }
  throw new Error("waitFor 超时");
}

/** 顶部「← 返回」导航链接 */
function topReturnHref(): string | null {
  return container.querySelector("nav a")?.getAttribute("href") ?? null;
}

/** 底部带按钮的返回链接（保存重算后才渲染） */
function bottomReturnAnchor(): HTMLAnchorElement | null {
  return (
    (Array.from(container.querySelectorAll("a")).find((a) =>
      a.querySelector("button"),
    ) as HTMLAnchorElement | undefined) ?? null
  );
}

function saveButton(): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("保存并重新判断"),
    ) as HTMLButtonElement | undefined) ?? null
  );
}

/** 挂载 → 等待可交互 → 点击保存并重算 → 返回前后返回链接 */
async function mountAndRecompute(
  origin: string,
  afterOverall: UnitMatchDTO["overall"],
) {
  holders.unitDetail = vi
    .fn()
    .mockResolvedValueOnce(makeDetail("need_more_info"))
    .mockResolvedValueOnce(makeDetail(afterOverall));

  act(() => {
    root.render(
      createElement(SupplementPageView, {
        mode: "real",
        unitId: UNIT_ID,
        searchParamsString: `origin=${origin}&bucket=need_more_info`,
      }),
    );
  });

  await waitFor(() => topReturnHref() !== null);
  const beforeHref = topReturnHref();
  const btn = saveButton();
  expect(btn).not.toBeNull();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // 重算完成后底部返回链接才出现
  await waitFor(() => bottomReturnAnchor() !== null);
  return {
    beforeHref,
    topHref: topReturnHref(),
    bottomHref: bottomReturnAnchor()?.getAttribute("href") ?? null,
  };
}

describe("SupplementPageView v7.2 定向补充返回链接", () => {
  const ANCHOR = `#unit-${UNIT_ID}`;

  beforeEach(() => {
    holders.unitDetail = () => Promise.resolve(makeDetail("need_more_info"));
    holders.match = () =>
      Promise.resolve({
        groups: {
          preliminary: [],
          needInfo: [],
          manualReview: [],
          notEligible: [],
          closed: [],
        },
      });
    holders.profileState = { status: "ready", profile: {}, isGuest: true };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("origin=opportunities + 重算后为优先机会：顶部与底部返回链接都指向 tab=priority 并锚定原岗位", async () => {
    const { beforeHref, topHref, bottomHref } = await mountAndRecompute(
      "opportunities",
      "preliminary_eligible",
    );
    // 保存前未重算：保持不带 tab，但锚定原岗位（D05 列表位置保留）
    expect(beforeHref).toBe(`/opportunities${ANCHOR}`);
    // 保存重算后：聚焦优先机会标签并锚定原岗位
    expect(topHref).toBe(`/opportunities?tab=priority${ANCHOR}`);
    expect(bottomHref).toBe(`/opportunities?tab=priority${ANCHOR}`);
    // P0 不变量：返回链接绝不回 onboarding
    expect(topHref).not.toContain("/onboarding");
    expect(bottomHref).not.toContain("/onboarding");
  }, 20000);

  it("origin=opportunities + 重算后仍需补充信息：返回链接指向 tab=supplement 并锚定原岗位", async () => {
    const { topHref, bottomHref } = await mountAndRecompute(
      "opportunities",
      "need_more_info",
    );
    expect(topHref).toBe(`/opportunities?tab=supplement${ANCHOR}`);
    expect(bottomHref).toBe(`/opportunities?tab=supplement${ANCHOR}`);
    expect(topHref).not.toContain("/onboarding");
    expect(bottomHref).not.toContain("/onboarding");
  }, 20000);

  it("origin=opportunities + 重算后为需人工确认：按 classify 归属 tab=supplement", async () => {
    const { topHref, bottomHref } = await mountAndRecompute(
      "opportunities",
      "manual_review",
    );
    expect(topHref).toBe(`/opportunities?tab=supplement${ANCHOR}`);
    expect(bottomHref).toBe(`/opportunities?tab=supplement${ANCHOR}`);
    expect(topHref).not.toContain("/onboarding");
  }, 20000);

  it("origin=opportunities 未重算：不带 ?tab=，仍锚定原岗位", async () => {
    holders.unitDetail = () => Promise.resolve(makeDetail("need_more_info"));
    act(() => {
      root.render(
        createElement(SupplementPageView, {
          mode: "real",
          unitId: UNIT_ID,
          searchParamsString: "origin=opportunities&bucket=need_more_info",
        }),
      );
    });
    await waitFor(() => topReturnHref() !== null);
    expect(topReturnHref()).toBe(`/opportunities${ANCHOR}`);
    expect(topReturnHref()).not.toContain("?tab=");
    expect(bottomReturnAnchor()).toBeNull();
  }, 20000);

  it("origin=preview：重算后仍返回 /preview，不带 tab", async () => {
    const { topHref, bottomHref } = await mountAndRecompute("preview", "preliminary_eligible");
    expect(topHref).toBe("/preview");
    expect(bottomHref).toBe("/preview");
    expect(topHref).not.toContain("?tab=");
    expect(topHref).not.toContain("/onboarding");
    expect(bottomHref).not.toContain("/onboarding");
  }, 20000);

  it("origin=detail：重算后仍返回岗位详情，不带 tab", async () => {
    const { topHref, bottomHref } = await mountAndRecompute("detail", "preliminary_eligible");
    expect(topHref).toBe(`/opportunities/${UNIT_ID}`);
    expect(bottomHref).toBe(`/opportunities/${UNIT_ID}`);
    expect(topHref).not.toContain("?tab=");
    expect(topHref).not.toContain("/onboarding");
  }, 20000);

  it("D05：保存后播报包含结论变化与仍需核实项数量", async () => {
    // makeUnit 自带 1 个 age UNKNOWN 维度：重算后结论变化且仍需核实 1 项
    await mountAndRecompute("opportunities", "preliminary_eligible");
    await waitFor(() =>
      (container.textContent ?? "").includes("机会判断已更新为：初步符合"),
    );
    expect(container.textContent).toContain("仍需核实 1 项");
    expect(container.textContent).toContain("待补充 1 项");
  }, 20000);

  it("D05：补充提示展示公告要求原文与影响岗位数（来自 match 分组计数）", async () => {
    holders.match = () =>
      Promise.resolve({
        groups: {
          preliminary: [],
          needInfo: [
            {
              dimension: "age",
              count: 2,
              units: [
                makeUnit("need_more_info"),
                makeUnit("need_more_info"),
              ],
            },
          ],
          manualReview: [],
          notEligible: [],
          closed: [],
        },
      });
    act(() => {
      root.render(
        createElement(SupplementPageView, {
          mode: "real",
          unitId: UNIT_ID,
          searchParamsString: "origin=detail&bucket=need_more_info",
        }),
      );
    });
    await waitFor(() =>
      (container.textContent ?? "").includes("公告要求：公告未明确年龄上限"),
    );
    expect(container.textContent).toContain(
      "补充这项会影响 2 个机会的判断（含本岗位）",
    );
  }, 20000);

  it("D05：影响统计请求失败时不显示数量提示（不编造），表单仍可用", async () => {
    holders.match = () => Promise.reject(new Error("网络异常"));
    act(() => {
      root.render(
        createElement(SupplementPageView, {
          mode: "real",
          unitId: UNIT_ID,
          searchParamsString: "origin=detail&bucket=need_more_info",
        }),
      );
    });
    await waitFor(() => saveButton() !== null);
    expect(container.textContent).toContain("公告要求：公告未明确年龄上限");
    expect(container.textContent ?? "").not.toContain("个机会的判断（含本岗位）");
  }, 20000);

  it("D05：demo 岗位 + 已登录演示账号——不构造服务端画像仓储，保存只写本机并完成播报", async () => {
    // 回归锁：修复前 /opportunities/[unitId]/supplement 硬编码 mode="real"，
    // 已登录演示账号会走受邀式 repo.read/patch → /api 503 → 整页报错
    holders.profileState = { status: "ready", profile: {}, isGuest: false };
    const { createProfileRepository } = await import(
      "@/lib/profile/profileRepository"
    );
    vi.mocked(createProfileRepository).mockClear();
    holders.unitDetail = vi
      .fn()
      .mockResolvedValueOnce(makeDetail("need_more_info"))
      .mockResolvedValueOnce(makeDetail("preliminary_eligible"));

    act(() => {
      root.render(
        createElement(SupplementPageView, {
          mode: "demo",
          unitId: UNIT_ID,
          searchParamsString: "origin=opportunities&bucket=need_more_info",
        }),
      );
    });
    await waitFor(() => saveButton() !== null);
    await act(async () => {
      saveButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => bottomReturnAnchor() !== null);

    // 服务端仓储从未被构造：不读 GET /api/profile，也不写 PATCH
    expect(createProfileRepository).not.toHaveBeenCalled();
    // 本机保存 + 重算 + 播报照常完成（含仍需核实项）
    expect(container.textContent).toContain("机会判断已更新为：初步符合");
    expect(container.textContent).toContain("仍需核实 1 项");
    // 返回链接带 tab 与锚点（与访客链路一致）
    expect(bottomReturnAnchor()?.getAttribute("href")).toBe(
      `/opportunities?tab=priority${ANCHOR}`,
    );
  }, 20000);
});
