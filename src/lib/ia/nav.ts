/**
 * 用户端主导航（PRD 11.10 U09：四个主入口统一）。
 *
 * 不变量（PRD.md U09 与 dev D09）：
 * - 四个主入口固定为：当年招聘 /opportunities、往年参考 /history、
 *   我的关注 /follows、我的资料 /me；桌面与手机顺序一致；
 * - 日程（/schedule、/applications）、材料、备考（/study）、设置等保留为
 *   可达的次级入口（「我的资料」页与头像菜单），不进主导航、无主导航高亮；
 * - 高亮以新路由为准；旧路由 /exam /today /plan 经 src/proxy.ts 跳转，不参与高亮。
 */

export type PrimaryNavId = "opportunities" | "history" | "follows" | "me";

export interface PrimaryNavItem {
  id: PrimaryNavId;
  href: "/" | `/${string}`;
  label: string;
}

export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { id: "opportunities", href: "/opportunities", label: "当年招聘" },
  { id: "history", href: "/history", label: "往年参考" },
  { id: "follows", href: "/follows", label: "我的关注" },
  { id: "me", href: "/me", label: "我的资料" },
] as const;

/**
 * 路径命中判定：精确匹配或位于该导航分区之下。
 * 使用 `href + "/"` 前缀，避免 `/opportunities-x` 误命中 `/opportunities`。
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/** 当前命中的主导航项；未命中返回 null（设置、资料、备考、日程等二级页面无高亮） */
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
