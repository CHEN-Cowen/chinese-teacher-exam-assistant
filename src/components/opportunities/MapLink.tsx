"use client";

/**
 * 地图轻量入口按钮（v7.1 M5）：固定文案「在地图中查看 ↗」。
 * 仅渲染一个安全外链 + 官方口径提示，不加载任何地图资源；
 * 埋点只记录岗位 ID、入口与地点类别枚举，不记录地址或搜索文本。
 */
import { track } from "@/lib/analytics/eventService";
import {
  MAP_LINK_LABEL,
  MAP_LINK_PROPS,
  type MapEntry,
} from "@/lib/opportunities/map-link";

/** 入口枚举：登录态岗位详情 / 访客预览卡片展开区 */
export type MapEntryPoint = "opportunity_detail" | "guest_preview_card";

export function MapLink({
  entry,
  unitId,
  from,
}: {
  entry: MapEntry;
  unitId: string;
  from: MapEntryPoint;
}) {
  return (
    <div className="space-y-1" data-testid="map-entry">
      <a
        href={entry.url}
        {...MAP_LINK_PROPS}
        onClick={() =>
          track("map_entry_clicked", "opportunity", {
            targetId: unitId,
            props: { entry: from, category: entry.category },
          })
        }
        className="inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand-soft"
      >
        {MAP_LINK_LABEL}
      </a>
      <p className="text-xs leading-5 text-ink-muted">
        地图仅辅助理解位置，最终任教地点以官方安排为准。
      </p>
    </div>
  );
}
