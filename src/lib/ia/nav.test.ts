import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAV,
  activeNavId,
  isNavActive,
  LEGACY_ROUTE_REDIRECTS,
} from "./nav";

describe("主导航 IA（2026-11：机会 / 我的报考 / 备考 / 我的）", () => {
  it("四个主入口且顺序固定（PRD U09：桌面与手机共用同一常量）", () => {
    expect(PRIMARY_NAV.map((item) => item.id)).toEqual([
      "opportunities",
      "applications",
      "study",
      "me",
    ]);
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual([
      "/opportunities",
      "/applications",
      "/study",
      "/me",
    ]);
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      "机会",
      "我的报考",
      "备考",
      "我的",
    ]);
  });

  it("当年招聘与往年参考合并为机会页内标签（/history 重定向）", () => {
    expect(PRIMARY_NAV.some((item) => item.href === "/history")).toBe(false);
    expect(LEGACY_ROUTE_REDIRECTS["/history"]).toBe("/opportunities?tab=history");
    // /history 兜底直达路径无高亮（正常流量经 proxy 落到 ?tab=history）
    expect(activeNavId("/history")).toBeNull();
    expect(activeNavId("/opportunities")).toBe("opportunities");
    expect(activeNavId("/opportunities/unit-hangzhou-01")).toBe("opportunities");
  });

  it("关注与日程并入我的报考页内标签（/follows /schedule 重定向）", () => {
    expect(PRIMARY_NAV.some((item) => item.href === "/follows")).toBe(false);
    expect(PRIMARY_NAV.some((item) => item.href === "/schedule")).toBe(false);
    expect(LEGACY_ROUTE_REDIRECTS["/follows"]).toBe("/applications?tab=follows");
    expect(LEGACY_ROUTE_REDIRECTS["/schedule"]).toBe("/applications?tab=schedule");
    expect(activeNavId("/follows")).toBeNull();
    expect(activeNavId("/schedule")).toBeNull();
    expect(activeNavId("/applications")).toBe("applications");
  });

  it("材料清单并入备考页内标签（/materials 重定向）", () => {
    expect(LEGACY_ROUTE_REDIRECTS["/materials"]).toBe("/study?tab=materials");
    expect(activeNavId("/materials")).toBeNull();
    expect(activeNavId("/study")).toBe("study");
  });

  it("精确路径与子路由正确高亮", () => {
    expect(isNavActive("/opportunities", "/opportunities")).toBe(true);
    expect(isNavActive("/opportunities/unit-hangzhou-01", "/opportunities")).toBe(true);
    expect(isNavActive("/me", "/me")).toBe(true);
    expect(isNavActive("/me/education", "/me")).toBe(true);
  });

  it("相似前缀路径不产生误高亮", () => {
    expect(isNavActive("/opportunities-x", "/opportunities")).toBe(false);
    expect(isNavActive("/history-x", "/opportunities")).toBe(false);
    expect(isNavActive("/memo", "/me")).toBe(false);
    expect(isNavActive("/settings", "/me")).toBe(false);
  });

  it("设置等二级页面没有主导航高亮", () => {
    expect(activeNavId("/settings")).toBeNull();
  });

  it("旧路由跳转表覆盖全部合并前路由", () => {
    expect(LEGACY_ROUTE_REDIRECTS["/exam"]).toBe("/opportunities");
    expect(LEGACY_ROUTE_REDIRECTS["/today"]).toBe("/study");
    expect(LEGACY_ROUTE_REDIRECTS["/plan"]).toBe("/study");
    expect(Object.keys(LEGACY_ROUTE_REDIRECTS).sort()).toEqual([
      "/exam",
      "/follows",
      "/history",
      "/materials",
      "/plan",
      "/schedule",
      "/today",
    ]);
  });
});
