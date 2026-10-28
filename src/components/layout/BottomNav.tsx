"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, isNavActive } from "@/lib/ia/nav";
import { NavIcon } from "./navIcons";

/**
 * 移动端主导航（U09）：当年招聘 / 往年参考 / 我的关注 / 我的资料 四个入口。
 * - 激活态同时用 顶部指示条 + 字重 + 颜色 + aria-current 表达，不只靠颜色；
 * - 每个入口等宽、高 64px，满足移动端触控目标；
 * - 日程/备考为次级入口；设置/通知/资料/账号进入头像菜单或「我的资料」页面。
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="fixed bottom-0 left-0 right-0 z-50 bg-canvas/97 backdrop-blur md:hidden"
      style={{
        // 移动端安全区：避开 iPhone 底部 Home Indicator
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex h-16 items-stretch justify-around border-t border-line">
        {PRIMARY_NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors",
                active
                  ? "text-ink-2"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              <NavIcon id={item.id} className="h-6 w-6" />
              <span className={cn("text-[11px]", active ? "font-semibold" : "font-medium")}>
                {item.label}
              </span>
              {active && <span className="sr-only">（当前页面）</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
