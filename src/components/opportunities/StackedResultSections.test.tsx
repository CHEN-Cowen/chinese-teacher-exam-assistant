/**
 * StackedResultSections 组件测试（v7.2 ff_new_results 回退布局，PRD 8.4）。
 *
 * 验证：
 * - ff_new_results 关闭时的旧式堆叠分组：初步符合 / 补充信息（按维度分组）/
 *   人工确认 / 偏好范围外；
 * - 空分组不渲染对应 section；
 * - 卡片 variant 正确（priority / supplement / outOfScope）；
 * - 全空时给留档指引空态。
 *
 * 无 @testing-library 依赖，使用 createRoot + act（与 WorkbenchTabs.test 相同模式）。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

import { StackedResultSections } from "./StackedResultSections";
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

interface RenderResult {
  container: HTMLDivElement;
  html: () => string;
  unmount: () => void;
}

async function renderSections(
  props: Partial<Parameters<typeof StackedResultSections>[0]> = {},
): Promise<RenderResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(StackedResultSections, {
        priority: null,
        otherPreliminary: [],
        needInfoGroups: [],
        manualReview: [],
        regionOutOfScope: [],
        evaluatedAt: "2026-10-05T10:00:00+08:00",
        followBusyId: null,
        onToggleFollow: () => {},
        ...props,
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

const cleanupFns: (() => void)[] = [];
afterEach(() => {
  while (cleanupFns.length) cleanupFns.pop()?.();
});

describe("StackedResultSections（ff_new_results 回退布局）", () => {
  it("初步符合：priority 排首，其余随后，variant=priority", async () => {
    const page = await renderSections({
      priority: makeUnit("u-first", "preliminary_eligible"),
      otherPreliminary: [makeUnit("u-second", "preliminary_eligible")],
    });
    cleanupFns.push(page.unmount);
    const html = page.html();
    expect(html).toContain("初步符合的机会");
    expect(html).toContain("u-first");
    expect(html).toContain("u-second");
    // priority 排在 second 之前
    expect(html.indexOf("u-first")).toBeLessThan(html.indexOf("u-second"));
    // 旧式堆叠不含工作台三标签
    expect(html).not.toContain("workbench-tab-priority");
  });

  it("需要补充信息：按缺失维度分组，variant=supplement", async () => {
    const page = await renderSections({
      needInfoGroups: [
        {
          dimension: "education",
          count: 1,
          units: [makeUnit("u-edu", "need_more_info")],
        },
      ],
    });
    cleanupFns.push(page.unmount);
    const html = page.html();
    expect(html).toContain("补充信息后判断");
    expect(html).toContain("u-edu");
  });

  it("人工确认与偏好范围外分组渲染，variant=supplement/outOfScope", async () => {
    const page = await renderSections({
      manualReview: [makeUnit("u-review", "manual_review")],
      regionOutOfScope: [makeUnit("u-region", "not_eligible")],
    });
    cleanupFns.push(page.unmount);
    const html = page.html();
    expect(html).toContain("建议向招聘单位确认");
    expect(html).toContain("u-review");
    expect(html).toContain("偏好范围外");
    expect(html).toContain("u-region");
  });

  it("空分组不渲染对应 section", async () => {
    const page = await renderSections({
      priority: makeUnit("u-only", "preliminary_eligible"),
    });
    cleanupFns.push(page.unmount);
    const html = page.html();
    expect(html).toContain("u-only");
    expect(html).not.toContain("补充信息后判断");
    expect(html).not.toContain("建议向招聘单位确认");
    expect(html).not.toContain("偏好范围外");
  });

  it("全空时展示留档指引空态", async () => {
    const page = await renderSections();
    cleanupFns.push(page.unmount);
    expect(page.html()).toContain("当前没有可行动的机会");
  });
});
