"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandMark } from "@/components/layout/BrandMark";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { Disclosure } from "@/components/ui/Disclosure";
import { LoadingPage } from "@/components/ui/Loading";
import { useCurrentUser } from "@/lib/auth";
import { guestSessionService } from "@/lib/guest/guestSession";
import { GUEST_COVERAGE } from "@/lib/guest/coverage";
import { coverageProvinceLine } from "@/lib/opportunities/coverage-view";
import { track } from "@/lib/analytics/eventService";
import { FLAGS } from "@/lib/flags";
import type { CoverageDTO } from "@/lib/opportunities/api-types";

/** "YYYY-MM-DD..." → "YYYY年M月D日"；无法解析时原样返回 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 首页路由规则（v6.1 模块 0A 双入口混合式，V7 视觉语言重写，v7.1 M1 单一入口）：
 * - 已登录 → 默认进入「机会」/opportunities；
 * - 未登录且画像问答进行到一半 → 回到 /onboarding；
 * - 未登录且已看完初步结果 → /preview；
 * - 其余访客 → 价值首页（本页内容，无需登录）。
 *
 * v7.1 M1 信息层级（PRD §5.2）：
 * - 首屏只有一个高强调主按钮「开始资格预筛」；
 * - 次级文字入口「先看结果示例」锚向右侧结果示例卡，不新增路由；
 * - 右侧由重复按钮组改为结果示例卡（匹配状态/主要依据/待确认/官方来源/核对时间），
 *   明确标注「结果示例 · 非真实岗位」，帮助用户在填写前理解会得到什么结果；
 * - 顶部「登录」保持次级入口；备考仍为弱化文字入口，不与主操作争夺。
 */
