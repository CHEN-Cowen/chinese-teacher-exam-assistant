import { describe, expect, it } from "vitest";
import {
  V61_NOW,
  V61_SCENARIO_IDS,
  V61_SEED_ANNOUNCEMENTS,
  V61_SEED_PROFILE,
} from "@/lib/seed/v61-opportunities";
import { buildOpportunitiesView, guestCardNextStep } from "./opportunities-view";
import { schoolDisplayText } from "@/lib/opportunities/school-placement";

describe("机会页视图模型", () => {
  const view = buildOpportunitiesView(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);

  it("按四档结果分组：2 初步符合 / 1 补户籍 / 1 人工确认 / 1 学历不符 / 1 已截止 / 1 来源失效", () => {
    expect(view.preliminary.map((r) => r.announcementId).sort()).toEqual(
      [V61_SCENARIO_IDS.eligible, V61_SCENARIO_IDS.supplemented].sort(),
    );
    expect(view.needInfoGroups).toHaveLength(1);
    expect(view.needInfoGroups[0].dimension).toBe("hukou");
    expect(view.needInfoGroups[0].count).toBe(1);
    expect(view.manualReview.map((r) => r.announcementId)).toEqual([
      V61_SCENARIO_IDS.majorAmbiguous,
    ]);
    expect(view.notEligible.map((r) => r.announcementId)).toEqual([
      V61_SCENARIO_IDS.educationFail,
    ]);
    // 嘉兴来源失效在排序上先于温州截止（同为浙江、状态初步符合，事业编优先）
    expect(view.closed.map((r) => r.announcementId)).toEqual([
      V61_SCENARIO_IDS.sourceUnavailable,
      V61_SCENARIO_IDS.closed,
    ]);
  });

  it("结论句与有效机会计数一致", () => {
    expect(view.validCount).toBe(4);
    expect(view.conclusion).toContain("2 个初步符合");
    // 未覆盖不等于没有招聘，必须在覆盖说明中声明
    expect(view.coverage).toContain("未覆盖地区不等于没有招聘");
  });

  it("优先机会是浙江事业编的杭州岗位（地区偏好 → 确定程度排序）", () => {
    expect(view.priority?.announcementId).toBe(V61_SCENARIO_IDS.eligible);
    expect(view.priority?.regionText).toBe("杭州市");
    expect(view.priority?.natureText).toBe("事业编");
    expect(view.priority?.stageText).toBe("初中");
    expect(view.priority?.headcount).toBe(12);
  });

  it("风险不制造虚假紧迫感：杭州距截止 16 天，只给中性提示", () => {
    expect(view.priority?.deadline).toContain("还剩 16 天");
    expect(view.risk?.tone).toBe("info");
  });

  it("已截止机会闸门失败原因可查，且不在主要推荐中", () => {
    const wenzhou = view.closed.find((r) => r.announcementId === V61_SCENARIO_IDS.closed);
    expect(wenzhou?.registrationClosed).toBe(true);
    expect(wenzhou?.gateReason).toContain("截止");
  });

  it("合肥当前版本为补充公告 v2：扩招 8 人、截止延期到 11 月", () => {
    const hefei = view.preliminary.find((r) => r.announcementId === V61_SCENARIO_IDS.supplemented);
    expect(hefei?.headcount).toBe(8);
    expect(hefei?.registrationEnd).toBe("2026-11-15");
  });

  it("每张卡都带逐项条件与官方来源（二、三层渐进展开所需字段齐备）", () => {
    for (const row of [...view.preliminary, ...view.manualReview, ...view.notEligible]) {
      expect(row.dimensions.length).toBeGreaterThan(0);
      expect(row.officialUrl).toMatch(/^https:\/\//);
      expect(row.publisher.length).toBeGreaterThan(0);
      expect(row.oneLineReason.length).toBeGreaterThan(0);
    }
  });

  it("机会卡严格遵守内容预算字段（6 项 + 行动，不堆砌额外事实字段）", () => {
    const budgetKeys = [
      "regionText",
      "unitName",
      "natureText",
      "stageText",
      "headcount",
      "status",
      "deadline",
      "oneLineReason",
    ];
    for (const key of budgetKeys) {
      expect(view.priority).toHaveProperty(key);
    }
  });

  it("来源失效单元落入 source 异常桶，闸门原因可查，且不与已截止混为一组", () => {
    const source = view.closed.find(
      (r) => r.announcementId === V61_SCENARIO_IDS.sourceUnavailable,
    );
    expect(source?.gateCode).toBe("source_unavailable");
    expect(source?.gateReason).toContain("404");
    const sourceBucket = view.closedBuckets.find((b) => b.key === "source");
    const expiredBucket = view.closedBuckets.find((b) => b.key === "expired");
    expect(sourceBucket?.rows.map((r) => r.unitId)).toEqual(["unit-jiaxing-01"]);
    expect(expiredBucket?.rows.map((r) => r.unitId)).toEqual(["unit-wenzhou-01"]);
  });

  it("每条条件行同时带公告原文表述与系统预筛判断（官方事实与推断分离）", () => {
    const jiaxing = view.closed.find(
      (r) => r.announcementId === V61_SCENARIO_IDS.sourceUnavailable,
    )!;
    const edu = jiaxing.dimensions.find((d) => d.label === "学历")!;
    expect(edu.officialRequirement).toContain("本科");
    expect(edu.reason.length).toBeGreaterThan(0);
    const region = jiaxing.dimensions.find((d) => d.label === "地区意向")!;
    expect(region.officialRequirement).toBeNull();
  });
});

describe("机会页视图模型：地区不重叠 / 暂未收录（模块 5）", () => {
  it("仅保留江苏画像：浙江岗位只进「地区不重叠」，不进「明确不符合」", () => {
    const jiangsuOnly = {
      ...V61_SEED_PROFILE,
      regions: [{ code: "320000", province: "江苏省", level: "required" as const }],
    };
    const v = buildOpportunitiesView(V61_SEED_ANNOUNCEMENTS, jiangsuOnly, V61_NOW);
    expect(
      v.regionOutOfScope.some((r) => r.announcementId === V61_SCENARIO_IDS.eligible),
    ).toBe(true);
    expect(
      v.regionOutOfScope.some((r) => r.announcementId === V61_SCENARIO_IDS.needHukou),
    ).toBe(true);
    // 南京同时有学历硬不符（江苏地域内）→ 仍是明确不符合，不被地区桶吸走
    expect(
      v.notEligible.some((r) => r.announcementId === V61_SCENARIO_IDS.educationFail),
    ).toBe(true);
    // 闸门失败（截止/来源失效）不参与地区桶
    expect(v.regionOutOfScope.every((r) => r.gateCode === null)).toBe(true);
  });

  it("画像地区无任何公告覆盖 → uncoveredRegions 标记暂未收录，但不判任何机会不符合", () => {
    const guangdong = {
      ...V61_SEED_PROFILE,
      regions: [{ code: "440000", province: "广东省", level: "required" as const }],
    };
    const v = buildOpportunitiesView(V61_SEED_ANNOUNCEMENTS, guangdong, V61_NOW);
    expect(v.uncoveredRegions).toEqual([{ code: "440000", label: "广东省" }]);
    // 广东画像下没有「仅因地区」被误判为明确不符合的单元：
    // 南京留在明确不符合，只是因为学历硬不符（非地区维度）
    expect(
      v.notEligible.every((r) =>
        r.dimensions.some(
          (d) => d.value === "FAIL" && d.label !== "地区意向",
        ),
      ),
    ).toBe(true);
    expect(v.regionOutOfScope.length).toBeGreaterThan(0);
  });

  it("浙江+江苏+安徽画像下没有暂未收录地区", () => {
    const v = buildOpportunitiesView(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);
    expect(v.uncoveredRegions).toEqual([]);
  });
});

describe("guestCardNextStep：每张卡一个下一步", () => {
  it("四档与闸门态各有对应下一步，异常态只给官方出口", () => {
    const v = buildOpportunitiesView(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);
    expect(guestCardNextStep(v.priority!).kind).toBe("login");
    const needInfo = v.needInfoGroups[0]!.rows[0]!;
    expect(guestCardNextStep(needInfo)).toMatchObject({
      kind: "supplement",
      label: "补充信息后判断",
    });
    expect(guestCardNextStep(v.manualReview[0]!).label).toBe("查看确认要点");
    expect(guestCardNextStep(v.notEligible[0]!).label).toBe("查看不符合原因");
    const source = v.closed.find(
      (r) => r.announcementId === V61_SCENARIO_IDS.sourceUnavailable,
    )!;
    expect(guestCardNextStep(source)).toMatchObject({
      kind: "official",
      label: "查看公告留档",
    });
  });
});

describe("v7.1 M4：卡片第一层九要素与学校表达", () => {
  const view = buildOpportunitiesView(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);

  it("每张有效卡都带完整省市区、学科与分配方式编码（第一层固定信息齐备）", () => {
    const rows = [
      view.priority,
      ...view.preliminary,
      ...view.needInfoGroups.flatMap((g) => g.rows),
      ...view.manualReview,
    ].filter((r): r is NonNullable<typeof r> => r !== null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // 省市区：公告未公布的层级省略，但省级必须始终在场
      expect(row.regionFullText).toContain(row.regionText.slice(0, 3));
      expect(row.subjectText).toBe("语文");
      expect(row.allocationCode.length).toBeGreaterThan(0);
    }
    expect(view.priority!.regionFullText).toBe("浙江省 杭州市");
    const yinzhou = view.needInfoGroups[0].rows.find((r) => r.unitId === "unit-yinzhou-01");
    expect(yinzhou!.regionFullText).toBe("浙江省 宁波市 鄞州区");
  });

  it("录用后选岗（按成绩择岗）：学校行走「录用后选岗」口径，绝不显示岗位组名当学校", () => {
    const suzhou = view.manualReview.find((r) => r.unitId === "unit-suzhou-01")!;
    expect(suzhou.allocationCode).toBe("score_based_choice");
    expect(suzhou.schoolPlacement).toBeUndefined();
    // 与 OpportunityCard 相同的调用形状：行模型没有 allocation 对象，只有 allocationCode
    expect(
      schoolDisplayText(
        { allocation: { code: suzhou.allocationCode }, schoolPlacement: suzhou.schoolPlacement },
        suzhou.regionText,
      ),
    ).toBe("录用后选岗，具体学校以官方安排为准");
  });

  it("统一调配：明确显示「录取后统一调配，具体学校以官方安排为准」，不虚构学校", () => {
    const hefei = view.preliminary.find(
      (r) => r.announcementId === V61_SCENARIO_IDS.supplemented,
    )!;
    expect(hefei.allocationCode).toBe("unified_assignment");
    expect(
      schoolDisplayText(
        { allocation: { code: hefei.allocationCode }, schoolPlacement: hefei.schoolPlacement },
        hefei.regionText,
      ),
    ).toBe("录取后统一调配，具体学校以官方安排为准");
  });

  it("直接定岗但未逐校列明：明确显示未知，以官方岗位计划表为准；招聘单位名不冒充学校", () => {
    const hangzhou = view.priority!;
    expect(hangzhou.allocationCode).toBe("direct_school");
    expect(hangzhou.schoolPlacement).toBeUndefined();
    const schoolText = schoolDisplayText(
      { allocation: { code: hangzhou.allocationCode }, schoolPlacement: hangzhou.schoolPlacement },
      hangzhou.regionText,
    );
    expect(schoolText).toContain("具体学校未知");
    expect(schoolText).toContain("官方岗位计划表");
    // 招聘单位/岗位组名不得被当作学校兜底
    expect(schoolText).not.toContain(hangzhou.unitName);
  });
});
