import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 旧路由兼容跳转（v5.2 → v6.1，以及 2026-11 导航合并产生的旧路由）。
 *
 * Next.js 16 起 middleware 文件约定改名为 proxy（功能不变、默认 Node.js runtime）。
 * 本 proxy 是旧链接（收藏夹、旧通知、外部文档）仍能到达新页面的唯一保障，
 * 不可随页面一起删除。/history/[unitId] 等详情页不在 matcher 内，仍可直接访问。
 *
 * 注意：proxy 仍不建议依赖共享模块或全局状态（与渲染代码分离部署）；
 * 此映射需与 src/lib/ia/nav.ts 的 LEGACY_ROUTE_REDIRECTS 保持一致
 * （proxy.test.ts 锁定）。
 */
const LEGACY_REDIRECTS: Record<string, { pathname: string; tab?: string }> = {
  "/exam": { pathname: "/opportunities" },
  "/today": { pathname: "/study" },
  "/plan": { pathname: "/study" },
  "/history": { pathname: "/opportunities", tab: "history" },
  "/follows": { pathname: "/applications", tab: "follows" },
  "/schedule": { pathname: "/applications", tab: "schedule" },
  "/materials": { pathname: "/study", tab: "materials" },
};

export function proxy(request: NextRequest) {
  const target = LEGACY_REDIRECTS[request.nextUrl.pathname];
  if (!target) return NextResponse.next();

  // clone 保留查询参数（如 ?target=xxx），落到语义最接近的新页面页内标签
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  if (target.tab && !url.searchParams.has("tab")) {
    url.searchParams.set("tab", target.tab);
  }
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/exam", "/today", "/plan", "/history", "/follows", "/schedule", "/materials"],
};
