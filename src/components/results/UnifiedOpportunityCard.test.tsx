/**
 * v7.2 统一岗位卡 DOM 结构测试（任务 §10.4 / §10.5）。
 *
 * 验证固定层级与地图位置（所有 variant 一致）：
 * - 七个稳定测试标识全部存在；
 * - opportunity-title 在 location-row 前，location-row 在 job-facts 前；
 * - 地图链接位于 location-row 内，同一张卡不存在两个地图入口；
 * - 地图不在折叠依据区；
 * - 无明确城市时只隐藏地图链接，地点文字保留；
 * - 两操作按钮同高 h-11、同圆角 rounded-xl；
 * - consult 卡显示「建议向招聘单位确认」；outOfScope 使用安静视觉。
 *
 * 无交互断言，使用 renderToString。
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import { UnifiedOpportunityCard } from "./UnifiedOpportunityCard";
import type {
  OpportunityCardViewModel,
  ResultsCardVariant,
} from "@/lib/results/workbench-view";

function makeVm(extra: Partial<OpportunityCardViewModel> = {}): OpportunityCardViewModel {
  return {
    id: "vm1",
    dataset: "demo",
    reviewLabel: "虚构试用示例",
    title: "杭州某公办初中 · 语文教师",
    titleHref: null,
    deadlineText: "报名 6 天后截止",
    deadlineClosed: false,
    locationText: "杭州市·余杭区",
    schoolText: "杭州某公办初中",
    mapEntry: {
      url: "https://uri.amap.com/search?keyword=x",
      category: "school",
    },
    employmentNatureText: "事业编",
    stageSubjectText: "初中语文",
    headcount: 2,
    status: "preliminary_eligible",
    isConsult: false,
    consultQuestion: null,
    passedCount: 3,
    pendingRisk: "公告未明确是否限制户籍，建议报名前确认",
    summary: "学历、专业、教师资格已通过",
    closedGate: null,
    saved: false,
    officialUrl: "https://www.hangzhou.gov.cn/notice/1",
    dimensions: [
      { label: "学历", value: "PASS", officialRequirement: null, reason: "符合" },
    ],
    natureOutOfPreference: false,
    ...extra,
  };
}

function render(
  vm: OpportunityCardViewModel,
  variant: ResultsCardVariant = "priority",
): string {
  return renderToString(
    createElement(UnifiedOpportunityCard, {
      vm,
      variant,
      capabilities: { canSave: true, onSave: () => {} },
    }),
  );
}

describe("UnifiedOpportunityCard：七个稳定测试标识", () => {
  it("全部渲染（任务 §10.4）", () => {
    const html = render(makeVm());
    for (const testid of [
      "opportunity-title",
      "location-row",
      "map-link",
      "job-facts",
      "decision-summary",
      "view-evidence-button",
      "save-button",
    ]) {
      expect(html).toContain(`data-testid="${testid}"`);
    }
  });
});

describe("UnifiedOpportunityCard：DOM 顺序（标题 → 地点行 → 岗位事实）", () => {
  it("opportunity-title 在 location-row 前，location-row 在 job-facts 前", () => {
    const html = render(makeVm());
    const title = html.indexOf('data-testid="opportunity-title"');
    const location = html.indexOf('data-testid="location-row"');
    const facts = html.indexOf('data-testid="job-facts"');
    expect(title).toBeGreaterThan(-1);
    expect(title).toBeLessThan(location);
    expect(location).toBeLessThan(facts);
  });

  it("地图链接位于 location-row 内（在 job-facts 之前）", () => {
    const html = render(makeVm());
    const location = html.indexOf('data-testid="location-row"');
    const map = html.indexOf('data-testid="map-link"');
    const facts = html.indexOf('data-testid="job-facts"');
    expect(map).toBeGreaterThan(location);
    expect(map).toBeLessThan(facts);
  });

  it("同一张卡不存在两个地图入口，地图不在折叠依据区", () => {
    const html = render(makeVm());
    const occurrences = html.split('data-testid="map-link"').length - 1;
    expect(occurrences).toBe(1);
    // 依据展开面板初始不渲染；即使展开，面板内也不含地图（面板结构无 map-link）
    expect(html).not.toContain('data-testid="evidence-panel"');
    const evidenceButton = html.indexOf('data-testid="view-evidence-button"');
    const map = html.indexOf('data-testid="map-link"');
    // 地图在第 3 层，远早于第 7 层的依据按钮
    expect(map).toBeLessThan(evidenceButton);
  });

  it("无明确城市（mapEntry 为 null）：隐藏地图链接，地点文字保留", () => {
    const html = render(
      makeVm({ mapEntry: null, locationText: "浙江省" }),
    );
    expect(html).not.toContain('data-testid="map-link"');
    expect(html).toContain('data-testid="location-row"');
    expect(html).toContain("浙江省");
  });

  it("访客卡（无 evidenceHref）：查看依据渲染为展开按钮，仍可保存", () => {
    const html = render(makeVm());
    expect(html).toContain('data-testid="view-evidence-button"');
    expect(html).toContain('data-testid="save-button"');
    expect(html).toContain("保存机会");
  });

  it("登录卡（有 evidenceHref）：查看依据渲染为站内详情链接", () => {
    const html = renderToString(
      createElement(UnifiedOpportunityCard, {
        vm: makeVm({ titleHref: "/opportunities/vm1" }),
        variant: "priority",
        capabilities: {
          canSave: true,
          onSave: () => {},
          evidenceHref: "/opportunities/vm1",
          evidenceLabel: "查看官方依据",
        },
      }),
    );
    expect(html).toContain('href="/opportunities/vm1"');
    expect(html).toContain("查看官方依据");
  });
});

describe("UnifiedOpportunityCard：按钮系统（同高同圆角）", () => {
  it("查看依据与保存按钮都使用 h-11 + rounded-xl", () => {
    const html = render(makeVm());
    const viewStart = html.indexOf('data-testid="view-evidence-button"');
    const saveStart = html.indexOf('data-testid="save-button"');
    // 向前截取所在标签的 class
    const viewTag = html.slice(Math.max(0, viewStart - 400), viewStart);
    const saveTag = html.slice(Math.max(0, saveStart - 400), saveStart);
    expect(viewTag).toContain("h-11");
    expect(viewTag).toContain("rounded-xl");
    expect(saveTag).toContain("h-11");
    expect(saveTag).toContain("rounded-xl");
  });

  it("saveBusy 时按钮 disabled 但尺寸类不变", () => {
    const html = renderToString(
      createElement(UnifiedOpportunityCard, {
        vm: makeVm(),
        variant: "priority",
        capabilities: { canSave: true, saveBusy: true, onSave: () => {} },
      }),
    );
    expect(html).toContain("disabled");
    expect(html).toContain("处理中");
    const saveStart = html.indexOf('data-testid="save-button"');
    const saveTag = html.slice(Math.max(0, saveStart - 400), saveStart);
    expect(saveTag).toContain("h-11");
    expect(saveTag).toContain("rounded-xl");
  });
});

describe("UnifiedOpportunityCard：状态差异（variant）", () => {
  it("MANUAL_REVIEW 补充后判断卡：显示「建议向招聘单位确认」，不伪装成普通缺失", () => {
    const html = render(
      makeVm({
        status: "manual_review",
        isConsult: true,
        consultQuestion: "是否限制非本地户籍？",
      }),
      "supplement",
    );
    expect(html).toContain('data-testid="consult-hint"');
    expect(html).toContain("建议向招聘单位确认");
    expect(html).toContain("是否限制非本地户籍？");
  });

  it("outOfScope 卡：安静视觉（无 danger 红），显示偏好范围外", () => {
    const html = render(makeVm(), "outOfScope");
    expect(html).toContain("偏好范围外");
    expect(html).not.toContain("text-danger");
    expect(html).toContain('data-variant="outOfScope"');
  });

  it("priority 卡：轻量品牌强调（brand 边框）", () => {
    const html = render(makeVm(), "priority");
    expect(html).toContain("border-brand");
  });

  it("留档区 excluded 卡：显示闸门状态标签", () => {
    const html = render(
      makeVm({
        closedGate: { code: "registration_closed", reason: "报名已截止" },
        summary: "报名已截止",
      }),
      "excluded",
    );
    expect(html).toContain('data-variant="excluded"');
    expect(html).toContain("报名已截止");
  });

  it("状态差异不改变基本层级：各 variant 的七层顺序一致", () => {
    for (const variant of ["priority", "supplement", "outOfScope", "excluded"] as const) {
      const html = render(makeVm(), variant);
      const title = html.indexOf('data-testid="opportunity-title"');
      const location = html.indexOf('data-testid="location-row"');
      const facts = html.indexOf('data-testid="job-facts"');
      const save = html.indexOf('data-testid="save-button"');
      expect(title).toBeGreaterThan(-1);
      expect(title).toBeLessThan(location);
      expect(location).toBeLessThan(facts);
      expect(facts).toBeLessThan(save);
    }
  });
});
