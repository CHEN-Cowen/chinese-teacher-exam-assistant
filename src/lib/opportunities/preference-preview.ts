/**
 * 偏好调整影响预览（D04 / PRD 11.5，纯函数）。
 *
 * 口径：
 * - 调整前后计数都来自 buildListViewModel 的 workbench 三标签分桶，
 *   与 /opportunities 实际列表保持同一数据源（计数必然一致）；
 * - 按报考单元去重；已截止、来源失效与待人工复核不进入三标签主桶；
 * - 只放宽/调整偏好，资格判断规则不变（预览响应由后端同一引擎计算）；
 * - 目录版本（catalogVersion/realCatalogVersion）不一致时预览视为过期，
 *   调用方必须丢弃并重新加载列表，不得把旧目录的结果当作当前影响。
 */
import type { MetaDTO } from "./api-types";
import type { OpportunityListViewModel } from "./list-view";

export interface PreferenceBucketCounts {
  /** 初步符合（偏好范围内） */
  priority: number;
  /** 补充信息后可判断 */
  supplement: number;
  /** 偏好范围外（资格无明确不符合） */
  outOfScope: number;
  /** 留档（已截止/来源失效/明确不符合，按报考单元去重） */
  excluded: number;
}

export function countPreferenceBuckets(
  view: OpportunityListViewModel,
): PreferenceBucketCounts {
  return {
    priority: view.workbench.priority.count,
    supplement: view.workbench.supplement.count,
    outOfScope: view.workbench.outOfScope.count,
    excluded: new Set(view.workbench.excluded.map((u) => u.unit.id)).size,
  };
}

/** 目录版本一致才允许用预览响应对比当前列表，否则必须丢弃 */
export function isSameCatalog(current: MetaDTO, preview: MetaDTO): boolean {
  return (
    current.catalogVersion === preview.catalogVersion &&
    current.realCatalogVersion === preview.realCatalogVersion
  );
}

export interface PreferencePreviewResult {
  before: PreferenceBucketCounts;
  after: PreferenceBucketCounts;
  /** 只列出有变化的桶，如「初步符合 0 → 2（+2）」；全部不变时为空 */
  lines: string[];
  /** 新增进入优先/待补充的单元名称（最多 5 个，供用户核对具体岗位） */
  newUnitNames: string[];
  /** 调整后三标签数量完全不变 */
  unchanged: boolean;
  /** 统计口径说明（必须在预览卡片中展示） */
  caliberNote: string;
}

const BUCKET_LABELS: { key: keyof PreferenceBucketCounts; label: string }[] = [
  { key: "priority", label: "初步符合" },
  { key: "supplement", label: "待补充信息" },
  { key: "outOfScope", label: "偏好范围外" },
  { key: "excluded", label: "留档（截止/不符合）" },
];

export const PREFERENCE_PREVIEW_CALIBER_NOTE =
  "统计口径：按报考单元去重；已截止、来源失效与待人工核对的公告不计入" +
  "「初步符合/待补充」；预览只调整偏好，资格判断规则不变。";

export function buildPreferencePreview(
  beforeView: OpportunityListViewModel,
  afterView: OpportunityListViewModel,
): PreferencePreviewResult {
  const before = countPreferenceBuckets(beforeView);
  const after = countPreferenceBuckets(afterView);
  const lines: string[] = [];
  for (const { key, label } of BUCKET_LABELS) {
    if (before[key] === after[key]) continue;
    const delta = after[key] - before[key];
    lines.push(
      `${label} ${before[key]} → ${after[key]}（${delta > 0 ? `+${delta}` : delta}）`,
    );
  }
  const beforeActionable = new Set(
    [
      ...beforeView.workbench.priority.units,
      ...beforeView.workbench.supplement.units,
    ].map((u) => u.unit.id),
  );
  const newUnitNames = [
    ...afterView.workbench.priority.units,
    ...afterView.workbench.supplement.units,
  ]
    .filter((u) => !beforeActionable.has(u.unit.id))
    .map((u) => u.unit.name)
    .slice(0, 5);
  return {
    before,
    after,
    lines,
    newUnitNames,
    unchanged: lines.length === 0,
    caliberNote: PREFERENCE_PREVIEW_CALIBER_NOTE,
  };
}
