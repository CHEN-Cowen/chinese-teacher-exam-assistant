"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
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

  // 价值首页 / 产品说明 / 快速问答 / 首次结果页 / 访客定向补充页：无导航外壳，
  // 未登录也可访问
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

  // 用户端常规页面：桌面 190px 侧栏 + 主内容；手机底部主导航
  return (
    <div className="min-h-screen bg-canvas">
      <DemoBanner />
      <div className={DEMO_BANNER_SPACER_CLASS} />
      <Sidebar />
      <div className="md:pl-[190px]">
        <Header />
        <main className="pb-20 md:pb-8">
          <div className="mx-auto max-w-[1440px] px-5 py-6 md:px-7">
            <RequireAuth>{children}</RequireAuth>
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
