"use client";

import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";
import {
  deadlineText,
  natureShortLabel,
  regionLabel,
  stageSubjectLabel,
} from "@/lib/ia/labels";
import { GateTag, MatchStatusTag } from "@/components/ia/MatchStatusTag";
import { primaryFailedGate } from "@/lib/gate-states";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";
import { listCardNextStepLabel } from "@/lib/opportunities/list-view";
import { schoolDisplayText } from "@/lib/opportunities/school-placement";
import {
  buildMapEntry,
  MAP_LINK_LABEL,
  MAP_LINK_PROPS,
} from "@/lib/opportunities/map-link";
import {
  FOLLOW_STATUS_LABELS,
  STUDY_TARGET_ROLE_LABELS,
} from "@/lib/opportunities";
import { ConditionRows } from "./ConditionRows";

/**
 * 卡片视觉变体（v7.2）：
 * - priority：资格与偏好都匹配，主推荐视觉（brand ring）；
 * - supplement：补充后判断（unknown 缺信息 / consult 建议向招聘单位确认），中性视觉；
 * - outOfScope：偏好范围外（仅地区不重叠），安静弱边框，不用红色不用「不符合」；
 * - excluded：留档区（截止/来源失效/明确不符合），由折叠区按 closedBuckets 渲染。
 */
export type OpportunityCardVariant =
  | "priority"
  | "supplement"
  | "outOfScope"
  | "excluded";

export interface OpportunityListItemProps {
  unit: UnitMatchDTO;
  /** 评估时间（截止文案的参照时间，由后端 meta.evaluatedAt 提供） */
  evaluatedAt: string;
  /** 卡片视觉变体（由 WorkbenchTabs 按 classifyOpportunity 桶决定） */
  variant?: OpportunityCardVariant;
  /** 次级结果使用紧凑卡片，只保留决策所需信息。 */
  compact?: boolean;
  defaultExpanded?: boolean;
  /** 保存/移除（卡片上的快捷操作）；缺省时只展示保存状态 */
  onToggleFollow?: (unit: UnitMatchDTO) => void;
  followBusy?: boolean;
  /** @deprecated v7.2 用 variant=outOfScope 替代；留档区旧调用仍兼容 */
  regionOutOfScope?: boolean;
}

/**
 * 登录态机会列表卡片（v7.2 §7.4 七层结构）。
 * 移动端固定顺序：状态 → 岗位 → 地点 → 事实 → 判断 → 操作。
 * 桌面 1024+ 双区布局：左区（岗位事实 2-4 层）7 栏 + 右区（判断 5-6 层）5 栏，
 * 第 1 层和第 7 层跨满宽。
 *
 * 主行动是「查看官方依据」（Link 到详情，primary 填充）+ 「保存机会」（button outline），
 * 两按钮同高 h-11、同圆角 rounded-xl、同基线，loading/成功/错误尺寸稳定。
 */
