import { cn } from "@/lib/utils";
import type { SourceHealthStatus } from "@/lib/admin/sourcesApi";

/**
 * 来源健康状态徽标（v7.2 来源管理）。
 * 五档语义：健康=绿 / 延迟=黄 / 结构变化=橙 / 被阻止=红 / 人工暂停=灰。
 * 状态不仅靠颜色区分，文字直接写明。
 */
const HEALTH_STYLES: Record<SourceHealthStatus, { label: string; className: string }> = {
  healthy: { label: "健康", className: "bg-emerald-100 text-emerald-700" },
  degraded: { label: "延迟", className: "bg-amber-100 text-amber-700" },
  structure_changed: { label: "结构变化", className: "bg-orange-100 text-orange-700" },
  blocked: { label: "被阻止", className: "bg-red-100 text-red-700" },
  paused: { label: "人工暂停", className: "bg-slate-200 text-slate-600" },
};

export function SourceHealthBadge({ status }: { status: SourceHealthStatus | string }) {
  const style = HEALTH_STYLES[status as SourceHealthStatus] ?? {
    label: status,
    className: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      data-testid={`health-badge-${status}`}
      className={cn("px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap", style.className)}
    >
      {style.label}
    </span>
  );
}

/** 最近一次运行的四计数（发现 / 新增 / 未变化 / 失败） */
export function RunCountBadges({
  discovered,
  downloaded,
  unchanged,
  failed,
}: {
  discovered: number;
  downloaded: number;
  unchanged: number;
  failed: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs whitespace-nowrap">
      <span className="text-slate-600">
        发现 <span className="font-medium text-slate-800">{discovered}</span>
      </span>
      <span className="text-blue-700">
        新增 <span className="font-medium">{downloaded}</span>
      </span>
      <span className="text-slate-500">
        未变化 <span className="font-medium">{unchanged}</span>
      </span>
      <span className={failed > 0 ? "text-red-600 font-medium" : "text-slate-500"}>
        失败 <span className="font-medium">{failed}</span>
      </span>
    </span>
  );
}
