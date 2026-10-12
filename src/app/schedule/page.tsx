"use client";

import { useEffect } from "react";
import { useSchedule } from "@/lib/schedule/useSchedule";
import { buildScheduleView } from "@/lib/ia/schedule-view";
import { Hero } from "@/components/ia/Hero";
import { Timeline } from "@/components/ia/Timeline";
import { LayerHeading } from "@/components/ia/Layer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { Callout } from "@/components/ui/Callout";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { track, trackView } from "@/lib/analytics/eventService";
import type { ScheduleGroup } from "@/lib/ia/schedule-view";
import type { TimelineEventDTO } from "@/lib/schedule/types";

/**
 * v7.1 M9：日程页行为追踪组件（隐藏渲染）。
 * - 时间冲突曝光：有冲突时 trackView 幂等记一次
 * - 公告改期通知查看：有 changedFromPrevious 的事件 trackView 每条记一次
 */
function ScheduleAnalytics({
  conflicts,
  events,
}: {
  conflicts: { dateIso: string; items: { event: TimelineEventDTO }[] }[];
  events: TimelineEventDTO[];
}) {
  useEffect(() => {
    if (conflicts.length > 0) {
      trackView("schedule_conflicts", "schedule_conflict_viewed", "schedule", {
        props: { conflictCount: conflicts.length },
      });
    }
  }, [conflicts.length]);

  useEffect(() => {
    for (const e of events) {
      if (e.changedFromPrevious) {
        trackView(`reschedule_${e.id}`, "announcement_reschedule_viewed", "schedule", {
          props: { nodeKind: e.kind },
        });
      }
    }
  }, [events]);

  return null;
}

export default function SchedulePage() {
  const { state, reload, toggleMute } = useSchedule();
  const online = useOnlineStatus();

  if (state.status === "loading") return <LoadingPage />;

  if (state.status === "error") {
    return (
      <ErrorState
        title={online ? "日程暂时加载失败" : "当前离线，无法加载日程"}
        description={
          online ? state.error : "网络已断开。恢复网络后点击重试，或返回后再打开。"
        }
        onRetry={reload}
      />
    );
  }

  const view = buildScheduleView(state.data.events, state.data.unitTrust);

  // 空态 1：没有关注任何机会——不制造虚假紧迫感
  if (view.groups.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="还没有不能错过的事"
          description="保存机会后，报名开始、截止和笔试等官方节点才会出现在这里。"
          actionLabel="去看看机会"
          actionHref="/opportunities"
        />
      </div>
    );
  }

  // v7.1 M9：日程节点查看——分组展开时记 nodeKind（下一未过期节点的类型）
  const handleGroupToggle = (group: ScheduleGroup, open: boolean) => {
    if (!open) return;
    const nextEvent = group.events.find((e) => !e.past);
    track("schedule_node_viewed", "schedule", {
      props: { nodeKind: (nextEvent ?? group.events[0]).kind },
    });
  };

  // 首屏只突出一个当前最重要的动作：优先行动链 nextAction，其次最近时间线节点
  const nextAction = state.data.nextAction;

  return (
    <div className="mx-auto max-w-2xl space-y-7 pb-2">
      <ScheduleAnalytics conflicts={view.conflicts} events={state.data.events} />
      {!online && (
        <Callout variant="ask" title="当前离线">
          显示的是之前加载的日程，可能不是最新安排。恢复网络后会自动刷新。
        </Callout>
      )}
      {nextAction ? (
        <Hero
          meta="当前最重要的一步"
          conclusion={nextAction.label}
          action={{ label: nextAction.label, href: nextAction.href }}
        >
          <p className="text-sm text-ink-muted">{nextAction.unitName}</p>
        </Hero>
      ) : view.next ? (
        <Hero
          meta="下一件不能错过的事"
          conclusion={`${view.next.groupTitle} · ${view.next.event.kindLabel}`}
          risk={{
            tone: view.next.event.urgency === "must" ? "must" : "info",
            text:
              view.next.event.urgency === "must"
                ? `必须处理：${view.next.event.dateText}，截止后通常无法补报名，请提前准备材料`
                : view.next.event.urgency === "suggest"
                  ? `建议处理：${view.next.event.dateText}，提前安排当天时间`
                  : `${view.next.event.dateText}`,
          }}
          action={
            view.next.event.action
              ? {
                  label: view.next.event.action.label,
                  href: view.next.event.action.href,
                  external: view.next.event.action.external,
                }
              : undefined
          }
        >
          <p className="text-sm text-ink-muted">
            {view.next.regionText} · {view.next.event.dateText}
          </p>
        </Hero>
      ) : (
        // 空态 2：有关注但近期没有需要行动的节点（时间未定显示“待官方通知”）
        <Hero
          meta="日程结论"
          conclusion="近期没有需要处理的节点"
          risk={{
            tone: "info",
            text: "时间未定的事项会等待官方通知，不会用推测日期催促你。",
          }}
          action={{
            label: "查看已保存机会",
            href: `/opportunities/${view.groups[0]!.unitId}`,
          }}
        />
      )}

      {/* 时间冲突提示：只提示，不替用户自动放弃 */}
      {view.conflicts.length > 0 && (
        <Callout variant="ask" title="时间冲突提醒">
          <ul className="space-y-1.5">
            {view.conflicts.map((c) => (
              <li key={c.dateIso}>
                <span className="font-medium">{c.dateText}</span>：
                {c.items.map((i) => `${i.unitName}·${i.kindLabel}`).join("；")}
                。请自行取舍，系统不会替你放弃任何机会。
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {/* 第二层：按关注机会分组的时间线；不默认展示月历 */}
      <section className="space-y-3">
        <LayerHeading title="完整时间线" count={view.groups.length} />
        <Timeline
          groups={view.groups}
          mutedUnitIds={state.data.mutedUnitIds}
          onToggleMute={toggleMute}
          onGroupToggle={handleGroupToggle}
        />
      </section>
    </div>
  );
}
