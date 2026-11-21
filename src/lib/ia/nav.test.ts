import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAV,
  activeNavId,
  isNavActive,
  LEGACY_ROUTE_REDIRECTS,
} from "./nav";

describe("主导航 IA U09（当年招聘 / 往年参考 / 我的关注 / 我的资料）", () => {
  it("四个主入口且顺序固定（PRD U09：桌面与手机共用同一常量）", () => {
    expect(PRIMARY_NAV.map((item) => item.id)).toEqual([
      "opportunities",
      "history",
      "follows",
      "me",
    ]);
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual([
      "/opportunities",
      "/history",
      "/follows",
      "/me",
    ]);
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      "当年招聘",
      "往年参考",
      "我的关注",
      "我的资料",
    ]);
  });

  it("备考不设主导航入口（次级入口保留）", () => {
    expect(PRIMARY_NAV.some((item) => item.href === "/study")).toBe(false);
    // /study 仍是可访问的次级路由，但不产生主导航高亮
    expect(activeNavId("/study")).toBeNull();
    expect(activeNavId("/study/materials")).toBeNull();
  });

  it("日程降为次级入口（/schedule /applications 保留可达，无主导航高亮）", () => {
    expect(PRIMARY_NAV.some((item) => item.href === "/schedule")).toBe(false);
    expect(activeNavId("/schedule")).toBeNull();
    expect(activeNavId("/applications")).toBeNull();
  });

  it("精确路径与子路由正确高亮", () => {
    expect(isNavActive("/opportunities", "/opportunities")).toBe(true);
    expect(isNavActive("/opportunities/unit-hangzhou-01", "/opportunities")).toBe(true);
    expect(isNavActive("/history", "/history")).toBe(true);
    expect(isNavActive("/history/unit-hangzhou-01", "/history")).toBe(true);
    expect(isNavActive("/follows", "/follows")).toBe(true);
    expect(isNavActive("/me", "/me")).toBe(true);
  });

  it("相似前缀路径不产生误高亮", () => {
    expect(isNavActive("/opportunities-x", "/opportunities")).toBe(false);
    expect(isNavActive("/history-x", "/history")).toBe(false);
    expect(isNavActive("/memo", "/me")).toBe(false);
    expect(isNavActive("/settings", "/me")).toBe(false);
  });

  it("二级页面（设置/资料/备考/日程）没有主导航高亮", () => {
    expect(activeNavId("/settings")).toBeNull();
    expect(activeNavId("/materials")).toBeNull();
  });

  it("旧路由跳转表覆盖 /exam /today /plan 且落到语义最接近的新页面", () => {
    expect(LEGACY_ROUTE_REDIRECTS["/exam"]).toBe("/opportunities");
    expect(LEGACY_ROUTE_REDIRECTS["/today"]).toBe("/study");
    expect(LEGACY_ROUTE_REDIRECTS["/plan"]).toBe("/study");
  });
});
