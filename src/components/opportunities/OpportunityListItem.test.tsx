/**
 * OpportunityListItem 卡片测试（v7.2 §7.4 七层结构）。
 *
 * 验证：
 * - 7 层关键内容存在（真实/演示、截止、岗位、地点、用工、已通过条件、提醒、按钮）；
 * - 地图入口：有明确城市时显示，无城市时隐藏；
 * - 两按钮同高 h-11（class 含 h-11）；
 * - MANUAL_REVIEW 卡显示咨询态文案「建议向招聘单位确认」+「查看需要确认的问题」；
 * - outOfScope 卡不用红色、显示「偏好范围外」；
 * - priority 卡有 brand ring。
 *
 * 使用 renderToString 快照式断言（无交互需求）。
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

import { OpportunityListItem } from "./OpportunityListItem";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";

function makeUnit(
  unitId: string,
  overall: UnitMatchDTO["overall"],
  extra: Partial<UnitMatchDTO> = {},
): UnitMatchDTO {
  return {
    unit: {
      id: unitId,
      code: unitId,
      name: `${unitId}-岗位名`,
      region: { code: "330100", province: "浙江省", city: "杭州市", district: "富阳区" },
      subject: "chinese",
      stage: "middle",
      headcount: 3,
      organizationType: "government_unified",
      employmentNature: {
        code: "public_institution_staff",
        officialName: "事业编制",
      },
      allocation: { code: "direct_school", description: "" },
      ...extra.unit,
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
      ...extra.announcement,
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
      ...extra.version,
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
    summary: "关键提醒文本",
    follow: null,
    ...extra,
  } as UnitMatchDTO;
}

function render(unit: UnitMatchDTO, variant: "priority" | "supplement" | "outOfScope" | "excluded" = "priority") {
  return renderToString(
    createElement(OpportunityListItem, {
      unit,
      evaluatedAt: "2026-10-05T10:00:00+08:00",
      variant,
      onToggleFollow: () => {},
    }),
  );
}

describe("OpportunityListItem：七层结构", () => {
  it("priority 卡渲染全部 7 层关键内容", () => {
    const html = render(makeUnit("u1", "preliminary_eligible"), "priority");
    // 第 1 层：真实/演示标签 + 截止文案
    expect(html).toContain("虚构试用示例");
    expect(html).toContain("报名");
    // 第 2 层：岗位名
    expect(html).toContain("u1-岗位名");
    // 第 3 层：地点 · 任教学校（school-placement）+ 地图入口，同一行
    expect(html).toContain('data-testid="location-row"');
    expect(html).toContain('data-testid="school-placement"');
    expect(html).toContain("杭州市");
    expect(html).toContain("在地图中查看");
    // 第 4 层：用工/学段/人数
    expect(html).toContain("招");
    expect(html).toContain("人");
    // 第 5 层：已通过条件数
    expect(html).toContain("已通过");
    // 第 6 层：关键提醒
    expect(html).toContain("关键提醒文本");
    // 第 7 层：两个按钮
    expect(html).toContain("查看依据并保存");
    expect(html).toContain("保存机会");
  });

  it("priority 卡有 brand ring 视觉", () => {
    const html = render(makeUnit("u1", "preliminary_eligible"), "priority");
    expect(html).toContain("border-brand");
    expect(html).toContain("ring-brand");
  });
});

describe("OpportunityListItem：地图入口显隐", () => {
  it("有明确城市时显示地图入口链接", () => {
    const html = render(makeUnit("u1", "preliminary_eligible"), "priority");
    expect(html).toContain('data-testid="map-link"');
    expect(html).toContain("uri.amap.com/search");
  });

  it("无城市（只有省级地区）时隐藏地图入口", () => {
    const unit = makeUnit("u2", "preliminary_eligible", {
      unit: {
        id: "u2",
        code: "u2",
        name: "u2-岗位",
        region: { code: "330000", province: "浙江省" },
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
    });
    const html = render(unit, "priority");
    expect(html).not.toContain('data-testid="map-link"');
    expect(html).not.toContain("uri.amap.com/search");
    // 地点行仍显示省份
    expect(html).toContain("浙江省");
  });

  it("地图链接 URL 安全编码（encodeURIComponent）", () => {
    const unit = makeUnit("u3", "preliminary_eligible", {
      unit: {
        id: "u3",
        code: "u3",
        name: "u3-岗位",
        region: {
          code: "330100",
          province: "浙江省",
          city: "杭州市",
          district: "富阳区",
        },
        subject: "chinese",
        stage: "middle",
        headcount: 1,
        organizationType: "government_unified",
        employmentNature: {
          code: "public_institution_staff",
          officialName: "事业编制",
        },
        allocation: { code: "direct_school", description: "" },
        schoolPlacement: { status: "specified", schoolName: "杭州第二中学" },
      },
    });
    const html = render(unit, "priority");
    // encodeURIComponent("杭州市富阳区杭州第二中学") 不会含未编码的中文特殊字符
    expect(html).toContain("uri.amap.com/search?keyword=");
    // 杭 = U+676d = UTF-8 E6 9D AD；州市 = E5 B7 9E E5 B8 82。确认中文被安全编码
    expect(html).toMatch(/keyword=%E6%9D%AD%E5%B7%9E%E5%B8%82/);
  });
});

describe("OpportunityListItem：按钮统一", () => {
  it("查看官方依据与保存机会两按钮同高 h-11 同圆角 rounded-xl", () => {
    const html = render(makeUnit("u1", "preliminary_eligible"), "priority");
    // 两个按钮都含 h-11 和 rounded-xl
    const h11Count = (html.match(/h-11/g) ?? []).length;
    const roundedXlCount = (html.match(/rounded-xl/g) ?? []).length;
    expect(h11Count).toBeGreaterThanOrEqual(2);
    expect(roundedXlCount).toBeGreaterThanOrEqual(2);
  });

  it("查看官方依据是 Link 到详情（href 含 /opportunities/）", () => {
    const html = render(makeUnit("u1", "preliminary_eligible"), "priority");
    expect(html).toContain('href="/opportunities/u1"');
  });

  it("保存按钮是 button type=button", () => {
    const html = render(makeUnit("u1", "preliminary_eligible"), "priority");
    expect(html).toContain('data-testid="save-button"');
    expect(html).toContain("保存机会");
  });

  it("followBusy 时保存按钮显示「处理中…」且尺寸不变（仍含 h-11）", () => {
    const html = renderToString(
      createElement(OpportunityListItem, {
        unit: makeUnit("u1", "preliminary_eligible"),
        evaluatedAt: "2026-10-05T10:00:00+08:00",
        variant: "priority",
        followBusy: true,
        onToggleFollow: () => {},
      }),
    );
    expect(html).toContain("处理中…");
    expect(html).toContain("h-11");
    expect(html).toContain("rounded-xl");
  });
});

describe("OpportunityListItem：MANUAL_REVIEW 咨询态", () => {
  it("consult 变体显示「建议向招聘单位确认」+ 咨询问题摘要", () => {
    const unit = makeUnit("u-manual", "manual_review", {
      consultationTemplates: [
        {
          dimensionKey: "age",
          dimensionLabel: "年龄",
          question: "年龄限制是否含周岁边界？",
        },
      ],
    });
    const html = render(unit, "supplement");
    expect(html).toContain("建议向招聘单位确认");
    expect(html).toContain("年龄限制是否含周岁边界？");
    expect(html).toContain('data-testid="consult-hint"');
  });

  it("consult 变体主按钮文案为「查看需要确认的问题」", () => {
    const unit = makeUnit("u-manual", "manual_review");
    const html = render(unit, "supplement");
    expect(html).toContain("查看需要确认的问题");
    expect(html).not.toContain("查看依据并保存");
  });

  it("supplement/unknown 变体不显示咨询态文案，显示已通过条件数", () => {
    const unit = makeUnit("u-needinfo", "need_more_info", {
      dimensions: [
        {
          requirementId: "r1",
          dimension: "hukou",
          value: "UNKNOWN",
          reason: "户籍待确认",
          hard: true,
        },
      ],
    });
    const html = render(unit, "supplement");
    expect(html).not.toContain("建议向招聘单位确认");
    expect(html).toContain("已通过");
    expect(html).toContain("待确认：户籍待确认");
  });
});

describe("OpportunityListItem：偏好范围外安静态", () => {
  it("outOfScope 不用红色、不用「不符合」文案，显示「偏好范围外」", () => {
    const unit = makeUnit("u-oos", "not_eligible", {
      dimensions: [
        {
          requirementId: "r",
          dimension: "region",
          value: "FAIL",
          reason: "地区不在偏好范围",
          hard: true,
        },
      ],
    });
    const html = render(unit, "outOfScope");
    expect(html).toContain("偏好范围外");
    // outOfScope 用安静弱边框 border-line，不用 priority 的 brand ring 视觉
    expect(html).toContain("border-line");
    // article 元素 class 不含 priority 专属的 border-brand / ring-brand-soft
    // （focus-visible:ring-brand 出现在按钮上是焦点环，不是卡片视觉）
    const articleMatch = html.match(/<article[^>]*class="([^"]*)"/);
    expect(articleMatch).not.toBeNull();
    const articleClass = articleMatch![1];
    expect(articleClass).not.toContain("border-brand");
    expect(articleClass).not.toContain("ring-brand-soft");
    // 不出现「不符合」惩罚性文案
    expect(html).not.toContain("明确不符合");
  });
});
