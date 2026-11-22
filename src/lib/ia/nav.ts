/**
 * 用户端主导航（2026-11 UI 大改版：四个主入口收敛）。
 *
 * 不变量（PRD.md U09 与 dev D09，随本改版同步更新）：
 * - 四个主入口固定为：机会 /opportunities、我的报考 /applications、
 *   备考 /study、我的 /me；桌面与手机顺序一致；
 * - 当年招聘与往年参考合并为「机会」页内标签（?tab=history）；
 *   我的关注与报考日程合并进「我的报考」页内标签（?tab=follows / ?tab=schedule）；
 *   材料清单合并进「备考」页内标签（?tab=materials）；
 * - 旧路由 /history /follows /schedule /materials 经 src/proxy.ts 跳转到对应
 *   页内标签，不参与高亮；更旧的 /exam /today /plan 依旧跳转；
 * - 运营后台不进主导航，仅 staff 角色在头像菜单可见。
 */

export type PrimaryNavId = "opportunities" | "applications" | "study" | "me";

export interface PrimaryNavItem {
  id: PrimaryNavId;
  href: "/" | `/${string}`;
  label: string;
}

export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { id: "opportunities", href: "/opportunities", label: "机会" },
  { id: "applications", href: "/applications", label: "我的报考" },
  { id: "study", href: "/study", label: "备考" },
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

/** 当前命中的主导航项；未命中返回 null（设置等二级页面无高亮） */
export function activeNavId(pathname: string): PrimaryNavId | null {
  const hit = PRIMARY_NAV.find((item) => isNavActive(pathname, item.href));
  return hit ? hit.id : null;
}

/**
 * 旧路由跳转表（v5.2/v6.1 → v6.1+，以及 2026-11 合并产生的旧路由）。
 * 注意：src/proxy.ts 与渲染代码分离部署、不建议依赖共享模块，此表只用于测试与
 * 页面内提示；修改时必须同步 src/proxy.ts 中的同名字典（proxy.test.ts 锁定）。
 */
export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  "/exam": "/opportunities",
  "/today": "/study",
  "/plan": "/study",
  "/history": "/opportunities?tab=history",
  "/follows": "/applications?tab=follows",
  "/schedule": "/applications?tab=schedule",
  "/materials": "/study?tab=materials",
};
