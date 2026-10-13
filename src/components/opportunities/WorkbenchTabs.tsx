"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { WorkbenchViewModel } from "@/lib/opportunities/list-view";
import type { OpportunityListItemProps } from "./OpportunityListItem";
import { OpportunityListItem } from "./OpportunityListItem";

type TabId = "priority" | "supplement" | "outOfScope";

interface TabDef {
  id: TabId;
  label: string;
  /** 面板为空时的提示文案 */
  emptyText: string;
  /** 面板顶部说明（非空时展示） */
  intro: string;
  /** 卡片渲染变体：priority=默认，supplement=按 overall 区分 unknown/consult，outOfScope=偏好范围外安静态 */
  variant: "priority" | "supplement" | "outOfScope";
}

const TABS: readonly TabDef[] = [
  {
    id: "priority",
    label: "优先机会",
    emptyText: "当前没有资格和偏好都匹配的机会。完善报考信息后会重新判断。",
    intro:
      "资格条件和报考偏好都匹配的机会，建议优先查看依据并保存。",
    variant: "priority",
  },
  {
    id: "supplement",
    label: "补充后判断",
    emptyText:
      "没有需要补充信息或向招聘单位确认的机会。补充报考信息后会重新判断。",
    intro:
      "这些岗位不是不符合：补充一项信息或向招聘单位确认一项条件后会重新判断，未确认前不要当作可报结论。",
    variant: "supplement",
  },
  {
    id: "outOfScope",
    label: "偏好范围外",
    emptyText: "没有「资格可能符合但不在报考偏好范围内」的岗位。",
    intro:
      "这些岗位的资格条件可能符合，但地点不在你填写的可接受地区内。调整报考地区后会重新判断，这里不是资格不符合结论。",
    variant: "outOfScope",
  },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.id));

function resolveTab(raw: string | null): TabId {
  if (raw && VALID_TABS.has(raw)) return raw as TabId;
  return "priority";
}

interface WorkbenchTabsProps {
  workbench: WorkbenchViewModel;
  evaluatedAt: string;
  followBusyId: string | null;
  onToggleFollow: OpportunityListItemProps["onToggleFollow"];
}

/**
 * 工作台三标签（v7.2 §7.4 / §7.7）：
 * - WAI-ARIA tablist/tab/tabpanel，aria-selected/aria-controls，roving tabindex；
 * - 键盘 ArrowLeft/Right/Home/End 切换，焦点跟随；
 * - URL ?tab= 同步：useSearchParams 读、router.replace 写，默认 priority，非法值回退；
 * - 标签带数量，数量为 0 仍保留标签展示空状态；
 * - 移动端 overflow-x-auto 横滚，桌面端平铺。
 * 非激活标签的 units 不渲染到 DOM（互斥，不靠 CSS 隐藏）。
 */
export function WorkbenchTabs({
  workbench,
  evaluatedAt,
  followBusyId,
  onToggleFollow,
}: WorkbenchTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const tablistId = useId();

  // 本地状态为 UI 真相：点击即时切换（selectTab setActiveTab），无需等 URL 导航。
  // URL → 本地状态同步用「渲染期间调整状态」模式（React 推荐，非 effect）：
  // 当 searchParams 引用变化（router.replace 后 Next 重新返回新 ReadonlyURLSearchParams，
  // 或浏览器前进/后退触发导航）时，在渲染期间同步 activeTab，避免额外 effect 渲染周期。
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    resolveTab(searchParams.get("tab")),
  );
  const [trackedSearchParams, setTrackedSearchParams] = useState(searchParams);
  if (searchParams !== trackedSearchParams) {
    setTrackedSearchParams(searchParams);
    setActiveTab(resolveTab(searchParams.get("tab")));
  }

  const counts = useMemo(
    () => ({
      priority: workbench.priority.count,
      supplement: workbench.supplement.count,
      outOfScope: workbench.outOfScope.count,
    }),
    [workbench],
  );

  const selectTab = useCallback(
    (id: TabId) => {
      // 即时更新本地 UI 真相，不等 URL 导航完成
      setActiveTab(id);
      // URL 同步：仅当目标与当前 URL 不同时才 replace，避免无谓导航
      if (id === resolveTab(searchParams.get("tab"))) return;
      const params = new URLSearchParams(searchParams.toString());
      if (id === "priority") {
        params.delete("tab");
      } else {
        params.set("tab", id);
      }
      const qs = params.toString();
      router.replace(qs ? `/opportunities?${qs}` : "/opportunities");
    },
    [router, searchParams],
  );

  const focusTab = (id: TabId) => {
    tabsRef.current[id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.id === activeTab);
    let nextIdx: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        nextIdx = (idx + 1) % TABS.length;
        break;
      case "ArrowLeft":
        nextIdx = (idx - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = TABS.length - 1;
        break;
      default:
        return;
    }
    if (nextIdx === null) return;
    e.preventDefault();
    const next = TABS[nextIdx]!.id;
    selectTab(next);
    // 焦点跟随激活标签（roving tabindex 模式）
    requestAnimationFrame(() => focusTab(next));
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="机会工作台分区"
        aria-orientation="horizontal"
        id={tablistId}
        onKeyDown={onKeyDown}
        className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabsRef.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`workbench-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`workbench-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={cn(
                "min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
                selected
                  ? "bg-brand-soft text-brand"
                  : "text-ink-muted hover:bg-canvas hover:text-ink",
              )}
            >
              <span>{tab.label}</span>
              <span
                aria-label={`${count} 个`}
                className={cn(
                  "ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                  selected
                    ? "bg-brand/15 text-brand"
                    : "bg-canvas text-ink-muted",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => {
        if (tab.id !== activeTab) return null;
        const bucket = workbench[tab.id];
        const units = bucket.units;
        return (
          <div
            key={tab.id}
            id={`workbench-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`workbench-tab-${tab.id}`}
            tabIndex={0}
            className="space-y-3 focus-visible:outline-none"
          >
            <p className="text-xs leading-5 text-ink-muted">{tab.intro}</p>
            {units.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line bg-canvas p-4 text-sm text-ink-muted">
                {tab.emptyText}
              </p>
            ) : (
              <div className="space-y-3">
                {units.map((unit) => (
                  <OpportunityListItem
                    key={unit.unit.id}
                    unit={unit}
                    evaluatedAt={evaluatedAt}
                    variant={tab.variant}
                    followBusy={followBusyId === unit.unit.id}
                    onToggleFollow={onToggleFollow}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
