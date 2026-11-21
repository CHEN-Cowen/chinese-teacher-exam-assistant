"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, isNavActive } from "@/lib/ia/nav";
import { NavIcon } from "./navIcons";

/**
 * 移动端主导航（U09）：当年招聘 / 往年参考 / 我的关注 / 我的资料 四个入口。
 * - 固定高 56px + safe-area-inset-bottom；
 * - 文字 11/16px，图标 18/22px；
 * - 激活态用 颜色 + 字重 + aria-current 表达，不只靠颜色；
 * - 内容底部需预留底栏高度 + 16px，避免遮挡按钮。
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-surface/97 backdrop-blur md:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex h-14 items-stretch justify-around">
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
                  ? "text-brand"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              <NavIcon id={item.id} className="h-[18px] w-[18px]" />
              <span
                className={cn(
                  "text-[11px] leading-4",
                  active ? "font-semibold" : "font-medium"
                )}
              >
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
