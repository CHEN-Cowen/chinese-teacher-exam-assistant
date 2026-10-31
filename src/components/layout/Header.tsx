"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { EDUCATION_LEVEL_LABELS } from "@/types";
import { useCurrentExamTarget } from "@/lib/targets/useCurrentExamTarget";
import { NotificationCenter } from "@/components/governance/NotificationCenter";
import { useCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/config";
import { activeNavId, PRIMARY_NAV } from "@/lib/ia/nav";
import { BrandMark } from "./BrandMark";

const PAGE_TITLES: Record<string, string> = {
  "/onboarding": "快速问答",
  "/materials": "我的资料",
  "/settings": "设置",
  "/study": "我的备考",
  "/history": "往年参考",
  "/follows": "我的关注",
};

const BACK_BUTTON_PATHS = new Set(["/onboarding", "/settings", "/materials", "/study", "/history", "/follows"]);

export function Header() {
  const pathname = usePathname();
  const { status } = useCurrentUser();
  const currentExam = useCurrentExamTarget();

  const navId = activeNavId(pathname);
  const navLabel = PRIMARY_NAV.find((item) => item.id === navId)?.label;
  const title = navLabel ?? PAGE_TITLES[pathname] ?? "教招有据";
  const showBack = BACK_BUTTON_PATHS.has(pathname);

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
    <>
      {/* 桌面应用顶部栏 */}
      <header
        className={`sticky top-0 z-30 hidden border-b border-line bg-surface/95 backdrop-blur md:flex ${
          isDemoMode ? "top-8" : "top-0"
        }`}
      >
        <div className="flex h-16 min-h-16 w-full items-center justify-between gap-4 px-7">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-ink-muted">教师招聘机会与资格预筛</span>
          </div>
          <div className="flex items-center gap-3">
            {ready && summary && (
              <span className="max-w-[200px] truncate text-[13px] text-ink-muted">{summary}</span>
            )}
            {ready && <NotificationCenter />}
            {ready && (
              <Link
                href="/me"
                className="text-[13px] font-medium text-ink-muted hover:text-brand"
              >
                我的资料
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* 手机顶部栏 */}
      <header
        className={`sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur md:hidden ${
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
            {showBack ? (
              <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
            ) : (
              <BrandMark size="sm" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {ready && <NotificationCenter />}
          </div>
        </div>
      </header>
    </>
  );
}
