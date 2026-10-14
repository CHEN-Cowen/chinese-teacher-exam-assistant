/**
 * Feature Flag 体系单元测试（工作包 0）。
 *
 * 锁定的不变量：
 * 1. 六个开关全部登记；测试环境下默认关闭（保守默认 = v7.1 现状行为）；
 *    ff_db_catalog 在 production 构建默认开启（镜像后端目录开关，见专用用例）；
 * 2. 只有 "true" 视为开启，其他值（含 "1"、"TRUE"、空串）一律关闭；
 * 3. 定向补充回退目标永远是岗位详情页内联表单，绝不指向 /onboarding
 *    （PRD 8.4：定向补充回退到岗位详情内联表单，绝不能回到基础画像第 1 屏）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEATURE_FLAG_KEYS,
  FLAGS,
  isFeatureEnabled,
  resolveSupplementTarget,
} from "./index";

const ENV_NAMES = [
  "NEXT_PUBLIC_FF_NEW_HOME",
  "NEXT_PUBLIC_FF_NEW_RESULTS",
  "NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT",
  "NEXT_PUBLIC_FF_DB_CATALOG",
  "NEXT_PUBLIC_FF_ACTIVE_CRAWL",
  "NEXT_PUBLIC_FF_POST_SAVE_NEXT",
] as const;

function clearFlagEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}

describe("Feature Flag 登记与默认值", () => {
  beforeEach(clearFlagEnv);
  afterEach(clearFlagEnv);

  it("登记恰好六个开关，与追踪表第 5 节一一对应", () => {
    expect([...FEATURE_FLAG_KEYS].sort()).toEqual(
      [
        "ff_active_crawl",
        "ff_db_catalog",
        "ff_new_home",
        "ff_new_results",
        "ff_post_save_next",
        "ff_targeted_supplement",
      ].sort(),
    );
  });

  it("未设置环境变量时全部关闭（关闭 = v7.1 现状行为）", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(isFeatureEnabled(key)).toBe(false);
      expect(FLAGS[key]).toBe(false);
    }
  });

  it('只有 "true" 开启；"1"/"TRUE"/空串/任意文本一律关闭', async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_FF_NEW_HOME = "1";
    process.env.NEXT_PUBLIC_FF_NEW_RESULTS = "TRUE";
    process.env.NEXT_PUBLIC_FF_DB_CATALOG = "";
    process.env.NEXT_PUBLIC_FF_POST_SAVE_NEXT = "yes";
    process.env.NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT = "true";
    const mod = await import("./index");
    expect(mod.isFeatureEnabled("ff_new_home")).toBe(false);
    expect(mod.isFeatureEnabled("ff_new_results")).toBe(false);
    expect(mod.isFeatureEnabled("ff_db_catalog")).toBe(false);
    expect(mod.isFeatureEnabled("ff_post_save_next")).toBe(false);
    expect(mod.isFeatureEnabled("ff_targeted_supplement")).toBe(true);
  });
});

describe("ff_db_catalog 前后端语义一致（镜像 isDbCatalogEnabled）", () => {
  beforeEach(clearFlagEnv);
  afterEach(() => {
    clearFlagEnv();
    vi.unstubAllEnvs();
  });

  it("显式 false 优先于 production 默认（可关闭）", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_FF_DB_CATALOG = "false";
    expect(isFeatureEnabled("ff_db_catalog")).toBe(false);
  });

  it("production 构建未设置时默认开启（与后端发布语义一致）", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_FF_DB_CATALOG;
    expect(isFeatureEnabled("ff_db_catalog")).toBe(true);
  });

  it("dev/test 环境未设置时默认关闭", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_FF_DB_CATALOG;
    expect(isFeatureEnabled("ff_db_catalog")).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(isFeatureEnabled("ff_db_catalog")).toBe(false);
  });

  it('显式 "true" 在任何环境都开启', () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_FF_DB_CATALOG = "true";
    expect(isFeatureEnabled("ff_db_catalog")).toBe(true);
  });
});

describe("定向补充回退决策（resolveSupplementTarget）", () => {
  beforeEach(clearFlagEnv);
  afterEach(clearFlagEnv);

  it("开关关闭（默认）：回退到岗位详情页内联表单锚点", () => {
    const target = resolveSupplementTarget("unit-abc");
    expect(target).toEqual({ kind: "inline", unitId: "unit-abc", anchor: "supplement" });
  });

  it("开关开启：进入专用补充路由 /opportunities/[unitId]/supplement", () => {
    process.env.NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT = "true";
    const target = resolveSupplementTarget("unit-abc");
    expect(target).toEqual({
      kind: "route",
      href: "/opportunities/unit-abc/supplement",
    });
  });

  it("unitId 含特殊字符时路由正确转义", () => {
    process.env.NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT = "true";
    const target = resolveSupplementTarget("a/b c");
    expect(target.kind).toBe("route");
    if (target.kind === "route") {
      expect(target.href).toBe("/opportunities/a%2Fb%20c/supplement");
    }
  });

  it("不变量：任何开关组合下补充目标都不指向 /onboarding", () => {
    // 默认（全关）
    for (const key of FEATURE_FLAG_KEYS) {
      expect(isFeatureEnabled(key)).toBe(false);
    }
    let target = resolveSupplementTarget("unit-x");
    expect(JSON.stringify(target)).not.toContain("/onboarding");

    // 全开（除本开关外的开关不应影响补充回退目标）
    for (const name of ENV_NAMES) process.env[name] = "true";
    target = resolveSupplementTarget("unit-x");
    expect(JSON.stringify(target)).not.toContain("/onboarding");
    if (target.kind === "route") {
      expect(target.href).toMatch(/^\/opportunities\/.+\/supplement$/);
    }
  });
});
