"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { WorkbenchViewModel } from "@/lib/opportunities/list-view";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";
import { buildUnitTabs } from "@/lib/results/workbench-view";
import { ResultsWorkbench } from "@/components/results/ResultsWorkbench";
import type { OpportunityListItemProps } from "./OpportunityListItem";
import { OpportunityListItem } from "./OpportunityListItem";
import { stageLabel, subjectLabel } from "@/lib/ia/labels";

interface WorkbenchTabsProps {
  workbench: WorkbenchViewModel;
  evaluatedAt: string;
  followBusyId: string | null;
  onToggleFollow: OpportunityListItemProps["onToggleFollow"];
}

/**
 * 登录端机会工作台（薄适配器，v7.2 §7.4 / §7.7）。
 *
 * 标签 chrome、URL ?tab= 语义与卡片 DOM 全部由共享实现承担：
 * - ResultsWorkbench：三标签互斥、WAI-ARIA、键盘、URL 同步；
 * - OpportunityListItem → UnifiedOpportunityCard：统一七层岗位卡。
 * 本组件只负责把 WorkbenchViewModel（UnitMatchDTO）适配成共享展示模型，
 * 并把保存回调映射回原始 UnitMatchDTO。
 */
export function WorkbenchTabs({
  workbench,
  evaluatedAt,
  followBusyId,
  onToggleFollow,
}: WorkbenchTabsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const router = useRouter();
  const search = useSearchParams();
  const region = search.get("region") ?? "";
  const subject = search.get("subject") ?? "";
  const stage = search.get("stage") ?? "";
  const updateFilters = (changes: Record<string, string>) => {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSelectedId(null);
    const query = params.toString();
    router.replace(query ? `/opportunities?${query}` : "/opportunities", { scroll: false });
  };
  const tabs = useMemo(
    () => buildUnitTabs(workbench, evaluatedAt),
    [workbench, evaluatedAt],
  );
  const unitById = useMemo(() => {
    const map = new Map<string, UnitMatchDTO>();
    for (const bucket of [
      workbench.priority,
      workbench.supplement,
      workbench.outOfScope,
    ]) {
      for (const unit of bucket.units) map.set(unit.unit.id, unit);
    }
    return map;
  }, [workbench]);

  const units = [...unitById.values()].map(({ unit }) => unit);
  const matches = ({ id }: { id: string }) => {
    const unit = unitById.get(id)?.unit;
    return unit && (!region || unit.region.province === region) &&
      (!subject || unit.subject === subject) && (!stage || unit.stage === stage);
  };
  const filteredTabs = {
    priority: tabs.priority.filter(matches),
    supplement: tabs.supplement.filter(matches),
    outOfScope: tabs.outOfScope.filter(matches),
  };
  const filters = [
    { key: "region", label: "地区", value: region, options: units.map((unit) => [unit.region.province, unit.region.province]) },
    { key: "subject", label: "学科", value: subject, options: units.map((unit) => [unit.subject, subjectLabel(unit.subject)]) },
    { key: "stage", label: "学段", value: stage, options: units.map((unit) => [unit.stage, stageLabel(unit.stage)]) },
  ];
  const selected = selectedId ? unitById.get(selectedId) : undefined;
  const comparison = compareIds.flatMap((id) => {
    const unit = unitById.get(id);
    return unit ? [unit] : [];
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {filters.map((filter) => (
          <label key={filter.label} className="grid gap-1 text-sm font-medium text-ink">
            {filter.label}
            <select
              className="rounded-lg border border-line bg-surface px-3 py-2"
              value={filter.value}
              onChange={(event) => updateFilters({ [filter.key]: event.target.value })}
            >
              <option value="">全部{filter.label}</option>
              {[...new Map(filter.options.map(([value, label]) => [value, label] as const))].map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        ))}
        {(region || subject || stage) && (
          <button type="button" className="rounded-lg px-3 py-2 text-sm font-medium text-brand hover:bg-brand-soft" onClick={() => updateFilters({ region: "", subject: "", stage: "" })}>
            清除筛选
          </button>
        )}
      </div>
      {comparison.length > 0 && (
        <section aria-labelledby="compare-jobs" className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="compare-jobs" className="font-semibold text-ink">岗位对比（{comparison.length}/3）</h2>
            <button type="button" onClick={() => setCompareIds([])} className="text-sm text-brand hover:underline">清空对比</button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {comparison.map((item) => (
              <article key={item.unit.id} className="min-w-0 rounded-lg border border-line p-3 text-sm">
                <Link href={`/opportunities/${item.unit.id}`} className="font-semibold text-brand hover:underline">{item.unit.name}</Link>
                <dl className="mt-2 space-y-2 text-ink">
                  <div><dt className="font-medium">报名截止</dt><dd>{item.version.timeline.registrationEnd?.slice(0, 10) ?? "待官方公布"}</dd></div>
                  <div><dt className="font-medium">关键条件</dt><dd>{item.dimensions.find((dimension) => dimension.hard && dimension.value !== "PASS")?.reason ?? "查看岗位依据"}</dd></div>
                  <div><dt className="font-medium">材料要求</dt><dd>{item.unit.materials?.length ? `${item.unit.materials.length} 项` : "查看公告原文"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
        <div className="min-w-0">
          <ResultsWorkbench
            tabs={filteredTabs}
            basePath="/opportunities"
            renderCard={(vm, variant) => {
              const unit = unitById.get(vm.id);
              if (!unit) return null;
              return (
                <div className="space-y-2">
                  <OpportunityListItem
                    unit={unit}
                    evaluatedAt={evaluatedAt}
                    variant={variant}
                    followBusy={followBusyId === vm.id}
                    onToggleFollow={onToggleFollow}
                  />
                  <button
                    type="button"
                    aria-pressed={selectedId === unit.unit.id}
                    onClick={() => setSelectedId(unit.unit.id)}
                    className="hidden rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-brand hover:bg-brand-soft xl:inline-flex"
                  >
                    预览岗位
                  </button>
                  <button
                    type="button"
                    aria-pressed={compareIds.includes(unit.unit.id)}
                    disabled={!compareIds.includes(unit.unit.id) && compareIds.length >= 3}
                    onClick={() => setCompareIds((ids) => ids.includes(unit.unit.id)
                      ? ids.filter((id) => id !== unit.unit.id)
                      : [...ids, unit.unit.id].slice(0, 3))}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-brand hover:bg-brand-soft disabled:opacity-50"
                  >
                    {compareIds.includes(unit.unit.id) ? "移出对比" : "加入对比"}
                  </button>
                </div>
              );
            }}
          />
        </div>
        <aside aria-label="岗位预览" className="sticky top-20 hidden space-y-3 rounded-xl border border-line bg-surface p-4 xl:block">
          <h2 className="font-semibold text-ink">岗位预览</h2>
          {selected ? (
            <>
              <OpportunityListItem unit={selected} evaluatedAt={evaluatedAt} compact />
              <Link href={`/opportunities/${selected.unit.id}`} className="inline-flex text-sm font-semibold text-brand hover:underline">查看完整岗位详情</Link>
            </>
          ) : <p className="text-sm text-ink-muted">选择一个岗位查看摘要。</p>}
        </aside>
      </div>
    </div>
  );
}
