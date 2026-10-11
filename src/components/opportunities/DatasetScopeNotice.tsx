export function DatasetScopeNotice({ hasDemo }: { hasDemo: boolean }) {
  if (!hasDemo) return null;

  return (
    <aside className="rounded-xl border border-warn/25 bg-warn-soft/60 px-4 py-3" aria-label="数据范围说明">
      <p className="text-sm font-semibold text-ink">虚构试用机会与真实监测范围分开显示</p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        页面中的试用岗位是虚构示例，不可用于真实报名；真实监测目前仅覆盖浙江杭州、宁波两市的官方渠道，江苏尚未接入。未监测城市统一显示为「暂未收录」，不代表当地没有招聘。
      </p>
    </aside>
  );
}
