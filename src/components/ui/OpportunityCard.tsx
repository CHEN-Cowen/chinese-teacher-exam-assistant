import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import type { QualifyLevel } from "./QualifyConclusionCard";

/**
 * 机会卡（v7 原型 .opp / .opp__meta / .facts / .why）
 *
 * 信息密度高于营销首页，用于机会列表与关注列表。
 * - fit：四档匹配状态，仅作色条+标签，不写死判断结果
 * - facts：结构化事实（学历/专业/招录人数/报名时间等）
 * - why：判断理由，由调用方基于领域逻辑传入
 * - highlighted：当前主目标或备选的视觉强调
 * - 卡片标题过长时使用 break-words，不破版
 */
export interface OpportunityFact {
  label: string;
  value: string;
}

interface OpportunityCardProps {
  title: string;
  region?: string;
  fit?: { level: QualifyLevel; label: string } | null;
  facts?: OpportunityFact[];
  why?: string;
  meta?: ReactNode;
  highlighted?: boolean;
  isFollowed?: boolean;
  onClick?: () => void;
  onFollow?: () => void;
  footer?: ReactNode;
  className?: string;
}

const fitStyles: Record<QualifyLevel, { tag: string; bar: string }> = {
  ok: { tag: "bg-ok-bg text-ok-ink border-ok-line", bar: "bg-ok-ink" },
  miss: { tag: "bg-miss-bg text-miss-ink border-miss-line", bar: "bg-miss-ink" },
  ask: { tag: "bg-ask-bg text-ask-ink border-ask-line", bar: "bg-ask-ink" },
  no: { tag: "bg-no-bg text-no-ink border-no-line", bar: "bg-no-ink" },
};

export function OpportunityCard({
  title,
  region,
  fit,
  facts,
  why,
  meta,
  highlighted,
  isFollowed,
  onClick,
  onFollow,
  footer,
  className,
}: OpportunityCardProps) {
  const fitStyle = fit ? fitStyles[fit.level] : null;
  const interactive = Boolean(onClick);
  return (
    <article
      className={cn(
        "relative grid gap-3.5 p-5 bg-surface border border-line rounded-lg",
        highlighted ? "border-brand shadow-2" : "shadow-1",
        interactive && "cursor-pointer hover:border-brand/40 transition-colors",
        className
      )}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {fitStyle && (
        <span
          aria-hidden="true"
          className={cn("absolute left-0 top-0 h-full w-1 rounded-l-lg", fitStyle.bar)}
        />
      )}
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-[18px] font-bold leading-snug text-ink break-words">
            {title}
          </h3>
          {fit && fitStyle && (
            <span
              className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-semibold",
                fitStyle.tag
              )}
            >
              {fit.label}
            </span>
          )}
        </div>
        {region && (
          <p className="text-[13px] text-ink-muted">{region}</p>
        )}
      </header>

      {facts && facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          {facts.map((f, i) => (
            <div key={i} className="grid gap-0.5">
              <dt className="text-[12px] text-ink-muted">{f.label}</dt>
              <dd className="text-ink break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {why && (
        <p className="text-sm text-ink-muted leading-relaxed">
          <span className="font-semibold text-ink-2">判断理由：</span>
          {why}
        </p>
      )}

      {meta && <div className="text-[13px] text-ink-muted">{meta}</div>}

      {(onFollow || footer) && (
        <footer className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-line/60">
          {footer}
          {onFollow && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFollow();
              }}
              aria-pressed={isFollowed}
              className={cn(
                "inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition-colors",
                isFollowed
                  ? "bg-brand-soft text-brand-strong"
                  : "border border-line bg-surface text-ink hover:border-brand/40"
              )}
            >
              {isFollowed ? "已关注" : "关注"}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
