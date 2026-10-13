"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SavedNextAction } from "@/lib/opportunities/next-action-selector";

/**
 * 保存后的下一步面板（v7.2 FR-4）。
 *
 * 保存成功后出现，且整个保存区域只有这一个最高优先级主动作（选择器规则见
 * next-action-selector）。明确告知「已保存并加入日程 ≠ 报名」：报名只能在
 * 官方入口完成。本次会话首次保存为绿色强调态并把焦点移到主动作；刷新或
 * 关闭强调后保留安静浅色条（可恢复、持续可见），不弹模态、不仅是 Toast。
 */
interface SavedNextActionPanelProps {
  /** 选择器结果；null 时不硬造动作，只提示当前无待办 */
  action: SavedNextAction | null;
  /** 本次会话刚保存成功＝绿色强调态；刷新/重访为安静态 */
  emphasized: boolean;
  /** follow 响应携带的官方日程同步节点数；缺省（如演示数据）不显示该行 */
  syncedEventCount?: number;
  busy?: boolean;
  onUnfollow: () => void;
  /** 关闭绿色强调（安静态仍保留） */
  onDismiss: () => void;
  /** 页内锚点点击（由页面打开折叠区并滚动） */
  onAnchor: (id: string) => void;
  /** 主动作曝光（随 action.key 变化）；埋点只带 tier/kind 枚举 */
  onActionOpened?: (action: SavedNextAction) => void;
}

function PrimaryAction({
  action,
  onAnchor,
  actionRef,
}: {
  action: SavedNextAction;
  onAnchor: (id: string) => void;
  actionRef: (el: HTMLAnchorElement | HTMLButtonElement | null) => void;
}) {
  const className =
    "inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-on-dark shadow-1 transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:w-auto";
  const href = action.href ?? "";
  if (action.external || /^https?:/i.test(href)) {
    return (
      <a
        ref={actionRef}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        data-testid="saved-next-action-primary"
      >
        {action.label}
      </a>
    );
  }
  if (href.startsWith("/")) {
    return (
      <Link
        ref={actionRef as never}
        href={href}
        className={className}
        data-testid="saved-next-action-primary"
      >
        {action.label}
      </Link>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a
        ref={actionRef}
        href={href}
        className={className}
        data-testid="saved-next-action-primary"
        onClick={(e) => {
          e.preventDefault();
          onAnchor(href.slice(1));
        }}
      >
        {action.label}
      </a>
    );
  }
  return (
    <button
      ref={actionRef}
      type="button"
      className={className}
      data-testid="saved-next-action-primary"
    >
      {action.label}
    </button>
  );
}

export function SavedNextActionPanel({
  action,
  emphasized,
  syncedEventCount,
  busy = false,
  onUnfollow,
  onDismiss,
  onAnchor,
  onActionOpened,
}: SavedNextActionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const actionElRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);

  // 主动作曝光随 key 变化（重算后新动作再次曝光）
  useEffect(() => {
    if (action) onActionOpened?.(action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.key]);

  // 刚保存成功：焦点移至主动作，键盘用户立刻接续；安静态不抢焦点
  useEffect(() => {
    if (emphasized) {
      actionElRef.current?.focus();
    }
  }, [emphasized]);

  return (
    <div
      ref={panelRef}
      role="status"
      aria-live="polite"
      data-testid="saved-next-action-panel"
      data-emphasized={emphasized ? "true" : "false"}
      tabIndex={-1}
      className={cn(
        "rounded-xl border p-3 sm:p-4 outline-none",
        emphasized
          ? "border-ok-line bg-ok-bg"
          : "border-line bg-canvas",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className={cn(
              "text-sm font-semibold",
              emphasized ? "text-ok-ink" : "text-ink",
            )}
          >
            已保存，并加入报考日程
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            这不是报名，报名须在官方入口完成。
          </p>
        </div>
        {emphasized && (
          <button
            type="button"
            aria-label="收起强调提示"
            onClick={onDismiss}
            className="-mr-1 -mt-1 rounded p-1 text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            data-testid="saved-next-action-dismiss"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        )}
      </div>

      {action ? (
        <div className="mt-3">
          <PrimaryAction
            action={action}
            onAnchor={onAnchor}
            actionRef={(el) => {
              actionElRef.current = el;
            }}
          />
          {action.detail ? (
            <p className="mt-1.5 text-xs text-ink-muted">{action.detail}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-ink-muted" data-testid="saved-next-action-empty">
          当前没有需要立即处理的事项；官方公布新的报名节点后，会在这里提醒你。
        </p>
      )}

      {typeof syncedEventCount === "number" && (
        <p className="mt-2 text-xs text-ink-muted">
          已同步 {syncedEventCount} 个官方日程节点
        </p>
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-2.5">
        <button
          type="button"
          onClick={onUnfollow}
          disabled={busy}
          className="text-xs text-ink-muted underline underline-offset-2 hover:text-danger disabled:opacity-50"
          data-testid="saved-next-action-undo"
        >
          撤销保存
        </button>
        <span className="text-[11px] text-ink-muted">
          保存只用于跟进提醒与材料准备，不代表已报名。
        </span>
      </div>
    </div>
  );
}
