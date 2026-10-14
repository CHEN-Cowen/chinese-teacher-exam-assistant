/**
 * v7.2 Feature Flag 体系（工作包 0）。
 *
 * 目的：为后续工作包提供小范围开关与回退能力（PRD 8.3 发布策略 / 8.4 回退策略）。
 * 设计约束：
 * - 除 ff_db_catalog（镜像后端：production 默认开）外全部默认关闭，
 *   关闭时严格保持 v7.1 现状行为；
 * - 只使用 NEXT_PUBLIC_* 环境变量（构建期内联到浏览器产物），严禁放密钥；
 * - 客户端修改开关后需要重新构建才生效，这是已知限制（见追踪表 R-WP0-02 风险）；
 * - 本模块只做「读开关 + 路由决策」，不包含任何业务逻辑；
 *   各工作包在自己的页面/服务里消费这些开关，不在这里堆业务分支。
 *
 * 开关清单与追踪表（docs/v7.2-implementation-tracking.md）第 5 节一一对应，
 * 新增开关必须同步更新追踪表，否则视为未登记开关。
 */

/** 开关的稳定标识（代码内引用，不随文案变化） */
export const FEATURE_FLAG_KEYS = [
  "ff_new_home",
  "ff_new_results",
  "ff_targeted_supplement",
  "ff_db_catalog",
  "ff_active_crawl",
  "ff_post_save_next",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/**
 * 读取单个开关。未设置或值不是 "true" 时一律关闭（保守默认）。
 *
 * 实现注意：必须使用字面量属性访问 `process.env.NEXT_PUBLIC_FF_*`，
 * 因为 Next.js 构建期只内联字面量环境变量访问；动态键访问
 * （如 process.env[someVar]）在浏览器产物中永远是 undefined。
 * switch 的每个分支都是字面量访问，构建期会被正确替换；
 * vitest 不做内联，测试中可在运行时改 process.env 后重新调用。
 */
export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  switch (key) {
    case "ff_new_home":
      return process.env.NEXT_PUBLIC_FF_NEW_HOME === "true";
    case "ff_new_results":
      return process.env.NEXT_PUBLIC_FF_NEW_RESULTS === "true";
    case "ff_targeted_supplement":
      return process.env.NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT === "true";
    case "ff_db_catalog": {
      // 语义镜像后端 backend/src/catalog/feature-flag.ts（isDbCatalogEnabled）：
      // 显式 on/off 优先；未设置时 production 默认开启（Next.js 构建期把
      // process.env.NODE_ENV 内联为 "production"，与后端发布语义一致）；
      // dev/test 默认关闭。当前前端尚无消费者，仅保证前后端语义一致。
      const value = process.env.NEXT_PUBLIC_FF_DB_CATALOG;
      if (value === "true") return true;
      if (value === "false") return false;
      return process.env.NODE_ENV === "production";
    }
    case "ff_active_crawl":
      return process.env.NEXT_PUBLIC_FF_ACTIVE_CRAWL === "true";
    case "ff_post_save_next":
      return process.env.NEXT_PUBLIC_FF_POST_SAVE_NEXT === "true";
  }
}

/** 全部开关的构建期快照（页面/组件直接消费这个对象） */
export const FLAGS: Readonly<Record<FeatureFlagKey, boolean>> = Object.freeze({
  ff_new_home: isFeatureEnabled("ff_new_home"),
  ff_new_results: isFeatureEnabled("ff_new_results"),
  ff_targeted_supplement: isFeatureEnabled("ff_targeted_supplement"),
  ff_db_catalog: isFeatureEnabled("ff_db_catalog"),
  ff_active_crawl: isFeatureEnabled("ff_active_crawl"),
  ff_post_save_next: isFeatureEnabled("ff_post_save_next"),
});

/**
 * 定向补充入口决策（PRD 7.4.4 + 8.4 回退策略的代码表达）。
 *
 * - 开关开：进入专用路由 /opportunities/[unitId]/supplement（WP2 建设）；
 * - 开关关（回退）：回到岗位详情页内联补充表单（#supplement 锚点）；
 * - 回退目标**绝不是** /onboarding 第一屏——这是 v7.2 明确禁止的行为，
 *   单元测试锁定此不变量，任何改动让结果指向 /onboarding 都应让测试失败。
 */
export type SupplementTarget =
  | { kind: "route"; href: string }
  | { kind: "inline"; unitId: string; anchor: "supplement" };

export function resolveSupplementTarget(unitId: string): SupplementTarget {
  if (isFeatureEnabled("ff_targeted_supplement")) {
    return {
      kind: "route",
      href: `/opportunities/${encodeURIComponent(unitId)}/supplement`,
    };
  }
  return { kind: "inline", unitId, anchor: "supplement" };
}
