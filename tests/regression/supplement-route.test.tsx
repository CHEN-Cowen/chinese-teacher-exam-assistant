/**
 * v7.2 工作包 0：链路①（首页→两屏填写→结果工作台）与
 * 链路②（结果→定向补充→重算→返回正确分类）的前端回归保护。
 *
 * 与后端 v72-chain-regression.spec.ts 同一原则：
 * - 「现状固化」锁定当前真实行为，后续工作包改动导致行为变化时必须先更新本文件；
 * - v7.2 WP2 已落地：补充信息走定向补充路由，绝不回 /onboarding。
 *
 * 页面级行为细节由各自单测覆盖（src/app/page.test.ts、
 * src/app/onboarding/page.test.tsx、src/lib/guest/previewEngine.test.ts），
 * 本文件只固化链路级结构与路由不变量，不重复页面测试。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SRC_APP = path.resolve(__dirname, "../../src/app");

describe("链路①：首页 → 两屏填写 → 结果工作台", () => {
  it("现状固化：链路页面文件齐备（防误删导致链路静默断裂）", () => {
    for (const rel of [
      "page.tsx", // 首页
      "onboarding/page.tsx", // 两屏填写
      "preview/page.tsx", // 访客结果
      "opportunities/page.tsx", // 登录结果工作台
      "schedule/page.tsx", // 日程
    ]) {
      expect(existsSync(path.join(SRC_APP, rel)), `${rel} 不存在`).toBe(true);
    }
  });

  it("现状固化：onboarding 保持两屏结构（v7.2 两屏填写在其上演进）", () => {
    // TOTAL_PROFILE_STEPS 的唯一定义在 guestSession.ts，onboarding 页面引用它
    const sessionSource = readFileSync(
      path.resolve(__dirname, "../../src/lib/guest/guestSession.ts"),
      "utf8",
    );
    expect(sessionSource).toMatch(/TOTAL_PROFILE_STEPS\s*=\s*2/);
    const pageSource = readFileSync(path.join(SRC_APP, "onboarding/page.tsx"), "utf8");
    expect(pageSource).toContain("TOTAL_PROFILE_STEPS");
  });

  it("现状固化：访客预览对画像不完整的访客回退到 /onboarding（首次填写唯一入口）", () => {
    const source = readFileSync(path.join(SRC_APP, "preview/page.tsx"), "utf8");
    expect(source).toContain('router.replace("/onboarding")');
  });
});

describe("链路②：结果工作台 → 定向补充（v7.2 已修复 P0 Bug）", () => {
  it("v7.2 修复：/preview 补充入口不再跳回 /onboarding?from=preview（handleCardNextStep）", () => {
    const source = readFileSync(path.join(SRC_APP, "preview/page.tsx"), "utf8");
    // handleCardNextStep 中的 case 不再包含 onboarding（改为 supplement）
    expect(source).toContain('case "supplement"');
    expect(source).not.toContain('case "onboarding"');
    // 跳转到 /preview/supplement/[unitId]
    expect(source).toContain("/preview/supplement/");
    expect(source).toContain("origin=preview");
    expect(source).toContain("bucket=need_more_info");
  });

  it("v7.2 修复：/preview 的 /onboarding?from=preview 仅用于「修改全部信息」，不用于补充", () => {
    const source = readFileSync(path.join(SRC_APP, "preview/page.tsx"), "utf8");
    // 唯一的 /onboarding?from=preview 出现在 NotOpenSubject 组件（改学科），
    // 不出现在 handleCardNextStep 中（补充信息不再走 onboarding）
    const handlerPart = source.substring(
      source.indexOf("handleCardNextStep"),
      source.indexOf("archivedCount"),
    );
    expect(handlerPart).not.toContain("/onboarding?from=preview");
  });

  it("现状固化：岗位详情页的补充是页内锚点表单（supplementFactsService + scrollToId）", () => {
    const source = readFileSync(
      path.join(SRC_APP, "opportunities/[unitId]/page.tsx"),
      "utf8",
    );
    expect(source).toContain("supplementFactsService");
    expect(source).toContain('scrollToId("supplement")');
  });

  // v7.2 已落地：真实岗位定向补充有专用路由（PRD 7.4.4）
  it("v7.2 目标行为：存在 /opportunities/[unitId]/supplement 专用补充路由", () => {
    expect(
      existsSync(path.join(SRC_APP, "opportunities/[unitId]/supplement/page.tsx")),
    ).toBe(true);
  });

  // v7.2 已落地：demo 模式的无持久化演示补充（PRD 7.4.4）
  it("v7.2 目标行为：存在 /preview/supplement/[unitId] 演示补充路由", () => {
    expect(
      existsSync(path.join(SRC_APP, "preview/supplement/[unitId]/page.tsx")),
    ).toBe(true);
  });
});
