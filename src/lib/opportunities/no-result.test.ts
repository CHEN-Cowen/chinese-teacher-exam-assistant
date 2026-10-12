/**
 * 无结果状态机测试（v7.1 M6）：三种无结果状态分别成立、互不混淆，
 * 且不得把「暂未收录」写成「当地没有招聘」。
 */
import { describe, expect, it } from "vitest";
import type { CoverageDTO, MatchResponse, UnitMatchDTO } from "./api-types";
import { buildListViewModel } from "./list-view";
import { buildNoResultState } from "./no-result";
import type { UserRecruitmentProfile } from "@/lib/profile/types";

function makeUnit(
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

function emptyCoverage(): CoverageDTO {
  return {
    version: "kb-monitoring-coverage-1.1.0",
    subject: "chinese",
    subjectLabel: "语文",
    status: "monitoring_no_open",
    provinces: [
      {
        code: "330000",
        label: "浙江省",
        status: "monitoring_no_open",
        monitoredRegionCodes: ["330100"],
        scopeNote: "浙江仅监测杭州。",
      },
    ],
    regions: [
      {
        code: "330100",
        label: "浙江·杭州",
        authority: "杭州市教育局",
        sources: [
          {
            id: "src-hz",
            name: "杭州教育网招聘栏目",
            url: "https://edu.hangzhou.gov.cn/x",
            lastCheckedAt: "2026-10-12T08:00:00+08:00",
            ok: true,
            failReason: null,
          },
        ],
      },
    ],
    lastCheckedAt: "2026-10-12T08:00:00+08:00",
    openOpportunityCount: 0,
    nextWindowNote: "",
    scopeNote: "暂未收录不代表当地无招聘。",
  };
}

function responseOf(
  groups: Partial<MatchResponse["groups"]>,
  coverage = emptyCoverage(),
): MatchResponse {
  return {
    meta: {
      ruleVersion: "kb-match-rules-1.1.0",
      majorAliasVersion: "kb-major-aliases-1.0.0",
      catalogVersion: "kb-opportunity-catalog-1.0.0",
      realCatalogVersion: "kb-real-catalog-1.0.0",
      evaluatedAt: "2026-10-12T10:00:00+08:00",
    },
    coverage,
    primaryTargetUnitId: null,
    groups: {
      preliminary: groups.preliminary ?? [],
      needInfo: groups.needInfo ?? [],
      manualReview: groups.manualReview ?? [],
      notEligible: groups.notEligible ?? [],
      closed: groups.closed ?? [],
    },
    follows: [],
  };
}

const PROFILE: UserRecruitmentProfile = {
  regions: [{ code: "330100", province: "浙江省", city: "杭州市", level: "required" }],
  educationLevel: "bachelor",
  degree: "bachelor",
  majorFullName: "汉语言文学（师范）",
  graduationDate: "2026-06-30",
  employmentStatus: "fresh_unemployed",
  socialSecurityMonths: 0,
  teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
  acceptedEmploymentNatures: ["public_institution_staff"],
};

describe("buildNoResultState：三种无结果状态", () => {
  it("状态三：目录里有岗位但没有初步符合（明确不符合）→ 资格暂不满足", () => {
    const view = buildListViewModel(
      responseOf({ notEligible: [makeUnit("unit-x", "not_eligible")] }),
      PROFILE,
    );
    const state = buildNoResultState(view)!;
    expect(state.kind).toBe("qualification_gap");
    expect(state.title).toContain("条件");
    expect(state.nextStep).toContain("不符合");
    // 不笼统：不得出现“没有适合你的岗位”
    expect(`${state.title}${state.reason}`).not.toContain("没有适合你");
  });

  it("状态三（需人工确认/已截止同样算存在岗位）；待补信息属于可行动机会不算无结果", () => {
    // 待补信息/建议确认是可行动机会（validCount 计入），页面直接展示卡片，不是“无结果”
    const needInfo = buildListViewModel(
      responseOf({
        needInfo: [{ dimension: "hukou", count: 1, units: [makeUnit("unit-y", "need_more_info")] }],
      }),
      PROFILE,
    );
    expect(needInfo.validCount).toBeGreaterThan(0);
    expect(buildNoResultState(needInfo)).toBeNull();

    const closed = buildListViewModel(
      responseOf({
        closed: [
          makeUnit("unit-z", "preliminary_eligible", {
            gates: [{ code: "registration_closed", passed: false, reason: "已截止" }],
          }),
        ],
      }),
      PROFILE,
    );
    expect(buildNoResultState(closed)!.kind).toBe("qualification_gap");
  });

  it("状态一：画像地区不在监测范围 → 暂未覆盖，且文案不得写成当地没有招聘", () => {
    const view = buildListViewModel(responseOf({}), {
      ...PROFILE,
      regions: [{ code: "440100", province: "广东省", city: "广州市", level: "required" }],
    });
    expect(view.uncoveredRegions.length).toBeGreaterThan(0);
    const state = buildNoResultState(view)!;
    expect(state.kind).toBe("region_uncovered");
    expect(state.reason).toContain("暂未收录不等于当地没有招聘");
    expect(state.reason).not.toContain("当地没有招聘公告");
  });

  it("状态二：地区已覆盖但当前无开放招聘 → 如实说明核对结果", () => {
    // 画像地区被覆盖（330100 在 monitoredRegionCodes 中），目录为空
    const view = buildListViewModel(responseOf({}), PROFILE);
    expect(view.uncoveredRegions).toHaveLength(0);
    const state = buildNoResultState(view)!;
    expect(state.kind).toBe("no_open_recruitment");
    expect(state.reason).toContain("当前核对时点没有在报");
    expect(state.nextStep).toContain("订阅");
  });

  it("有可行动机会时不是无结果（返回 null）", () => {
    const view = buildListViewModel(
      responseOf({ preliminary: [makeUnit("unit-ok", "preliminary_eligible")] }),
      PROFILE,
    );
    expect(view.validCount).toBeGreaterThan(0);
    expect(buildNoResultState(view)).toBeNull();
  });
});
