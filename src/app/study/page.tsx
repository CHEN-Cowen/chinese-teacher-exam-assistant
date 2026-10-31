"use client";

/**
 * 备考首页（模块 7）：整合“今天”与“本周”。
 *
 * 门禁（不生成伪精确计划）：
 * 1. 未选择主要目标 → 给出明确下一步（去机会页选择），不生成计划；
 * 2. 考试内容未对照官方公告确认（或公告出新版本后未重新确认）→ 只给“核对考试内容”任务；
 * 3. 就绪 → 主要目标桥接为本地目标（tgt-${unitId}），复用现有计划/反馈/重排管线：
 *    第一屏只显示今天最重要的一项任务（做什么/用什么/预计多久/完成标准/为什么先做），
 *    本周其余任务、重排与周复盘在第二层；备选目标仅展示，不自动创建多套计划。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { Callout } from "@/components/ui/Callout";
import { DailyPlanCard } from "@/components/plans/DailyPlanCard";
import { ReplanPanel } from "@/components/plans/ReplanPanel";
import { WeeklyReviewCard } from "@/components/plans/WeeklyReviewCard";
import { QuickFeedbackPanel } from "@/components/plans/QuickFeedbackPanel";
import { ChangeNoticeBanner } from "@/components/governance/ChangeNoticeBanner";
import { useCurrentUser } from "@/lib/auth/AuthContext";
import { goalService } from "@/lib/goals/goalService";
import {
  backupGoalsOf,
  derivedTargetIdOf,
  evaluateStudyGate,
  type ExamContentConfirmation,
} from "@/lib/goals/domain";
import type { GoalDTO, GoalsResponse } from "@/lib/opportunities/api-types";
import {
  examTargetService,
  feedbackService,
  materialService,
  planService,
  replanService,
  resourceService,
} from "@/lib/services";
import { usePlans } from "@/lib/plans/usePlans";
import { setActivePlanTarget } from "@/lib/plans/planStore";
import { useTodayString } from "@/lib/plans/useToday";
import type { NextStepSummary } from "@/lib/plans/replanEngine";
import type { PlanTask, TaskFeedback } from "@/types";
import { formatDateWithWeekday, formatTime, getGreeting } from "@/lib/utils";
import { trackOncePerUser } from "@/lib/analytics/eventService";
import { safeOfficialLink } from "@/lib/links/official";
import { useOnlineStatus, isForbiddenError } from "@/lib/useOnlineStatus";

/** 任务使用的资料/资源名称（与 today 页同口径） */
function sourceNameOf(task: PlanTask): string | null {
  if (task.materialId) {
    return materialService.getById(task.materialId)?.name ?? null;
  }
  if (task.resourceId) {
    return resourceService.getById(task.resourceId)?.title ?? null;
  }
  return null;
}

/** 公共资源的可打开链接（用户自有资料无链接） */
function sourceUrlOf(task: PlanTask): string | null {
  if (task.resourceId) {
    return resourceService.getById(task.resourceId)?.sourceUrl ?? null;
  }
  return null;
}

interface NextStepState {
  summary: NextStepSummary;
  version: number;
}

/** 恢复原安排；失败时静默（反馈与历史仍保留） */
function handleRestoreQuietly(targetId: string, clear: () => void): void {
  try {
    replanService.restoreOriginal(targetId);
    clear();
  } catch {
    // 无可恢复版本等异常：不跳转、不打扰
  }
}

