"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Hero } from "@/components/ia/Hero";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { ApplicationTargetCard } from "@/components/ui/ApplicationTargetCard";
import { Timeline } from "@/components/ui/Timeline";
import type { TimelineItem } from "@/components/ui/Timeline";
import { Callout } from "@/components/ui/Callout";
import { ConfirmModal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useCurrentUser } from "@/lib/auth";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type {
  FollowDTO,
  FollowStatus,
  GoalDTO,
  GoalsResponse,
} from "@/lib/opportunities/api-types";
import { FOLLOW_STATUS_LABELS } from "@/lib/opportunities";
import { safeOfficialLink } from "@/lib/links/official";
import { daysUntil, stageSubjectLabel } from "@/lib/ia/labels";
import { track } from "@/lib/analytics/eventService";
import { useOnlineStatus, isForbiddenError } from "@/lib/useOnlineStatus";

/**
 * 报考中心（v7.0 IA /applications）：聚合页。
 *
 * 不变量：
 * - 不建立新的状态系统：状态字段仍为后端 FollowStatus（considering/preparing/
 *   registered/waiting_exam/abandoned/closed），不引入新枚举；
 * - 外部官网状态无法自动确认，必须标注「需要你确认」；
 * - 只跳验证过的官方地址，不在站内伪造报名成功；用户返回后可主动确认「我已报名」
 *   并记录时间（写入 follow.statusHistory）；
 * - 主目标卡 + 备选列表 + 下一步 + 报名倒计时 + 材料完成度 + 官方入口 +
 *   状态变更历史（Timeline）+ 取消关注确认 + 空状态引导。
 */
