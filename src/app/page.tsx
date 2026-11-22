"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandMark } from "@/components/layout/BrandMark";
import { LoadingPage } from "@/components/ui/Loading";
import { useCurrentUser } from "@/lib/auth";
import { guestSessionService } from "@/lib/guest/guestSession";
import { track } from "@/lib/analytics/eventService";

/**
 * 价值首页（2026-11 UI 大改版，对应 docs/workbuddy-upgrade/ui-redesign-plan.md）。
 *
 * 路由规则不变（v6.1 0A / v7.1 M1）：
 * - 已登录 → /opportunities；
 * - 未登录且画像问答进行到一半 → /onboarding；
 * - 未登录且已看完初步结果 → /preview；
 * - 其余访客 → 价值首页（本页内容，无需登录）。
 *
 * 首页结构（与 Ardot 设计稿一致）：
 * Header / Hero（徽章 + 主张 + 双 CTA + 机会页真实界面截图）/ 三步运作 /
 * 官方数据信任带 / 功能网格 / FAQ / 转化带 / Footer。
 * 约束：不引入远程字体与图标（国内网络基线）；Hero 截图为机会页界面示意
 * （图中标题与日期不含年份，避免首页长期挂着失效信息），图注标注「示意内容」；
 * 页脚保留资格免责声明；首屏只有一个高强调主 CTA。
 */

const NAV_LINKS = [
  { href: "/opportunities", label: "找机会" },
  { href: "/learn", label: "怎么运作" },
  { href: "/policy", label: "数据来源" },
] as const;

const STEPS = [
  {
    no: "01",
    title: "选地区",
    desc: "按省、市、区县直接检索已收录的招聘公告，不用再逐个翻政府网站和公众号。",
  },
  {
    no: "02",
    title: "核资格",
    desc: "对照你的学历、专业、教师资格，逐项核对每条公告的报考条件，符合与不符一目了然。",
  },
  {
    no: "03",
    title: "跟报名",
    desc: "关注心仪岗位后自动提醒报名时间节点，报名、缴费、打印准考证的日程一处管理。",
  },
] as const;

const TRUST_STATS = [
  { num: "11+", label: "已收录官方数据源" },
  { num: "全部", label: "公告来自官方发布渠道" },
  { num: "逐项", label: "每条结论可溯源到公告原文" },
  { num: "持续", label: "新增公告纳入监测更新" },
] as const;

