import Link from "next/link";
import type { CoverageDTO } from "@/lib/opportunities/api-types";
import { coverageProvinceLine } from "@/lib/opportunities/coverage-view";
import type { NoResultState } from "@/lib/opportunities/no-result";

/** "YYYY-MM-DD..." → "YYYY年M月D日"；无法解析时原样返回 */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 无结果反馈（v7.1 M6）：不得笼统显示“没有适合你的岗位”。
 * 三种状态各展示：真实原因、实际覆盖范围、最后核对时间、可用官方入口、
 * 下一步（修改信息或等待）、新公告订阅入口（锚点到 #subscription）。
 * 把「暂未收录」与「当地没有招聘」严格区分，由 no-result.ts 状态机保证文案口径。
 */
export function NoResultFeedback({
  state,
  coverage,
}: {
  state: NoResultState;
  coverage: CoverageDTO;
}) {
  const officialSources = coverage.regions.flatMap((region) =>
    region.sources.map((source) => ({
      key: `${region.code}-${source.id}`,
      label: `${region.label} · ${source.name}`,
      url: source.url,
    })),
  );

  return (
    <section
      data-testid={`no-result-${state.kind}`}
      aria-label="无结果说明"
      className="rounded-2xl border border-dashed border-line bg-surface/70 px-5 py-8"
    >
      <h3 className="text-center text-lg font-semibold text-ink">
        {state.title}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        {state.reason}
      </p>

      <div className="mx-auto mt-5 max-w-md space-y-2.5 rounded-xl bg-canvas p-4 text-left">
        <p className="text-xs leading-5 text-ink-muted">
          <span className="font-semibold text-ink">实际覆盖范围：</span>
          {coverageProvinceLine(coverage)}
        </p>
        <p className="text-xs leading-5 text-ink-muted">
          <span className="font-semibold text-ink">最后核对时间：</span>
          {formatDay(coverage.lastCheckedAt)}
        </p>
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
        {state.nextStep}
      </p>
      <div className="mt-4 text-center">
        <Link
          href="#subscription"
          className="inline-block rounded-xl bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-strong transition-colors hover:bg-bar/60"
        >
          订阅新机会提醒
        </Link>
      </div>
    </section>
  );
}