export default function ApplicationsPage() {
  const { status, session } = useCurrentUser();
  const userId = session?.userId;

  const [goals, setGoals] = useState<GoalsResponse | null>(null);
  const [follows, setFollows] = useState<FollowDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const online = useOnlineStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [unfollowTarget, setUnfollowTarget] = useState<GoalDTO | null>(null);
  const [officialModal, setOfficialModal] = useState<GoalDTO | null>(null);
  // 「我已报名」二次确认：仅在主操作面板出现，避免误触发
  const [registeredConfirm, setRegisteredConfirm] = useState<GoalDTO | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let cancelled = false;
    Promise.all([opportunitiesApi.getGoals(), opportunitiesApi.listFollows()])
      .then(([g, f]) => {
        if (cancelled) return;
        setGoals(g);
        setFollows(f);
        setError(null);
        setForbidden(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isForbiddenError(e)) {
          setForbidden(true);
          return;
        }
        setError(e instanceof Error ? e.message : "报考信息加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [status, userId, reloadKey]);

  const merged = useMemo(() => {
    if (!goals || !follows) return [];
    const followByUnit = new Map(follows.map((f) => [f.unitId, f]));
    return goals.goals.map((g) => ({
      goal: g,
      follow: followByUnit.get(g.unitId) ?? null,
    }));
  }, [goals, follows]);

  if (status === "loading") return <LoadingPage />;

  if (status !== "authenticated" || !userId) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="登录后查看你的报考"
          description="报考中心集中跟进你关注的机会：从准备材料到官方报名、审核和考试进展。"
          actionLabel="去登录"
          actionHref="/login"
        />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="无权限查看报考信息"
          description="登录已过期或当前账号无权访问这些数据。请重新登录后再试。"
          actionLabel="去登录"
          actionHref="/login"
        />
      </div>
    );
  }

  if (error && !goals) {
    return (
      <ErrorState
        title={online ? "报考信息暂时加载失败" : "当前离线，无法加载报考信息"}
        description={
          online ? error : "网络已断开。恢复网络后点击重试，或返回后再打开。"
        }
        onRetry={() => {
          setError(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  if (!goals || !follows) return <LoadingPage />;

  if (merged.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-brand">报考中心</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">我的报考</h1>
          <p className="text-sm text-ink-muted">
            从关注机会开始，材料、官方报名、审核和考试进展都会集中在这里。
          </p>
        </header>
        <EmptyState
          title="还没有报考目标"
          description="先从资格结果里关注一个机会，再决定是否开始准备报名。关注后，下一步会出现在这里。"
          actionLabel="去看机会"
          actionHref="/opportunities"
        />
      </div>
    );
  }

  // 主目标：role==="primary" 优先；否则取第一个非 closed/abandoned 的；再退到第一个
  const primaryEntry =
    merged.find((m) => m.follow?.role === "primary") ??
    merged.find((m) => {
      const s = m.follow?.status ?? m.goal.followStatus;
      return s !== "closed" && s !== "abandoned";
    }) ??
    merged[0]!;
  const primaryGoal = primaryEntry.goal;
  const primaryFollow = primaryEntry.follow;

  // 主目标下一步：基于 followStatus 推导（不引入新状态机）
  const primaryNextStep = nextStepFor(primaryGoal.followStatus, primaryGoal);
  const activeCount = merged.filter((m) => {
    const s = m.follow?.status ?? m.goal.followStatus;
    return s !== "closed" && s !== "abandoned";
  }).length;
  const waitingCount = merged.filter((m) => {
    const s = m.follow?.status ?? m.goal.followStatus;
    return s === "registered" || s === "waiting_exam";
  }).length;

  return (
    <div className="mx-auto max-w-2xl space-y-7 pb-2">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-brand">报考中心</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">我的报考</h1>
        <p className="text-sm text-ink-muted">
          从准备材料到考试结果，每个目标只突出眼下最该做的一件事。
        </p>
      </header>

      {actionError && (
        <Callout variant="no" title="操作未完成">
          {actionError}
        </Callout>
      )}
      {actionNotice && (
        <Callout variant="ok" title="已更新">
          {actionNotice}
        </Callout>
      )}
      {!online && (
        <Callout variant="ask" title="当前离线">
          显示的是之前加载的内容，可能不是最新进展。恢复网络后会自动刷新。
        </Callout>
      )}

      {/* 主目标工作区 */}
      <Hero
        meta="当前主目标"
        conclusion={primaryNextStep.title}
        action={{
          label: primaryNextStep.label,
          onClick: () => void runPrimaryAction(primaryGoal),
        }}
      >
        <p className="text-sm text-ink-muted">
          {primaryGoal.unitName}｜{primaryNextStep.detail}
        </p>
      </Hero>

      {/* metric 三联：报名截止 / 材料准备 / 笔试时间 */}
      <section
        aria-label="关键节点"
        className="grid grid-cols-3 gap-3"
      >
        <MetricCell
          label="报名截止"
          value={
            primaryGoal.version.timeline.registrationEnd
              ? formatIsoDate(primaryGoal.version.timeline.registrationEnd)
              : "待官方通知"
          }
          meta={
            primaryGoal.version.timeline.registrationEnd
              ? (() => {
                  const d = daysUntil(
                    primaryGoal.version.timeline.registrationEnd,
                    new Date().toISOString(),
                  );
                  return d >= 0 ? `还剩 ${d} 天` : "已结束";
                })()
              : "时间未定"
          }
        />
        <MetricCell
          label="材料准备"
          value={
            primaryFollow?.materialStatuses
              ? `${countDone(primaryFollow.materialStatuses)}/${countTotal(primaryFollow.materialStatuses)}`
              : "—"
          }
          meta="项"
        >
          <Link
            href={`/opportunities/${primaryGoal.unitId}#follow`}
            className="text-xs text-brand hover:underline"
          >
            查看清单
          </Link>
        </MetricCell>
        <MetricCell
          label="笔试时间"
          value={
            primaryGoal.version.timeline.writtenExamDate
              ? formatIsoDate(primaryGoal.version.timeline.writtenExamDate)
              : "待官方通知"
          }
          meta={
            primaryGoal.version.timeline.writtenExamDate ? "已公布" : "未公布"
          }
        >
          <Link href="/study" className="text-xs text-brand hover:underline">
            安排备考
          </Link>
        </MetricCell>
      </section>

      {/* 官方报名入口：只跳验证过的地址，不在站内伪造报名成功 */}
      <section className="grid gap-3 p-5 rounded-lg border border-line bg-surface shadow-1">
        <div>
          <h2 className="text-base font-semibold text-ink">报名在哪里完成</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            我们帮助你核对资格、准备材料和记录进展，不代报名、不收取费用。
          </p>
        </div>
        <Callout variant="note" title="报名只能在官方系统完成">
          点击下方按钮会跳往经过验证的官方地址；返回后可主动确认「我已报名」，我们会记录时间。
        </Callout>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setOfficialModal(primaryGoal)}
            disabled={!safeOfficialLink(primaryGoal.announcement.officialUrl)}
          >
            查看官方报名入口 ↗
          </Button>
          <Link
            href={`/opportunities/${primaryGoal.unitId}`}
            className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium text-ink border border-line hover:bg-surface-2 transition-colors"
          >
            核对资格依据
          </Link>
        </div>
        {!safeOfficialLink(primaryGoal.announcement.officialUrl) && (
          <p className="text-xs text-warn">
            官方报名入口需要用户确认：演示机会或未验证地址不会自动跳转，请以当地教育局或人社局官网为准。
          </p>
        )}
      </section>

      {/* 主目标状态历史 Timeline */}
      {primaryFollow && primaryFollow.statusHistory.length > 0 && (
        <section className="grid gap-3 p-5 rounded-lg border border-line bg-surface shadow-1">
          <div>
            <h2 className="text-base font-semibold text-ink">我的状态记录</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              每次状态变化都会保留历史，不会丢失。
            </p>
          </div>
          <Timeline items={buildTimelineItems(primaryFollow)} />
        </section>
      )}

      {/* 全部报考目标 */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-ink">全部报考目标</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            正在跟进 {activeCount} 个目标{waitingCount > 0 ? ` · ${waitingCount} 个等待官方结果` : ""}
          </p>
        </div>
        <div className="grid gap-3">
          {merged.map(({ goal, follow }) => (
            <ApplicationTargetCard
              key={goal.unitId}
              unitName={goal.unitName}
              position={`${goal.region.province}${goal.region.city ? " " + goal.region.city : ""} · ${stageSubjectLabel(goal.stage, goal.subject)}`}
              isPrimary={goal.unitId === primaryGoal.unitId}
              statusLabel={FOLLOW_STATUS_LABELS[follow?.status ?? goal.followStatus]}
              statusVariant={statusVariantFor(follow?.status ?? goal.followStatus)}
              deadline={goal.version.timeline.registrationEnd}
              materials={
                follow?.materialStatuses
                  ? {
                      done: countDone(follow.materialStatuses),
                      total: countTotal(follow.materialStatuses),
                    }
                  : undefined
              }
              officialUrl={safeOfficialLink(goal.announcement.officialUrl) ?? undefined}
              officialUrlLabel="前往官方报名"
              needsUserConfirm={
                (follow?.status ?? goal.followStatus) === "preparing" &&
                !safeOfficialLink(goal.announcement.officialUrl)
              }
              note={
                follow?.newerVersion
                  ? "公告版本已更新，请前往详情核对考试内容"
                  : undefined
              }
              updatedAt={follow?.followedAt ? formatIsoDate(follow.followedAt) : undefined}
              actions={
                <>
                  <Link
                    href={`/opportunities/${goal.unitId}`}
                    className="inline-flex items-center px-3 py-1.5 rounded-pill text-xs font-medium text-ink border border-line hover:bg-surface-2 transition-colors"
                  >
                    查看进展
                  </Link>
                  {goal.unitId !== primaryGoal.unitId && (
                    <button
                      type="button"
                      onClick={() => void handleSetPrimary(goal)}
                      disabled={busy}
                      className="inline-flex items-center px-3 py-1.5 rounded-pill text-xs font-medium text-brand border border-brand/30 hover:bg-brand-soft/40 transition-colors disabled:opacity-50"
                    >
                      设为主目标
                    </button>
                  )}
                  {(follow?.status ?? goal.followStatus) === "preparing" &&
                    safeOfficialLink(goal.announcement.officialUrl) && (
                      <button
                        type="button"
                        onClick={() => setRegisteredConfirm(goal)}
                        disabled={busy}
                        className="inline-flex items-center px-3 py-1.5 rounded-pill text-xs font-medium bg-brand text-on-dark hover:bg-brand-strong transition-colors disabled:opacity-50"
                      >
                        我已报名
                      </button>
                    )}
                </>
              }
              onUnfollow={() => setUnfollowTarget(goal)}
            />
          ))}
        </div>
      </section>

      {/* 取消关注二次确认 */}
      <ConfirmModal
        isOpen={unfollowTarget !== null}
        title="取消关注这个机会？"
        description={
          unfollowTarget
            ? `取消后《${unfollowTarget.unitName}》将不再出现在报考中心。已保存的材料进度与状态历史会保留在服务端，重新关注后仍可继续。`
            : ""
        }
        confirmLabel="取消关注"
        cancelLabel="先留着"
        variant="danger"
        onConfirm={() => {
          if (!unfollowTarget) return;
          void handleUnfollow(unfollowTarget);
        }}
        onClose={() => setUnfollowTarget(null)}
      />

      {/* 官方报名入口确认弹窗 */}
      <ConfirmModal
        isOpen={officialModal !== null}
        title="即将前往官方报名系统"
        description={
          officialModal
            ? `你将离开本站，前往：${safeOfficialLink(officialModal.announcement.officialUrl) ?? "（未验证地址）"}。我们不在站内代你完成报名，报名结果以官方系统为准。返回后可主动确认「我已报名」。`
            : ""
        }
        confirmLabel="前往官方系统"
        cancelLabel="先准备材料"
        onConfirm={() => {
          if (!officialModal) return;
          const url = safeOfficialLink(officialModal.announcement.officialUrl);
          if (url) {
            window.open(url, "_blank", "noopener,noreferrer");
            track("register_entry_opened", "opportunity", {
              targetId: officialModal.unitId,
            });
          }
          setOfficialModal(null);
        }}
        onClose={() => setOfficialModal(null)}
      />

      {/* 「我已报名」二次确认 */}
      <ConfirmModal
        isOpen={registeredConfirm !== null}
        title="确认你已在官方系统完成报名"
        description={
          registeredConfirm
            ? `确认后会将《${registeredConfirm.unitName}》标记为「已报名」并记录当前时间。仅在你已真正完成官方报名时点击；如尚未完成，请先前往官方系统。`
            : ""
        }
        confirmLabel="我已报名"
        cancelLabel="还没报名"
        onConfirm={() => {
          if (!registeredConfirm) return;
          void handleMarkRegistered(registeredConfirm);
        }}
        onClose={() => setRegisteredConfirm(null)}
      />
    </div>
  );

  /** 主目标主行动：根据 nextStep 分发到具体操作 */
  async function runPrimaryAction(goal: GoalDTO) {
    const step = nextStepFor(goal.followStatus, goal);
    if (step.kind === "official") {
      setOfficialModal(goal);
      return;
    }
    if (step.kind === "registered") {
      setRegisteredConfirm(goal);
      return;
    }
    if (step.href) {
      window.location.assign(step.href);
    }
  }

  async function handleUnfollow(goal: GoalDTO) {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await opportunitiesApi.unfollow(goal.unitId);
      track("opportunity_unfollowed", "opportunity", { targetId: goal.unitId });
      setUnfollowTarget(null);
      setActionNotice(`已取消关注《${goal.unitName}》，可在机会列表重新关注。`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "取消关注失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPrimary(goal: GoalDTO) {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await opportunitiesApi.setRole(goal.unitId, "primary");
      track("primary_target_set", "opportunity", { targetId: goal.unitId });
      setActionNotice(`已将《${goal.unitName}》设为主目标。`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "设置主目标失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkRegistered(goal: GoalDTO) {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      // 乐观锁版本：未提供时由后端兜底；VERSION_CONFLICT 时由调用方重拉
      const follow = follows?.find((f) => f.unitId === goal.unitId);
      await opportunitiesApi.transition(goal.unitId, "registered", {
        version: follow?.version,
      });
      track("follow_status_changed", "opportunity", {
        targetId: goal.unitId,
        props: { from: goal.followStatus, to: "registered" },
      });
      setRegisteredConfirm(null);
      setActionNotice("已记录为「已报名」，等待官方审核结果。");
      setReloadKey((k) => k + 1);
    } catch (e) {
      const err = e as Error & { body?: { error?: string } };
      if (err.body?.error === "VERSION_CONFLICT") {
        setActionError("状态已在其他设备更新，已同步最新状态，请重试。");
        setReloadKey((k) => k + 1);
      } else {
        setActionError(err.message || "标记已报名失败");
      }
    } finally {
      setBusy(false);
    }
  }
}

// ===== 子组件与辅助 =====

function MetricCell({
  label,
  value,
  meta,
  children,
}: {
  label: string;
  value: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 p-4 rounded-md bg-surface-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-base font-semibold text-ink break-words">{value}</span>
      {meta && <span className="text-xs text-ink-muted">{meta}</span>}
      {children}
    </div>
  );
}

/** 主目标下一步推导：不引入新状态机，仅基于现有 FollowStatus 与时间字段 */
function nextStepFor(
  status: FollowStatus,
  goal: GoalDTO,
): {
  kind: "supplement" | "prepare" | "official" | "registered" | "wait" | "review" | "done";
  title: string;
  detail: string;
  label: string;
  href?: string;
} {
  const today = new Date().toISOString();
  const deadline = goal.version.timeline.registrationEnd;
  const exam = goal.version.timeline.writtenExamDate;
  switch (status) {
    case "considering":
      return {
        kind: "supplement",
        title: "先核对资格依据",
        detail: "确认条件满足后再开始准备材料",
        label: "查看资格详情",
        href: `/opportunities/${goal.unitId}`,
      };
    case "preparing":
      if (deadline && daysUntil(deadline, today) <= 7) {
        return {
          kind: "official",
          title: "报名临近截止",
          detail: "尽快前往官方系统完成报名",
          label: "前往官方报名",
        };
      }
      return {
        kind: "prepare",
        title: "继续准备报名材料",
        detail: "材料齐备后再前往官方系统报名",
        label: "查看材料清单",
        href: `/opportunities/${goal.unitId}#follow`,
      };
    case "registered":
      return {
        kind: "wait",
        title: "等待官方资格审核",
        detail: "审核结果以官方系统为准",
        label: "查看官方系统",
        href: safeOfficialLink(goal.announcement.officialUrl) ?? `/opportunities/${goal.unitId}`,
      };
    case "waiting_exam":
      return {
        kind: "review",
        title: "等待考试",
        detail: exam
          ? `笔试时间 ${formatIsoDate(exam)}，做好备考安排`
          : "考试时间待官方通知，可先安排备考",
        label: "安排备考",
        href: "/study",
      };
    case "abandoned":
      return {
        kind: "done",
        title: "已放弃这个目标",
        detail: "可在机会列表查看其他机会",
        label: "去看其他机会",
        href: "/opportunities",
      };
    case "closed":
      if (exam && daysUntil(exam, today) >= 0) {
        return {
          kind: "review",
          title: "准备笔试",
          detail: `笔试时间 ${formatIsoDate(exam)}`,
          label: "安排备考",
          href: "/study",
        };
      }
      return {
        kind: "done",
        title: "这个批次已结束",
        detail: "可在机会列表查看新一轮公告",
        label: "去看新机会",
        href: "/opportunities",
      };
  }
}

function statusVariantFor(status: FollowStatus) {
  switch (status) {
    case "considering":
      return "info" as const;
    case "preparing":
      return "primary" as const;
    case "registered":
    case "waiting_exam":
      return "success" as const;
    case "abandoned":
    case "closed":
      return "muted" as const;
  }
}

function countDone(statuses: Record<string, string>): number {
  return Object.values(statuses).filter((s) => s === "done").length;
}

function countTotal(statuses: Record<string, string>): number {
  // not_applicable 不计入总数
  return Object.values(statuses).filter((s) => s !== "not_applicable").length;
}

function buildTimelineItems(follow: FollowDTO): TimelineItem[] {
  // statusHistory 已按时间升序，倒序展示最近的在前
  const reversed = [...follow.statusHistory].reverse();
  return reversed.map((evt, idx) => ({
    title: FOLLOW_STATUS_LABELS[evt.status] ?? evt.status,
    subtitle: evt.note ?? undefined,
    meta: formatIsoDateTime(evt.at),
    status: idx === 0 ? ("now" as const) : ("done" as const),
  }));
}

function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatIsoDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = formatIsoDate(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}
