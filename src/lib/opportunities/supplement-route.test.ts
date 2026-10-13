/**
 * v7.2 定向补充路由工具测试（PRD 7.4.4 / 7.8）。
 *
 * 覆盖：
 * - 路由生成（真实 + 演示）
 * - 参数验证（合法值通过）
 * - 安全回退（非法 origin/bucket 回退到默认值）
 * - 缺失参数回退
 * - URL 编码
 */
import { describe, expect, it } from "vitest";
import {
  buildPreviewSupplementRoute,
  buildSupplementRoute,
  DEFAULT_SUPPLEMENT_BUCKET,
  DEFAULT_SUPPLEMENT_ORIGIN,
  isSupplementBucket,
  isSupplementOrigin,
  parseSupplementParams,
  SUPPLEMENT_BUCKET_VALUES,
  SUPPLEMENT_ORIGIN_VALUES,
} from "./supplement-route";

describe("supplement-route：路由生成", () => {
  it("真实岗位路由格式正确，包含 origin 和 bucket", () => {
    const route = buildSupplementRoute("unit-123", "preview", "need_more_info");
    expect(route).toBe(
      "/opportunities/unit-123/supplement?origin=preview&bucket=need_more_info",
    );
  });

  it("演示岗位路由使用 /preview/supplement/[unitId]", () => {
    const route = buildPreviewSupplementRoute("demo-1", "preview", "need_more_info");
    expect(route).toBe(
      "/preview/supplement/demo-1?origin=preview&bucket=need_more_info",
    );
  });

  it("省略 origin 和 bucket 时使用默认值", () => {
    const route = buildSupplementRoute("unit-1");
    expect(route).toContain(`origin=${DEFAULT_SUPPLEMENT_ORIGIN}`);
    expect(route).toContain(`bucket=${DEFAULT_SUPPLEMENT_BUCKET}`);
  });

  it("unitId 含特殊字符时 URL 编码", () => {
    const route = buildSupplementRoute("unit/with space");
    expect(route).toContain("unit%2Fwith%20space");
  });
});

describe("supplement-route：参数验证", () => {
  it("合法 origin 全部通过", () => {
    for (const origin of SUPPLEMENT_ORIGIN_VALUES) {
      expect(isSupplementOrigin(origin)).toBe(true);
    }
  });

  it("合法 bucket 全部通过", () => {
    for (const bucket of SUPPLEMENT_BUCKET_VALUES) {
      expect(isSupplementBucket(bucket)).toBe(true);
    }
  });

  it("非法 origin 不通过", () => {
    expect(isSupplementOrigin("onboarding")).toBe(false);
    expect(isSupplementOrigin("login")).toBe(false);
    expect(isSupplementOrigin("")).toBe(false);
    expect(isSupplementOrigin(null)).toBe(false);
    expect(isSupplementOrigin(undefined)).toBe(false);
  });

  it("非法 bucket 不通过", () => {
    expect(isSupplementBucket("not_eligible")).toBe(false);
    expect(isSupplementBucket("preliminary_eligible")).toBe(false);
    expect(isSupplementBucket("")).toBe(false);
    expect(isSupplementBucket(null)).toBe(false);
  });
});

describe("supplement-route：安全回退", () => {
  it("合法参数原样返回，valid=true", () => {
    const params = new URLSearchParams({
      origin: "detail",
      bucket: "manual_review",
    });
    const result = parseSupplementParams(params);
    expect(result.origin).toBe("detail");
    expect(result.bucket).toBe("manual_review");
    expect(result.valid).toBe(true);
  });

  it("非法 origin 回退到默认值，valid=false", () => {
    const params = new URLSearchParams({
      origin: "onboarding",
      bucket: "need_more_info",
    });
    const result = parseSupplementParams(params);
    expect(result.origin).toBe(DEFAULT_SUPPLEMENT_ORIGIN);
    expect(result.bucket).toBe("need_more_info");
    expect(result.valid).toBe(false);
  });

  it("非法 bucket 回退到默认值，valid=false", () => {
    const params = new URLSearchParams({
      origin: "preview",
      bucket: "not_eligible",
    });
    const result = parseSupplementParams(params);
    expect(result.origin).toBe("preview");
    expect(result.bucket).toBe(DEFAULT_SUPPLEMENT_BUCKET);
    expect(result.valid).toBe(false);
  });

  it("缺失参数全部回退到默认值，valid=false", () => {
    const params = new URLSearchParams();
    const result = parseSupplementParams(params);
    expect(result.origin).toBe(DEFAULT_SUPPLEMENT_ORIGIN);
    expect(result.bucket).toBe(DEFAULT_SUPPLEMENT_BUCKET);
    expect(result.valid).toBe(false);
  });

  it("undefined 入参安全回退", () => {
    const result = parseSupplementParams(undefined);
    expect(result.origin).toBe(DEFAULT_SUPPLEMENT_ORIGIN);
    expect(result.bucket).toBe(DEFAULT_SUPPLEMENT_BUCKET);
    expect(result.valid).toBe(false);
  });

  it("Record<string,string> 入参也能解析", () => {
    const result = parseSupplementParams({
      origin: "opportunities",
      bucket: "need_more_info",
    });
    expect(result.origin).toBe("opportunities");
    expect(result.bucket).toBe("need_more_info");
    expect(result.valid).toBe(true);
  });
});
