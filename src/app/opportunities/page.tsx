"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Hero } from "@/components/ia/Hero";
import { Disclosure } from "@/components/ia/Layer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { daysUntil } from "@/lib/ia/labels";
import { useOpportunities } from "@/lib/opportunities/useOpportunities";
import {
  buildListViewModel,
  formatEvaluatedAt,
  listCardNextStepLabel,
} from "@/lib/opportunities/list-view";
import { buildNoResultPanel } from "@/lib/opportunities/no-result";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { OpportunityListItem } from "@/components/opportunities/OpportunityListItem";
import { PreferencePreviewCard } from "@/components/opportunities/PreferencePreviewCard";
import { MigrationConflictBanner } from "@/components/opportunities/MigrationConflictBanner";
import type { SupplementFacts } from "@/lib/profile/activeProfile";
import { WorkbenchTabs } from "@/components/opportunities/WorkbenchTabs";
import { StackedResultSections } from "@/components/opportunities/StackedResultSections";
import { FLAGS } from "@/lib/flags";
import { CoverageBanner } from "@/components/opportunities/CoverageBanner";
import { DatasetScopeNotice } from "@/components/opportunities/DatasetScopeNotice";
import { TrialJourneyGuide } from "@/components/opportunities/TrialJourneyGuide";
import { NoResultFeedback } from "@/components/opportunities/NoResultFeedback";
import { SubscriptionCard } from "@/components/opportunities/SubscriptionCard";
import { StatusMessage, StatusMessageRegion } from "@/components/ui/StatusMessage";
import { Callout } from "@/components/ui/Callout";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { ResultConditionSummary } from "@/components/results/ResultConditionSummary";
import { buildEditConditionsHref } from "@/lib/results/condition-summary";
import type { ConditionSource } from "@/lib/results/condition-summary";

const NO_PROFILE_COPY: Record<string, { title: string; description: string }> = {
  no_draft: {
    title: "先填写报考信息，才能看到适合你的机会",
    description:
      "填写地区、学历、专业、毕业情况和教师资格后，系统会立即核对已发布公告。",
  },
  incomplete: {
    title: "报考信息还差几步",
    description: "补全剩余信息后，机会列表会立即更新。",
  },
  subject_not_open: {
    title: "当前只开放语文学科的机会匹配",
    description:
      "你的意向学科尚未开放。可以先登记意向，开放后会优先评估。",
  },
};

