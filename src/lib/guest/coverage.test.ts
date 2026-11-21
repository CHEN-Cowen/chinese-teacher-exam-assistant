/**
 * 访客覆盖静态快照（lib/guest/coverage.ts）一致性测试（M01/F2）。
 *
 * 快照必须与后端统一覆盖投影（backend/src/opportunities/coverage-projection.ts
 * + SOURCE_CATALOG/SOURCE_MONITORING_RECORDS，截至 GUEST_COVERAGE_LAST_UPDATED）
 * 人工保持一致。前端无法直接引用后端模块，这里以快照断言锁定关键字段；
 * 台账更新时必须同步本快照、本测试与 GUEST_COVERAGE_LAST_UPDATED。
 */
import { describe, expect, it } from "vitest";
import { GUEST_COVERAGE, GUEST_COVERAGE_LAST_UPDATED } from "./coverage";
import {
  buildProvinceScopeViews,
  coverageFallbackNote,
  coverageProvinceLine,
} from "@/lib/opportunities/coverage-view";

describe("访客侧覆盖静态快照（统一覆盖投影口径）", () => {
  it("验证期只监测语文，监测中无在报，0 个在报岗位；快照显式标注非实时回退", () => {
    expect(GUEST_COVERAGE.subject).toBe("chinese");
    expect(GUEST_COVERAGE.status).toBe("monitoring_no_open");
    expect(GUEST_COVERAGE.openOpportunityCount).toBe(0);
    expect(GUEST_COVERAGE.caliber.isFallback).toBe(true);
    expect(GUEST_COVERAGE.caliber.fallbackNote).toContain("非实时");
    expect(coverageFallbackNote(GUEST_COVERAGE)).toContain("非实时");
  });

  it("口径计数与来源列表一致：15 个登记来源、11 个近期检查正常、2 个核验不可用", () => {
    expect(GUEST_COVERAGE.sources).toHaveLength(15);
    expect(GUEST_COVERAGE.caliber.registeredSources).toBe(15);
    expect(GUEST_COVERAGE.caliber.recentlyHealthySources).toBe(11);
    expect(GUEST_COVERAGE.caliber.blockedSources).toBe(2);
    const ready = GUEST_COVERAGE.sources.filter((s) => s.state === "recently_healthy");
    expect(ready).toHaveLength(11);
    // 每个 ready 来源都有来源级检查时间与判定依据
    for (const source of ready) {
      expect(source.lastCheckedAt).toBeTruthy();
      expect(source.note.length).toBeGreaterThan(0);
    }
    expect(coverageProvinceLine(GUEST_COVERAGE).length).toBeGreaterThan(0);
  });

  it("最近核对时间与同步日期一致，覆盖边界与窗口说明保留", () => {
    expect(GUEST_COVERAGE.lastCheckedAt.startsWith(GUEST_COVERAGE_LAST_UPDATED)).toBe(true);
    expect(GUEST_COVERAGE.scopeNote).toContain("暂未收录");
    expect(GUEST_COVERAGE.scopeNote).toContain("不代表当地没有招聘");
    expect(GUEST_COVERAGE.nextWindowNote).toContain("以官方公告为准");
  });

  it("逐省口径：浙/苏/皖均有近期正常来源；省级候选不计入监测城市；无锡 blocked 仍如实列出", () => {
    expect(GUEST_COVERAGE.version).toBe("coverage-projection-2.0.0");
    const views = buildProvinceScopeViews(GUEST_COVERAGE);
    expect(views.map((v) => v.label)).toEqual(["浙江省", "江苏省", "安徽省"]);

    const zhejiang = views.find((v) => v.code === "330000")!;
    expect(zhejiang.status).toBe("monitoring_no_open");
    // 市级 7 地；省级候选（330000）不计入
    expect(zhejiang.monitoredRegionCodes).not.toContain("330000");
    expect(zhejiang.monitoredRegionCodes).toContain("330109");
    expect(zhejiang.monitoredRegions.flatMap((r) => r.sources)).toHaveLength(8);
    expect(zhejiang.scopeNote).toContain("暂未收录");

    const jiangsu = views.find((v) => v.code === "320000")!;
    expect(jiangsu.monitoredRegionCodes).toEqual(["320100", "320200", "320400", "320500"]);
    const wuxi = jiangsu.monitoredRegions
      .flatMap((r) => r.sources)
      .find((s) => s.id === "wuxi-education-candidate");
    expect(wuxi?.state).toBe("blocked");
    expect(jiangsu.scopeNote).toContain("不代表当地没有招聘");
  });

  it("一句话摘要呈现实际监测城市，且不暗示全省或全国覆盖", () => {
    const line = coverageProvinceLine(GUEST_COVERAGE);
    expect(line).toContain("浙江：杭州");
    expect(line).toContain("安徽：蚌埠");
    expect(line).not.toContain("全省");
    expect(line).not.toContain("全国");
  });
});
