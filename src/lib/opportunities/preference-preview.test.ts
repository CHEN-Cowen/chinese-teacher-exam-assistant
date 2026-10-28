/**
 * 偏好调整影响预览测试（D04 / PRD 11.5）：
 * - 调整前后计数与列表分桶（workbench 单一数据源）一致、按报考单元去重；
 * - 只列出真实变化，新增岗位可点名核对；
 * - 目录版本不一致判定为过期，预览必须丢弃；
 * - 数量不变时如实说明，不编造差异。
 */
import { describe, expect, it } from "vitest";
import type { MatchResponse, UnitMatchDTO } from "./api-types";
import { buildListViewModel } from "./list-view";
import {
  buildPreferencePreview,
  countPreferenceBuckets,
  isSameCatalog,
} from "./preference-preview";
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
      name: `岗位${unitId}`,
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
      region: { code: "330100", province: "浙江省", city: "杭州市" },
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
      timeline: { registrationStart: "2026-10-01", registrationEnd: "2026-10-20" },
      officialSource: {
        id: "src",
        locator: { kind: "url", url: "https://example.gov.cn/a" },
        state: "official",
        checkedAt: "2026-10-04T12:00:00+08:00",
      },
    },
    gates: [{ code: "registration_closed", passed: true, reason: "" }],
    dimensions: [],
    overall,
    summary: "",
    follow: null,
    ...extra,
  };
}

const META = {
  ruleVersion: "kb-match-rules-1.1.0",
  majorAliasVersion: "kb-major-aliases-1.0.0",
  catalogVersion: "kb-opportunity-catalog-1.0.0",
  realCatalogVersion: "kb-real-catalog-1.0.0",
  evaluatedAt: "2026-10-12T10:00:00+08:00",
};

function responseOf(
  groups: Partial<MatchResponse["groups"]>,
  meta = META,
): MatchResponse {
  return {
    meta,
    coverage: {
      version: "coverage-projection-2.0.0",
      subject: "chinese",
      subjectLabel: "语文",
      status: "open_batch_exists",
      provinces: [],
      regions: [],
      sources: [],
      lastCheckedAt: "2026-10-12T08:00:00+08:00",
      openOpportunityCount: 1,
      nextWindowNote: "",
      scopeNote: "",
      caliber: {
        generatedAt: "2026-10-12T08:00:00+08:00",
        version: "coverage-projection-2.0.0",
        registeredSources: 0,
        verifiedSources: 0,
        recentlyHealthySources: 0,
        failedSources: 0,
        pausedSources: 0,
        blockedSources: 0,
        publishedOpenUnits: 1,
        isFallback: false,
        fallbackNote: null,
      },
    },
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
  majorFullName: "汉语言文学",
  graduationDate: "2026-06-30",
  employmentStatus: "fresh_unemployed",
  teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
  acceptedEmploymentNatures: ["public_institution_staff"],
};

describe("countPreferenceBuckets / buildPreferencePreview", () => {
  it("调整后计数变化如实列出，新增岗位可点名", () => {
    const beforeView = buildListViewModel(
      responseOf({
        preliminary: [
          makeUnit("unit-out", "preliminary_eligible", { preferenceOutOfScope: true }),
        ],
      }),
      PROFILE,
    );
    const afterView = buildListViewModel(
      responseOf({ preliminary: [makeUnit("unit-in", "preliminary_eligible")] }),
      PROFILE,
    );
    const result = buildPreferencePreview(beforeView, afterView);
    expect(result.before.outOfScope).toBe(1);
    expect(result.before.priority).toBe(0);
    expect(result.after.priority).toBe(1);
    expect(result.lines).toContain("初步符合 0 → 1（+1）");
    expect(result.lines).toContain("偏好范围外 1 → 0（-1）");
    expect(result.newUnitNames).toContain("岗位unit-in");
    expect(result.unchanged).toBe(false);
    expect(result.caliberNote).toContain("去重");
    expect(result.caliberNote).toContain("资格判断规则不变");
  });

  it("数量不变时如实说明，不编造差异", () => {
    const beforeView = buildListViewModel(
      responseOf({ preliminary: [makeUnit("unit-a", "preliminary_eligible")] }),
      PROFILE,
    );
    const afterView = buildListViewModel(
      responseOf({ preliminary: [makeUnit("unit-a", "preliminary_eligible")] }),
      PROFILE,
    );
    const result = buildPreferencePreview(beforeView, afterView);
    expect(result.unchanged).toBe(true);
    expect(result.lines).toHaveLength(0);
  });

  it("留档计数按报考单元去重", () => {
    const dup = makeUnit("unit-dup", "not_eligible");
    const view = buildListViewModel(
      responseOf({ notEligible: [dup, { ...dup }] }),
      PROFILE,
    );
    expect(countPreferenceBuckets(view).excluded).toBe(1);
  });
});

describe("isSameCatalog：过期响应保护", () => {
  it("目录版本一致时允许对比", () => {
    expect(isSameCatalog(META, { ...META, evaluatedAt: "2026-10-12T11:00:00+08:00" })).toBe(true);
  });

  it("目录版本不一致时必须丢弃预览", () => {
    expect(
      isSameCatalog(META, { ...META, realCatalogVersion: "kb-real-catalog-1.0.1" }),
    ).toBe(false);
  });
});