export function OpportunityListItem({
  unit,
  evaluatedAt,
  variant = "excluded",
  compact = false,
  defaultExpanded = false,
  onToggleFollow,
  followBusy = false,
  regionOutOfScope = false,
}: OpportunityListItemProps) {
  const panelId = useId();
  const closedGate = primaryFailedGate(unit.gates);
  const deadline = deadlineText(
    unit.version.timeline.registrationEnd,
    evaluatedAt,
  );
  const follow = unit.follow;

  // 兼容旧 regionOutOfScope 布尔：若调用方仍传 true，视为 outOfScope 变体
  const effectiveVariant: OpportunityCardVariant =
    regionOutOfScope && variant === "excluded" ? "outOfScope" : variant;

  const isPriority = effectiveVariant === "priority";
  const isOutOfScope = effectiveVariant === "outOfScope";
  const isSupplement = effectiveVariant === "supplement";
  const isConsult = isSupplement && unit.overall === "manual_review";

  // 地图入口：有明确城市才显示，无城市时返回 null 不渲染入口
  const mapEntry = buildMapEntry({
    city: unit.unit.region.city,
    district: unit.unit.region.district,
    schoolPlacement: unit.unit.schoolPlacement,
  });
  const locationText = regionLabel(unit.unit.region);

  // 已通过条件数 + 一个待确认风险（从 dimensions 统计）
  const passedCount = unit.dimensions.filter((d) => d.value === "PASS").length;
  const pendingRisk = unit.dimensions.find(
    (d) => d.value === "UNKNOWN" || d.value === "MANUAL_REVIEW",
  );

  return (
    <article
      data-testid={`opportunity-card-${unit.unit.id}`}
      data-variant={effectiveVariant}
      className={cn(
        "rounded-xl border bg-surface",
        isPriority
          ? "border-brand ring-1 ring-brand-soft"
          : isOutOfScope
            ? "border-line bg-surface"
            : "border-line",
      )}
    >
      <div className="p-4">
        <div className="lg:grid lg:grid-cols-12 lg:gap-4">
          {/* 第 1 层：真实/演示标签 + 截止紧迫度（跨满宽） */}
          <div className="lg:col-span-12">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                data-testid="dataset-tag"
              >
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
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  deadline.closed ? "text-ink-muted" : "text-ink",
                )}
                data-testid="deadline-text"
              >
                报名{deadline.text}
              </span>
            </div>
          </div>

          {/* 左区：岗位事实（第 2-4 层）—— 桌面 7 栏 */}
          <div className="mt-3 space-y-2 lg:col-span-7 lg:mt-0">
            {/* 第 2 层：学校 + 岗位名 */}
            <Link
              href={`/opportunities/${unit.unit.id}`}
              className="block min-w-0 rounded text-sm font-semibold text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <span className="break-words">{unit.unit.name}</span>
            </Link>
            <p className="text-xs text-ink-muted" data-testid="school-placement">
              任教学校：
              {schoolDisplayText(unit.unit, locationText)}
            </p>

            {/* 第 3 层：省市区 + 地图入口（地点明确时才显示入口） */}
            <p
              className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted"
              data-testid="location-row"
            >
              <span>{locationText}</span>
              {mapEntry && (
                <a
                  href={mapEntry.url}
                  {...MAP_LINK_PROPS}
                  className="font-medium text-brand hover:text-brand-strong"
                  data-testid="map-link"
                >
                  {MAP_LINK_LABEL}
                </a>
              )}
            </p>

            {/* 第 4 层：用工形式 / 学段学科 / 招聘人数 */}
            <p className="text-xs text-ink-muted">
              {natureShortLabel(unit.unit.employmentNature.code as never)} ·{" "}
              {stageSubjectLabel(unit.unit.stage, unit.unit.subject)} · 招{" "}
              {unit.unit.headcount} 人
            </p>
          </div>

          {/* 右区：资格判断（第 5-6 层）—— 桌面 5 栏 */}
          <div className="mt-3 space-y-2 lg:col-span-5 lg:mt-0">
            {/* 第 5 层：已通过条件数 + 一个待确认风险，或咨询态文案 */}
            {isConsult ? (
              <div data-testid="consult-hint">
                <p className="text-sm font-medium text-warn">
                  建议向招聘单位确认
                </p>
                {unit.consultationTemplates?.[0]?.question && (
                  <p className="mt-1 text-xs leading-5 text-ink-muted">
                    {unit.consultationTemplates[0].question}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-muted" data-testid="conditions-summary">
                已通过 {passedCount} 项条件
                {pendingRisk ? `，待确认：${pendingRisk.reason}` : ""}
              </p>
            )}

            {/* 状态标签 */}
            <div className="flex items-center gap-2">
              {closedGate ? (
                <GateTag code={closedGate.code} />
              ) : isOutOfScope ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-muted text-[10px] font-bold text-white"
                  >
                    ◌
                  </span>
                  偏好范围外
                </span>
              ) : (
                <MatchStatusTag status={unit.overall} />
              )}
            </div>

            {/* 第 6 层：关键提醒（unit.summary 或闸门原因） */}
            <p
              className={cn(
                "text-sm leading-6",
                closedGate ? "font-medium text-danger" : "text-ink-muted",
              )}
              data-testid="summary-text"
            >
              {closedGate ? closedGate.reason : unit.summary}
            </p>
          </div>

          {/* 第 7 层：官方依据 + 保存（跨满宽，两按钮同高同圆角同基线） */}
          <div className="mt-3 lg:col-span-12 lg:mt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <Link
                href={`/opportunities/${unit.unit.id}`}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-1 transition hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                data-testid="view-evidence-button"
              >
                {isConsult ? "查看需要确认的问题" : listCardNextStepLabel(unit)}
              </Link>
              {onToggleFollow && (
                <button
                  type="button"
                  onClick={() => onToggleFollow(unit)}
                  disabled={followBusy}
                  aria-busy={followBusy || undefined}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition hover:border-brand/30 hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
                  data-testid="save-button"
                >
                  {followBusy ? "处理中…" : follow ? "移除保存" : "保存机会"}
                </button>
              )}
            </div>
          </div>
        </div>

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
            {/* v7.2：保存后的下一步只在详情页按五级规则计算，卡片只给入口 */}
            {follow.status === "considering" && (
              <Link
                href={`/opportunities/${unit.unit.id}#follow`}
                className="font-medium text-brand underline underline-offset-2 hover:text-brand-strong"
                data-testid="saved-next-step-link"
              >
                去看下一步 →
              </Link>
            )}
          </p>
        )}

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
      </div>

      {!compact && defaultExpanded && (
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
