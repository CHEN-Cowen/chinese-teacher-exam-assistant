import { describe, expect, it } from "vitest";
import type { CoverageDTO } from "./api-types";
import {
  PROVINCE_STATUS_LABELS,
  buildProvinceScopeViews,
  coverageProvinceLine,
} from "./coverage-view";

function coverage(
  provinces: CoverageDTO["provinces"],
  regions: CoverageDTO["regions"],
): CoverageDTO {
  return {
    version: "test",
    subject: "chinese",
    subjectLabel: "语文",
    status: "monitoring_no_open",
    provinces,
    regions,
    lastCheckedAt: "2026-10-06T11:30:00+08:00",
    openOpportunityCount: 0,
    nextWindowNote: "",
    scopeNote: "暂未收录不代表当地没有招聘",
  };
}

describe("coverage-view：逐省覆盖视图", () => {
  it("监测中省份关联实际监测城市与来源，城市短名兼容两种标签写法", () => {
    const views = buildProvinceScopeViews(
      coverage(
        [
          {
            code: "330000",
            label: "浙江省",
            status: "monitoring_no_open",
            monitoredRegionCodes: ["330100", "330200"],
            scopeNote: "",
          },
        ],
        [
          {
            code: "330100",
            label: "浙江省·杭州市",
            authority: "杭州市教育局",
            sources: [],
          },
          {
            code: "330200",
            label: "浙江·宁波（含鄞州等区县）",
            authority: "宁波市教育局",
            sources: [],
          },
        ],
      ),
    );
    expect(views[0]!.cityText).toBe("杭州市、宁波（含鄞州等区县）");
    expect(views[0]!.monitoredRegions).toHaveLength(2);
    expect(views[0]!.statusLabel).toBe(
      PROVINCE_STATUS_LABELS.monitoring_no_open,
    );
  });

  it("not_started 省份：0 城市 0 来源，摘要明确「暂未收录（待接入）」", () => {
    const dto = coverage(
      [
        {
          code: "320000",
          label: "江苏省",
          status: "not_started",
          monitoredRegionCodes: [],
          scopeNote: "不代表当地没有招聘",
        },
      ],
      [],
    );
    const views = buildProvinceScopeViews(dto);
    expect(views[0]!.cityText).toBe("暂未收录");
    expect(views[0]!.monitoredRegions).toEqual([]);
    expect(coverageProvinceLine(dto)).toBe("江苏：暂未收录（待接入）");
  });

  it("监测城市代码在 regions 中缺失时跳过该城市，不虚构来源", () => {
    const views = buildProvinceScopeViews(
      coverage(
        [
          {
            code: "330000",
            label: "浙江省",
            status: "monitoring_no_open",
            monitoredRegionCodes: ["330100", "339999"],
            scopeNote: "",
          },
        ],
        [
          {
            code: "330100",
            label: "浙江·杭州",
            authority: "杭州市教育局",
            sources: [],
          },
        ],
      ),
    );
    expect(views[0]!.monitoredRegions.map((r) => r.code)).toEqual(["330100"]);
  });
});
