"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Badge } from "./Badge";

/**
 * 报考目标卡（v7 原型主目标 + 备选目标）
 *
 * 聚合关注状态、主备选、准备状态、报名状态、材料完成度、关键日期、官方入口。
 * - isPrimary：主目标卡片显著视觉权重；备选目标使用次级样式
 * - 倒计时：基于 deadline 计算；过期显示"已截止"
 * - 材料完成度：done/total 比例 + 文字
 * - 官方入口：仅渲染 officialUrl，不在站内伪造报名成功
 * - 状态来源不明时显示"需要你确认"
 */
interface ApplicationTargetCardProps {
  unitName: string;
  position?: string;
  isPrimary?: boolean;
  statusLabel: string;
  statusVariant?: "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted";
  deadline?: string;
  materials?: { done: number; total: number };
  officialUrl?: string;
  officialUrlLabel?: string;
  needsUserConfirm?: boolean;
  note?: string;
  updatedAt?: string;
  actions?: ReactNode;
  onUnfollow?: () => void;
  className?: string;
}

function formatCountdown(deadline?: string): { text: string; overdue: boolean } | null {
  if (!deadline) return null;
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return null;
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return { text: "已截止", overdue: true };
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days > 1) return { text: `剩 ${days} 天`, overdue: false };
  const hours = Math.ceil(diff / (60 * 60 * 1000));
  return { text: `剩 ${hours} 小时`, overdue: false };
}

export function ApplicationTargetCard({
  unitName,
  position,
  isPrimary,
  statusLabel,
  statusVariant = "default",
  deadline,
  materials,
  officialUrl,
  officialUrlLabel = "前往官方报名",
  needsUserConfirm,
  note,
  updatedAt,
  actions,
  onUnfollow,
  className,
}: ApplicationTargetCardProps) {
  const countdown = formatCountdown(deadline);
  return (
    <article
      className={cn(
        "grid gap-3 p-5 rounded-lg border bg-surface",
        isPrimary
          ? "border-brand shadow-2 ring-1 ring-brand/20"
          : "border-line shadow-1",
        className
      )}
      aria-label={isPrimary ? "主目标" : "备选目标"}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isPrimary && (
              <span className="inline-flex h-6 items-center rounded px-2 bg-brand text-on-dark text-xs font-semibold">
                主目标
              </span>
            )}
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </div>
          <h3 className="mt-1.5 text-base font-bold text-ink break-words">{unitName}</h3>
          {position && (
            <p className="mt-0.5 text-sm text-ink-muted break-words">{position}</p>
          )}
        </div>
        {countdown && (
          <div
            className={cn(
              "inline-flex h-6 items-center rounded px-2.5 text-xs font-semibold border",
              countdown.overdue
                ? "bg-no-bg border-no-line text-no-ink"
                : "bg-ask-bg border-ask-line text-ask-ink"
            )}
          >
            {countdown.text}
          </div>
        )}
      </header>

      {(materials || officialUrl) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {materials && (
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">材料</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-pill bg-grey-bg overflow-hidden">
                  <div
                    className="h-full bg-ok-ink transition-all"
                    style={{
                      width: `${materials.total === 0 ? 0 : Math.min(100, (materials.done / materials.total) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-ink-muted">
                  {materials.done}/{materials.total}
                </span>
              </div>
            </div>
          )}
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-3 bg-brand text-on-dark text-xs font-semibold hover:bg-brand-strong transition-colors"
            >
              {officialUrlLabel}
              <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
      )}

      {needsUserConfirm && (
        <p className="text-xs text-warn bg-warn-soft border border-warn/30 rounded-sm px-2.5 py-1.5">
          官方发生的状态无法自动确认，需要你确认。
        </p>
      )}

      {note && (
        <p className="text-sm text-ink-muted leading-relaxed">
          <span className="font-semibold text-ink-2">备注：</span>
          {note}
        </p>
      )}

      {(actions || onUnfollow) && (
        <footer className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line/60">
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
          {onUnfollow && (
            <button
              type="button"
              onClick={onUnfollow}
              className="text-xs text-ink-muted hover:text-danger underline underline-offset-2"
            >
              取消关注
            </button>
          )}
        </footer>
      )}

      {updatedAt && (
        <p className="text-[11px] text-ink-muted/70">状态更新于 {updatedAt}</p>
      )}
    </article>
  );
}
