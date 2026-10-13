"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { DesktopNav } from "./DesktopNav";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { DemoBanner, DEMO_BANNER_SPACER_CLASS } from "@/components/demo/DemoBanner";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // 登录页：完全独立，无导航、无守卫
  if (pathname === "/login") {
    return (
      <>
        <DemoBanner />
        <div className={DEMO_BANNER_SPACER_CLASS} />
        {children}
      </>
    );
  }

  // 运营后台：不使用用户端导航，守卫与后台框架由 /admin 布局负责
  if (pathname.startsWith("/admin")) {
    return (
      <>
        <DemoBanner />
        {children}
      </>
    );
  }

  // 价值首页 / 30 秒说明 / 快速问答 / 首次结果页 / 访客定向补充页：无导航外壳，
  // 未登录也可访问（v5.1 先体验后登录；v7.2 访客补充流程绝不进入登录或 onboarding）
  if (
    pathname === "/" ||
    pathname === "/learn" ||
    pathname === "/onboarding" ||
    pathname === "/preview" ||
    pathname.startsWith("/preview/")
  ) {
    return (
      <div className="min-h-screen bg-canvas">
        <DemoBanner />
        <div className={DEMO_BANNER_SPACER_CLASS} />
        {children}
      </div>
    );
  }

  // 用户端常规页面
  return (
    <div className="min-h-screen bg-canvas">
      <DemoBanner />
      <div className={DEMO_BANNER_SPACER_CLASS} />
      <DesktopNav />
      <Header />
      <main className="pb-16 md:pb-0">
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6">
          <RequireAuth>{children}</RequireAuth>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
