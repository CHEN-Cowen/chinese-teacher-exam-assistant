"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { CoverageDTO } from "@/lib/opportunities/api-types";
import { coverageProvinceLine } from "@/lib/opportunities/coverage-view";
import type { NoResultPanelModel } from "@/lib/opportunities/no-result";
import { trackView } from "@/lib/analytics/eventService";

/** "YYYY-MM-DD..." → "YYYY年M月D日"；无法解析时原样返回 */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 无结果反馈（D04 / PRD 11.5 多原因版）：不得笼统显示“没有适合你的岗位”。
 * 展示：并存的多个真实原因、当前筛选、统计范围、分阶段数量（按报考单元去重）、
 * 最近成功检查时间与统计生成时间、非实时回退说明、可用官方入口与主要下一步。
 * 「请求失败」不在此组件：页面以 ErrorState 区分，网络失败不显示业务零结果。
 * 暂未收录 ≠ 当地没有招聘；待人工复核公告只计数、不展示内容。
 */
export function NoResultFeedback({
  panel,
  coverage,
  /** D08：打开公告补录弹窗（报告未收录的官方公告） */
  onOpenSubmission,
}: {
  panel: NoResultPanelModel;
  coverage: CoverageDTO;
  onOpenSubmission?: () => void;
}) {
  // 无结果原因曝光（会话级去重；reasonCode 沿用旧三态，并存原因列表只记枚举不记正文）
  useEffect(() => {
    trackView(panel.legacyKind, "no_result_reason_viewed", "opportunity", {
      props: {
        reasonCode: panel.legacyKind,
        kind: panel.legacyKind,
        reasonKinds: panel.reasons.map((r) => r.kind).join(","),
      },
    });
  }, [panel]);

  const officialSources = coverage.regions.flatMap((region) =>
    region.sources.map((source) => ({
      key: `${region.code}-${source.id}`,
      label: `${region.label} · ${source.name}`,
      url: source.url,
    })),
  );

  return (
    <section
      data-testid={`no-result-${panel.legacyKind}`}
      aria-label="无结果说明"
      className="rounded-2xl border border-dashed border-line bg-surface/70 px-5 py-8"
    >
      <h3 className="text-center text-lg font-semibold text-ink">
        {panel.primary.title}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-ink-muted">
        没有找到可直接行动的机会。下面是按真实数据核对的全部原因（可能并存）：
      </p>

      <ul
        data-testid="no-result-reasons"
        className="mx-auto mt-4 max-w-md space-y-2.5 text-left"
      >
        {panel.reasons.map((reason) => (
          <li
            key={reason.kind}
            data-reason={reason.kind}
            className="rounded-xl bg-canvas px-4 py-3"
          >
            <p className="text-sm font-semibold text-ink">{reason.title}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {reason.detail}
            </p>
            {reason.nextStep && (
              <p className="mt-1 text-xs leading-5 text-ink">
                下一步：{reason.nextStep}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="mx-auto mt-5 max-w-md space-y-2.5 rounded-xl bg-canvas p-4 text-left">
        {panel.filterText && (
          <p className="text-xs leading-5 text-ink-muted">
            <span className="font-semibold text-ink">当前筛选：</span>
            {panel.filterText}
          </p>
        )}
        <p className="text-xs leading-5 text-ink-muted">
          <span className="font-semibold text-ink">统计范围：</span>
          {panel.scopeText}
        </p>
        <p
          className="flex flex-wrap gap-1.5 text-xs leading-5 text-ink-muted"
          data-testid="no-result-stage-counts"
        >
          <span className="font-semibold text-ink">分阶段数量：</span>
          {panel.stageCounts.map((item) => (
            <span
              key={item.label}
              className="inline-flex h-6 items-center rounded bg-surface px-2 ring-1 ring-line"
            >
              {item.label} {item.count}
            </span>
          ))}
        </p>
        <p className="text-xs leading-5 text-ink-muted">
          <span className="font-semibold text-ink">实际覆盖范围：</span>
          {coverageProvinceLine(coverage)}
        </p>
        <p className="text-xs leading-5 text-ink-muted">
          <span className="font-semibold text-ink">最近成功检查：</span>
          {formatDay(panel.lastCheckedAt)}
          {panel.generatedAt && panel.generatedAt !== panel.lastCheckedAt && (
            <>；<span className="font-semibold text-ink">统计生成：</span>
            {formatDay(panel.generatedAt)}</>
          )}
        </p>
        {panel.fallbackNote && (
          <p className="rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs leading-5 text-ink">
            {panel.fallbackNote}
          </p>
        )}
        {officialSources.length > 0 && (
          <div className="text-xs leading-5 text-ink-muted">
            <span className="font-semibold text-ink">可用官方入口：</span>
            <ul className="mt-1 space-y-1">
              {officialSources.map((source) => (
                <li key={source.key}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand underline underline-offset-2"
                  >
                    {source.label} ↗
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-1">报名前请以官方来源最新公告为准。</p>
          </div>
        )}
      </div>

      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink">
        {panel.primary.nextStep ??
          "订阅新机会提醒：人工核对发布的新公告会在站内通知中心提醒你一次。"}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="#subscription"
          className="inline-block rounded-xl bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-strong transition-colors hover:bg-bar/60"
        >
          订阅新机会提醒
        </Link>
        {onOpenSubmission && (
          <button
            type="button"
            onClick={onOpenSubmission}
            className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            发现未收录的官方公告？提交补录
          </button>
        )}
      </div>
    </section>
  );
}
