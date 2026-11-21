/**
 * 覆盖 DTO 的用户端展示派生（纯函数）。
 *
 * M01/F1-F2：DTO 为统一服务端覆盖投影（api-types.CoverageDTO）。
 * 关键口径：
 * - not_started 省份必须显示「暂未收录（待接入）」，不得列出任何城市或来源，
 *   也不得出现「当地没有招聘」类表述；
 * - registered/verified 不代表已有在报岗位；
 * - 来源状态文案逐字区分登记/核验/近期正常/失败/暂停/不可用；
 * - caliber.isFallback 时必须把「非实时」说明透传给用户。
 */
import type {
  CoverageDTO,
  CoverageRegionDTO,
  CoverageSourceStateDTO,
  CoverageStatusDTO,
  ProvinceScopeDTO,
} from "./api-types";

export const PROVINCE_STATUS_LABELS: Record<CoverageStatusDTO, string> = {
  not_started: "暂未收录 · 待接入",
  registered: "已登记 · 核验中",
  verified: "已核验 · 检查待运行",
  monitoring_no_open: "监测中 · 当前无在报批次",
  open_batch_exists: "监测中 · 存在在报批次",
  paused: "监测暂停",
};

export const SOURCE_STATE_LABELS: Record<CoverageSourceStateDTO, string> = {
  registered: "已登记 · 待核验",
  verified: "已核验 · 检查待运行",
  recently_healthy: "近期检查正常",
  check_failed: "检查失败 · 待处理",
  paused: "已暂停",
  blocked: "核验不可用",
};

/** 来源健康点色：recently_healthy 绿；check_failed/blocked 红；其余中性灰 */
export function sourceStateTone(
  state: CoverageSourceStateDTO,
): "ok" | "bad" | "neutral" {
  if (state === "recently_healthy") return "ok";
  if (state === "check_failed" || state === "blocked") return "bad";
  return "neutral";
}

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

/** 非实时回退说明：静态快照/数据库不可用时给用户的明示文案；正常为 null */
export function coverageFallbackNote(coverage: CoverageDTO): string | null {
  return coverage.caliber?.isFallback ? (coverage.caliber.fallbackNote ?? null) : null;
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
