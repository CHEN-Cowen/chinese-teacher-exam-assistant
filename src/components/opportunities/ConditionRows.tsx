"use client";

import { cn } from "@/lib/utils";
import { dimensionLabel } from "@/lib/ia/labels";
import type { DimensionDTO } from "@/lib/opportunities/api-types";
import { DIMENSION_VALUE_META } from "@/lib/opportunities/detail-view";

/**
 * 逐条件结果行（详情第二段 / 列表卡片展开态共用）。
 * 每行固定两个栏位，严格区分两类信息（PRD v7.0）：
 * - 「公告怎么写」：官方事实，只取自公告/岗位表原文摘录；未摘录时明确说明，
 *   不把系统推断写进这一栏；
 * - 「系统预筛判断」：本系统基于画像的比对结论与原因，还不能判断/建议向招聘单位确认
 *   带固定护栏——缺信息不是不符合，歧义不能自动判定。
 */
export function ConditionRows({
  dimensions,
  showDescription = false,
  /** D08：携带条件维度打开纠错弹窗（预选问题位置）；不传则不显示逐行纠错入口 */
  onCorrectCondition,
}: {
  dimensions: DimensionDTO[];
  /** 详情页展示公告原文栏；列表卡片展开态可只展示短判断 */
  showDescription?: boolean;
  onCorrectCondition?: (fieldPath: string) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {dimensions.map((dim) => {
        const meta = DIMENSION_VALUE_META[dim.value];
        return (
          <li
            key={dim.requirementId}
            id={`condition-${dim.requirementId}`}
            className="scroll-mt-24 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium text-ink">
                {dim.dimension === "region"
                  ? "就业地区"
                  : dimensionLabel(dim.dimension)}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {onCorrectCondition && dim.dimension !== "region" && (
                  <button
                    type="button"
                    onClick={() => onCorrectCondition("matching")}
                    className="text-xs text-ink-muted underline-offset-2 hover:text-brand hover:underline"
                  >
                    判断有误？
                  </button>
                )}
                <span
                  className={cn(
                    "inline-flex h-6 shrink-0 items-center gap-1 rounded bg-canvas px-2 text-xs font-medium",
                    meta.className,
                  )}
                >
                  <span aria-hidden="true">{meta.symbol}</span>
                  {meta.text}
                </span>
              </span>
            </div>

            {showDescription && (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <p className="rounded-md bg-canvas p-2 text-xs leading-5 text-ink">
                  <span className="block font-medium text-ink-muted">
                    公告怎么写（官方事实）
                  </span>
                  {dim.dimension === "region" ? (
                    <span className="text-ink-muted">
                      地区意向是你设置的浏览偏好，不是公告条件；不在范围内不等于不符合
                    </span>
                  ) : dim.requirementDescription ? (
                    dim.requirementDescription
                  ) : (
                    <span className="text-ink-muted">
                      本条暂无已摘录的公告/岗位表原文，请以官方岗位表对应行核对
                    </span>
                  )}
                </p>
                <p className="rounded-md bg-surface p-2 text-xs leading-5 text-ink-muted ring-1 ring-line">
                  <span className="block font-medium text-ink-muted">
                    根据你填写的报考信息判断
                  </span>
                  {dim.userFact ? (
                    <span className="mb-1 block text-ink">
                      你的情况：{dim.userFact}
                    </span>
                  ) : null}
                  {dim.adoptedEducation && dim.adoptedEducation.length > 0 ? (
                    <span className="mb-1 block text-ink-muted">
                      采用经历：
                      {dim.adoptedEducation
                        .map((item) => item.majorFullName)
                        .join("、")}
                    </span>
                  ) : null}
                  {dim.reason}
                </p>
              </div>
            )}

            {showDescription && dim.nextStep ? (
              <p className="mt-1.5 text-xs leading-5 text-ink-muted">
                下一步：{dim.nextStep}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