export default function OpportunitiesPage() {
  const router = useRouter();
  const [loginNotice, setLoginNotice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const message = window.sessionStorage.getItem("kb_post_login_notice");
    if (message) window.sessionStorage.removeItem("kb_post_login_notice");
    return message;
  });
  // v7.2 登录迁移冲突：HttpAuthProvider 在画像冲突时写入标记，本页引导用户确认（不静默覆盖）
  const [migrationConflict, setMigrationConflict] = useState<{
    guestFacts?: SupplementFacts;
  } | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem("kb_profile_migration_conflict");
    if (!raw) return null;
    window.sessionStorage.removeItem("kb_profile_migration_conflict");
    try {
      const parsed = JSON.parse(raw) as { guestFacts?: SupplementFacts };
      return { guestFacts: parsed.guestFacts };
    } catch {
      return {};
    }
  });
  const [migrationResolvedNotice, setMigrationResolvedNotice] = useState<
    string | null
  >(null);
  const {
    state,
    reload,
    followBusyId,
    actionError,
    actionFeedback,
    clearActionFeedback,
    toggleFollow,
  } = useOpportunities();
  const online = useOnlineStatus();

  // v7.1 M6：进入机会页即幂等同步订阅（fire-and-forget）；有新提醒时给页面提示条
  const [newNotices, setNewNotices] = useState(0);
  useEffect(() => {
    let cancelled = false;
    opportunitiesApi
      .syncSubscription()
      .then((result) => {
        if (!cancelled && result.enabled && result.newNotices > 0) {
          setNewNotices(result.newNotices);
        }
      })
      .catch(() => {
        // 同步失败不打扰用户：下次进入页面会再次幂等同步
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // D05 列表位置保留（PRD 11.6）：从定向补充页保存返回时 URL 带 #unit-<id> 锚点，
  // 数据就绪后滚动定位到原岗位卡片（锚点元素由 ResultsWorkbench 渲染）。
  useEffect(() => {
    if (state.status !== "ready") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#unit-")) return;
    document
      .getElementById(hash.slice(1))
      ?.scrollIntoView({ block: "center" });
  }, [state.status]);

  if (state.status === "loading") return <LoadingPage />;

  if (state.status === "no-profile") {
    const copy = NO_PROFILE_COPY[state.reason] ?? NO_PROFILE_COPY.no_draft!;
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title={copy.title}
          description={copy.description}
          actionLabel="填写报考信息"
          actionHref="/onboarding?from=opportunities"
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title={online ? "机会暂时加载失败" : "当前离线，无法加载机会列表"}
        description={
          online
            ? `${state.error}。正式结果来自已登录的后端服务，不会用本地演示数据替代；请检查服务后重试。`
            : "网络已断开。恢复网络后点击重试，或返回后再打开。"
        }
        onRetry={reload}
      />
    );
  }

  const view = buildListViewModel(state.data, state.profile);
  // D04：多原因无结果面板（含当前筛选/统计范围/分阶段数量/检查时间）
  const noResult = buildNoResultPanel(view, state.profile);
  const evaluatedAt = view.meta.evaluatedAt;
  const suggested =
    view.priority ??
    view.otherPreliminary[0] ??
    view.needInfoGroups[0]?.units[0] ??
    view.manualReview[0] ??
    null;
  // v7.2：页面叙事以 workbench 三标签为单一来源，hasDemo/trialEntry/hasSavedDemo
  // 都从 workbench 全量单元派生，避免与三标签分桶不一致。
  const allWorkbenchUnits = [
    ...view.workbench.priority.units,
    ...view.workbench.supplement.units,
    ...view.workbench.outOfScope.units,
    ...view.workbench.excluded,
  ];
  const hasDemo = allWorkbenchUnits.some(
    (unit) => unit.announcement.dataset === "demo",
  );
  const trialEntry =
    allWorkbenchUnits.find(
      (unit) => unit.announcement.dataset === "demo",
    ) ?? null;
  const hasSavedDemoOpportunity = allWorkbenchUnits.some(
    (unit) => unit.announcement.dataset === "demo" && unit.follow !== null,
  );
  const heroConclusion = view.priority
    ? view.conclusion
    : view.needInfoGroups.length > 0
      ? `${view.validCount} 个机会还差信息就能完成判断`
      : view.conclusion;

  // 最近的报名截止（只在初步符合中找）：7 天内给出必须级风险提示
  let risk: { tone: "must" | "info"; text: string } | null = null;
  const priorityEnd = view.priority?.version.timeline.registrationEnd;
  const nearest =
    view.priority && priorityEnd ? daysUntil(priorityEnd, evaluatedAt) : null;
  if (nearest !== null && nearest >= 0 && nearest <= 7) {
    risk = {
      tone: "must",
      text: `优先机会报名还有 ${nearest} 天截止，请尽快保存并准备报名。`,
    };
  } else if (view.needInfoGroups.length > 0 || view.manualReview.length > 0) {
    risk = {
      tone: "info",
      text: "部分机会需要补充信息或向招聘单位确认后才能判断，未确认前不要当作可报结论。",
    };
  } else if (view.excludedCount > 0) {
    risk = {
      tone: "info",
      text: "已截止与明确不符合的机会不进入推荐，可在页面底部查看原因与公告留档。",
    };
  }

  // 留档区：excluded 中 closedBuckets 已按闸门主异常态分桶（截止/来源失效/撤回…）；
  // 其余 excluded 是资格明确不符合（非地区 FAIL），单独展示一个折叠区。
  const closedIds = new Set(view.closed.map((u) => u.unit.id));
  const hardNotEligible = view.workbench.excluded.filter(
    (u) => !closedIds.has(u.unit.id),
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-7 px-4 pb-2 sm:px-5 lg:px-6">
      {actionFeedback && (
        <StatusMessageRegion>
          <StatusMessage
            tone="success"
            message={actionFeedback.message}
            action={
              actionFeedback.kind === "saved"
                ? { label: "查看日程", onClick: () => router.push("/schedule") }
                : undefined
            }
            onDismiss={clearActionFeedback}
          />
        </StatusMessageRegion>
      )}
      {loginNotice && (
        <StatusMessageRegion anchor="top">
          <StatusMessage
            tone="success"
            message={loginNotice}
            onDismiss={() => setLoginNotice(null)}
          />
        </StatusMessageRegion>
      )}
      {migrationConflict && (
        <MigrationConflictBanner
          guestFacts={migrationConflict.guestFacts}
          onResolved={(choice) => {
            setMigrationConflict(null);
            setMigrationResolvedNotice(
              choice === "guest"
                ? "已使用本次填写的补充信息，机会判断已更新。"
                : "已保留账号中保存的补充信息。",
            );
            reload();
          }}
        />
      )}
      {migrationResolvedNotice && (
        <StatusMessageRegion>
          <StatusMessage
            tone="success"
            message={migrationResolvedNotice}
            onDismiss={() => setMigrationResolvedNotice(null)}
          />
        </StatusMessageRegion>
      )}
      {!online && (
        <Callout variant="ask" title="当前离线">
          显示的是之前加载的机会列表，可能不是最新结果。恢复网络后会自动刷新。
        </Callout>
      )}
      {newNotices > 0 && (
        <StatusMessageRegion>
          <StatusMessage
            tone="success"
            message={`有 ${newNotices} 条新机会提醒已放入站内通知中心（顶部导航铃铛）。`}
            onDismiss={() => setNewNotices(0)}
          />
        </StatusMessageRegion>
      )}
      <Hero
        meta={`机会结论 · ${formatEvaluatedAt(evaluatedAt)} 更新`}
        conclusion={heroConclusion}
        risk={risk}
        action={
          suggested
            ? {
                label: listCardNextStepLabel(suggested),
                href: `/opportunities/${suggested.unit.id}`,
              }
            : undefined
        }
      />

      <CoverageBanner coverage={view.coverage} />
      <DatasetScopeNotice hasDemo={hasDemo} />
      {/* D04：偏好调整影响预览（只读预览 → 确认保存 → 可撤销），有结果/无结果都可用 */}
      <PreferencePreviewCard
        profile={state.profile}
        response={state.data}
        onApplied={() => reload()}
      />
      {/* v7.2：当前条件摘要 + 修改入口（与 /preview 同一组件，ff 开时展示） */}
      {FLAGS.ff_new_results && state.profile && (
        <Suspense fallback={null}>
          <OpportunitiesConditionSummary source={state.profile} />
        </Suspense>
      )}
      {trialEntry && (
        <TrialJourneyGuide
          unitId={trialEntry.unit.id}
          hasSavedOpportunity={hasSavedDemoOpportunity}
        />
      )}

      {view.uncoveredRegions.length > 0 && (
        <div
          data-testid="uncovered-regions"
          className="rounded-xl border border-dashed border-line bg-canvas p-4"
        >
          <p className="text-sm font-semibold text-ink">
            这些地区当前暂未收录官方公告
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
            {view.uncoveredRegions.map((region) => (
              <span
                key={region.code}
                className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 font-medium text-ink-muted ring-1 ring-line"
              >
                {region.label}
              </span>
            ))}
          </p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            暂未收录不等于当地没有招聘：可能公告尚未发布，或还没进入我们的监测范围。
            这里提供的是初步判断，报名前请以当地教育局或人社局官网为准。
          </p>
          <Link
            href="/onboarding?from=opportunities"
            className="mt-2 inline-block text-xs font-medium text-brand underline underline-offset-2"
          >
            修改报考地区
          </Link>
        </div>
      )}

      {noResult && (
        <NoResultFeedback panel={noResult} coverage={view.coverage} />
      )}
      {noResult && <SubscriptionCard profile={state.profile} />}

      {actionError && (
        <Callout variant="no" title="操作未完成">
          {actionError}
        </Callout>
      )}

      {/* v7.2 结果区：ff_new_results 开 → 工作台三标签；关（回退）→ 旧式堆叠分组。
          FLAGS 是构建期快照，顶层条件渲染在服务端与客户端一致，无 hydration 风险。
          WorkbenchTabs 的 useSearchParams 在生产构建需要 Suspense 边界，避免 prerender 失败。 */}
      {!noResult &&
        (FLAGS.ff_new_results ? (
          <Suspense
            fallback={
              <div className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
                正在加载机会标签…
              </div>
            }
          >
            <WorkbenchTabs
              workbench={view.workbench}
              evaluatedAt={evaluatedAt}
              followBusyId={followBusyId}
              onToggleFollow={toggleFollow}
            />
          </Suspense>
        ) : (
          <StackedResultSections
            priority={view.priority}
            otherPreliminary={view.otherPreliminary}
            needInfoGroups={view.needInfoGroups}
            manualReview={view.manualReview}
            regionOutOfScope={view.regionOutOfScope}
            evaluatedAt={evaluatedAt}
            followBusyId={followBusyId}
            onToggleFollow={toggleFollow}
          />
        ))}

      {/* 留档区：已截止 / 来源失效 / 明确不符合的公告不进入推荐，但历史依据仍可追溯。
          不用惩罚性红色（danger 仅用于来源失效/撤回的高风险留档，由 GateTag 自身控制）。 */}
      {view.closedBuckets.length > 0 && (
        <section
          aria-labelledby="excluded-closed-heading"
          className="space-y-3"
        >
          <h2
            id="excluded-closed-heading"
            className="text-sm font-semibold text-ink-muted"
          >
            已截止与来源失效的留档公告
          </h2>
          {view.closedBuckets.map((bucket) => (
            <Disclosure
              key={bucket.key}
              title={bucket.label}
              count={bucket.units.length}
            >
              <div className="space-y-3">
                {bucket.units.map((unit) => (
                  <OpportunityListItem
                    key={unit.unit.id}
                    unit={unit}
                    evaluatedAt={evaluatedAt}
                    variant="excluded"
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                该状态只表示当前不进入推荐，历史留档与官方依据仍可追溯；它不是资格不符合结论。
              </p>
            </Disclosure>
          ))}
        </section>
      )}

      {hardNotEligible.length > 0 && (
        <section
          aria-labelledby="excluded-noteligible-heading"
          className="space-y-3"
        >
          <h2
            id="excluded-noteligible-heading"
            className="text-sm font-semibold text-ink-muted"
          >
            明确不符合（资格条件本身不满足）
          </h2>
          <Disclosure
            title="资格条件明确不符合"
            count={hardNotEligible.length}
          >
            <div className="space-y-3">
              {hardNotEligible.map((unit) => (
                <OpportunityListItem
                  key={unit.unit.id}
                  unit={unit}
                  evaluatedAt={evaluatedAt}
                  variant="excluded"
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              这些岗位的资格条件本身不满足，不进入推荐；官方依据仍可追溯，供你对比参考。
            </p>
          </Disclosure>
        </section>
      )}

      {!noResult && <SubscriptionCard profile={state.profile} />}
    </div>
  );
}

/**
 * v7.2 登录端条件摘要（ff_new_results 开）：与 /preview 同一 ResultConditionSummary。
 * 「修改」默认进入第二屏，returnTo 保留当前标签，保存后回到 /opportunities 重新计算。
 */
function OpportunitiesConditionSummary({ source }: { source: ConditionSource }) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const returnTo =
    tab && tab !== "priority" ? `/opportunities?tab=${tab}` : "/opportunities";
  return (
    <ResultConditionSummary
      source={source}
      editHref={buildEditConditionsHref(returnTo)}
    />
  );
}
