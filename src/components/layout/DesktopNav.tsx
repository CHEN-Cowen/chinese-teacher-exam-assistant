"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationCenter } from "@/components/governance/NotificationCenter";
import { useCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/config";
import { PRIMARY_NAV, isNavActive } from "@/lib/ia/nav";
import { cn } from "@/lib/utils";
import { STAFF_ROLES, USER_ROLE_LABELS } from "@/types";
import { BrandMark } from "./BrandMark";

export function DesktopNav() {
  const pathname = usePathname();
  const { user, role, hasRole, logout, status } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ready = status === "authenticated";

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "sticky z-40 hidden border-b border-line bg-canvas/92 backdrop-blur md:block",
        isDemoMode ? "top-8" : "top-0",
      )}
    >
      <div className="mx-auto flex min-h-[68px] max-w-[1200px] items-center gap-4 px-6">
        <Link href="/opportunities" aria-label="教招有据首页" className="shrink-0">
          <BrandMark size="sm" />
        </Link>

        <nav aria-label="主导航" className="flex h-full items-center gap-1">
          {PRIMARY_NAV.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[44px] items-center rounded-sm px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft font-semibold text-ink-2"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {ready && hasRole(STAFF_ROLES) && !isDemoMode && (
            <Link href="/admin" className="px-4 text-sm font-medium text-ink-muted hover:text-ink">
              运营后台
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {ready && <NotificationCenter />}
          <div className="relative" ref={menuRef}>
            {ready && user ? (
              <>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink hover:bg-surface-2"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                    {(user.name || "我").slice(0, 1)}
                  </span>
                  <span className="max-w-24 truncate">{user.name}</span>
                  <svg aria-hidden="true" className="h-3.5 w-3.5 text-ink-muted" viewBox="0 0 20 20" fill="currentColor">
                    <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
                  </svg>
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-2">
                    <div className="border-b border-line px-3 py-2">
                      <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                      <p className="text-xs text-ink-muted">{role ? USER_ROLE_LABELS[role] : ""}</p>
                    </div>
                    <Link role="menuitem" href="/settings" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-sm text-ink hover:bg-surface-2">
                      设置
                    </Link>
                    <Link role="menuitem" href="/materials" onClick={() => setMenuOpen(false)} className="block px-3 py-2 text-sm text-ink hover:bg-surface-2">
                      学习资料
                    </Link>
                    <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); logout(); }} className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2">
                      退出登录
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="h-9 w-24 animate-pulse rounded-lg bg-canvas" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
