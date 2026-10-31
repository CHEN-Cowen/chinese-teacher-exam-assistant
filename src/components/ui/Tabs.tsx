"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface TabsProps {
  tabs: { id: string; label: string; count?: number }[];
  activeTab: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

/**
 * 分类标签页（v1.1 同层级一致性）：
 * 固定高 48px，下划线激活态（3px 品牌蓝），激活字重 600 + 品牌色。
 * 同类项对齐，支持键盘左右方向键（WAI-ARIA tablist 模式）。
 */
export function Tabs({ tabs, activeTab, onChange, children }: TabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = tabs[(index + 1) % tabs.length];
      onChange(next.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = tabs[(index - 1 + tabs.length) % tabs.length];
      onChange(prev.id);
    }
  };

  return (
    <div>
      <div
        className="mb-5 flex gap-5 overflow-x-auto border-b border-line"
        role="tablist"
        aria-label="页面分区"
      >
        {tabs.map((tab, index) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                "relative flex h-12 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                active
                  ? "font-semibold text-brand"
                  : "font-medium text-ink-muted hover:text-ink"
              )}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span
                  className={cn(
                    "text-xs",
                    active ? "text-brand" : "text-ink-muted"
                  )}
                >
                  {tab.count}
                </span>
              )}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-px h-[3px] rounded-t bg-brand"
                />
              )}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

interface TabPanelProps {
  id: string;
  activeTab: string;
  children: ReactNode;
}

export function TabPanel({ id, activeTab, children }: TabPanelProps) {
  if (id !== activeTab) return null;
  return <div role="tabpanel">{children}</div>;
}
