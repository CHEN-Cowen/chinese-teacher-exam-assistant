"use client";

import { usePathname } from "next/navigation";
import { EDUCATION_LEVEL_LABELS } from "@/types";
import { useCurrentExamTarget } from "@/lib/targets/useCurrentExamTarget";
import { NotificationCenter } from "@/components/governance/NotificationCenter";
import { useCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/config";
import { activeNavId, PRIMARY_NAV } from "@/lib/ia/nav";

const PAGE_TITLES: Record<string, string> = {
  "/onboarding": "快速问答",
  "/materials": "我的资料",
  "/settings": "设置",
  "/study": "我的备考",
  "/history": "往年参考",
  "/follows": "我的关注",
};

/** 有返回按钮的二级页面；主导航三页是顶层页，不显示返回 */
const BACK_BUTTON_PATHS = new Set(["/onboarding", "/settings", "/materials", "/study", "/history", "/follows"]);

export function Header() {
  const pathname = usePathname();
  const { status } = useCurrentUser();
  const currentExam = useCurrentExamTarget();

  // 标题优先取主导航分区名（/opportunities/[id] 等子路由同样显示“机会”），
  // 再取二级页面静态标题。
  const navId = activeNavId(pathname);
  const navLabel = PRIMARY_NAV.find((item) => item.id === navId)?.label;
  const title = navLabel ?? PAGE_TITLES[pathname] ?? "教招有据";
  const showBack = BACK_BUTTON_PATHS.has(pathname);

  // 会话恢复完成前不渲染依赖存储的摘要与通知，保证与服务端渲染一致
  const ready = status === "authenticated";

  const summary = currentExam
    ? [
        currentExam.region || "地区待确认",
        currentExam.educationLevel
          ? EDUCATION_LEVEL_LABELS[currentExam.educationLevel]
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <header
      className={`sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur md:hidden ${
        // 演示模式：移动端为两行高的横幅让出空间
        isDemoMode ? "top-11" : "top-0"
      }`}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-3">
          {showBack && (
            <button
              type="button"
              onClick={() => window.history.back()}
              aria-label="返回上一页"
              className="-ml-1 p-1 text-ink-muted hover:text-ink"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ready && summary && (
            <span className="max-w-[140px] truncate text-xs text-ink-muted">{summary}</span>
          )}
          {ready && <NotificationCenter />}
        </div>
      </div>
    </header>
  );
}
