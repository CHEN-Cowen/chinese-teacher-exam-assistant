import { describe, expect, it } from "vitest";
import type { MatchResponse, UnitMatchDTO } from "./api-types";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import {
  buildListViewModel,
  dimensionImpactCounts,
  formatEvaluatedAt,
  listCardNextStepLabel,
} from "./list-view";

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

function makeResponse(
  units: Record<string, UnitMatchDTO>,
  primaryTargetUnitId: string | null = null,
): MatchResponse {
  return {
    meta: {
      ruleVersion: "kb-match-rules-1.1.0",
      majorAliasVersion: "kb-major-aliases-1.0.0",
      catalogVersion: "kb-opportunity-catalog-1.0.0",
      realCatalogVersion: "kb-real-catalog-1.0.0",
      evaluatedAt: "2026-10-05T10:00:00+08:00",
    },
    coverage: {
      version: "coverage-projection-2.0.0",
      subject: "chinese",
      subjectLabel: "语文",
      status: "monitoring_no_open",
      provinces: [
        {
          code: "330000",
          label: "浙江省",
          status: "monitoring_no_open",
          monitoredRegionCodes: ["330100", "330200"],
          scopeNote: "浙江仅监测杭州、宁波；其余城市暂未收录。",
        },
        {
          code: "320000",
          label: "江苏省",
          status: "not_started",
          monitoredRegionCodes: [],
          scopeNote: "江苏暂未收录，不代表当地没有招聘。",
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
              regionCode: "330100",
              authorityLevel: "city",
              state: "recently_healthy",
              lastCheckedAt: "2026-10-06T11:30:00+08:00",
              note: "检查正常",
            },
          ],
        },
        {
          code: "330200",
          label: "浙江·宁波",
          authority: "宁波市教育局",
          sources: [
            {
              id: "src-nb",
              name: "宁波教育局招聘栏目",
              url: "http://jyj.ningbo.gov.cn/x",
              regionCode: "330200",
              authorityLevel: "city",
              state: "recently_healthy",
              lastCheckedAt: "2026-10-06T11:30:00+08:00",
              note: "检查正常",
            },
          ],
        },
      ],
      sources: [
        {
          id: "src-hz",
          name: "杭州教育网招聘栏目",
          url: "https://edu.hangzhou.gov.cn/x",
          regionCode: "330100",
          authorityLevel: "city",
          state: "recently_healthy",
          lastCheckedAt: "2026-10-06T11:30:00+08:00",
          note: "检查正常",
        },
        {
          id: "src-nb",
          name: "宁波教育局招聘栏目",
          url: "http://jyj.ningbo.gov.cn/x",
          regionCode: "330200",
          authorityLevel: "city",
          state: "recently_healthy",
          lastCheckedAt: "2026-10-06T11:30:00+08:00",
          note: "检查正常",
        },
      ],
      lastCheckedAt: "2026-10-06T11:30:00+08:00",
      openOpportunityCount: 0,
      nextWindowNote: "",
      scopeNote: "暂未收录不代表当地无招聘。",
      caliber: {
        generatedAt: "2026-10-06T11:30:00+08:00",
        version: "coverage-projection-2.0.0",
        registeredSources: 2,
        verifiedSources: 0,
        recentlyHealthySources: 2,
        failedSources: 0,
        pausedSources: 0,
        blockedSources: 0,
        publishedOpenUnits: 0,
        isFallback: false,
        fallbackNote: null,
      },
    },
    primaryTargetUnitId,
    groups: {
      preliminary: [units.hangzhou!, units.hefei!].filter(Boolean),
      needInfo: units.yinzhou
        ? [
            {
              dimension: "hukou",
              count: 1,
              units: [units.yinzhou],
            },
          ]
        : [],
      manualReview: units.suzhou ? [units.suzhou] : [],
      notEligible: units.nanjing ? [units.nanjing] : [],
      closed: units.wenzhou ? [units.wenzhou] : [],
    },
    follows: [],
  };
}

