/**
 * v7.2 统一结果工作台展示模型测试（任务 §10.1）。
 *
 * 验证：
 * - 访客数据（OpportunityRow）与登录数据（UnitMatchDTO）都能转换成同一个
 *   OpportunityCardViewModel（共享 ViewModel，双适配器）；
 * - 同一个岗位在正常结果中只能进入一个标签（priority 重复出现于 preliminary 时去重）；
 * - MANUAL_REVIEW 进入「补充后判断」且标记 consult，绝不进入优先机会；
 * - 用工偏好不匹配（只看事业编筛除）只进入「偏好范围外」，不是资格不符合；
 * - 已截止与来源失效（闸门失败）进入留档区，不混入三个正常标签。
 */
import { describe, expect, it } from "vitest";
import {
  buildGuestWorkbenchTabs,
  buildUnitTabs,
  classifyGuestRow,
  guestRowToCardView,
  unitMatchToCardView,
} from "./workbench-view";
import type { GuestPreviewReady } from "@/lib/guest/previewEngine";
import type {
  OpportunitiesView,
  OpportunityRow,
} from "@/lib/ia/opportunities-view";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";
import type { WorkbenchViewModel } from "@/lib/opportunities/list-view";
import type { UserRecruitmentProfile } from "@/lib/profile/types";

const EVALUATED_AT = "2026-10-05T10:00:00+08:00";

/* ---------------- 访客端 OpportunityRow 夹具 ---------------- */

function makeRow(
  unitId: string,
  status: OpportunityRow["status"],
  extra: Partial<OpportunityRow> = {},
): OpportunityRow {
  return {
    unitId,
    announcementId: `ann-${unitId}`,
    regionText: "杭州",
    regionFullText: "浙江省·杭州市·余杭区",
    unitName: `${unitId}-岗位名`,
    subjectText: "初中语文",
    natureText: "事业编制",
    natureCode: "public_institution_staff",
    stageText: "初中",
    headcount: 2,
    status,
    deadline: "6 天后截止",
    registrationEnd: "2026-10-20",
    registrationClosed: false,
    allocationCode: "direct_school",
    region: {
      code: "330110",
      province: "浙江省",
      city: "杭州市",
      district: "余杭区",
    },
    oneLineReason: `${unitId} 的一句话依据`,
    gateCode: null,
    gateReason: null,
    dimensions: [
      { label: "学历", value: "PASS", officialRequirement: null, reason: "符合" },
      { label: "专业", value: "PASS", officialRequirement: null, reason: "符合" },
      { label: "户籍", value: "UNKNOWN", officialRequirement: null, reason: "公告未明确是否限制户籍" },
    ],
    officialUrl: "https://www.hangzhou.gov.cn/notice/1",
    publisher: "余杭区教育局",
    checkedAtText: "2026-10-04 核对",
    ...extra,
  };
}

function makePreview(
  view: Partial<OpportunitiesView>,
  natureOut: OpportunityRow[] = [],
): GuestPreviewReady {
  return {
    kind: "ready",
    profile: {} as UserRecruitmentProfile,
    view: {
      conclusion: "",
      coverage: "",
      risk: null,
      priority: null,
      validCount: 0,
      preliminary: [],
      needInfoGroups: [],
      manualReview: [],
      notEligible: [],
      regionOutOfScope: [],
      closed: [],
      closedBuckets: [],
      uncoveredRegions: [],
      ...view,
    },
    followUps: [],
    limitations: [],
    primaryAction: null,
    naturePreference: undefined,
    natureOutOfPreference: natureOut,
  };
}

/* ---------------- 登录端 UnitMatchDTO 夹具 ---------------- */

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
      officialUrl: "https://www.hangzhou.gov.cn/notice/2",
      dataset: "real",
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
        locator: { kind: "url", url: "https://www.hangzhou.gov.cn/notice/2" },
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
    dimensions: [
      {
        requirementId: "r1",
        dimension: "education",
        value: "PASS",
        reason: "符合",
        officialRequirement: null,
      },
      {
        requirementId: "r2",
        dimension: "hukou",
        value: "UNKNOWN",
        reason: "公告未明确是否限制户籍",
        officialRequirement: null,
      },
    ],
    overall,
    summary: "关键提醒",
    follow: null,
    ...extra,
  } as UnitMatchDTO;
}

