/**
 * 访客覆盖镜像（lib/guest/coverage.ts）必须与后端
 * backend/src/matching/coverage.ts 的 REAL_COVERAGE 人工保持一致。
 * 前端无法直接引用后端模块，这里以快照断言锁定关键字段：
 * 后端巡检结论更新时，必须同步本镜像并更新本测试与 GUEST_COVERAGE_LAST_UPDATED。
 */
import { describe, expect, it } from "vitest";
import { GUEST_COVERAGE, GUEST_COVERAGE_LAST_UPDATED } from "./coverage";
import {
  buildProvinceScopeViews,
  coverageProvinceLine,
} from "@/lib/opportunities/coverage-view";

describe("访客侧真实覆盖镜像（随后端 REAL_COVERAGE 人工同步）", () => {
  it("验证期只监测语文，状态为监测中无在报，0 个在报岗位", () => {
    expect(GUEST_COVERAGE.subject).toBe("chinese");
    expect(GUEST_COVERAGE.status).toBe("monitoring_no_open");
    expect(GUEST_COVERAGE.openOpportunityCount).toBe(0);
  });

  it("仅杭州、宁波两市，共 3 个官方来源", () => {
    expect(GUEST_COVERAGE.regions.map((r) => r.code)).toEqual(["330100", "330200"]);
    const sourceCount = GUEST_COVERAGE.regions.reduce(
      (sum, region) => sum + region.sources.length,
      0,
    );
    expect(sourceCount).toBe(3);
    expect(GUEST_COVERAGE.regions.flatMap((r) => r.sources).every((s) => s.ok)).toBe(true);
  });

  it("最近核对时间与同步日期一致，且保留下一窗口与覆盖边界说明", () => {
    expect(GUEST_COVERAGE.lastCheckedAt.startsWith(GUEST_COVERAGE_LAST_UPDATED)).toBe(true);
    expect(GUEST_COVERAGE.nextWindowNote).toContain("11—12 月");
    expect(GUEST_COVERAGE.scopeNote).toContain("暂未收录");
  });

  it("逐省口径：浙江监测杭州/宁波 2 市；江苏 not_started 且 0 城市 0 来源（不虚构江苏渠道）", () => {
    expect(GUEST_COVERAGE.version).toBe("kb-monitoring-coverage-1.1.0");
    const views = buildProvinceScopeViews(GUEST_COVERAGE);
    expect(views.map((v) => v.code)).toEqual(["330000", "320000"]);

    const zhejiang = views.find((v) => v.code === "330000")!;
    expect(zhejiang.status).toBe("monitoring_no_open");
    expect(zhejiang.monitoredRegionCodes).toEqual(["330100", "330200"]);
    expect(zhejiang.cityText).toContain("杭州");
    expect(zhejiang.cityText).toContain("宁波");
    expect(zhejiang.monitoredRegions.flatMap((r) => r.sources)).toHaveLength(3);
    expect(zhejiang.scopeNote).toContain("暂未收录");

    const jiangsu = views.find((v) => v.code === "320000")!;
    expect(jiangsu.status).toBe("not_started");
    expect(jiangsu.monitoredRegionCodes).toEqual([]);
    expect(jiangsu.monitoredRegions).toEqual([]);
    expect(jiangsu.cityText).toBe("暂未收录");
    expect(jiangsu.statusLabel).toContain("待接入");
    expect(jiangsu.scopeNote).toContain("不代表当地没有招聘");
  });

  it("一句话摘要同时呈现浙江实际城市与江苏暂未收录，不暗示全省覆盖", () => {
    const line = coverageProvinceLine(GUEST_COVERAGE);
    expect(line).toContain("浙江：杭州");
    expect(line).toContain("江苏：暂未收录（待接入）");
    expect(line).not.toContain("苏州");
    expect(line).not.toContain("南京");
  });
});
