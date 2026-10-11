/**
 * 覆盖 DTO 的用户端展示派生（纯函数）。
 *
 * 关键口径：选择省时只能看到该省「实际监测」的城市与来源；
 * not_started 省份必须显示「暂未收录（待接入）」，不得列出任何城市或来源，
 * 也不得出现「当地没有招聘」类表述。
 */
import type {
  CoverageDTO,
  CoverageRegionDTO,
  CoverageStatusDTO,
  ProvinceScopeDTO,
} from "./api-types";

export const PROVINCE_STATUS_LABELS: Record<CoverageStatusDTO, string> = {
  monitoring_no_open: "监测中 · 当前无在报批次",
  open_batch_exists: "监测中 · 存在在报批次",
  paused: "监测暂停",
  not_started: "暂未收录 · 待接入",
};

export interface ProvinceScopeView extends ProvinceScopeDTO {
  statusLabel: string;
  /** 已监测城市短名（如「杭州、宁波（含鄞州等区县）」）；未监测为「暂未收录」 */
  cityText: string;
  /** 该省实际监测城市的完整栏目结构（not_started 省份为空数组） */
  monitoredRegions: CoverageRegionDTO[];
}

/** “浙江省·杭州市” / “浙江·杭州” → “杭州市” / “杭州”；无分隔符时原样返回 */
function shortCityLabel(label: string): string {
  const parts = label.split("·");
  return parts.length > 1 ? parts.slice(1).join("·") : label;
}

export function buildProvinceScopeViews(
  coverage: CoverageDTO,
): ProvinceScopeView[] {
  const regionsByCode = new Map(
    coverage.regions.map((region) => [region.code, region]),
  );
  return coverage.provinces.map((province) => {
    const monitoredRegions = province.monitoredRegionCodes
      .map((code) => regionsByCode.get(code))
      .filter((region): region is CoverageRegionDTO => Boolean(region));
    return {
      ...province,
      statusLabel: PROVINCE_STATUS_LABELS[province.status],
      cityText:
        monitoredRegions.length > 0
          ? monitoredRegions.map((r) => shortCityLabel(r.label)).join("、")
          : "暂未收录",
      monitoredRegions,
    };
  });
}

/**
 * 一句话逐省覆盖摘要，用于首页/preview 的真实监测事实行，例如：
 * 「浙江：杭州、宁波（含鄞州等区县） · 江苏：暂未收录（待接入）」
 */
export function coverageProvinceLine(coverage: CoverageDTO): string {
  return buildProvinceScopeViews(coverage)
    .map((view) => {
      const provinceShort = view.label.replace(/省$|市$/, "");
      const city =
        view.status === "not_started"
          ? "暂未收录（待接入）"
          : view.cityText;
      return `${provinceShort}：${city}`;
    })
    .join(" · ");
}
