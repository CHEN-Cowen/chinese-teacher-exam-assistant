"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RequireRole } from "@/components/auth/RequireAuth";
import { useCurrentUser } from "@/lib/auth";
import { STAFF_ROLES, USER_ROLE_LABELS } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/demo/config";
import { DEMO_BANNER_SPACER_CLASS } from "@/components/demo/DemoBanner";

const ADMIN_NAV = [
  { href: "/admin", label: "后台概览", exact: true },
  { href: "/admin/pipeline", label: "公告流水线", exact: false },
  { href: "/admin/sources", label: "来源管理", exact: false },
  { href: "/admin/exams", label: "考情管理", exact: false },
  { href: "/admin/reviews", label: "审核队列", exact: false },
  { href: "/admin/corrections", label: "机会纠错", exact: false },
  { href: "/admin/feedback", label: "纠错与治理", exact: false },
  { href: "/admin/resources", label: "资源管理", exact: false },
  { href: "/admin/trial", label: "受邀试用看板", exact: false },
];

function AdminChrome({ children }: { children: React.ReactNode }) {
  const { user, role, logout } = useCurrentUser();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-canvas">
      {/* 后台顶栏 */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">🛡️</span>
            <div>
              <p className="text-sm font-semibold leading-4">运营审核后台</p>
              <p className="text-[11px] text-slate-400">教招有据</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm leading-4">{user?.name}</p>
              {role && (
                <Badge variant="info" className="mt-0.5">
                  {USER_ROLE_LABELS[role]}
                </Badge>
              )}
            </div>
            <Link
              href="/opportunities"
              className="text-xs text-slate-300 hover:text-white transition-colors"
            >
              返回用户端
            </Link>
            <button
              onClick={logout}
              className="text-xs text-slate-300 hover:text-white transition-colors"
            >
              退出登录
            </button>
          </div>
        </div>
        {/* 后台子导航 */}
        <nav className="bg-slate-800">
          <div className="max-w-6xl mx-auto px-4 flex gap-1">
            {ADMIN_NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-4 py-2.5 text-sm transition-colors border-b-2",
                    active
                      ? "text-white border-white font-medium"
                      : "text-slate-400 border-transparent hover:text-slate-200"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

/**
 * 公开演示环境：管理后台整体关闭。
 * 客户端角色守卫不构成安全边界，因此演示模式下无论是否登录、用什么账号，
 * /admin 及其全部子路由都只显示关闭说明，不渲染任何管理功能。
 */
function AdminClosedNotice() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className={DEMO_BANNER_SPACER_CLASS} />
      <div className="max-w-md mx-auto px-4 pt-20 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🔒</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          管理后台未在公开演示环境开放
        </h1>
        <p className="text-sm text-slate-500 leading-6 mb-6">
          审核通过、驳回、考情修改、资源停用、结论撤回等管理操作需要服务端认证与权限控制，
          当前演示版本不提供这些能力。
        </p>
        <Link
          href="/opportunities"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong transition-colors"
        >
          返回用户端演示
        </Link>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (isDemoMode) {
    return <AdminClosedNotice />;
  }

  return (
    <RequireRole roles={STAFF_ROLES}>
      <AdminChrome>{children}</AdminChrome>
    </RequireRole>
  );
}
