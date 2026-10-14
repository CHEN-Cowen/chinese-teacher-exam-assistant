"use client";

import Link from "next/link";
import { track } from "@/lib/analytics/eventService";
import { buildConditionItems } from "@/lib/results/condition-summary";
import type { ConditionSource } from "@/lib/results/condition-summary";

interface ResultConditionSummaryProps {
  source: ConditionSource;
  editHref: string;
}

/**
 * 结果页顶部条件摘要条（v7.2 §7.4.2）。
 *
 * 桌面端尽量一行；移动端自然换行，不堆叠大量胶囊标签。
 * 缺失字段不显示 undefined、空字符串或多余分隔符。
 */
export function ResultConditionSummary({
  source,
  editHref,
}: ResultConditionSummaryProps) {
  const items = buildConditionItems(source);
  const summary = items.length > 0 ? items.join(" · ") : "部分信息暂未填写";

  return (
    <div
      data-testid="condition-summary"
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-ink">
        <span className="font-medium text-ink-muted">当前条件：</span>
        <span className="font-medium">{summary}</span>
      </p>
      <Link
        href={editHref}
        onClick={() => {
          track("preview_summary_edited", "profile");
        }}
        className="shrink-0 text-sm font-medium text-brand hover:underline"
      >
        修改
      </Link>
    </div>
  );
}