/* ================= 双适配器：两种来源 → 同一 ViewModel ================= */

describe("workbench-view：双适配器产出同一个 ViewModel 形状", () => {
  it("登录 UnitMatchDTO → CardViewModel（真实标识 + 详情页链接）", () => {
    const vm = unitMatchToCardView(
      makeUnit("u1", "preliminary_eligible"),
      EVALUATED_AT,
    );
    expect(vm.id).toBe("u1");
    expect(vm.dataset).toBe("real");
    expect(vm.reviewLabel).toBe("真实公告 · 已人工核对");
    expect(vm.title).toBe("u1-岗位名");
    expect(vm.titleHref).toBe("/opportunities/u1");
    expect(vm.locationText).toContain("杭州市");
    expect(vm.mapEntry).not.toBeNull();
    expect(vm.employmentNatureText).toBe("事业编");
    expect(vm.headcount).toBe(3);
    expect(vm.passedCount).toBe(1);
    expect(vm.pendingRisk).toBe("公告未明确是否限制户籍");
  });

  it("访客 OpportunityRow → CardViewModel（永远演示标识，无详情页链接）", () => {
    const vm = guestRowToCardView(makeRow("g1", "preliminary_eligible"));
    expect(vm.id).toBe("g1");
    expect(vm.dataset).toBe("demo");
    expect(vm.reviewLabel).toBe("虚构试用示例");
    expect(vm.title).toBe("g1-岗位名");
    expect(vm.titleHref).toBeNull();
    expect(vm.locationText).toContain("杭州市");
    expect(vm.mapEntry).not.toBeNull();
    expect(vm.employmentNatureText).toBe("事业编");
    expect(vm.passedCount).toBe(2);
    expect(vm.pendingRisk).toBe("公告未明确是否限制户籍");
  });

  it("两种来源的 ViewModel 字段集完全一致", () => {
    const guestVm = guestRowToCardView(makeRow("g1", "preliminary_eligible"));
    const unitVm = unitMatchToCardView(
      makeUnit("u1", "preliminary_eligible"),
      EVALUATED_AT,
    );
    expect(Object.keys(guestVm).sort()).toEqual(Object.keys(unitVm).sort());
  });
});

/* ================= 访客分类：与登录 classifyOpportunity 同规则 ================= */

describe("classifyGuestRow：三标签互斥规则", () => {
  const none = new Set<string>();

  it("闸门失败（已截止/来源失效）→ 留档区", () => {
    expect(
      classifyGuestRow(makeRow("c1", "preliminary_eligible", {
        gateCode: "registration_closed",
        gateReason: "报名已截止",
      }), { natureOut: none, regionOut: none }).tab,
    ).toBe("excluded");
    expect(
      classifyGuestRow(makeRow("c2", "need_more_info", {
        registrationClosed: true,
      }), { natureOut: none, regionOut: none }).tab,
    ).toBe("excluded");
  });

  it("初步符合 → 优先机会", () => {
    expect(
      classifyGuestRow(makeRow("p1", "preliminary_eligible"), {
        natureOut: none,
        regionOut: none,
      }).tab,
    ).toBe("priority");
  });

  it("待补信息 → 补充后判断（unknown 子态）", () => {
    const result = classifyGuestRow(makeRow("s1", "need_more_info"), {
      natureOut: none,
      regionOut: none,
    });
    expect(result.tab).toBe("supplement");
    expect(result.supplementVariant).toBe("unknown");
  });

  it("MANUAL_REVIEW → 补充后判断（consult 子态），绝不进优先机会", () => {
    const result = classifyGuestRow(makeRow("m1", "manual_review"), {
      natureOut: none,
      regionOut: none,
    });
    expect(result.tab).toBe("supplement");
    expect(result.supplementVariant).toBe("consult");
    expect(result.tab).not.toBe("priority");
  });

  it("用工偏好筛除 → 偏好范围外（偏好分类，不是资格不符合）", () => {
    const natureOut = new Set(["n1"]);
    expect(
      classifyGuestRow(makeRow("n1", "preliminary_eligible"), {
        natureOut,
        regionOut: none,
      }).tab,
    ).toBe("outOfScope");
  });

  it("仅地区不匹配（not_eligible + regionOut）→ 偏好范围外", () => {
    const regionOut = new Set(["r1"]);
    expect(
      classifyGuestRow(makeRow("r1", "not_eligible"), {
        natureOut: none,
        regionOut,
      }).tab,
    ).toBe("outOfScope");
  });

  it("其他明确不符合（not_eligible 且非地区原因）→ 留档区", () => {
    expect(
      classifyGuestRow(makeRow("x1", "not_eligible"), {
        natureOut: none,
        regionOut: none,
      }).tab,
    ).toBe("excluded");
  });
});