/** 反馈后的“下一步”卡（用户语言，与 today 页一致） */
function NextStepCard({
  state,
  onRestore,
  onDismiss,
}: {
  state: NextStepState;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  return (
    <Card className="bg-success-soft/50 border-success/30">
      <p className="text-xs font-medium text-success">已为你调整</p>
      <p className="text-base font-medium text-ink mt-1">{state.summary.nextStep}</p>
      <p className="text-sm text-ink-muted mt-1">{state.summary.originalHandling}</p>
      <div className="flex items-center gap-4 mt-4">
        <button
          type="button"
          onClick={onRestore}
          className="h-9 px-3 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
        >
          恢复原安排
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-sm text-ink-muted hover:text-ink transition-colors"
        >
          知道了
        </button>
      </div>
    </Card>
  );
}

function TaskDefinition({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-2">
      <dt className="w-20 shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{value}</dd>
    </div>
  );
}

export default function StudyPage() {
  const { status, session } = useCurrentUser();
  const [goals, setGoals] = useState<GoalsResponse | null>(null);
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const online = useOnlineStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmation, setConfirmation] = useState<ExamContentConfirmation | null>(null);

  const userId = session?.userId;

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let cancelled = false;
    goalService
      .fetchGoals()
      .then((res) => {
        if (cancelled) return;
        setGoals(res);
        setGoalsError(null);
        setForbidden(false);
        setConfirmation(goalService.getExamContentConfirmation(userId));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isForbiddenError(e)) {
          setForbidden(true);
          return;
        }
        setGoals(null);
        setGoalsError(e instanceof Error ? e.message : "加载失败，请稍后重试");
      });
    return () => {
      cancelled = true;
    };
  }, [status, userId, reloadKey]);

  const gate = useMemo(
    () =>
      evaluateStudyGate(
        goals?.goals ?? [],
        goals?.primaryTargetUnitId ?? null,
        confirmation,
      ),
    [goals, confirmation],
  );

  if (status === "loading") return <LoadingPage />;

  if (status !== "authenticated" || !userId) {
    return (
      <div className="mx-auto max-w-2xl pb-2">
        <EmptyState
          title="登录后开始备考"
          description="备考首页按你保存的机会生成每日任务，需要先登录。"
          actionLabel="去登录"
          actionHref="/login"
        />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl pb-2">
        <EmptyState
          title="无权限查看备考信息"
          description="登录已过期或当前账号无权访问这些数据。请重新登录后再试。"
          actionLabel="去登录"
          actionHref="/login"
        />
      </div>
    );
  }

  if (goalsError && !goals) {
    return (
      <div className="mx-auto max-w-2xl pb-2">
        <ErrorState
          title={online ? "备考信息暂时加载失败" : "当前离线，无法加载备考信息"}
          description={
            online ? goalsError : "网络已断开。恢复网络后点击重试，或返回后再打开。"
          }
          onRetry={() => {
            setGoalsError(null);
            setReloadKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  if (!goals) return <LoadingPage />;

  return (
    <div className="mx-auto max-w-2xl space-y-7 pb-2">
      {!online && (
        <Callout variant="ask" title="当前离线">
          显示的是之前生成的备考计划，可能不是最新安排。恢复网络后会自动刷新。
        </Callout>
      )}
      {gate.kind === "no_primary" && <NoPrimaryGate nextStep={gate.nextStep} />}
      {gate.kind === "exam_unverified" && (
        <ExamUnverifiedGate
          goal={gate.goal}
          reason={gate.reason}
          verifyTask={gate.verifyTask}
          onConfirmed={(record) => setConfirmation(record)}
        />
      )}
      {gate.kind === "ready" && (
        <ReadySection
          key={gate.goal.unitId}
          goal={gate.goal}
          warnings={gate.warnings}
          backups={backupGoalsOf(goals.goals, goals.primaryTargetUnitId)}
          userId={userId}
        />
      )}
    </div>
  );
}

/** 门禁一：无主要目标 —— 只给明确下一步，不生成计划 */
function NoPrimaryGate({ nextStep }: { nextStep: string }) {
  return (
    <Card className="overflow-hidden border-brand/15 shadow-2">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <circle cx="12" cy="12" r="8" strokeWidth="2" />
          <circle cx="12" cy="12" r="3" strokeWidth="2" />
          <path strokeLinecap="round" strokeWidth="2" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
        </svg>
      </div>
      <p className="mt-5 text-xs font-semibold tracking-wide text-brand">备考结论</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        先选择一个重点准备的机会
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{nextStep}</p>
      <Link
        href="/opportunities"
        className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(57,115,230,0.2)] transition-colors hover:bg-brand-strong"
      >
        去选择主要目标
        <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" />
        </svg>
      </Link>
      <p className="mt-3 text-center text-xs text-ink-muted">
        选定前不会生成计划，其他已保存机会仍会保留
      </p>
    </Card>
  );
}

/** 门禁二：考试内容未确认 —— 核对任务（做什么/用什么/预计多久/完成标准/为什么先做），确认前不生成计划 */
function ExamUnverifiedGate({
  goal,
  reason,
  verifyTask,
  onConfirmed,
}: {
  goal: GoalDTO;
  reason: "no_confirmation" | "version_changed";
  verifyTask: {
    title: string;
    what: string;
    withWhat: string;
    estimatedMinutes: number;
    doneCriteria: string;
    whyFirst: string;
    url: string;
  };
  onConfirmed: (record: ExamContentConfirmation) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const officialLink = safeOfficialLink(verifyTask.url);

  const handleConfirm = () => {
    setError(null);
    try {
      onConfirmed(goalService.confirmExamContent(goal));
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败，请重试");
    }
  };

  return (
    <Card className="border-brand/20 shadow-2">
        <p className="text-xs font-semibold tracking-wide text-brand">下一步</p>
        {reason === "version_changed" && (
          <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
            该机会的公告已更新为新版本，需要重新核对考试内容后才能继续。
          </p>
        )}
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{verifyTask.title}</h2>
        <p className="text-sm text-ink-muted mt-1">{goal.unitName}</p>
        <dl className="mt-3 divide-y divide-line">
          <TaskDefinition label="做什么" value={verifyTask.what} />
          <TaskDefinition label="用什么" value={verifyTask.withWhat} />
          <TaskDefinition label="预计多久" value={`约 ${verifyTask.estimatedMinutes} 分钟`} />
          <TaskDefinition label="完成标准" value={verifyTask.doneCriteria} />
          <TaskDefinition label="为什么先做" value={verifyTask.whyFirst} />
        </dl>
        <div className="mt-4">
          {officialLink ? (
            <a href={officialLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              先打开官方公告核对
              <span aria-hidden="true">↗</span>
            </a>
          ) : <p className="text-xs text-warn">虚构演示机会，无官方公告链接。</p>}
          <Button className="mt-4 w-full" variant="primary" onClick={handleConfirm}>
            {officialLink ? "我已核对，确认考试内容" : "继续演示：确认示例考情"}
          </Button>
        </div>
        {error && (
          <div role="alert" className="mt-3 p-3 rounded-lg bg-danger-soft border border-danger/30">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}
        <p className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
          确认仅对当前公告版本有效，公告更新后会再次提醒
        </p>
    </Card>
  );
}

/** 就绪：第一屏只显示今天最重要的一项任务；本周其余任务在第二层 */
function ReadySection({
  goal,
  warnings,
  backups,
  userId,
}: {
  goal: GoalDTO;
  warnings: string[];
  backups: GoalDTO[];
  userId: string;
}) {
  const targetId = derivedTargetIdOf(goal.unitId);
  const { currentPlan, dailyPlans, versions } = usePlans(targetId);
  const todayStr = useTodayString();
  const [nextStep, setNextStep] = useState<NextStepState | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // invited 模式：从服务端加载该目标的计划快照后再渲染，避免读到空/伪造数据
  const [loadedTargetId, setLoadedTargetId] = useState<string | null>(null);

  // 主要目标桥接：upsert 进本地目标库并设为当前（稳定 id，旧目标保留为历史）。
  // 同一机会 + 同一公告版本只同步一次，避免每次渲染重复写库。
  const syncedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${goal.unitId}:${goal.version.id}:${userId}`;
    if (syncedKeyRef.current === key) return;
    syncedKeyRef.current = key;
    goalService.syncPrimaryTarget(goal);
  }, [goal, userId]);

  // invited 模式加载服务端计划快照
  useEffect(() => {
    let cancelled = false;
    setActivePlanTarget(targetId)
      .then(() => {
        if (!cancelled) setLoadedTargetId(targetId);
      })
      .catch(() => {
        if (!cancelled) setLoadedTargetId(targetId);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const plansLoaded = loadedTargetId === targetId;

  const readiness = examTargetService.getById(targetId)
    ? planService.getReadiness(targetId)
    : null;
  const activePlan = versions.find((v) => v.status === "active") ?? null;

  // 反馈在渲染时直接读取：usePlans 已订阅 feedbackService，提交后自动重渲染
  const currentTaskIds = useMemo(
    () => new Set(dailyPlans.flatMap((d) => d.tasks.map((t) => t.id))),
    [dailyPlans],
  );
  const feedbacks = feedbackService
    .listByDate(todayStr)
    .filter((f) => currentTaskIds.has(f.taskId));
  const feedbackByTask = new Map(feedbacks.map((f) => [f.taskId, f]));

  const todayPlan = useMemo(
    () => dailyPlans.find((d) => d.date === todayStr) ?? null,
    [dailyPlans, todayStr],
  );

  if (!plansLoaded) {
    return <LoadingPage />;
  }

  const handleGenerate = () => {
    setGenerateError(null);
    try {
      planService.generateDraft(targetId);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "生成失败，请稍后重试");
    }
  };

  const handleConfirmPlan = () => {
    if (currentPlan) planService.confirmPlan(currentPlan.id);
  };

  const handleRegenerate = () => {
    setGenerateError(null);
    try {
      planService.regenerate(targetId);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "重新生成失败");
    }
  };

  /** 反馈提交后：就地调整并展示下一步（未完成欠账不会全部堆到明天） */
  const handleSubmitted = (status: TaskFeedback["status"]) => {
    if (status === "completed") {
      setNextStep(null);
      return;
    }
    try {
      const adjusted = replanService.applyFeedbackAdjustment(targetId);
      if (adjusted?.summary) {
        setNextStep({ summary: adjusted.summary, version: adjusted.version });
      }
    } catch {
      // 反馈已保存；即时调整失败不阻塞用户继续操作
    }
  };

  /**
   * P0 漏斗⑧：开始第一项学习任务（同一用户只记一次）。
   * 不新增交互：以用户对今日首任务的第一个真实动作计——打开任务资料入口，
   * 或直接提交执行反馈（无资料入口的任务由此覆盖）。
   */
  const recordTaskStarted = (
    task: PlanTask,
    via: "open_source" | "feedback",
  ): void => {
    trackOncePerUser("task_started", "plan", {
      targetId: goal.unitId,
      props: {
        planId: currentPlan?.id ?? "",
        taskIndex: task.order,
        via,
      },
    });
  };

  /** “明天能学多久”：更新基线，后续任务总时长按它安排 */
  const handleAvailableTimeChange = (minutes: number) => {
    const baseline = materialService.getBaseline(targetId);
    if (!baseline) return;
    materialService.saveBaseline({
      ...baseline,
      dailyAvailableMinutes: minutes,
      weeklyAvailableHours: Math.round((minutes * 7) / 60),
      updatedAt: new Date().toISOString(),
    });
  };

  const planEnded = currentPlan && currentPlan.status === "active" && todayStr > currentPlan.endDate;
  const review = planEnded ? replanService.getLatestReview(targetId) : null;

  // ===== 第一屏内容分支 =====
  let firstScreen: ReactNode;
  if (!currentPlan) {
    firstScreen = readiness && !readiness.ready ? (
      <Card className="rounded-xl">
        <CardHeader
          title="还差一点，暂时不能生成计划"
          description="先补全下面的信息"
        />
        <ul className="space-y-2 mt-2">
          {readiness.missing.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink">
              <span className="text-danger mt-0.5">●</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Link
            href="/materials"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            去补全资料
          </Link>
        </div>
      </Card>
    ) : (
      <Card className="border-brand/15 shadow-2">
        <p className="text-xs font-semibold tracking-wide text-brand">备考结论</p>
        <CardHeader
          title="可以开始安排这 7 天了"
          description={`主要目标：${goal.unitName}`}
        />
        <p className="text-sm text-ink-muted mt-2">
          按考试内容、已有资料和可用时间生成草稿，确认后开始执行。
        </p>
        {readiness?.warnings && readiness.warnings.length > 0 && (
          <Callout variant="ask" title="生成计划前请留意">
            {readiness.warnings.map((w, i) => (
              <p key={i}>• {w}</p>
            ))}
          </Callout>
        )}
        {generateError && (
          <Callout variant="no" title="生成失败">
            {generateError}
          </Callout>
        )}
        <Button className="mt-4 w-full" onClick={handleGenerate}>
          生成我的 7 天计划
        </Button>
      </Card>
    );
  } else if (currentPlan.status === "draft") {
    firstScreen = (
      <Card className="border-brand/20">
        <p className="mb-2 text-xs font-semibold tracking-wide text-brand">下一步</p>
        <CardHeader
          title="计划草稿待确认"
          description={`${currentPlan.startDate} 至 ${currentPlan.endDate} · 只覆盖 7 天`}
          action={<Badge variant="warning">草稿 · v{currentPlan.version}</Badge>}
        />
        <p className="text-sm text-ink-muted mt-1">{currentPlan.generationReason}</p>
        {generateError && (
          <Callout variant="no" title="重新生成失败">
            {generateError}
          </Callout>
        )}
        <div className="mt-4 space-y-2">
          <Button className="w-full" variant="primary" onClick={handleConfirmPlan}>
            确认计划，开始执行
          </Button>
          <Button className="w-full" variant="ghost" onClick={handleRegenerate}>
            重新生成草稿
          </Button>
        </div>
      </Card>
    );
  } else if (planEnded) {
    firstScreen = (
      <Card className="text-center py-8">
        <p className="text-xs font-semibold tracking-wide text-success">本周结论</p>
        <h2 className="text-xl font-bold text-ink">这 7 天的安排结束了</h2>
        <p className="text-sm text-ink-muted mt-2">
          {formatDateWithWeekday(currentPlan.startDate)} — {formatDateWithWeekday(currentPlan.endDate)}
        </p>
        <Button className="mt-5 w-full" onClick={handleGenerate}>
          安排下一个 7 天
        </Button>
      </Card>
    );
  } else if (!todayPlan || todayPlan.tasks.length === 0) {
    firstScreen = nextStep ? (
      <NextStepCard
        state={nextStep}
        onRestore={() => handleRestoreQuietly(targetId, () => setNextStep(null))}
        onDismiss={() => setNextStep(null)}
      />
    ) : (
      <Card className="text-center py-8">
        <p className="text-xs font-semibold tracking-wide text-brand">今日结论</p>
        <h2 className="text-xl font-bold text-ink">今天没有安排任务</h2>
        <p className="text-sm text-ink-muted mt-2">
          当前安排从 {currentPlan.startDate} 开始，今天可以休息或自由复习。
        </p>
      </Card>
    );
  } else {
    // 正常执行：只突出第一项未完成任务
    const sortedTasks = [...todayPlan.tasks].sort((a, b) => a.order - b.order);
    const pendingTasks = sortedTasks.filter(
      (t) => feedbackByTask.get(t.id)?.status !== "completed",
    );
    const doneCount = sortedTasks.length - pendingTasks.length;
    const totalActual = feedbacks.reduce((sum, f) => sum + (f.actualTime ?? 0), 0);

    if (pendingTasks.length === 0) {
      firstScreen = (
        <Card className="text-center py-8">
          <p className="text-xs font-semibold tracking-wide text-success">今日结论</p>
          <h2 className="text-xl font-bold text-ink">今天的任务都完成了</h2>
          <p className="text-sm text-ink-muted mt-2">
            共 {sortedTasks.length} 项
            {totalActual > 0 && ` · 实际用时约 ${formatTime(totalActual)}`}
          </p>
        </Card>
      );
    } else {
      const currentTask = pendingTasks[0];
      const source = sourceNameOf(currentTask);
      const sourceUrl = sourceUrlOf(currentTask);
      const blocked = currentTask.executable === false;
      firstScreen = (
        <Card className="border-brand/20 shadow-2">
          <p className="text-xs font-semibold tracking-wide text-brand">今天先做这一项</p>
          {todayPlan.isMinimumViable && (
            <div className="mt-2"><Badge variant="warning">今天时间少，完成这一项就好</Badge></div>
          )}
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{currentTask.title}</h2>
          <p className="text-xs text-ink-muted mt-1">
            {getGreeting()} · 约 {formatTime(currentTask.estimatedTime)} · 已完成 {doneCount}/{sortedTasks.length} 项
          </p>

          {blocked && (
            <Callout variant="ask" title="这项任务暂不可执行">
              {currentTask.blockedReason ?? "资料入口缺失"}
            </Callout>
          )}

          <dl className="mt-3 divide-y divide-line border-y border-line">
            <TaskDefinition
              label="用什么"
              value={
                source
                  ? sourceUrl
                    ? `${source}（点击打开）`
                    : source
                  : "暂无可打开的资料入口"
              }
            />
            <TaskDefinition label="完成标准" value={currentTask.completionCriteria} />
            <TaskDefinition label="为什么先做" value={currentTask.arrangementReason} />
          </dl>
          {source && sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => recordTaskStarted(currentTask, "open_source")}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(57,115,230,0.2)] transition-colors hover:bg-brand-strong"
            >
              开始任务
              <span aria-hidden="true">↗</span>
            </a>
          )}

          {sourceUrl ? (
            <details className="group mt-4 rounded-xl border border-line bg-canvas/60">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                完成后反馈进度
                <span className="text-ink-muted transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <div className="border-t border-line p-3">
                <QuickFeedbackPanel
                  key={currentTask.id}
                  task={currentTask}
                  onSubmitted={(status) => {
                    recordTaskStarted(currentTask, "feedback");
                    handleSubmitted(status);
                  }}
                  onAvailableTimeChange={handleAvailableTimeChange}
                />
              </div>
            </details>
          ) : (
            <div className="mt-5">
              <p className="mb-2 text-xs text-ink-muted">反馈当前进度</p>
              <QuickFeedbackPanel
                key={currentTask.id}
                task={currentTask}
                onSubmitted={(status) => {
                  recordTaskStarted(currentTask, "feedback");
                  handleSubmitted(status);
                }}
                onAvailableTimeChange={handleAvailableTimeChange}
              />
            </div>
          )}
        </Card>
      );
    }
  }

  return (
    <>
      {/* 目标条：主要目标 + 软警告 */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">重点准备</p>
            <p className="truncate text-sm font-semibold text-ink">{goal.unitName}</p>
          </div>
          <Link
            href={`/opportunities/${goal.unitId}`}
            className="shrink-0 text-xs text-brand hover:underline"
          >
            查看机会详情
          </Link>
        </div>
        {warnings.map((w, i) => (
          <p key={i} className="mt-2 text-xs text-warn">⚠ {w}</p>
        ))}
      </div>

      <ChangeNoticeBanner types={["plan_reconfirm", "exam_change"]} />

      {/* ===== 第一屏：今天最重要的一项任务 ===== */}
      <section aria-label="今天">{firstScreen}</section>

      {/* ===== 第二层：本周其余任务、重排与复盘 ===== */}
      <details aria-label="本周" className="group rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold text-ink">查看本周安排</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {currentPlan ? `${currentPlan.startDate} 至 ${currentPlan.endDate}` : "生成计划后显示"}
            </span>
          </span>
          <svg aria-hidden="true" className="h-4 w-4 text-ink-muted transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="space-y-3 border-t border-line p-4">

        {nextStep && (todayPlan?.tasks.length ?? 0) > 0 && (
          <NextStepCard
            state={nextStep}
            onRestore={() => handleRestoreQuietly(targetId, () => setNextStep(null))}
            onDismiss={() => setNextStep(null)}
          />
        )}

        {currentPlan && (currentPlan.status === "active" || currentPlan.status === "draft") && (
          <>
            <div className="space-y-3">
              {dailyPlans.map((day) => (
                <DailyPlanCard
                  key={day.id}
                  plan={day}
                  onAdjustTime={(dailyPlanId, minutes) =>
                    planService.adjustDailyTime(dailyPlanId, minutes)
                  }
                />
              ))}
            </div>

            {activePlan && <ReplanPanel targetId={targetId} activePlan={activePlan} />}

            {planEnded && (
              <Card>
                <CardHeader
                  title="第 7 天周复盘"
                  description="完成情况与下周建议（仅统计真实提交的反馈）"
                  action={
                    <Button
                      variant={review ? "outline" : "primary"}
                      size="sm"
                      onClick={() => {
                        try {
                          replanService.generateReview(targetId);
                        } catch {
                          // 复盘数据不足等异常不阻塞页面
                        }
                      }}
                    >
                      {review ? "重新生成复盘" : "生成周复盘"}
                    </Button>
                  }
                />
                {review && <WeeklyReviewCard review={review} />}
              </Card>
            )}
          </>
        )}

        {todayPlan?.adjustmentNote && (
          <Card className="bg-warn-soft/50">
            <p className="text-sm text-warn">
              <span className="font-medium">安排有调整：</span>
              {todayPlan.adjustmentNote}
            </p>
          </Card>
        )}

        {/* 备选目标：继续作为备选，不自动创建多套计划 */}
        <Card>
          <CardHeader
            title="备选目标"
            description="其他已保存机会继续保留为备选，不会自动创建计划"
          />
          {backups.length === 0 ? (
            <p className="text-sm text-ink-muted">还没有备选目标。</p>
          ) : (
            <ul className="space-y-2">
              {backups.map((b) => (
                <li key={b.unitId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-ink">{b.unitName}</span>
                  <Link
                    href={`/opportunities/${b.unitId}`}
                    className="shrink-0 text-xs text-brand hover:underline"
                  >
                    查看
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
      </details>
    </>
  );
}
