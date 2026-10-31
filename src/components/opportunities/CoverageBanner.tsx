import type { CoverageDTO } from "@/lib/opportunities/api-types";
import {
  SOURCE_STATE_LABELS,
  buildProvinceScopeViews,
  coverageFallbackNote,
  coverageProvinceLine,
  sourceStateTone,
} from "@/lib/opportunities/coverage-view";

/** "YYYY-MM-DD..." → "M月D日"；无法解析时原样返回 */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 官方监测覆盖说明（M01/F1-F2 统一覆盖投影）：
 * 逐省说清「实际监测哪些城市、有哪些官方来源、各来源检查状态、
 * 最近核对时间、当前是否有在报批次」；
 * 尚未登记的省份只显示「暂未收录（待接入）」，不列城市不列来源；
 * 已登记/核验通过不等于已有在报岗位；
 * 非实时回退（caliber.isFallback）必须明示，不冒充实时监测。
 */
export function CoverageBanner({
  coverage,
  /** D08：打开公告补录弹窗（覆盖说明内提供入口，与无结果面板一致） */
  onOpenSubmission,
}: {
  coverage: CoverageDTO;
  onOpenSubmission?: () => void;
}) {
  const provinceViews = buildProvinceScopeViews(coverage);
  const fallbackNote = coverageFallbackNote(coverage);
  return (
    <details
      aria-label="官方监测覆盖说明"
      className="group rounded-2xl border border-line bg-surface"
      data-testid="coverage-banner"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m5 12 4 4L19 6"
              />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">
              真实监测范围 · {coverageProvinceLine(coverage)}
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {formatDay(coverage.lastCheckedAt)} 核对 · 点击查看监测城市与官方来源
            </span>
          </span>
        </span>
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <div className="border-t border-line px-4 pb-4 pt-3">
        <p className="text-sm text-ink">
          当前监测到{" "}
          <span className="font-semibold">
            {coverage.openOpportunityCount} 个在报语文教师岗位
          </span>
          ；{coverage.nextWindowNote}
        </p>

        {provinceViews.map((province) => (
          <section
            key={province.code}
            data-testid={`coverage-province-${province.code}`}
            className="mt-3 border-t border-line pt-3 first:border-t-0 first:pt-3"
          >
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
              <span>{province.label}</span>
              <span
                className={
                  province.status === "not_started"
                    ? "inline-flex h-6 items-center rounded bg-canvas px-2 text-xs font-medium text-ink-muted ring-1 ring-line"
                    : "inline-flex h-6 items-center rounded bg-success-soft px-2 text-xs font-medium text-success"
                }
              >
                {province.statusLabel}
              </span>
              <span className="text-xs font-normal text-ink-muted">
                监测城市：{province.cityText}
              </span>
            </p>

            {province.status === "not_started" ? (
              <p
                className="mt-1.5 text-xs leading-5 text-ink-muted"
                data-testid={`coverage-pending-${province.code}`}
              >
                {province.scopeNote}
              </p>
            ) : (
              <>
                <ul className="mt-1.5 space-y-1.5 text-xs text-ink-muted">
                  {province.monitoredRegions.flatMap((region) =>
                    region.sources.map((source) => {
                      const tone = sourceStateTone(source.state);
                      return (
                        <li
                          key={source.id}
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                        >
                          <span
                            aria-hidden="true"
                            className={
                              tone === "ok"
                                ? "inline-block h-1.5 w-1.5 rounded-full bg-success"
                                : tone === "bad"
                                  ? "inline-block h-1.5 w-1.5 rounded-full bg-danger"
                                  : "inline-block h-1.5 w-1.5 rounded-full bg-canvas ring-1 ring-line"
                            }
                          />
                          <span>
                            {region.label} · {source.name}
                          </span>
                          <span>{SOURCE_STATE_LABELS[source.state]}</span>
                          {source.state === "check_failed" ? (
                            <span>原因：{source.note}</span>
                          ) : null}
                          <span>
                            {source.lastCheckedAt
                              ? `核对于 ${formatDay(source.lastCheckedAt)}`
                              : "暂无来源级检查记录"}
                          </span>
                        </li>
                      );
                    }),
                  )}
                </ul>
                <p className="mt-1.5 text-xs leading-5 text-ink-muted">
                  {province.scopeNote}
                </p>
              </>
            )}
          </section>
        ))}

        {fallbackNote ? (
          <p
            className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-xs leading-5 text-ink"
            data-testid="coverage-fallback-note"
          >
            {fallbackNote}
          </p>
        ) : null}
        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
          {coverage.scopeNote}
          AI 初核且尚待人工复核的记录不会进入推荐。来源检查正常但没有新增公告属于正常状态，
          不算故障。最近成功检查 {formatDay(coverage.lastCheckedAt)}
          {coverage.caliber?.generatedAt &&
          coverage.caliber.generatedAt !== coverage.lastCheckedAt
            ? `；统计生成于 ${formatDay(coverage.caliber.generatedAt)}`
            : ""}
          。覆盖版本 {coverage.version}。
        </p>
        {onOpenSubmission && (
          <p className="mt-2 text-xs">
            <button
              type="button"
              onClick={onOpenSubmission}
              className="text-brand underline underline-offset-2 hover:text-brand-strong"
            >
              发现尚未收录的官方公告？提交补录供人工核对 →
            </button>
          </p>
        )}
      </div>
    </details>
  );
}