/* ================= 访客工作台：互斥 + 留档 ================= */

describe("buildGuestWorkbenchTabs：同一岗位只进一个正常标签", () => {
  it("priority 同时出现在 preliminary 时去重，只进优先机会一次", () => {
    const row = makeRow("p1", "preliminary_eligible");
    const { tabs } = buildGuestWorkbenchTabs(
      makePreview({ priority: row, preliminary: [row] }),
    );
    expect(tabs.priority.map((c) => c.id)).toEqual(["p1"]);
    expect(tabs.supplement).toHaveLength(0);
    expect(tabs.outOfScope).toHaveLength(0);
  });

  it("MANUAL_REVIEW 进入补充后判断且卡片标记「建议官方确认」，不进优先", () => {
    const manual = makeRow("m1", "manual_review");
    const { tabs } = buildGuestWorkbenchTabs(
      makePreview({ manualReview: [manual] }),
    );
    expect(tabs.priority).toHaveLength(0);
    expect(tabs.supplement).toHaveLength(1);
    expect(tabs.supplement[0]!.isConsult).toBe(true);
  });

  it("已截止与来源失效进入留档区，不混入三个正常标签", () => {
    const closed = makeRow("c1", "preliminary_eligible", {
      gateCode: "registration_closed",
      gateReason: "报名已截止",
      registrationClosed: true,
    });
    const sourceDead = makeRow("c2", "need_more_info", {
      gateCode: "no_official_source",
      gateReason: "官方来源已失效",
    });
    const { tabs, archived } = buildGuestWorkbenchTabs(
      makePreview({
        preliminary: [closed],
        needInfoGroups: [
          { dimension: "hukou", dimensionText: "户籍", count: 1, rows: [sourceDead] },
        ],
        closed: [closed, sourceDead],
        closedBuckets: [
          { key: "expired", label: "已截止", rows: [closed] },
          { key: "source", label: "来源失效", rows: [sourceDead] },
        ],
      }),
    );
    expect(tabs.priority).toHaveLength(0);
    expect(tabs.supplement).toHaveLength(0);
    expect(tabs.outOfScope).toHaveLength(0);
    const archivedIds = archived.flatMap((g) => g.cards.map((c) => c.id));
    expect(archivedIds.sort()).toEqual(["c1", "c2"]);
    // 留档区保留稳定分桶标签
    expect(archived.map((g) => g.label)).toEqual(["已截止", "来源失效"]);
    // 留档卡片带闸门原因
    const c1 = archived[0]!.cards[0]!;
    expect(c1.closedGate).not.toBeNull();
    expect(c1.summary).toBe("报名已截止");
  });

  it("用工偏好筛除只影响偏好分类：outOfScope 且标记 natureOutOfPreference", () => {
    const out = makeRow("n1", "preliminary_eligible", {
      natureCode: "record_filing",
      natureText: "备案制",
    });
    const { tabs } = buildGuestWorkbenchTabs(makePreview({}, [out]));
    expect(tabs.priority).toHaveLength(0);
    expect(tabs.outOfScope).toHaveLength(1);
    const card = tabs.outOfScope[0]!;
    expect(card.natureOutOfPreference).toBe(true);
    // 不是资格不符合：状态仍是初步符合，不是 not_eligible，也没有闸门
    expect(card.status).toBe("preliminary_eligible");
    expect(card.closedGate).toBeNull();
  });

  it("混合场景：全部候选行互斥分布，总数守恒", () => {
    const priority = makeRow("p1", "preliminary_eligible");
    const supplement = makeRow("s1", "need_more_info");
    const manual = makeRow("m1", "manual_review");
    const natureOut = makeRow("n1", "preliminary_eligible");
    const regionOut = makeRow("r1", "not_eligible");
    const hardOut = makeRow("x1", "not_eligible");
    const closed = makeRow("c1", "preliminary_eligible", {
      gateCode: "registration_closed",
      gateReason: "报名已截止",
      registrationClosed: true,
    });
    const { tabs, archived } = buildGuestWorkbenchTabs(
      makePreview(
        {
          priority,
          preliminary: [priority],
          needInfoGroups: [
            { dimension: "hukou", dimensionText: "户籍", count: 1, rows: [supplement] },
          ],
          manualReview: [manual],
          notEligible: [hardOut],
          regionOutOfScope: [regionOut],
          closed: [closed],
          closedBuckets: [{ key: "expired", label: "已截止", rows: [closed] }],
        },
        [natureOut],
      ),
    );
    expect(tabs.priority.map((c) => c.id)).toEqual(["p1"]);
    expect(tabs.supplement.map((c) => c.id).sort()).toEqual(["m1", "s1"]);
    expect(tabs.outOfScope.map((c) => c.id).sort()).toEqual(["n1", "r1"]);
    const archivedIds = archived.flatMap((g) => g.cards.map((c) => c.id)).sort();
    expect(archivedIds).toEqual(["c1", "x1"]);
    // 严格互斥：7 个岗位各出现且只出现一次
    const total =
      tabs.priority.length +
      tabs.supplement.length +
      tabs.outOfScope.length +
      archivedIds.length;
    expect(total).toBe(7);
  });
});

