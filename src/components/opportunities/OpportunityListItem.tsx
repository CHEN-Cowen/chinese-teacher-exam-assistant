"use client";

import Link from "next/link";
import { useId } from "react";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";
import { listCardNextStepLabel } from "@/lib/opportunities/list-view";
import { unitMatchToCardView } from "@/lib/results/workbench-view";
import {
  UnifiedOpportunityCard,
  type OpportunityCardCapabilities,
} from "@/components/results/UnifiedOpportunityCard";
import type { ResultsCardVariant } from "@/lib/results/workbench-view";
import {
  FOLLOW_STATUS_LABELS,
  STUDY_TARGET_ROLE_LABELS,
} from "@/lib/opportunities";
import { ConditionRows } from "./ConditionRows";

/**
 * 卡片视觉变体（v7.2）：与 ResultsCardVariant 一致。
 * - priority：资格与偏好都匹配，主推荐视觉（brand ring）；
 * - supplement：补充后判断（unknown 缺信息 / consult 建议向招聘单位确认），中性视觉；
 * - outOfScope：偏好范围外（仅地区不重叠），安静弱边框，不用红色不用「不符合」；
 * - excluded：留档区（截止/来源失效/明确不符合），由折叠区按 closedBuckets 渲染。
 */
export type OpportunityCardVariant = ResultsCardVariant;

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
 * 登录态机会列表卡片（薄适配器）。
 *
 * 七层结构、地图位置、按钮系统与响应式行为全部由 UnifiedOpportunityCard
 * 统一承担（/preview 与 /opportunities 同一份 DOM）；本组件只负责：
 * - UnitMatchDTO → 共享展示模型（unitMatchToCardView）；
 * - 登录能力（查看依据 → 详情页；保存 → onToggleFollow）；
 * - 登录端附加内容：follow 状态行、真实公告官方原文/岗位表附件、
 *   defaultExpanded 的条件核对面板。
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
  const follow = unit.follow;

  // 兼容旧 regionOutOfScope 布尔：若调用方仍传 true，视为 outOfScope 变体
  const effectiveVariant: OpportunityCardVariant =
    regionOutOfScope && variant === "excluded" ? "outOfScope" : variant;

  const vm = unitMatchToCardView(unit, evaluatedAt);
  const isConsult =
    effectiveVariant === "supplement" && unit.overall === "manual_review";

  const capabilities: OpportunityCardCapabilities = {
    canSave: Boolean(onToggleFollow),
    saveLabel: follow ? "移除保存" : "保存机会",
    saveBusy: followBusy,
    onSave: onToggleFollow ? () => onToggleFollow(unit) : undefined,
    evidenceHref: `/opportunities/${unit.unit.id}`,
    evidenceLabel: isConsult
      ? "查看需要确认的问题"
      : listCardNextStepLabel(unit),
  };

  const afterActions = !compact ? (
    <>
      {follow && (
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

      {unit.announcement.dataset === "real" && (
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
    </>
  ) : null;

  const expandedExtra =
    !compact && defaultExpanded ? (
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
    ) : null;

  return (
    <UnifiedOpportunityCard
      vm={vm}
      variant={effectiveVariant}
      capabilities={capabilities}
      afterActions={afterActions}
      expandedExtra={expandedExtra}
    />
  );
}
