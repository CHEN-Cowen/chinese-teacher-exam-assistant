/**
 * v7.2 单一分类函数测试（classifyOpportunity）。
 *
 * 验证三标签互斥规则（PRD §7.5），全部 6 种 outcome 覆盖：
 * - 闸门失败 → excluded
 * - 非 actionable（未发布/证据未 official）→ excluded
 * - preliminary_eligible → priority
 * - need_more_info → supplement/unknown
 * - manual_review → supplement/consult
 * - not_eligible 仅地区 FAIL → outOfScope
 * - not_eligible 非地区 FAIL → excluded
 *
 * 夹具沿用 list-view.test.ts 的 makeUnit 约定（这里复制最小版本避免跨文件依赖）。
 */
import { describe, expect, it } from "vitest";
import type { UnitMatchDTO } from "./api-types";
import { classifyOpportunity, isTab } from "./classify";

function makeBaseUnit(
  unitId: string,
  overall: UnitMatchDTO["overall"],
  extra: Partial<UnitMatchDTO> = {},
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
        officialName: "事业编制工作人员",
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
      id: `ann-${unitId}-v1`,
      versionNumber: 1,
      sourceKind: "original",
      publishedAt: "2026-09-28T09:00:00+08:00",
      timeline: {
        registrationStart: "2026-10-01",
        registrationEnd: "2026-10-20",
      },
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
    ...extra,
  };
}