/* ================= 登录端三标签转换 ================= */

describe("buildUnitTabs：登录 WorkbenchViewModel → 三标签 CardViewModel", () => {
  it("三个桶分别转换，分类由 classifyOpportunity 保证互斥", () => {
    const workbench: WorkbenchViewModel = {
      priority: {
        count: 1,
        units: [makeUnit("p1", "preliminary_eligible")],
      },
      supplement: {
        count: 1,
        units: [makeUnit("m1", "manual_review")],
      },
      outOfScope: {
        count: 1,
        units: [makeUnit("o1", "not_eligible")],
      },
      excluded: [],
    };
    const tabs = buildUnitTabs(workbench, EVALUATED_AT);
    expect(tabs.priority.map((c) => c.id)).toEqual(["p1"]);
    expect(tabs.supplement.map((c) => c.id)).toEqual(["m1"]);
    expect(tabs.outOfScope.map((c) => c.id)).toEqual(["o1"]);
    // 登录端 MANUAL_REVIEW 卡同样标记 consult
    expect(tabs.supplement[0]!.isConsult).toBe(true);
    expect(tabs.priority[0]!.isConsult).toBe(false);
  });
});

/* ================= 关键风险与摘要字段 ================= */

describe("CardViewModel：第 5-6 层内容", () => {
  it("访客卡 pendingRisk 取第一个 UNKNOWN/MANUAL_REVIEW 维度", () => {
    const vm = guestRowToCardView(makeRow("g1", "need_more_info"));
    expect(vm.pendingRisk).toBe("公告未明确是否限制户籍");
    expect(vm.passedCount).toBe(2);
  });

  it("闸门失败卡的 summary 用闸门原因（不是一句话依据）", () => {
    const vm = guestRowToCardView(
      makeRow("c1", "preliminary_eligible", {
        gateCode: "registration_closed",
        gateReason: "报名已截止",
      }),
    );
    expect(vm.summary).toBe("报名已截止");
    expect(vm.closedGate).toEqual({
      code: "registration_closed",
      reason: "报名已截止",
    });
  });

  it("dimensions 只在访客卡携带（登录端依据在详情页）", () => {
    const guestVm = guestRowToCardView(makeRow("g1", "preliminary_eligible"));
    const unitVm = unitMatchToCardView(
      makeUnit("u1", "preliminary_eligible"),
      EVALUATED_AT,
    );
    expect(guestVm.dimensions).not.toBeNull();
    expect(guestVm.dimensions!.length).toBeGreaterThan(0);
    expect(unitVm.dimensions).toBeNull();
  });
});
