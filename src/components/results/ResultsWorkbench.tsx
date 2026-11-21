"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics/eventService";
import type {
  OpportunityCardViewModel,
  ResultsCardVariant,
  ResultsTabId,
} from "@/lib/results/workbench-view";

interface TabDef {
  id: ResultsTabId;
  label: string;
  /** 面板为空时的提示文案 */
  emptyText: string;
  /** 面板顶部说明（非空时展示） */
  intro: string;
  /** 卡片渲染变体 */
  variant: ResultsCardVariant;
}

const TABS: readonly TabDef[] = [
  {
    id: "priority",
    label: "优先机会",
    emptyText: "当前没有资格和偏好都匹配的机会。完善报考信息后会重新判断。",
    intro: "资格条件和报考偏好都匹配的机会，建议优先查看依据并保存。",
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
      "这些岗位的资格条件可能符合，但地点或用工形式不在你填写的偏好范围内。调整偏好后会重新判断，这里不是资格不符合结论。",
    variant: "outOfScope",
  },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.id));

function resolveTab(raw: string | null): ResultsTabId {
  if (raw && VALID_TABS.has(raw)) return raw as ResultsTabId;
  return "priority";
}

export interface ResultsWorkbenchProps {
  /** 三标签数据（共享 ViewModel，由访客或登录适配器产出） */
  tabs: Record<ResultsTabId, OpportunityCardViewModel[]>;
  /** URL 同步的页面路径：/preview 与 /opportunities 使用一致的 ?tab= 语义 */
  basePath: "/preview" | "/opportunities";
  /** 卡片渲染（由调用方提供 capabilities 差异；DOM 结构由 UnifiedOpportunityCard 统一） */
  renderCard: (
    vm: OpportunityCardViewModel,
    variant: ResultsCardVariant,
  ) => ReactNode;
}

/**
 * v7.2 统一结果工作台三标签（/preview 与 /opportunities 共用同一实现）：
 * - WAI-ARIA tablist/tab/tabpanel，aria-selected/aria-controls，roving tabindex；
 * - 键盘 ArrowLeft/Right/Home/End 切换，焦点跟随；
 * - URL ?tab= 同步：useSearchParams 读、router.replace 写，默认 priority，非法值回退；
 *   刷新与浏览器前进/后退按 URL 恢复标签；
 * - 标签带真实数量徽标，数量为 0 仍保留标签展示空状态；
 * - 非激活标签的数据不渲染到 DOM（互斥，不靠 CSS 隐藏）；
 * - 移动端 overflow-x-auto 横滚，桌面端平铺。
 */
export function ResultsWorkbench({
  tabs,
  basePath,
  renderCard,
}: ResultsWorkbenchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const tablistId = useId();

  // 本地状态为 UI 真相：点击即时切换，无需等 URL 导航。
  // URL → 本地状态同步用「渲染期间调整状态」模式（React 推荐，非 effect）。
  const [activeTab, setActiveTab] = useState<ResultsTabId>(() =>
    resolveTab(searchParams.get("tab")),
  );
  const [trackedSearchParams, setTrackedSearchParams] = useState(searchParams);
  if (searchParams !== trackedSearchParams) {
    setTrackedSearchParams(searchParams);
    setActiveTab(resolveTab(searchParams.get("tab")));
  }

  const selectTab = useCallback(
    (id: ResultsTabId) => {
      // 用户主动切换才埋点（挂载与 URL 同步不经过这里）；点击已激活标签不重复记录
      if (id !== activeTab) {
        track("result_tab_changed", "opportunity", { props: { tab: id } });
      }
      setActiveTab(id);
      if (id === resolveTab(searchParams.get("tab"))) return;
      const params = new URLSearchParams(searchParams.toString());
      if (id === "priority") {
        params.delete("tab");
      } else {
        params.set("tab", id);
      }
      const qs = params.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath);
    },
    [router, searchParams, activeTab, basePath],
  );

  const focusTab = (id: ResultsTabId) => {
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
        className="mb-5 flex gap-5 overflow-x-auto border-b border-line"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          const count = tabs[tab.id].length;
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
                "relative flex h-12 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                selected
                  ? "font-semibold text-brand"
                  : "font-medium text-ink-muted hover:text-ink",
              )}
            >
              <span>{tab.label}</span>
              <span
                aria-label={`${count} 个`}
                className={cn(
                  "text-xs",
                  selected ? "text-brand" : "text-ink-muted",
                )}
              >
                {count}
              </span>
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-px h-[3px] rounded-t bg-brand"
                />
              )}
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => {
        if (tab.id !== activeTab) return null;
        const cards = tabs[tab.id];
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
            {cards.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line bg-canvas p-4 text-sm text-ink-muted">
                {tab.emptyText}
              </p>
            ) : (
              <div className="space-y-3">
                {cards.map((vm) => (
                  // D05：id 锚点供「补充保存后返回结果页」滚动定位到原岗位卡片
                  // （/opportunities 页读取 #unit-<id> 后 scrollIntoView）
                  <div key={vm.id} id={`unit-${vm.id}`} className="scroll-mt-24">
                    {renderCard(vm, tab.variant)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