const FEATURES = [
  {
    title: "地区级联检索",
    desc: "省、市、区县三级定位，公告按地区聚合，先选地方再看机会。",
    icon: (
      <>
        <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="2" />
        <path d="M26 26l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "资格逐项核对",
    desc: "学历、专业、教资逐条比对公告条件，差什么看得明明白白。",
    icon: (
      <>
        <path d="M13 14h18M13 22h18M13 30h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="m27 30 3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    title: "关注与到点提醒",
    desc: "收藏岗位后自动盯更新，报名通道开启、临近截止都会提醒。",
    icon: (
      <>
        <path d="M22 10c-6 0-9 4-9 9v5l-3 4h24l-3-4v-5c0-5-3-9-9-9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M19 31a3 3 0 0 0 6 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "报考日程管理",
    desc: "报名、笔试、缴费节点自动进日程，同时报多个地区也不乱。",
    icon: (
      <>
        <rect x="12" y="14" width="20" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M12 20h20M18 11v6M26 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "公告数据准不准？",
    a: "全部公告来自官方发布渠道的原文，机会结论可逐项溯源；发现错漏可以在产品内一键纠错，有专人核对。",
  },
  {
    q: "覆盖哪些地区？",
    a: "首批覆盖江苏、浙江、安徽等地市并持续扩展，检索时可按省市区查看已收录范围。",
  },
  {
    q: "收费吗？",
    a: "公告检索与资格核对的核心能力免费使用；进阶的提醒与日程管理等能力见会员方案，按需选择。",
  },
  {
    q: "我是外地考生，能用吗？",
    a: "可以。先选择目标地区检索公告，再填一次报考信息，系统会按当地条件逐项核对是否符合。",
  },
] as const;

const FOOTER_COLUMNS = [
  { title: "产品", links: [{ label: "找机会", href: "/opportunities" }, { label: "备考资料", href: "/study" }] },
  { title: "支持", links: [{ label: "帮助中心", href: "/learn" }, { label: "公告纠错", href: "/me" }] },
  { title: "关于", links: [{ label: "数据来源说明", href: "/policy" }, { label: "隐私政策", href: "/policy" }] },
] as const;

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

  const handleStart = () => {
    track("home_start_match_clicked", "home");
    router.push("/onboarding");
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* ===== Header ===== */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-18 w-full max-w-[1440px] items-center justify-between px-5 md:h-[72px] md:px-16">
          <BrandMark size="md" />
          <nav aria-label="首页导航" className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm font-medium text-ink-muted hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-5">
            <Link href="/login" className="text-sm font-medium text-ink hover:text-brand">
              登录
            </Link>
            <Link
              href="/onboarding"
              className="hidden h-10 items-center rounded-lg bg-brand px-5 text-sm font-medium text-on-dark transition-colors hover:bg-brand-strong sm:inline-flex"
            >
              免费开始
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ===== Hero ===== */}
        <section aria-label="产品价值与结果预览" className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 right-24 h-[380px] w-[380px] rounded-full bg-brand-soft"
          />
          <div className="relative mx-auto grid max-w-[1440px] items-center gap-10 px-5 py-16 md:px-16 md:py-24 lg:grid-cols-[1.05fr_0.95fr]">
            {/* 左：价值 + 主行动 */}
            <div>
              <p className="inline-flex h-8 items-center rounded-full bg-brand-soft px-4 text-[13px] font-medium text-brand-strong">
                官方发布渠道同步收录 · 持续更新
              </p>
              <h1
                className="mt-6 text-[40px] font-bold leading-[54px] tracking-tight text-ink md:text-[52px] md:leading-[66px]"
                data-testid="home-primary-title"
              >
                能报哪些教招岗位，
                <br />
                一眼看清
              </h1>
              <p className="mt-5 max-w-[30em] text-[16px] leading-7 text-ink-muted md:text-[17px]">
                自动追踪全国教师招聘公告，逐项核对学历、专业、教师资格等报考条件，告诉你能不能报、还差什么、什么时候报名。
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleStart}
                  data-testid="start-onboarding"
                  className="inline-flex h-13 min-w-44 items-center justify-center gap-2 rounded-[10px] bg-brand px-8 text-base font-semibold text-on-dark shadow-[0_6px_16px_rgba(66,92,199,0.30)] transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  免费查看我的机会
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 10h12m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <Link
                  href="/opportunities"
                  className="inline-flex h-13 items-center justify-center rounded-[10px] border border-line bg-surface px-8 text-base font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  浏览最近收录的公告
                </Link>
              </div>

              <ul
                className="mt-6 flex flex-wrap gap-2"
                aria-label="信任说明"
                data-testid="home-trust-chips"
              >
                {["支持全学科教师招聘", "真实公告", "逐条可核对", "不确定就明确提示"].map((item) => (
                  <li
                    key={item}
                    className="inline-flex h-7 items-center rounded-full border border-line bg-surface px-3 text-[13px] text-ink-muted"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* 右：机会页界面截图（与设计稿 HeroVisual 一致；为免首页带时效性，
                图中标题与日期均为不含年份的示意内容） */}
            <aside
              id="result-example"
              aria-label="机会页界面预览，内容为示意"
              data-testid="result-preview"
            >
              <figure className="overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-2 md:p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- 静态截图按展示尺寸导出 2x 位图；部署镜像未装 sharp，不走 next/image 运行时优化 */}
                <img
                  src="/images/hero-opportunities.png"
                  alt="机会页界面预览：选择省市区后按地区浏览招聘公告，每条公告标注报名状态与报名时间"
                  width={1228}
                  height={1140}
                  fetchPriority="high"
                  className="w-full rounded-xl border border-line"
                />
                <figcaption className="px-2 pb-0.5 pt-3 text-center text-xs text-ink-muted">
                  机会页界面预览 · 示意内容
                </figcaption>
              </figure>
            </aside>
          </div>
        </section>

        {/* ===== 三步运作 ===== */}
        <section aria-labelledby="how-it-works-title" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1440px] px-5 py-16 md:px-16 md:py-20">
            <div className="mx-auto max-w-xl text-center">
              <h2 id="how-it-works-title" className="text-[28px] font-bold leading-tight text-ink md:text-[32px]">
                三步，锁定你的报考目标
              </h2>
              <p className="mt-3 text-base text-ink-muted">从翻几十个网站，到只看一份属于你的名单</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.no} className="rounded-2xl border border-line bg-surface p-7">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-base font-bold text-brand">
                    {step.no}
                  </span>
                  <h3 className="mt-4 text-xl font-bold text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 官方数据信任带 ===== */}
        <section aria-labelledby="trust-title" className="bg-brand text-on-dark">
          <div className="mx-auto max-w-[1440px] px-5 py-14 md:px-16 md:py-16">
            <h2 id="trust-title" className="text-center text-[22px] font-bold md:text-2xl">
              数据经得起追问，结论才敢用
            </h2>
            <dl className="mt-9 grid grid-cols-2 gap-8 text-center md:grid-cols-4">
              {TRUST_STATS.map((stat) => (
                <div key={stat.label} className="flex flex-col items-center gap-2">
                  <dd className="text-4xl font-bold">{stat.num}</dd>
                  <dt className="text-sm text-brand-soft">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ===== 功能网格 ===== */}
        <section aria-labelledby="features-title">
          <div className="mx-auto max-w-[1440px] px-5 py-16 md:px-16 md:py-20">
            <div className="mx-auto max-w-xl text-center">
              <h2 id="features-title" className="text-[28px] font-bold leading-tight text-ink md:text-[32px]">
                不只帮你找到机会，还把报名管起来
              </h2>
              <p className="mt-3 text-base text-ink-muted">检索、核对、提醒、日程，一条报考链路全覆盖</p>
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-2xl bg-surface p-7">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 44 44" fill="none">
                      <rect width="44" height="44" rx="12" fill="#EDF1FF" />
                      {feature.icon}
                    </svg>
                  </span>
                  <h3 className="mt-4 text-lg font-bold text-ink">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== FAQ ===== */}
        <section aria-labelledby="faq-title" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1080px] px-5 py-16 md:px-10 md:py-20">
            <div className="mx-auto max-w-xl text-center">
              <h2 id="faq-title" className="text-[28px] font-bold leading-tight text-ink md:text-[32px]">
                你可能想问
              </h2>
              <p className="mt-3 text-base text-ink-muted">数据从哪来、准不准、怎么用，先说清楚</p>
            </div>
            <div className="mt-8 space-y-4">
              {FAQ_ITEMS.map((item) => (
                <div key={item.q} className="rounded-xl bg-canvas px-6 py-5">
                  <h3 className="text-base font-medium text-ink">{item.q}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 转化带 ===== */}
        <section aria-labelledby="final-cta-title" className="bg-brand text-on-dark">
          <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-5 px-5 py-16 text-center md:px-16">
            <h2 id="final-cta-title" className="text-[28px] font-bold leading-tight md:text-[34px]">
              下一次报名，别再靠刷网站碰运气
            </h2>
            <p className="text-base text-brand-soft">注册后 1 分钟内，看到属于你的第一批匹配结果</p>
            <button
              type="button"
              onClick={handleStart}
              className="mt-2 inline-flex h-13 items-center justify-center rounded-[10px] bg-surface px-9 text-base font-semibold text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
            >
              免费开始使用
            </button>
          </div>
        </section>
      </main>

      {/* ===== Footer ===== */}
      <footer className="bg-surface">
        <div className="mx-auto max-w-[1440px] px-5 pb-7 pt-12 md:px-16">
          <div className="grid gap-10 md:grid-cols-[300px_1fr_1fr_1fr]">
            <div>
              <BrandMark size="md" />
              <p className="mt-3 text-[13px] leading-[22px] text-ink-muted">
                全国教师公开招聘助手
                <br />
                每一条机会，都有据可查
              </p>
            </div>
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-medium text-ink">{col.title}</h3>
                <ul className="mt-3 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-[13px] text-ink-muted hover:text-ink">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-8 border-t border-line pt-5">
            <p className="text-xs text-ink-muted">
              版权所有 2026 教招有据 · 资格预筛仅供参考，最终以招聘单位审核为准。
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
