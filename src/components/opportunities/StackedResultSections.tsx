"use client";

/**
 * v7.2 ff_new_results 回退布局（PRD 8.4）。
 *
 * 新工作台三标签（WorkbenchTabs）关闭时的旧式堆叠分组：
 * - 初步符合 → 需要补充信息（按缺失维度分组）→ 建议人工确认 → 偏好范围外；
 * - 数据全部来自 buildListViewModel 的既有分组字段，不在本组件内重复任何判定；
 * - 卡片复用 OpportunityListItem（variant 与 WorkbenchTabs 一致）；
 * - 已截止 / 明确不符合的留档区由页面主体继续渲染，不在这里重复。
 */
import type { MatchResponse, UnitMatchDTO } from "@/lib/opportunities/api-types";
import { dimensionLabel } from "@/lib/ia/labels";
import { Disclosure } from "@/components/ia/Layer";
import {
  OpportunityListItem,
  type OpportunityListItemProps,
} from "./OpportunityListItem";

type NeedInfoGroups = MatchResponse["groups"]["needInfo"];

interface StackedResultSectionsProps {
  priority: UnitMatchDTO | null;
  otherPreliminary: UnitMatchDTO[];
  needInfoGroups: NeedInfoGroups;
  manualReview: UnitMatchDTO[];
  regionOutOfScope: UnitMatchDTO[];
  evaluatedAt: string;
  followBusyId: string | null;
  onToggleFollow: OpportunityListItemProps["onToggleFollow"];
}

export function StackedResultSections({
  priority,
  otherPreliminary,
  needInfoGroups,
  manualReview,
  regionOutOfScope,
  evaluatedAt,
  followBusyId,
  onToggleFollow,
}: StackedResultSectionsProps) {
  const preliminary = priority ? [priority, ...otherPreliminary] : otherPreliminary;
  const allEmpty =
    preliminary.length === 0 &&
    needInfoGroups.length === 0 &&
    manualReview.length === 0 &&
    regionOutOfScope.length === 0;

  if (allEmpty) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-canvas p-4 text-sm text-ink-muted">
        当前没有可行动的机会。已截止与明确不符合的公告可在下方留档区查看。
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {preliminary.length > 0 && (
        <section aria-labelledby="stacked-preliminary-heading" className="space-y-3">
          <h2 id="stacked-preliminary-heading" className="text-sm font-semibold text-ink-muted">
            初步符合的机会
          </h2>
          <div className="space-y-3">
            {preliminary.map((unit) => (
              <OpportunityListItem
                key={unit.unit.id}
                unit={unit}
                evaluatedAt={evaluatedAt}
                variant="priority"
                followBusy={followBusyId === unit.unit.id}
                onToggleFollow={onToggleFollow}
              />
            ))}
          </div>
        </section>
      )}

      {needInfoGroups.length > 0 && (
        <section aria-labelledby="stacked-needinfo-heading" className="space-y-3">
          <h2 id="stacked-needinfo-heading" className="text-sm font-semibold text-ink-muted">
            补充信息后判断
          </h2>
          {needInfoGroups.map((group) => (
            <Disclosure
              key={group.dimension}
              title={`补充${dimensionLabel(group.dimension)}后判断`}
              count={group.units.length}
            >
              <div className="space-y-3">
                {group.units.map((unit) => (
                  <OpportunityListItem
                    key={unit.unit.id}
                    unit={unit}
                    evaluatedAt={evaluatedAt}
                    variant="supplement"
                    followBusy={followBusyId === unit.unit.id}
                    onToggleFollow={onToggleFollow}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                这些岗位不是不符合：补充信息后会重新判断，未补充前不要当作可报结论。
              </p>
            </Disclosure>
          ))}
        </section>
      )}

      {manualReview.length > 0 && (
        <section aria-labelledby="stacked-manual-heading" className="space-y-3">
          <h2 id="stacked-manual-heading" className="text-sm font-semibold text-ink-muted">
            建议向招聘单位确认
          </h2>
          <Disclosure title="向招聘单位确认后判断" count={manualReview.length}>
            <div className="space-y-3">
              {manualReview.map((unit) => (
                <OpportunityListItem
                  key={unit.unit.id}
                  unit={unit}
                  evaluatedAt={evaluatedAt}
                  variant="supplement"
                  followBusy={followBusyId === unit.unit.id}
                  onToggleFollow={onToggleFollow}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              这些岗位的条件需要向招聘单位确认，确认前不要当作可报结论。
            </p>
          </Disclosure>
        </section>
      )}

      {regionOutOfScope.length > 0 && (
        <section aria-labelledby="stacked-outofscope-heading" className="space-y-3">
          <h2 id="stacked-outofscope-heading" className="text-sm font-semibold text-ink-muted">
            偏好范围外
          </h2>
          <Disclosure title="资格可能符合，但地点不在偏好内" count={regionOutOfScope.length}>
            <div className="space-y-3">
              {regionOutOfScope.map((unit) => (
                <OpportunityListItem
                  key={unit.unit.id}
                  unit={unit}
                  evaluatedAt={evaluatedAt}
                  variant="outOfScope"
                  followBusy={followBusyId === unit.unit.id}
                  onToggleFollow={onToggleFollow}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              这不是资格不符合结论：调整报考地区后会重新判断。
            </p>
          </Disclosure>
        </section>
      )}
    </div>
  );
}
