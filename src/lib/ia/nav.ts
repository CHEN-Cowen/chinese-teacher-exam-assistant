/**
 * v7.0 用户端主导航（机会 / 日程 / 我的）。
 *
 * 不变量（PRD.md 用户流程与页面职责）：
 * - 主导航永远只有三个入口：机会 / 日程 / 我的；
 * - 个人画像、地区偏好、用工偏好、通知、隐私、纠错记录统一收入「我的」；
 * - 不设置独立「备考」主导航：备考能力仅在用户设置主要目标后，
 *   从目标上下文与「我的」次级入口进入；旧 /study 路由与数据保留；
 * - 高亮以新路由为准；旧路由 /exam /today /plan 经 src/proxy.ts 跳转，不参与高亮。
 */

export type PrimaryNavId = "opportunities" | "schedule" | "me";

export interface PrimaryNavItem {
  id: PrimaryNavId;
  href: "/" | `/${string}`;
  label: string;
}

export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { id: "opportunities", href: "/opportunities", label: "机会" },
  { id: "schedule", href: "/schedule", label: "日程" },
  { id: "me", href: "/me", label: "我的" },
] as const;

/**
 * 路径命中判定：精确匹配或位于该导航分区之下。
 * 使用 `href + "/"` 前缀，避免 `/opportunities-x` 误命中 `/opportunities`。
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/** 当前命中的主导航项；未命中返回 null（设置、资料、备考等二级页面无高亮） */
export function activeNavId(pathname: string): PrimaryNavId | null {
  const hit = PRIMARY_NAV.find((item) => isNavActive(pathname, item.href));
  return hit ? hit.id : null;
}

/**
 * v5.2 → v6.1 旧路由跳转表。
 * 注意：src/proxy.ts 与渲染代码分离部署、不建议依赖共享模块，此表只用于测试与
 * 页面内提示；修改时必须同步 src/proxy.ts 中的同名字典。
 */
export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  "/exam": "/opportunities",
  "/today": "/study",
  "/plan": "/study",
};