describe("buildListViewModel：四类结果的列表叙事", () => {
  it("六场景分组正确：杭州/合肥初步符合、鄞州待补户籍、苏州人工确认、南京不符合、温州已截止", () => {
    const closedWenzhou = makeUnit("unit-wenzhou-01", "preliminary_eligible", {
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
    const response = makeResponse({
      hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
      hefei: makeUnit("unit-hefei-01-v2", "preliminary_eligible"),
      yinzhou: makeUnit("unit-yinzhou-01", "need_more_info"),
      suzhou: makeUnit("unit-suzhou-01", "manual_review"),
      nanjing: makeUnit("unit-nanjing-01", "not_eligible"),
      wenzhou: closedWenzhou,
    });

    const view = buildListViewModel(response);
    expect(view.priority?.unit.id).toBe("unit-hangzhou-01");
    expect(view.otherPreliminary.map((u) => u.unit.id)).toEqual([
      "unit-hefei-01-v2",
    ]);
    expect(view.needInfoGroups[0]?.dimension).toBe("hukou");
    expect(view.needInfoGroups[0]?.units[0]?.unit.id).toBe(
      "unit-yinzhou-01",
    );
    expect(view.manualReview.map((u) => u.unit.id)).toEqual(["unit-suzhou-01"]);
    expect(view.notEligible.map((u) => u.unit.id)).toEqual(["unit-nanjing-01"]);
    expect(view.closed.map((u) => u.unit.id)).toEqual(["unit-wenzhou-01"]);
    expect(view.validCount).toBe(4);
    expect(view.excludedCount).toBe(2);
    expect(view.conclusion).toContain("2 个初步符合");
    expect(view.conclusion).toContain("1 个待补充信息");
    expect(view.conclusion).toContain("1 个建议人工确认");
  });

  it("主要备考目标是初步符合之一时，它成为第一屏优先机会", () => {
    const response = makeResponse(
      {
        hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
        hefei: makeUnit("unit-hefei-01-v2", "preliminary_eligible"),
      },
      "unit-hefei-01-v2",
    );
    const view = buildListViewModel(response);
    expect(view.priority?.unit.id).toBe("unit-hefei-01-v2");
    expect(view.otherPreliminary.map((u) => u.unit.id)).toEqual([
      "unit-hangzhou-01",
    ]);
  });

  it("无初步符合但有待补充时，结论引导补信息且没有优先卡", () => {
    const response = makeResponse({
      yinzhou: makeUnit("unit-yinzhou-01", "need_more_info"),
    });
    const view = buildListViewModel(response);
    expect(view.priority).toBeNull();
    expect(view.otherPreliminary).toHaveLength(0);
    expect(view.conclusion).toContain("补充 1 个机会");
  });

  it("已截止机会不计入有效机会数", () => {
    const response = makeResponse({
      wenzhou: makeUnit("unit-wenzhou-01", "preliminary_eligible", {
        gates: [
          { code: "subject_not_open", passed: true, reason: "" },
          {
            code: "registration_closed",
            passed: false,
            reason: "已截止",
          },
          { code: "out_of_scope_nature", passed: true, reason: "" },
          { code: "announcement_withdrawn", passed: true, reason: "" },
          { code: "no_official_source", passed: true, reason: "" },
        ],
      }),
    });
    const view = buildListViewModel(response);
    expect(view.validCount).toBe(0);
    expect(view.closed).toHaveLength(1);
  });

  it("主推荐会二次校验：已截止、无官方来源和明确不符合都不能混入", () => {
    const valid = makeUnit("unit-valid", "preliminary_eligible");
    const closed = makeUnit("unit-closed", "preliminary_eligible", {
      gates: [
        { code: "registration_closed", passed: false, reason: "已截止" },
      ],
    });
    const noSource = makeUnit("unit-no-source", "preliminary_eligible", {
      announcement: {
        ...valid.announcement,
        id: "ann-no-source",
        officialUrl: "",
      },
    });
    const notEligible = makeUnit("unit-not-eligible", "not_eligible");
    const response = makeResponse({} as never);
    response.groups.preliminary = [closed, noSource, notEligible, valid];

    const view = buildListViewModel(response);
    expect(view.priority?.unit.id).toBe("unit-valid");
    expect(view.otherPreliminary).toEqual([]);
    expect(view.validCount).toBe(1);
  });

  it("评估时间格式化为月日时分", () => {
    const text = formatEvaluatedAt("2026-10-05T10:00:00+08:00");
    expect(text).toContain("10月5日");
    expect(text).toMatch(/\d{2}:\d{2}/);
  });

  it("真实监测记录被合规过滤：不进 closed、不进 realMonitored，不计有效机会（模块 7.5）", () => {
    const real = makeUnit("real-yz-2026-chinese-01", "preliminary_eligible", {
      announcement: {
        id: "real-yinzhou-2026-autumn",
        title: "鄞州区公开招聘事业编制教师公告",
        publisher: "宁波市鄞州区教育局",
        organizationType: "government_unified",
        officialUrl: "https://www.nbyz.gov.cn/x",
        region: { code: "330200", province: "浙江省", city: "宁波市" },
        dataset: "real",
        reviewStatus: "ai_reviewed_pending",
        reviewedBy: null,
        reviewedAt: null,
      },
      version: {
        id: "real-yinzhou-2026-autumn-v1",
        versionNumber: 1,
        sourceKind: "original",
        publishedAt: "2026-07-31T00:00:00+08:00",
        timeline: {
          pendingItems: ["具体报名时间另行通知"],
        },
        officialSource: {
          id: "src",
          locator: { kind: "url", url: "https://www.nbyz.gov.cn/x" },
          state: "ai_extracted",
          checkedAt: "2026-10-06T11:30:00+08:00",
        },
      },
      gates: [
        {
          code: "registration_unconfirmed",
          passed: false,
          reason: "官方尚未公布具体报名时间，以官方后续通知为准",
        },
        { code: "registration_closed", passed: true, reason: "" },
        { code: "out_of_scope_nature", passed: true, reason: "" },
        { code: "announcement_withdrawn", passed: true, reason: "" },
        {
          code: "evidence_not_reviewed",
          passed: false,
          reason: "高影响字段尚未经人工复核",
        },
      ],
    });
    const demoClosed = makeUnit(
      "unit-wenzhou-01",
      "preliminary_eligible",
      {
        gates: [
          { code: "subject_not_open", passed: true, reason: "" },
          { code: "registration_closed", passed: false, reason: "已截止" },
          { code: "out_of_scope_nature", passed: true, reason: "" },
          { code: "announcement_withdrawn", passed: true, reason: "" },
          { code: "no_official_source", passed: true, reason: "" },
        ],
      },
    );
    const response = makeResponse({} as never);
    response.groups.closed = [real, demoClosed];

    const view = buildListViewModel(response);
    // 模块 7.5：用户端不显示 AI 初核待人工复核记录（real）。
    // list-view 把 real 从 closed 拆出后丢弃，realMonitored 永远为空。
    expect(view.realMonitored).toEqual([]);
    expect(view.closed.map((u) => u.unit.id)).toEqual(["unit-wenzhou-01"]);
    expect(view.validCount).toBe(0);
    expect(view.coverage.openOpportunityCount).toBe(0);
  });
});

describe("buildListViewModel：模块 5 异常态与地区分流", () => {
  function profileWith(regions: UserRecruitmentProfile["regions"]) {
    return { regions } as UserRecruitmentProfile;
  }

  it("仅地区维度 FAIL 的单元进入 regionOutOfScope，不留在明确不符合（缺信息不算不符合）", () => {
    const regionOnly = makeUnit("unit-guangzhou-01", "not_eligible", {
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
    const hardFail = makeUnit("unit-nanjing-01", "not_eligible", {
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
    const response = makeResponse({} as never);
    response.groups.notEligible = [regionOnly, hardFail];

    const view = buildListViewModel(response);
    expect(view.regionOutOfScope.map((u) => u.unit.id)).toEqual([
      "unit-guangzhou-01",
    ]);
    expect(view.notEligible.map((u) => u.unit.id)).toEqual(["unit-nanjing-01"]);
  });

  it("暂未收录：画像省级地区无任何岗位/监测覆盖时给出提示，但不产生任何不符合结论", () => {
    const response = makeResponse({
      hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
    });
    const view = buildListViewModel(
      response,
      profileWith([
        { code: "330000", province: "浙江省", level: "required" },
        { code: "440000", province: "广东省", level: "consider" },
      ]),
    );
    expect(view.uncoveredRegions).toEqual([
      { code: "440000", label: "广东省" },
    ]);
  });

  /** 构造指定地区/分配方式的演示单元（其余字段沿用合格夹具） */
  function demoUnitInRegion(
    unitId: string,
    region: { code: string; province: string; city?: string },
    allocationCode = "direct_school",
  ): UnitMatchDTO {
    const base = makeUnit(unitId, "preliminary_eligible");
    return {
      ...base,
      unit: {
        ...base.unit,
        region,
        allocation: { code: allocationCode, description: allocationCode },
      },
    };
  }

  it("江苏画像：苏州/南京虚构演示岗位不构成真实覆盖，江苏省仍标记暂未收录", () => {
    const suzhou = demoUnitInRegion(
      "unit-suzhou-demo",
      { code: "320500", province: "江苏省", city: "苏州市" },
      "score_based_choice",
    );
    const nanjing = demoUnitInRegion(
      "unit-nanjing-demo",
      { code: "320100", province: "江苏省", city: "南京市" },
    );
    const response = makeResponse({} as never);
    response.groups.preliminary = [suzhou];
    response.groups.notEligible = [nanjing];

    const view = buildListViewModel(
      response,
      profileWith([{ code: "320000", province: "江苏省", level: "required" }]),
    );
    expect(view.uncoveredRegions).toEqual([
      { code: "320000", label: "江苏省" },
    ]);
    // 演示卡本身仍可见（演示分区），但不能抹掉真实覆盖缺口
    expect(view.priority?.unit.id).toBe("unit-suzhou-demo");
  });

  it("浙江温州画像：温州演示卡不抑制「温州市暂未收录」（真实监测仅杭州、宁波）", () => {
    const wenzhou = demoUnitInRegion(
      "unit-wenzhou-demo",
      { code: "330300", province: "浙江省", city: "温州市" },
    );
    const response = makeResponse({} as never);
    response.groups.closed = [
      {
        ...wenzhou,
        gates: [
          { code: "registration_closed", passed: false, reason: "已截止" },
        ],
      },
    ];
    const view = buildListViewModel(
      response,
      profileWith([
        { code: "330300", province: "浙江省", city: "温州市", level: "required" },
      ]),
    );
    expect(view.uncoveredRegions).toEqual([
      { code: "330300", label: "浙江省温州市" },
    ]);
  });

  it("浙江+江苏画像：浙江（杭州/宁波已监测）不在暂未收录列表，江苏在列表", () => {
    const response = makeResponse({
      hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
    });
    const view = buildListViewModel(
      response,
      profileWith([
        { code: "330000", province: "浙江省", level: "required" },
        { code: "320000", province: "江苏省", level: "consider" },
      ]),
    );
    expect(view.uncoveredRegions.map((r) => r.code)).toEqual(["320000"]);
  });

  it("真实 AI 初核待复核记录即使混入 preliminary 也不进任何主要推荐（前端证据闸门兜底）", () => {
    const realPending = makeUnit("real-yz-2026-chinese-01", "preliminary_eligible", {
      announcement: {
        id: "real-yinzhou-2026-autumn",
        title: "鄞州区公开招聘事业编制教师公告",
        publisher: "宁波市鄞州区教育局",
        organizationType: "government_unified",
        officialUrl: "https://www.nbyz.gov.cn/x",
        region: { code: "330200", province: "浙江省", city: "宁波市" },
        dataset: "real",
        reviewStatus: "ai_reviewed_pending",
        reviewedBy: null,
        reviewedAt: null,
      },
      version: {
        id: "real-yinzhou-2026-autumn-v1",
        versionNumber: 1,
        sourceKind: "original",
        publishedAt: "2026-07-31T00:00:00+08:00",
        timeline: { pendingItems: ["报名时间另行通知"] },
        officialSource: {
          id: "src",
          locator: { kind: "url", url: "https://www.nbyz.gov.cn/x" },
          state: "ai_extracted",
          checkedAt: "2026-10-06T11:30:00+08:00",
        },
      },
      gates: [
        {
          code: "evidence_not_reviewed",
          passed: false,
          reason: "高影响字段尚未经人工复核",
        },
      ],
    });
    const response = makeResponse({} as never);
    response.groups.preliminary = [realPending];

    const view = buildListViewModel(response);
    expect(view.priority).toBeNull();
    expect(view.otherPreliminary).toEqual([]);
    expect(view.validCount).toBe(0);
    expect(view.closed.map((u) => u.unit.id)).toEqual([]);
  });

  it("已人工复核且证据为 official 的真实记录满足发布门槛时可进主要推荐（正向路径不被误杀）", () => {
    const realPublished = makeUnit("real-hz-published", "preliminary_eligible", {
      unit: {
        id: "real-hz-published",
        code: "HZ-PUB",
        name: "杭州第二中学富春学校·高中语文教师",
        region: { code: "330111", province: "浙江省", city: "杭州市", district: "富阳区" },
        subject: "chinese",
        stage: "high",
        headcount: 4,
        organizationType: "institution_unified",
        employmentNature: {
          code: "public_institution_staff",
          officialName: "事业编制",
        },
        allocation: { code: "direct_school", description: "按报考学校直接定岗" },
        schoolPlacement: {
          status: "specified",
          schoolName: "杭州第二中学富春学校",
        },
      },
      announcement: {
        id: "real-hangzhou-published",
        title: "杭州市教育局公开招聘公告",
        publisher: "杭州市教育局",
        organizationType: "institution_unified",
        officialUrl: "https://edu.hangzhou.gov.cn/art/x.html",
        region: { code: "330100", province: "浙江省", city: "杭州市" },
        dataset: "real",
        reviewStatus: "human_reviewed",
        reviewedBy: "reviewer-chen",
        reviewedAt: "2026-10-08T10:00:00+08:00",
      },
    });
    const response = makeResponse({} as never);
    response.groups.preliminary = [realPublished];

    const view = buildListViewModel(response);
    expect(view.priority?.unit.id).toBe("real-hz-published");
    expect(view.validCount).toBe(1);
  });

  it("受邀模式传入空占位画像时，机会页不应因缺少 regions 而崩溃", () => {
    const response = makeResponse({
      hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
    });

    expect(() =>
      buildListViewModel(response, {} as UserRecruitmentProfile),
    ).not.toThrow();
    expect(
      buildListViewModel(response, {} as UserRecruitmentProfile)
        .uncoveredRegions,
    ).toEqual([]);
  });

  it("四档全空且 closed 也为空时 emptyResult=true；有留档记录时不算空结果", () => {
    const empty = makeResponse({} as never);
    expect(buildListViewModel(empty).emptyResult).toBe(true);

    const withClosed = makeResponse({} as never);
    withClosed.groups.closed = [
      makeUnit("unit-wenzhou-01", "preliminary_eligible", {
        gates: [
          { code: "subject_not_open", passed: true, reason: "" },
          { code: "registration_closed", passed: false, reason: "已截止" },
          { code: "out_of_scope_nature", passed: true, reason: "" },
          { code: "announcement_withdrawn", passed: true, reason: "" },
          { code: "no_official_source", passed: true, reason: "" },
        ],
      }),
    ];
    expect(buildListViewModel(withClosed).emptyResult).toBe(false);
  });

  it("closedBuckets：截止进 expired 桶，来源失效进 source 桶", () => {
    const expired = makeUnit("unit-wenzhou-01", "preliminary_eligible", {
      gates: [
        { code: "subject_not_open", passed: true, reason: "" },
        { code: "registration_closed", passed: false, reason: "已截止" },
        { code: "out_of_scope_nature", passed: true, reason: "" },
        { code: "announcement_withdrawn", passed: true, reason: "" },
        { code: "no_official_source", passed: true, reason: "" },
      ],
    });
    const sourceLost = makeUnit("unit-jiaxing-01", "preliminary_eligible", {
      gates: [
        { code: "subject_not_open", passed: true, reason: "" },
        { code: "registration_closed", passed: true, reason: "" },
        { code: "out_of_scope_nature", passed: true, reason: "" },
        { code: "announcement_withdrawn", passed: true, reason: "" },
        {
          code: "source_unavailable",
          passed: false,
          reason: "官方来源最近巡检不可用（404）",
        },
        { code: "no_official_source", passed: true, reason: "" },
      ],
    });
    const response = makeResponse({} as never);
    response.groups.closed = [expired, sourceLost];
    const view = buildListViewModel(response);
    const keys = view.closedBuckets.map((b) => b.key);
    expect(keys).toContain("expired");
    expect(keys).toContain("source");
    expect(
      view.closedBuckets.find((b) => b.key === "source")?.units[0]?.unit.id,
    ).toBe("unit-jiaxing-01");
  });

  it("listCardNextStepLabel：四档与闸门态各给一个下一步文案", () => {
    expect(
      listCardNextStepLabel(makeUnit("u1", "preliminary_eligible")),
    ).toBe("查看依据并保存");
    expect(listCardNextStepLabel(makeUnit("u2", "need_more_info"))).toBe(
      "查看要补充的信息",
    );
    expect(listCardNextStepLabel(makeUnit("u3", "manual_review"))).toBe(
      "查看确认要点",
    );
    expect(listCardNextStepLabel(makeUnit("u4", "not_eligible"))).toBe(
      "查看不符合原因",
    );
    const closed = makeUnit("u5", "preliminary_eligible", {
      gates: [
        { code: "subject_not_open", passed: true, reason: "" },
        { code: "registration_closed", passed: false, reason: "已截止" },
        { code: "out_of_scope_nature", passed: true, reason: "" },
        { code: "announcement_withdrawn", passed: true, reason: "" },
        { code: "no_official_source", passed: true, reason: "" },
      ],
    });
    expect(listCardNextStepLabel(closed)).toContain("公告");
  });
});

describe("dimensionImpactCounts（D05：补充提示的「影响岗位」计数）", () => {
  it("按维度聚合可行动的待补单元；与结果页 needInfoGroups 同口径", () => {
    const response = makeResponse({
      yinzhou: makeUnit("unit-yinzhou-01", "need_more_info"),
    });
    const impact = dimensionImpactCounts(response);
    expect(impact.hukou).toBe(1);
    expect(impact.age).toBeUndefined();
  });

  it("闸门失败/不可行动的单元不计入；空分组返回空对象", () => {
    const closedNeedInfo = makeUnit("unit-closed-needinfo", "need_more_info", {
      gates: [
        { code: "subject_not_open", passed: true, reason: "" },
        { code: "registration_closed", passed: false, reason: "已截止" },
        { code: "out_of_scope_nature", passed: true, reason: "" },
        { code: "announcement_withdrawn", passed: true, reason: "" },
        { code: "no_official_source", passed: true, reason: "" },
      ],
    });
    const response = makeResponse({ yinzhou: closedNeedInfo });
    expect(dimensionImpactCounts(response)).toEqual({});

    const empty = makeResponse({});
    expect(dimensionImpactCounts(empty)).toEqual({});
  });
});

describe("buildListViewModel：v7.2 工作台三标签分桶", () => {
  it("六场景按 classifyOpportunity 分到正确桶且互斥", () => {
    const closedWenzhou = makeUnit("unit-wenzhou-01", "preliminary_eligible", {
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
    const response = makeResponse({
      hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
      hefei: makeUnit("unit-hefei-01-v2", "preliminary_eligible"),
      yinzhou: makeUnit("unit-yinzhou-01", "need_more_info"),
      suzhou: makeUnit("unit-suzhou-01", "manual_review"),
      nanjing: makeUnit("unit-nanjing-01", "not_eligible"),
      wenzhou: closedWenzhou,
    });

    const view = buildListViewModel(response);
    // priority 桶：杭州 + 合肥（preliminary_eligible）
    expect(view.workbench.priority.count).toBe(2);
    expect(view.workbench.priority.units.map((u) => u.unit.id)).toEqual([
      "unit-hangzhou-01",
      "unit-hefei-01-v2",
    ]);
    // supplement 桶：鄞州（unknown）+ 苏州（consult）
    expect(view.workbench.supplement.count).toBe(2);
    expect(view.workbench.supplement.units.map((u) => u.unit.id)).toEqual([
      "unit-yinzhou-01",
      "unit-suzhou-01",
    ]);
    // outOfScope 桶：南京是 not_eligible 但无 dimensions FAIL → excluded 非 outOfScope
    expect(view.workbench.outOfScope.count).toBe(0);
    // excluded 桶：温州（闸门失败）+ 南京（not_eligible 非地区 FAIL）
    expect(view.workbench.excluded.map((u) => u.unit.id)).toEqual([
      "unit-nanjing-01",
      "unit-wenzhou-01",
    ]);
  });

  it("仅地区 FAIL 的 not_eligible 进 outOfScope，不进 excluded", () => {
    const regionOnly = makeUnit("unit-guangzhou-01", "not_eligible", {
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
    const response = makeResponse({} as never);
    response.groups.notEligible = [regionOnly];

    const view = buildListViewModel(response);
    expect(view.workbench.outOfScope.count).toBe(1);
    expect(view.workbench.outOfScope.units[0]?.unit.id).toBe(
      "unit-guangzhou-01",
    );
    expect(view.workbench.excluded).toHaveLength(0);
  });

  it("非地区 FAIL 的 not_eligible 进 excluded，不进 outOfScope", () => {
    const hardFail = makeUnit("unit-nanjing-01", "not_eligible", {
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
    const response = makeResponse({} as never);
    response.groups.notEligible = [hardFail];

    const view = buildListViewModel(response);
    expect(view.workbench.outOfScope.count).toBe(0);
    expect(view.workbench.excluded.map((u) => u.unit.id)).toEqual([
      "unit-nanjing-01",
    ]);
  });

  it("MANUAL_REVIEW 在 supplement 桶（不进普通补表，也不进 excluded）", () => {
    const response = makeResponse({
      suzhou: makeUnit("unit-suzhou-01", "manual_review"),
    });
    const view = buildListViewModel(response);
    expect(view.workbench.supplement.count).toBe(1);
    expect(view.workbench.supplement.units[0]?.overall).toBe("manual_review");
    expect(view.workbench.excluded).toHaveLength(0);
  });

  it("excluded 按 closedBuckets 分桶供折叠区展示", () => {
    const expired = makeUnit("unit-wenzhou-01", "preliminary_eligible", {
      gates: [
        { code: "registration_closed", passed: false, reason: "已截止" },
      ],
    });
    const sourceLost = makeUnit("unit-jiaxing-01", "preliminary_eligible", {
      gates: [
        {
          code: "source_unavailable",
          passed: false,
          reason: "官方来源不可用",
        },
      ],
    });
    const response = makeResponse({} as never);
    response.groups.closed = [expired, sourceLost];

    const view = buildListViewModel(response);
    expect(view.workbench.excluded.map((u) => u.unit.id)).toEqual([
      "unit-wenzhou-01",
      "unit-jiaxing-01",
    ]);
    // closedBuckets 仍可按闸门主异常态分桶
    const keys = view.closedBuckets.map((b) => b.key);
    expect(keys).toContain("expired");
    expect(keys).toContain("source");
  });

  it("real AI 初核记录不进入任何 workbench 桶（前端兜底）", () => {
    const real = makeUnit("real-yz-2026-chinese-01", "preliminary_eligible", {
      announcement: {
        id: "real-yz",
        title: "real",
        publisher: "教育局",
        organizationType: "government_unified",
        officialUrl: "https://example.gov.cn/a",
        region: { code: "330100", province: "浙江省", city: "杭州市" },
        dataset: "real",
        reviewStatus: "ai_reviewed_pending",
        reviewedBy: null,
        reviewedAt: null,
      },
      version: {
        id: "real-yz-v1",
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
      gates: [
        {
          code: "evidence_not_reviewed",
          passed: false,
          reason: "高影响字段尚未经人工复核",
        },
      ],
    });
    const response = makeResponse({} as never);
    response.groups.closed = [real];

    const view = buildListViewModel(response);
    // real 未通过 isPublishedForUser，不进入 workbench 任何桶
    expect(view.workbench.priority.count).toBe(0);
    expect(view.workbench.supplement.count).toBe(0);
    expect(view.workbench.outOfScope.count).toBe(0);
    expect(view.workbench.excluded).toHaveLength(0);
  });

  it("三标签 count 与 units.length 一致", () => {
    const response = makeResponse({
      hangzhou: makeUnit("unit-hangzhou-01", "preliminary_eligible"),
      yinzhou: makeUnit("unit-yinzhou-01", "need_more_info"),
    });
    const view = buildListViewModel(response);
    expect(view.workbench.priority.count).toBe(
      view.workbench.priority.units.length,
    );
    expect(view.workbench.supplement.count).toBe(
      view.workbench.supplement.units.length,
    );
    expect(view.workbench.outOfScope.count).toBe(
      view.workbench.outOfScope.units.length,
    );
  });
});
