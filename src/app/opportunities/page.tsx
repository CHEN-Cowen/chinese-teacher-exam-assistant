"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { buildNoResultState } from "@/lib/opportunities/no-result";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { OpportunityListItem } from "@/components/opportunities/OpportunityListItem";
import { CoverageBanner } from "@/components/opportunities/CoverageBanner";
import { DatasetScopeNotice } from "@/components/opportunities/DatasetScopeNotice";
import { TrialJourneyGuide } from "@/components/opportunities/TrialJourneyGuide";
import { NoResultFeedback } from "@/components/opportunities/NoResultFeedback";
import { SubscriptionCard } from "@/components/opportunities/SubscriptionCard";
import { StatusMessage, StatusMessageRegion } from "@/components/ui/StatusMessage";
import { Callout } from "@/components/ui/Callout";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

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
  const noResult = buildNoResultState(view);
  const evaluatedAt = view.meta.evaluatedAt;
  const suggested =
    view.priority ??
    view.otherPreliminary[0] ??
    view.needInfoGroups[0]?.units[0] ??
    view.manualReview[0] ??
    null;
  const actionable = [
    ...(view.priority ? [view.priority] : []),
    ...view.otherPreliminary,
    ...view.needInfoGroups.flatMap((group) => group.units),
    ...view.manualReview,
  ].filter(
    (unit, index, units) =>
      units.findIndex((candidate) => candidate.unit.id === unit.unit.id) === index,
  );
  const featured = actionable[0] ?? null;
  const secondary = actionable.slice(1);
  const visibleSecondary = secondary.slice(0, 3);
  const collapsedSecondary = secondary.slice(3);
  const hasDemo = [
    ...actionable,
    ...view.regionOutOfScope,
    ...view.notEligible,
    ...view.closed,
  ].some((unit) => unit.announcement.dataset === "demo");
  const allVisible = [
    ...actionable,
    ...view.regionOutOfScope,
    ...view.notEligible,
    ...view.closed,
  ].filter(
    (unit, index, units) =>
      units.findIndex((candidate) => candidate.unit.id === unit.unit.id) === index,
  );
  const trialEntry =
    actionable.find((unit) => unit.announcement.dataset === "demo") ??
    view.regionOutOfScope.find((unit) => unit.announcement.dataset === "demo") ??
    view.notEligible.find((unit) => unit.announcement.dataset === "demo") ??
    view.closed.find((unit) => unit.announcement.dataset === "demo") ??
    null;
  const hasSavedDemoOpportunity = allVisible.some(
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

  return (
    <div className="mx-auto max-w-2xl space-y-7 pb-2">
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
        <NoResultFeedback state={noResult} coverage={view.coverage} />
      )}
      {noResult && <SubscriptionCard profile={state.profile} />}

      {actionError && (
        <Callout variant="no" title="操作未完成">
          {actionError}
        </Callout>
      )}

      {featured && (
        <section
          id="priority-opportunity"
          aria-labelledby="priority-opportunity-heading"
          className="scroll-mt-20 space-y-3 rounded-lg bg-surface-2 p-4"
        >
          <h2
            id="priority-opportunity-heading"
            className="text-sm font-semibold text-ink"
          >
            {featured.unit.id === view.primaryTargetUnitId ? "重点准备的机会" : "优先查看"}
          </h2>
          <OpportunityListItem
            unit={featured}
            evaluatedAt={evaluatedAt}
            priority
            followBusy={followBusyId === featured.unit.id}
            onToggleFollow={toggleFollow}
          />
        </section>
      )}

      {visibleSecondary.length > 0 && (
        <section aria-labelledby="secondary-heading" className="space-y-3">
          <h2 id="secondary-heading" className="text-sm font-semibold text-ink">其他值得查看</h2>
          {visibleSecondary.map((unit) => (
            <OpportunityListItem
              key={unit.unit.id}
              unit={unit}
              evaluatedAt={evaluatedAt}
              compact
              followBusy={followBusyId === unit.unit.id}
              onToggleFollow={toggleFollow}
            />
          ))}
        </section>
      )}

      {collapsedSecondary.length > 0 && (
        <Disclosure title="查看其余结果" count={collapsedSecondary.length}>
          <div className="space-y-2">
          {collapsedSecondary.map((unit) => (
            <OpportunityListItem
              key={unit.unit.id}
              unit={unit}
              evaluatedAt={evaluatedAt}
              compact
              followBusy={followBusyId === unit.unit.id}
              onToggleFollow={toggleFollow}
            />
          ))}
          </div>
        </Disclosure>
      )}

      {/* 模块 7.5：用户端不显示 AI 初核待人工复核记录（real）。
          list-view 已把 realMonitored 置空，此处不再渲染该分组。
          后续若后端 API 增加 status 过滤，realMonitored 永远为空，此注释块可删除。 */}

      {view.regionOutOfScope.length > 0 && (
        <Disclosure
          title="岗位地区不在你选择的范围（不是资格不符合）"
          count={view.regionOutOfScope.length}
        >
          <div className="space-y-3">
            <p className="text-xs leading-5 text-ink-muted">
              这些岗位只是地点不在你填写的可接受地区内，学历、专业等条件并未判定为不符合。
              调整报考地区后会重新判断。
            </p>
            {view.regionOutOfScope.map((unit) => (
              <OpportunityListItem
                key={unit.unit.id}
                unit={unit}
                evaluatedAt={evaluatedAt}
                regionOutOfScope
              />
            ))}
          </div>
        </Disclosure>
      )}

      {view.notEligible.length > 0 && (
        <Disclosure title="明确不符合（资格条件本身不满足）" count={view.notEligible.length}>
          <div className="space-y-3">
            {view.notEligible.map((unit) => (
              <OpportunityListItem
                key={unit.unit.id}
                unit={unit}
                evaluatedAt={evaluatedAt}
              />
            ))}
          </div>
        </Disclosure>
      )}

      {view.closedBuckets.map((bucket) => (
        <Disclosure key={bucket.key} title={bucket.label} count={bucket.units.length}>
          <div className="space-y-3">
            {bucket.units.map((unit) => (
              <OpportunityListItem
                key={unit.unit.id}
                unit={unit}
                evaluatedAt={evaluatedAt}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            该状态只表示当前不进入推荐，历史留档与官方依据仍可追溯；它不是资格不符合结论。
          </p>
        </Disclosure>
      ))}

      {!noResult && <SubscriptionCard profile={state.profile} />}
    </div>
  );
}
