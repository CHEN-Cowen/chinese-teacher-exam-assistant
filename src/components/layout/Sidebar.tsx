"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { STAFF_ROLES, USER_ROLE_LABELS } from "@/types";
import { useCurrentUser } from "@/lib/auth";
import { NotificationCenter } from "@/components/governance/NotificationCenter";
import { isDemoMode } from "@/lib/demo/config";
import { PRIMARY_NAV, isNavActive } from "@/lib/ia/nav";
import { NavIcon } from "./navIcons";
import { BrandMark } from "./BrandMark";

// U09：主导航为 当年招聘 / 往年参考 / 我的关注 / 我的资料 四个入口；
// 日程、备考为次级入口（从「我的资料」页与目标上下文进入）；
// 设置、资料、通知、账号进入头像菜单或「我的资料」页面，不在主导航中。
//
// v6.1 模块 0A：移除常驻大型目标卡（核心方案 §3.7：桌面端移除宽侧栏中常驻的目标卡）；
// 用 BrandMark 替代 📝 Emoji Logo；侧栏收窄到 w-56，颜色切品牌墨蓝；
// 头像菜单与运营后台入口保留。

export function Sidebar() {
  const pathname = usePathname();
  const { user, role, hasRole, logout, status } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部时收起头像菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  // 会话恢复完成前只渲染与服务端一致的静态骨架，
  // 避免硬刷新时"服务端无会话 / 客户端 localStorage 有会话"造成水合不匹配
  const ready = status === "authenticated";

  return (
    <aside
      className={cn(
        "fixed inset-y-0 z-40 hidden w-56 flex-col border-r border-line bg-surface md:flex",
        // 演示模式：为顶部固定横幅让出空间
        isDemoMode && "top-8 h-[calc(100%-2rem)]"
      )}
    >
      {/* 品牌 Logo */}
      <div className="flex h-16 items-center border-b border-line px-5">
        <Link href="/opportunities" aria-label="教招有据首页">
          <BrandMark size="sm" />
        </Link>
      </div>

      {/* Navigation */}
      <nav aria-label="主导航" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {PRIMARY_NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-soft font-semibold text-brand"
                  : "text-ink-muted hover:bg-canvas hover:text-ink"
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand"
                />
              )}
              <NavIcon id={item.id} className="h-5 w-5" />
              {item.label}
              {active && <span className="sr-only">（当前页面）</span>}
            </Link>
          );
        })}

        {ready && hasRole(STAFF_ROLES) && !isDemoMode && (
          <Link
            href="/admin"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith("/admin")
                ? "bg-ink text-white"
                : "text-ink-muted hover:bg-canvas hover:text-ink"
            )}
          >
            <span aria-hidden="true">🛡️</span>
            运营后台
          </Link>
        )}
      </nav>

      {/* 头像菜单：设置、我的资料与退出登录；通知为上下文入口 */}
      <div className="relative border-t border-line px-3 py-3" ref={menuRef}>
        {!ready ? (
          <div className="h-[52px] animate-pulse rounded-lg bg-canvas" aria-hidden="true" />
        ) : (
          user && (
            <>
              {menuOpen && (
                <div className="absolute bottom-full left-3 right-3 z-50 mb-2 rounded-xl border border-line bg-surface py-1 shadow-lg">
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                    <p className="text-xs text-ink-muted">
                      {role ? USER_ROLE_LABELS[role] : ""}
                    </p>
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-canvas"
                  >
                    <span aria-hidden="true">⚙️</span> 设置
                  </Link>
                  <Link
                    href="/materials"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-canvas"
                  >
                    <span aria-hidden="true">📚</span> 学习资料
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-canvas"
                  >
                    <span aria-hidden="true">🚪</span> 退出登录
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-canvas"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <span className="text-base" aria-hidden="true">👤</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                  </div>
                  <svg
                    aria-hidden="true"
                    className={cn("h-4 w-4 text-ink-muted transition-transform", menuOpen && "rotate-180")}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <NotificationCenter />
              </div>
            </>
          )
        )}
      </div>
    </aside>
  );
}
