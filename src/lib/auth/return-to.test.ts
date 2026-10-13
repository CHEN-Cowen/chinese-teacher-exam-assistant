/**
 * 登录回程纯函数测试（v7.2 FR-1）。
 *
 * 锁定：保存触发的登录必须回到原岗位；next 只接受站内相对路径；
 * /onboarding 永不作为回程；/preview 归并到机会列表；非法输入有明确兜底。
 */
import { describe, expect, it } from "vitest";
import { resolvePostLoginPath, safeReturnPath } from "./return-to";

describe("safeReturnPath", () => {
  it("保留站内机会详情回程（含锚点/查询参数）", () => {
    expect(safeReturnPath("/opportunities/unit-suzhou-01")).toBe(
      "/opportunities/unit-suzhou-01",
    );
    expect(safeReturnPath("/opportunities/unit-suzhou-01?reason=save")).toBe(
      "/opportunities/unit-suzhou-01?reason=save",
    );
    expect(safeReturnPath("/opportunities/unit-suzhou-01#follow")).toBe(
      "/opportunities/unit-suzhou-01#follow",
    );
    expect(safeReturnPath("/schedule")).toBe("/schedule");
  });

  it("拒绝外域绝对 URL 与协议相对 URL", () => {
    expect(safeReturnPath("https://evil.com/phishing")).toBeNull();
    expect(safeReturnPath("//evil.com/path")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("\\evil.com")).toBeNull();
  });

  it("空值返回 null", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });

  it("绝不把 /onboarding 作为回程目标（保存/咨询不进基础画像）", () => {
    expect(safeReturnPath("/onboarding")).toBeNull();
    expect(safeReturnPath("/onboarding?from=opportunity")).toBeNull();
    // 其他 onboarding 子路径同样不放行，避免前缀绕过
    expect(safeReturnPath("/onboarding/wizard")).toBeNull();
  });
});

describe("resolvePostLoginPath", () => {
  it("保存回程原样回到对应岗位", () => {
    expect(resolvePostLoginPath("/opportunities/unit-hangzhou-01")).toBe(
      "/opportunities/unit-hangzhou-01",
    );
  });

  it("缺省/非法 next 回机会列表，而不是 onboarding", () => {
    expect(resolvePostLoginPath(null)).toBe("/opportunities");
    expect(resolvePostLoginPath("https://evil.com")).toBe("/opportunities");
    expect(resolvePostLoginPath("/onboarding")).toBe("/opportunities");
  });

  it("/preview 旧试用入口归并到 /opportunities", () => {
    expect(resolvePostLoginPath("/preview")).toBe("/opportunities");
  });
});
