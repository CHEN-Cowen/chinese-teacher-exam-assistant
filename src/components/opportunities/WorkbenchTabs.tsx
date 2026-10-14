"use client";

import { useMemo } from "react";
import type { WorkbenchViewModel } from "@/lib/opportunities/list-view";
import type { UnitMatchDTO } from "@/lib/opportunities/api-types";
import { buildUnitTabs } from "@/lib/results/workbench-view";
import { ResultsWorkbench } from "@/components/results/ResultsWorkbench";
import type { OpportunityListItemProps } from "./OpportunityListItem";
import { OpportunityListItem } from "./OpportunityListItem";

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

  return (
    <ResultsWorkbench
      tabs={tabs}
      basePath="/opportunities"
      renderCard={(vm, variant) => {
        const unit = unitById.get(vm.id);
        if (!unit) return null;
        return (
          <OpportunityListItem
            unit={unit}
            evaluatedAt={evaluatedAt}
            variant={variant}
            followBusy={followBusyId === vm.id}
            onToggleFollow={onToggleFollow}
          />
        );
      }}
    />
  );
}
