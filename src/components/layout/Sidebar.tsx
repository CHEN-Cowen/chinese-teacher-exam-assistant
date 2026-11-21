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
// 侧栏下半为日程、材料、备考、设置等次级入口。
// 桌面侧栏宽 190px，内边距左右 14px、上下 24px；主导航项 48px 高。

const SECONDARY_NAV = [
  { id: "schedule", href: "/schedule", label: "日程" },
  { id: "materials", href: "/materials", label: "材料清单" },
  { id: "study", href: "/study", label: "辅助备考" },
  { id: "settings", href: "/settings", label: "账号设置" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, role, hasRole, logout, status } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const ready = status === "authenticated";

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden w-[190px] flex-col border-r border-line bg-surface md:flex",
        isDemoMode && "top-8 h-[calc(100%-2rem)]"
      )}
    >
      {/* 品牌 Logo */}
      <div className="flex h-16 items-center px-3.5">
        <Link href="/opportunities" aria-label="教招有据首页">
          <BrandMark size="sm" />
        </Link>
      </div>

      {/* 主导航 */}
      <nav aria-label="主导航" className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {PRIMARY_NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-soft font-semibold text-brand"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink"
              )}
            >
              <NavIcon id={item.id} className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.label}</span>
              {active && <span className="sr-only">（当前页面）</span>}
            </Link>
          );
        })}

        {ready && hasRole(STAFF_ROLES) && !isDemoMode && (
          <Link
            href="/admin"
            className={cn(
              "flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              pathname.startsWith("/admin")
                ? "bg-ink text-white"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink"
            )}
          >
            <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z" strokeLinejoin="round" />
            </svg>
            <span className="truncate">运营后台</span>
          </Link>
        )}

        {/* 分隔线 */}
        <hr className="my-3 border-line" />

        {/* 次级导航：日程、材料、备考、设置 */}
        {SECONDARY_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-soft font-semibold text-brand"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink"
              )}
            >
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 头像菜单 */}
      <div className="relative border-t border-line px-2.5 py-3" ref={menuRef}>
        {!ready ? (
          <div className="h-11 animate-pulse rounded-lg bg-surface-2" aria-hidden="true" />
        ) : (
          user && (
            <>
              {menuOpen && (
                <div className="absolute bottom-full left-2.5 right-2.5 z-50 mb-2 overflow-hidden rounded-lg border border-line bg-surface shadow-2">
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                    <p className="text-xs text-ink-muted">
                      {role ? USER_ROLE_LABELS[role] : ""}
                    </p>
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-surface-2"
                  >
                    设置
                  </Link>
                  <Link
                    href="/materials"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-surface-2"
                  >
                    学习资料
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
                  >
                    退出登录
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                    {(user.name || "我").slice(0, 1)}
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