describe("classifyOpportunity：三标签互斥分类", () => {
  it("preliminary_eligible（闸门全过 + 官方证据）→ priority", () => {
    const unit = makeBaseUnit("u-priority", "preliminary_eligible");
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("priority");
    expect(result.supplementVariant).toBeNull();
    expect(isTab(unit, "priority")).toBe(true);
  });

  it("need_more_info → supplement/unknown", () => {
    const unit = makeBaseUnit("u-needinfo", "need_more_info");
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("supplement");
    expect(result.supplementVariant).toBe("unknown");
    expect(isTab(unit, "supplement")).toBe(true);
  });

  it("manual_review → supplement/consult", () => {
    const unit = makeBaseUnit("u-manual", "manual_review");
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("supplement");
    expect(result.supplementVariant).toBe("consult");
  });

  it("not_eligible 仅地区维度 FAIL → outOfScope（不是资格不符合）", () => {
    const unit = makeBaseUnit("u-region", "not_eligible", {
      dimensions: [
        {
          requirementId: "req-region",
          dimension: "region",
          value: "FAIL",
          reason: "岗位在广东，画像未选广东",
          hard: true,
        },
      ],
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("outOfScope");
    expect(result.supplementVariant).toBeNull();
    expect(isTab(unit, "outOfScope")).toBe(true);
  });

  it("not_eligible 非地区 FAIL（学历）→ excluded", () => {
    const unit = makeBaseUnit("u-hardfail", "not_eligible", {
      dimensions: [
        {
          requirementId: "req-edu",
          dimension: "education",
          value: "FAIL",
          reason: "要求硕士",
          hard: true,
        },
      ],
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("excluded");
  });

  it("not_eligible 同时有地区 FAIL + 学历 FAIL → excluded（只要有非地区 FAIL）", () => {
    const unit = makeBaseUnit("u-mixed-fail", "not_eligible", {
      dimensions: [
        {
          requirementId: "req-edu",
          dimension: "education",
          value: "FAIL",
          reason: "要求硕士",
          hard: true,
        },
        {
          requirementId: "req-region",
          dimension: "region",
          value: "FAIL",
          reason: "地区也不匹配",
          hard: true,
        },
      ],
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("excluded");
  });

  it("闸门失败（registration_closed）→ excluded，即使 overall=preliminary_eligible", () => {
    const unit = makeBaseUnit("u-closed", "preliminary_eligible", {
      gates: [
        { code: "subject_not_open", passed: true, reason: "" },
        {
          code: "registration_closed",
          passed: false,
          reason: "报名已于 2026-09-20 截止",
        },
        { code: "out_of_scope_nature", passed: true, reason: "" },
        { code: "announcement_withdrawn", passed: true, reason: "" },
        { code: "no_official_source", passed: true, reason: "" },
      ],
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("excluded");
  });

  it("闸门失败优先于 overall：not_eligible + 闸门失败 → excluded（不进 outOfScope）", () => {
    const unit = makeBaseUnit("u-closed-noteligible", "not_eligible", {
      gates: [
        { code: "registration_closed", passed: false, reason: "已截止" },
      ],
      dimensions: [
        {
          requirementId: "req-region",
          dimension: "region",
          value: "FAIL",
          reason: "地区不匹配",
          hard: true,
        },
      ],
    });
    const result = classifyOpportunity(unit);
    // 闸门失败优先，不进 outOfScope
    expect(result.tab).toBe("excluded");
  });

  it("非 actionable（real AI 初核未复核）→ excluded，即使 overall=preliminary_eligible", () => {
    const unit = makeBaseUnit("real-pending", "preliminary_eligible", {
      announcement: {
        id: "real-pending",
        title: "real",
        publisher: "教育局",
        organizationType: "government_unified",
        officialUrl: "https://example.gov.cn/a",
        dataset: "real",
        reviewStatus: "ai_reviewed_pending",
        reviewedBy: null,
        reviewedAt: null,
      },
      version: {
        id: "real-pending-v1",
        versionNumber: 1,
        sourceKind: "original",
        publishedAt: "2026-07-31T00:00:00+08:00",
        timeline: { pendingItems: ["报名时间另行通知"] },
        officialSource: {
          id: "src",
          locator: { kind: "url", url: "https://example.gov.cn/a" },
          state: "ai_extracted",
          checkedAt: "2026-10-06T11:30:00+08:00",
        },
      },
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("excluded");
  });

  it("非 actionable（officialUrl 为空）→ excluded", () => {
    const unit = makeBaseUnit("u-nourl", "preliminary_eligible", {
      announcement: {
        id: "ann-nourl",
        title: "u-nourl",
        publisher: "教育局",
        organizationType: "government_unified",
        officialUrl: "",
        dataset: "demo",
        reviewStatus: "human_reviewed",
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("excluded");
  });

  it("真实公告已人工核对 + 证据 official → 可进入 priority（正向路径不被误杀）", () => {
    const unit = makeBaseUnit("real-published", "preliminary_eligible", {
      announcement: {
        id: "real-published",
        title: "real",
        publisher: "教育局",
        organizationType: "government_unified",
        officialUrl: "https://example.gov.cn/a",
        dataset: "real",
        reviewStatus: "human_reviewed",
        reviewedBy: "reviewer-chen",
        reviewedAt: "2026-10-08T10:00:00+08:00",
      },
    });
    const result = classifyOpportunity(unit);
    expect(result.tab).toBe("priority");
  });

  it("supplementVariant 仅在 supplement 桶有意义，其他桶为 null", () => {
    const priority = classifyOpportunity(
      makeBaseUnit("u1", "preliminary_eligible"),
    );
    const outOfScope = classifyOpportunity(
      makeBaseUnit("u2", "not_eligible", {
        dimensions: [
          {
            requirementId: "r",
            dimension: "region",
            value: "FAIL",
            reason: "",
            hard: true,
          },
        ],
      }),
    );
    expect(priority.supplementVariant).toBeNull();
    expect(outOfScope.supplementVariant).toBeNull();
  });
});

describe("classifyOpportunity：互斥性——同一单元只属于一个桶", () => {
  const allOveralls: UnitMatchDTO["overall"][] = [
    "preliminary_eligible",
    "need_more_info",
    "manual_review",
    "not_eligible",
  ];
  for (const overall of allOveralls) {
    it(`${overall}（无闸门失败、可行动、无非地区 FAIL）返回的 tab 是唯一桶`, () => {
      const unit = makeBaseUnit(`u-${overall}`, overall);
      const result = classifyOpportunity(unit);
      const tabs = ["priority", "supplement", "outOfScope", "excluded"] as const;
      const hits = tabs.filter((t) => t === result.tab);
      expect(hits).toHaveLength(1);
    });
  }
});
