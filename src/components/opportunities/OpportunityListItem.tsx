"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import {
  deadlineText,
  natureShortLabel,
  regionLabel,
  stageLabel,
} from "@/lib/ia/labels";
import { GateTag, MatchStatusTag } from "@/components/ia/MatchStatusTag";
import { primaryFailedGate } from "@/lib/gate-states";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";
import { listCardNextStepLabel } from "@/lib/opportunities/list-view";
import { schoolDisplayText } from "@/lib/opportunities/school-placement";
import {
  FOLLOW_STATUS_LABELS,
  STUDY_TARGET_ROLE_LABELS,
} from "@/lib/opportunities";
import { ConditionRows } from "./ConditionRows";

interface OpportunityListItemProps {
  unit: UnitMatchDTO;
  /** 评估时间（截止文案的参照时间，由后端 meta.evaluatedAt 提供） */
  evaluatedAt: string;
  priority?: boolean;
  /** 次级结果使用紧凑卡片，只保留决策所需信息。 */
  compact?: boolean;
  defaultExpanded?: boolean;
  /** 保存/移除（卡片上的快捷操作）；缺省时只展示保存状态 */
  onToggleFollow?: (unit: UnitMatchDTO) => void;
  followBusy?: boolean;
  /**
   * 展示在「岗位地区不在你选择的范围」分区：overall 虽为 not_eligible，
   * 但仅地区偏好不重叠，不能显示红色「明确不符合」标签。
   */
  regionOutOfScope?: boolean;
}

/**
 * 登录态机会列表卡片（模块 5：首层七要素 + 一个下一步）。
 * 主行动始终是「进详情完成下一步」（文案说明进去做什么），
 * 保存与展开条件降为次级文本操作；闸门失败时显示具体异常态名称与原因。
 */
export function OpportunityListItem({
  unit,
  evaluatedAt,
  priority = false,
  compact = false,
  defaultExpanded = false,
  onToggleFollow,
  followBusy = false,
  regionOutOfScope = false,
}: OpportunityListItemProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const closedGate = primaryFailedGate(unit.gates);
  const deadline = deadlineText(
    unit.version.timeline.registrationEnd,
    evaluatedAt,
  );
  const follow = unit.follow;

  return (
    <article
      className={cn(
        "rounded-xl border bg-surface",
        priority ? "border-brand ring-1 ring-brand-soft" : "border-line",
      )}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/opportunities/${unit.unit.id}`}
            className="min-w-0 rounded text-sm font-semibold text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="font-normal text-ink-muted">
              {regionLabel(unit.unit.region)}
            </span>
            <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
              |
            </span>
            <span className="break-words">{unit.unit.name}</span>
          </Link>
          {closedGate ? (
            <GateTag code={closedGate.code} />
          ) : regionOutOfScope ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-muted">
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-muted text-[10px] font-bold text-white"
              >
                ◌
              </span>
              地区不在选择范围
            </span>
          ) : (
            <MatchStatusTag status={unit.overall} />
          )}
        </div>

        {/* 真实/演示明确区分：演示固定显示"虚构试用示例"，真实展示来源与核对状态 */}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {unit.announcement.dataset === "demo" ? (
            <span className="inline-flex items-center rounded-full bg-canvas px-2 py-0.5 font-medium text-ink-muted ring-1 ring-line">
              虚构试用示例
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">
              {unit.announcement.reviewStatus === "human_reviewed"
                ? "真实公告 · 已人工核对"
                : "真实记录 · AI 初核待人工复核"}
            </span>
          )}
          <span className="text-ink-muted">
            {natureShortLabel(unit.unit.employmentNature.code as never)} ·{" "}
            {stageLabel(unit.unit.stage)} · 招 {unit.unit.headcount} 人
          </span>
        </p>

        {/* 任教学校：只有官方逐校列明才显示校名；统一择岗/调配明确显示未知，不虚构学校 */}
        <p className="mt-1 text-xs text-ink-muted" data-testid="school-placement">
          任教学校：{schoolDisplayText(unit.unit)}
        </p>

        <p
          className={cn(
            "mt-1 text-sm",
            closedGate || deadline.closed ? "text-ink-muted" : "text-ink-muted",
          )}
        >
          报名{deadline.text}
        </p>

        {/* 一条关键依据或风险：闸门失败时优先显示异常原因 */}
        <p
          className={cn(
            "mt-2 text-sm leading-6",
            closedGate ? "font-medium text-danger" : "text-ink-muted",
          )}
        >
          {closedGate ? closedGate.reason : unit.summary}
        </p>

        {!compact && unit.announcement.dataset === "real" && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <a
              href={unit.announcement.officialUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand hover:text-brand-strong"
            >
              官方原文 ↗
            </a>
            {unit.unit.sourceRow?.locator.kind === "url" && (
              <a
                href={unit.unit.sourceRow.locator.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand hover:text-brand-strong"
              >
                岗位表附件 ↗
              </a>
            )}
          </p>
        )}

        {!compact && follow && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-ink-muted">
              {FOLLOW_STATUS_LABELS[follow.status]}
            </span>
            {follow.role && (
              <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">
                {follow.role === "primary" ? "★ " : ""}
                {STUDY_TARGET_ROLE_LABELS[follow.role]}
              </span>
            )}
            {follow.newerVersion && (
              <span className="inline-flex items-center rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">
                公告有新版本
              </span>
            )}
          </p>
        )}

        {/* 一个下一步（主样式，进详情完成）+ 保存/展开（次级文本） */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/opportunities/${unit.unit.id}`}
            className={cn(
              "inline-flex items-center justify-center rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
              compact
                ? "py-1 text-brand hover:text-brand-strong"
                : "bg-brand px-3.5 py-2 text-white hover:bg-brand-strong",
            )}
          >
            {listCardNextStepLabel(unit)}
          </Link>
          {!compact && onToggleFollow && (
            <button
              type="button"
              onClick={() => onToggleFollow(unit)}
              disabled={followBusy}
              className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-brand disabled:opacity-50"
            >
              {follow ? "移除保存" : "保存"}
            </button>
          )}
          {!compact && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={panelId}
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              {expanded ? "收起条件核对" : "展开条件核对"}
              <svg
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expanded && "rotate-180",
                )}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!compact && expanded && (
        <div
          id={panelId}
          className="border-t border-line px-4 py-2"
          aria-label="条件核对"
        >
          <ConditionRows dimensions={unit.dimensions} />
          <p className="py-2 text-[11px] text-ink-muted">
            完整依据、官方原文与版本信息见详情页。
          </p>
        </div>
      )}
    </article>
  );
}
