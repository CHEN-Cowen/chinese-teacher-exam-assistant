"use client";

import { Disclosure } from "@/components/ia/Layer";
import { cn } from "@/lib/utils";
import { safeOfficialLink } from "@/lib/links/official";
import type {
  MaterialItemDTO,
  MaterialStatus,
} from "@/lib/opportunities/api-types";

const STATUS_LABELS: Record<MaterialStatus, string> = {
  not_started: "未准备",
  in_progress: "准备中",
  done: "已完成",
  not_applicable: "不适用",
};

const STATUS_TONE: Record<MaterialStatus, string> = {
  not_started: "bg-canvas text-ink-muted",
  in_progress: "bg-warn-soft text-warn",
  done: "bg-green-50 text-green-700",
  not_applicable: "bg-canvas text-ink-muted",
};

interface MaterialsListProps {
  materials: MaterialItemDTO[];
  /** 当前 follow 的材料状态映射 */
  statuses: Record<string, MaterialStatus> | null;
  busy: boolean;
  onStatusChange: (itemId: string, status: MaterialStatus) => void;
}

/**
 * 报名材料清单（模块 6）。
 * - 每项带来源（官方原文摘录/岗位表定位，可展开）、适用人群、完成状态四选一；
 * - 不采集证件号码或扫描件，只记录进度。
 */
export function MaterialsList({
  materials,
  statuses,
  busy,
  onStatusChange,
}: MaterialsListProps) {
  if (materials.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        该公告暂未摘录报名材料清单，请以官方公告原文为准。
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {materials.map((m) => {
        const status = statuses?.[m.id] ?? "not_started";
        return (
          <li key={m.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {m.label}
                  {m.required ? (
                    <span className="ml-1.5 text-xs text-red-500">*必填</span>
                  ) : (
                    <span className="ml-1.5 text-xs text-ink-muted">建议准备</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  适用人群：{m.applicableAudience}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex h-6 shrink-0 items-center rounded px-2.5 text-xs font-medium",
                  STATUS_TONE[status],
                )}
              >
                {STATUS_LABELS[status]}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                ["not_started", "in_progress", "done", "not_applicable"] as const
              ).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => onStatusChange(m.id, s)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    status === s
                      ? "bg-brand text-white"
                      : "bg-canvas text-ink-muted hover:bg-line",
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>

            <Disclosure title="查看官方来源">
              <p className="text-xs leading-5 text-ink-muted">
                来源：
                {safeOfficialLink(m.source.locator.url) ? (
                  <a
                    href={safeOfficialLink(m.source.locator.url)!}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline"
                  >
                    {m.source.locator.anchor ?? m.source.locator.url}
                  </a>
                ) : (
                  m.source.locator.anchor ?? "演示示例，无可访问的官方原文"
                )}
              </p>
              {m.source.excerpt && (
                <p className="mt-1 rounded bg-canvas p-2 text-xs text-ink-muted">
                  「{m.source.excerpt}」
                </p>
              )}
            </Disclosure>
          </li>
        );
      })}
    </ul>
  );
}

/** 材料完成进度文案，如「3 / 5 已准备」 */
export function materialProgressText(
  materials: MaterialItemDTO[],
  statuses: Record<string, MaterialStatus> | null,
): string {
  const total = materials.length;
  if (total === 0) return "暂无材料清单";
  const done = materials.filter((m) => statuses?.[m.id] === "done").length;
  return `${done} / ${total} 已准备`;
}