export default function Home() {
  const router = useRouter();
  const { status } = useCurrentUser();
  const [coverage, setCoverage] = useState<CoverageDTO>(GUEST_COVERAGE);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AUTH_MODE !== "invited") return;
    let cancelled = false;
    fetch("/api/opportunities/coverage", { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<CoverageDTO>) : null))
      .then((next) => {
        if (next && !cancelled) setCoverage(next);
      })
      .catch(() => {
        // 首页仍可使用本地镜像，避免覆盖接口暂时不可用时阻断访客。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "loading") return;

    if (status === "authenticated") {
      router.replace("/opportunities");
      return;
    }

    if (guestSessionService.isInProgress()) {
      router.replace("/onboarding");
      return;
    }
    if (guestSessionService.isComplete()) {
      router.replace("/preview");
    }
  }, [status, router]);

  if (status === "loading") return <LoadingPage />;

  const regionText = coverageProvinceLine(coverage);
  const sourceCount = coverage.regions.reduce(
    (sum, region) => sum + region.sources.length,
    0,
  );

  const handleStart = () => {
    track("home_start_match_clicked", "home");
    router.push("/onboarding");
  };

  /**
   * v7.2 结果先行首页（ff_new_home 开启时渲染）。
   *
   * PRD 7.4.1 / 7.2 + UIUX方案 §5：
   * - 主标题「哪些教师岗位，你现在就能报？」
   * - 唯一高强调按钮「开始匹配岗位」→ /onboarding
   * - 右侧只展示结果形状（三类标签 + 一个简化岗位 + 少量状态），不展开完整公告
   * - 示例只做一次页面级标识（aside aria-label + "结果预览 · 示例"）
   * - 桌面 5:7 左右布局，内容容器 max-w-1280px 居中
   * - 移动端顺序：价值 → CTA → 说明 → 简化预览 → 信任短句
   * - 不引入远程字体/图标，复用 globals.css 和 ui/ 组件
   */
  if (FLAGS.ff_new_home) {
    const trustChips = ["真实公告", "逐条可核对", "不确定就明确提示"];

    return (
      <div className="min-h-screen bg-canvas">
        <header className="mx-auto flex h-18 w-full max-w-[1280px] items-center justify-between px-5 md:h-20 md:px-8">
          <BrandMark size="md" />
          <LinkButton href="/login" variant="ghost" size="sm" className="text-ink-muted">
            登录
          </LinkButton>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-5 pb-12 md:px-8 md:pb-16">
          <section
            aria-label="产品价值与结果预览"
            className="grid gap-8 py-4 md:gap-12 md:py-8 lg:grid-cols-12"
          >
            {/* 左：价值 + 主行动（桌面约 5 栏） */}
            <div className="lg:col-span-5">
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-strong">
                30 秒完成资格预筛
              </p>
              <h1
                className="mt-3.5 text-[36px] font-bold leading-[44px] tracking-[-0.02em] md:text-[48px] md:leading-[58px]"
                data-testid="home-primary-title"
              >
                哪些教师岗，<br />你能报？
              </h1>
              <p className="mt-4 max-w-[30em] text-[15px] leading-6 text-ink-muted md:text-[17px]">
                按条件预筛，查看官方依据。
              </p>

              <div className="mt-6 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  onClick={handleStart}
                  data-testid="start-onboarding"
                  className="w-full bg-brand text-on-dark hover:bg-brand-strong sm:w-auto sm:min-w-44"
                  iconEnd={
                    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 10h12m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  }
                >
                  开始匹配岗位
                </Button>
                <span className="text-[13px] text-ink-muted" data-testid="home-time-hint">
                  无需登录 · 约 30 秒
                </span>
              </div>
            </div>

            {/* 右：结果预览（桌面约 7 栏）——只展示结果形状，不展开完整公告 */}
            <aside
              className="lg:col-span-7"
              aria-label="结果预览，示例非真实岗位"
              data-testid="result-preview"
            >
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-2 md:p-6">
                {/* 页面级示例标识（只标注一次） */}
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span className="font-semibold">结果预览 · 示例</span>
                  <span>刚刚核对</span>
                </div>

                {/* 三类结果标签 */}
                <div className="mt-4 grid grid-cols-3 gap-2" role="presentation">
                  <div className="rounded-lg bg-brand-soft px-2.5 py-2 text-center text-[11px] text-brand-strong">
                    <strong className="block text-[18px] font-medium">1</strong>
                    优先机会
                  </div>
                  <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-center text-[11px] text-ink-muted">
                    <strong className="block text-[18px] font-medium text-ink">2</strong>
                    补充后判断
                  </div>
                  <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-center text-[11px] text-ink-muted">
                    <strong className="block text-[18px] font-medium text-ink">3</strong>
                    偏好范围外
                  </div>
                </div>

                {/* 简化岗位卡（示意，不展开完整公告） */}
                <div className="mt-3 rounded-lg border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-6 items-center rounded border border-ok-line bg-ok-bg px-2.5 text-xs font-semibold text-ok-ink">
                      初步符合
                    </span>
                    <span className="inline-flex h-6 items-center rounded border border-ask-line bg-ask-bg px-2.5 text-xs font-medium text-ask-ink">
                      6 天后截止
                    </span>
                  </div>
                  <h2 className="mt-3 text-[15px] font-bold leading-snug text-ink">
                    杭州某公办初中 · 语文教师
                  </h2>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    杭州 · 余杭区
                  </p>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs">
                    <strong className="font-medium text-ok-ink">3 项已通过</strong>
                    <span className="text-ink-muted">户籍待确认</span>
                  </div>
                </div>

                {/* 查看官方依据（示意动作，不可交互） */}
                <div
                  className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand-soft text-[13px] font-semibold text-brand-strong"
                  role="presentation"
                  aria-hidden="true"
                >
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
                    <path d="M14 3v4h4M9 13h6M9 17h4" />
                  </svg>
                  查看官方依据
                </div>
              </div>
            </aside>

            {/* 信任短句（桌面左列下方；移动端在预览之后） */}
            <ul
              className="flex flex-wrap gap-2 lg:col-span-5 lg:col-start-1"
              aria-label="信任说明"
              data-testid="home-trust-chips"
            >
              {trustChips.map((item) => (
                <li
                  key={item}
                  className="inline-flex h-6 items-center rounded border border-line bg-surface-2 px-3 text-[13px] text-ink-muted"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </main>

        <footer className="mx-auto w-full max-w-[1280px] px-5 pb-10 md:px-8">
          <div className="border-t border-line pt-5 text-xs text-ink-muted">
            <p>初步判断不等于保证可以报名，最终资格以招聘单位审核为准。</p>
          </div>
        </footer>
      </div>
    );
  }

  // 三步核心流程
  const flow: Array<[string, string, string]> = [
    ["01", "填写条件", "地区、分阶段教育经历与教师资格。"],
    ["02", "核对机会", "初步结论、未知项与官方依据分开呈现。"],
    ["03", "保存并推进", "跟进材料与日程；报名到官方渠道完成。"],
  ];

  return (
    <div className="min-h-screen bg-canvas">
      {/* 公共顶部栏：品牌 + 产品说明/服务范围 + 登录 */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 md:px-8">
          <BrandMark size="md" />
          <div className="flex items-center gap-6">
            <div className="hidden items-center gap-6 text-sm text-ink-muted md:flex">
              <Link href="/learn" className="hover:text-brand">产品说明</Link>
              <Link href="#coverage" className="hover:text-brand">服务范围</Link>
            </div>
            <LinkButton href="/login" variant="ghost" size="sm" className="text-ink-muted">
              登录
            </LinkButton>
          </div>
        </div>
      </header>

      <main>
        {/* Hero：桌面双列 1.1:0.9，内容最大 1120px，上下 72px、左右 40px */}
        <section
          aria-label="产品价值与快速入口"
          className="mx-auto max-w-[1120px] px-6 py-12 md:px-10 md:py-[72px]"
        >
          <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            {/* 左：价值 + 主行动 */}
            <div>
              <p className="text-[13px] font-medium text-ink-muted">
                教师招聘机会与资格预筛
              </p>
              <h1
                className="mt-3.5 text-[36px] font-bold leading-[44px] tracking-[-0.02em] md:text-[48px] md:leading-[58px]"
                data-testid="home-primary-title"
              >
                哪些教师岗，<br />你能报？
              </h1>
              <p className="mt-5 max-w-[30em] text-[15px] leading-6 text-ink-muted md:text-[17px]">
                按条件预筛，查看官方依据。
              </p>

              <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  onClick={handleStart}
                  data-testid="start-onboarding"
                  iconEnd={
                    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 10h12m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  }
                >
                  开始资格预筛
                </Button>
                <span className="text-[13px] text-ink-muted" data-testid="home-time-hint">
                  无需登录即可体验
                </span>
              </div>

              <div className="mt-7">
                <Link href="#coverage" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
                  浙江、江苏、安徽部分地区 · 语文
                  <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="10" cy="10" r="8" />
                    <path d="M10 7v4M10 14h.01" strokeLinecap="round" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* 右：结果示例卡 */}
            <aside
              id="result-example"
              tabIndex={-1}
              aria-label="结果示例，非真实岗位"
              data-testid="result-example-card"
              className="rounded-[10px] border border-line bg-surface p-5 shadow-2 focus:outline-none md:p-6"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex h-6 items-center rounded bg-ask-bg px-2 text-xs font-medium text-ask-ink">
                  结果示例 · 非真实岗位
                </span>
              </div>
              <h2 className="mt-3 text-xl font-bold leading-7 text-ink">
                小学语文
              </h2>
              <p className="mt-1 text-[13px] text-ink-muted">杭州·某区（示例）</p>

              {/* 关键条件节选 */}
              <div className="mt-4 space-y-0">
                {["学历", "专业", "教师资格"].map((t) => (
                  <div key={t} className="flex items-center justify-between border-b border-line py-3 last:border-0">
                    <span className="text-sm text-ink">{t}</span>
                    <span className="inline-flex h-6 items-center rounded bg-ok-bg px-2 text-xs font-medium text-ok-ink">
                      已满足
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-[13px] leading-5 text-ink-muted">
                上述为关键条件节选，完整判断包含全部公告要求。
              </p>
              <div className="mt-3">
                <Link href="/preview" className="text-[13px] font-medium text-brand hover:underline">
                  查看示例 →
                </Link>
              </div>
            </aside>
          </div>
        </section>

        {/* 三步说明 */}
        <section className="mx-auto max-w-[1120px] px-6 pb-12 md:px-10 md:pb-16">
          <div className="grid gap-4 md:grid-cols-3 md:gap-5">
            {flow.map(([no, title, desc]) => (
              <div key={no} className="rounded-[10px] border border-line bg-surface p-5">
                <span className="inline-flex h-6 items-center rounded bg-brand-soft px-2 text-xs font-medium text-brand">
                  {no}
                </span>
                <h3 className="mt-2.5 text-base font-semibold text-ink">{title}</h3>
                <p className="mt-1 text-[13px] leading-5 text-ink-muted">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 rounded-lg bg-brand-soft px-4 py-3 text-[13px] text-brand-strong">
            当前只开放语文学科，来源覆盖部分城市。没有收录不代表当地没有招聘。
          </p>
        </section>

        {/* 覆盖范围 */}
        <section
          id="coverage"
          className="mx-auto max-w-[1120px] px-6 pb-16 md:px-10"
        >
          <div className="rounded-[10px] border border-line bg-surface p-5 md:p-6">
            <h2 className="text-xl font-bold text-ink">服务覆盖范围</h2>
            <p className="mt-1 text-[13px] text-ink-muted">以下为当前覆盖，实际以运行时来源状态为准。</p>
            <div className="mt-4">
              <p className="text-sm font-semibold text-ink">
                {regionText} · 语文教师岗位
              </p>
              <p className="mt-1 text-[13px] text-ink-muted" data-testid="home-coverage-summary">
                最近核对 {formatDate(coverage.lastCheckedAt)} · 官方来源共 {sourceCount} 个 ·
                下一个窗口：{coverage.nextWindowNote}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1440px] px-5 py-5 text-center text-xs text-ink-muted md:px-8">
          <p>资格预筛仅供参考，最终以招聘单位审核为准。</p>
        </div>
      </footer>
    </div>
  );
}
