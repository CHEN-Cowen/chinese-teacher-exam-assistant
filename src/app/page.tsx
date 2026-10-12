"use client";

import { useEffect } from "react";
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

/** "YYYY-MM-DD..." → "YYYY年M月D日"；无法解析时原样返回 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const SOURCE_COUNT = GUEST_COVERAGE.regions.reduce(
  (sum, region) => sum + region.sources.length,
  0,
);

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

  const regionText = coverageProvinceLine(GUEST_COVERAGE);

  const handleStart = () => {
    track("home_start_match_clicked", "home");
    router.push("/onboarding");
  };

  // 原型 .hero__safe 三标签：明确"无注册 / 步步有反馈 / 可回看原文"
  const safeChips = ["无需登录即可初筛", "每一步都有反馈", "结论可回到官方原文核对"];

  // 三步核心流程（v7：找机会 → 判资格 → 跟报名；备考弱化为补充说明，不与主操作争夺）
  const flow: Array<[string, string, string, string]> = [
    ["01", "找到招聘机会", "汇总已覆盖的官方教师招聘", "/onboarding"],
    ["02", "看懂是否符合", "逐条核对条件，解释判断依据", "/onboarding"],
    ["03", "跟进报名节点", "整理材料，记录审核与考试状态", "/applications"],
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between px-5 md:h-20 md:px-8">
        <BrandMark size="md" />
        <LinkButton href="/login" variant="ghost" size="sm" className="text-ink-muted">
          登录
        </LinkButton>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-12 pt-2 md:px-8 md:pb-16 md:pt-4">
        {/* Hero：原型 .hero 圆角 2xl + 渐变背景 + 双列布局 */}
        <section
          aria-label="产品价值与快速入口"
          className="relative overflow-hidden rounded-2xl p-7 text-on-dark md:p-14"
          style={{ background: "var(--color-hero)" }}
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-12">
            {/* 左：价值表达 + 主行动 + 安全标签。
                v7.1 M1 修复：窄屏撑满首屏视口并垂直居中，确保右侧示例卡
                在移动端完全折叠到首屏线下，只能通过「先看结果示例」锚点到达；
                桌面端（lg+）不受影响，仍为双列并排。 */}
            <div className="min-w-0 hero-left-fold">
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-on-dark/85">
                教师招聘机会发现与资格判断
              </p>
              <h1 className="mt-3.5 text-[34px] font-bold leading-[1.16] tracking-[-0.01em] sm:text-[40px] md:text-[clamp(38px,4.6vw,54px)]">
                找到真正适合你报考的教师招聘机会
              </h1>
              <p className="mt-4 max-w-[30em] text-[15px] leading-[1.65] text-on-dark/92 md:text-[17px]">
                根据你的地区、学段学科和资格条件，解释你是否符合，并帮你整理报名材料与关键时间节点。
              </p>

              <div className="mt-5 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center">
                {/* v7.1 M1：全页唯一高强调主按钮，testid 与 QA harness 保持一致 */}
                <Button
                  size="lg"
                  onClick={handleStart}
                  data-testid="start-onboarding"
                  className="w-full bg-on-dark text-ink hover:bg-on-dark/90 sm:w-auto sm:min-w-44"
                  iconEnd={
                    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 10h12m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  }
                >
                  开始资格预筛
                </Button>
                {/* 次级文字入口：锚向右侧结果示例卡（页内锚点，不新增路由与跳转成本） */}
                <a
                  href="#result-example"
                  data-testid="view-result-example"
                  className="inline-flex h-[52px] items-center justify-center rounded-xl border border-on-dark/30 px-6 text-base font-semibold text-on-dark transition-colors hover:bg-on-dark/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-dark/60"
                >
                  先看结果示例
                </a>
              </div>

              <ul className="mt-6 flex flex-wrap gap-2" aria-label="使用说明">
                {safeChips.map((item) => (
                  <li
                    key={item}
                    className="rounded-pill border border-on-dark/26 bg-on-dark/16 px-3 py-1.5 text-[13px]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* 右：结果示例卡（v7.1 M1：右侧不再重复主操作，改为展示"填写后会得到什么"。
                内容为虚构示例并明确标注，避免被误认为真实岗位；tabIndex 使锚点跳转后焦点可达） */}
            <aside
              id="result-example"
              tabIndex={-1}
              aria-label="结果示例，非真实岗位"
              data-testid="result-example-card"
              className="rounded-xl bg-surface p-5 text-ink shadow-3 focus:outline-none md:p-6"
            >
              <span className="inline-flex rounded-pill bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                结果示例 · 非真实岗位
              </span>
              <h2 className="mt-2.5 text-lg font-bold leading-snug text-ink">
                填写后，你会看到这样的结果
              </h2>

              {/* 匹配状态（示例）：沿用资格结论卡的 ok 档视觉语言 */}
              <div className="mt-4 rounded-lg border border-ok-line bg-ok-bg p-4 text-ok-ink">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-ok-line bg-ok-bg px-2.5 py-0.5 text-xs font-semibold">
                    初步符合
                  </span>
                  <span className="text-xs font-medium">示例：杭州某公办初中 · 语文教师</span>
                </div>
              </div>

              <dl className="mt-3 grid gap-2.5 text-sm">
                <div>
                  <dt className="text-xs font-medium text-ink-muted">主要依据</dt>
                  <dd className="mt-0.5 leading-relaxed text-ink">
                    公告写明要求本科及以上学历、汉语言文学类专业，与所填信息一致。
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">待确认事项</dt>
                  <dd className="mt-0.5 leading-relaxed text-ink">
                    公告未写明是否限户籍，建议向招聘单位确认后再报名。
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">官方来源</dt>
                  <dd className="mt-0.5 leading-relaxed text-ink">
                    官方公告发布页；真实结果中可点开原文逐条核对。
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">最后核对时间</dt>
                  <dd className="mt-0.5 leading-relaxed text-ink">2026年10月6日</dd>
                </div>
              </dl>

              <p className="mt-3 border-t border-line pt-3 text-xs leading-5 text-ink-muted">
                示例为虚构数据，仅用于说明判断方式；你的结果将按官方公告逐条计算，最终以招聘单位审核为准。
              </p>
            </aside>
          </div>
        </section>

        {/* 三步核心流程（v7：找机会 → 判资格 → 跟报名） */}
        <section className="mt-12 grid gap-3 md:mt-16 md:grid-cols-3 md:gap-3.5">
          {flow.map(([no, title, desc, href]) => (
            <Link
              key={no}
              href={href}
              className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-brand/40 md:p-5"
            >
              <span className="inline-flex items-center rounded-pill bg-note-bg px-2.5 py-0.5 text-xs font-semibold text-note-ink">
                {no}
              </span>
              <h3 className="mt-2.5 text-[15px] font-bold text-ink">{title}</h3>
              <p className="mt-1 text-[13px] leading-5 text-ink-muted">{desc}</p>
            </Link>
          ))}
        </section>

        {/* 备考弱化说明：确定主目标后才进入，不与首页主操作争夺 */}
        <p className="mt-4 text-center text-[13px] leading-5 text-ink-muted">
          确定主目标后，还可以继续
          <Link href="/study" className="mx-0.5 font-medium text-brand hover:underline">
            制定备考计划
          </Link>
          。
        </p>

        {/* 三个核心能力：原型 .od-grid cols-3 */}
        <section className="mt-12 grid gap-3.5 md:mt-16 md:grid-cols-3">
          {[
            {
              title: "每条判断都能回到原文",
              desc: "我们标出公告和岗位表里的具体位置，你可以自己核对。",
              icon: (
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
                  <path d="M14 3v4h4M9 13h6M9 17h4" />
                </svg>
              ),
            },
            {
              title: "不确定就说不确定",
              desc: "信息不足时写「需要补充」，规则有歧义时建议你问招聘单位。",
              icon: (
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              ),
            },
            {
              title: "公告变了会告诉你",
              desc: "报名延期、岗位核减、要求调整，我们会说明对你的影响和下一步。",
              icon: (
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="2.5" />
                  <circle cx="18" cy="18" r="2.5" />
                  <path d="M8.5 6H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h5.5" />
                </svg>
              ),
            },
          ].map(({ title, desc, icon }) => (
            <div key={title} className="rounded-lg border border-line bg-surface p-5">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-surface-2 text-ink-2">
                {icon}
              </span>
              <h3 className="mt-3 text-[15px] font-bold text-ink">{title}</h3>
              <p className="mt-1 text-[13px] leading-5 text-ink-muted">{desc}</p>
            </div>
          ))}
        </section>

        {/* 覆盖范围卡片：原型 .card--tint */}
        <section className="mt-12 rounded-lg border border-line bg-surface-2 p-5 md:mt-16 md:p-6">
          <div className="flex flex-wrap items-center gap-3 md:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                真实监测：{regionText} · 语文教师岗位
              </p>
              <p className="mt-1 text-xs text-ink-muted" data-testid="home-coverage-summary">
                最近核对 {formatDate(GUEST_COVERAGE.lastCheckedAt)} · 官方来源共 {SOURCE_COUNT} 个 ·
                下一个窗口：{GUEST_COVERAGE.nextWindowNote}
              </p>
            </div>
            <Disclosure
              trigger="覆盖范围与判断依据"
              triggerVariant="ghost"
              contentClassName="mt-2 rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed text-ink-muted sm:w-[480px] sm:shadow-2"
            >
              <dl className="grid gap-2 sm:grid-cols-2">
                <div><dt className="text-xs text-ink-muted">最近核对</dt><dd className="mt-0.5 font-medium text-ink">{formatDate(GUEST_COVERAGE.lastCheckedAt)}</dd></div>
                <div><dt className="text-xs text-ink-muted">官方来源</dt><dd className="mt-0.5 font-medium text-ink">共 {SOURCE_COUNT} 个</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-ink-muted">下一窗口</dt><dd className="mt-0.5 font-medium text-ink">{GUEST_COVERAGE.nextWindowNote}</dd></div>
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-xs">{GUEST_COVERAGE.scopeNote}</p>
              <p className="mt-2 text-xs">初步判断不是官方审核，最终以招聘单位认定为准。</p>
            </Disclosure>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 pb-10 md:px-8">
        <div className="border-t border-line pt-5 text-xs text-ink-muted">
          <p>初步判断不等于保证可以报名，最终资格以招聘单位审核为准。</p>
        </div>
      </footer>
    </div>
  );
}
