/**
 * 国内地图轻量入口（v7.1 M5）：用户主动点击后以网页链接打开高德地图。
 *
 * 技术边界（PRD v7.1 §5.6 / docs/china-network-accessibility.md §3「用户点击的官方外链」）：
 * - 不内嵌地图 SDK/脚本/图片；本模块只做纯字符串构造，点击前零地图资源请求；
 * - 不申请、不读取用户当前位置；
 * - 链接新窗口打开并使用安全外链属性（MAP_LINK_PROPS）；
 * - 地图不可达不影响岗位详情与其他操作（纯 <a> 跳转，非运行依赖）。
 *
 * 高德 URI API 搜索（官方文档 https://lbs.amap.com/api/uri-api/summary ）：
 * https://uri.amap.com/search?keyword=关键词&callnative=0
 */
import type { SchoolPlacementDTO } from "./api-types";

/** 地点类别枚举。埋点只记录该枚举，不记录完整地址或地图搜索文本。 */
export type MapLocationCategory = "school" | "district";

export interface MapEntry {
  /** 高德地图网页搜索链接（用户点击后才由浏览器请求） */
  url: string;
  category: MapLocationCategory;
}

/** 安全外链属性：新窗口 + noopener noreferrer，组件与测试共用同一常量 */
export const MAP_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

/** 按钮固定文案（PRD v7.1 §5.6） */
export const MAP_LINK_LABEL = "在地图中查看 ↗";

/**
 * 构造地图入口。规则：
 * - 有明确学校（官方逐校列明）：「市＋区＋学校名称」——同名学校必须含市区消歧；
 * - 只有区县 / 录用后选岗 / 统一调配：只打开「市＋区」行政区，不制造学校点位；
 * - 连市也未明确：返回 null（页面隐藏地图入口）。
 */
export function buildMapEntry(input: {
  city?: string;
  district?: string;
  schoolPlacement?: SchoolPlacementDTO;
}): MapEntry | null {
  const city = input.city?.trim();
  if (!city) return null;
  const district = input.district?.trim() || "";
  const placement = input.schoolPlacement;
  if (placement?.status === "specified" && placement.schoolName.trim()) {
    return {
      url: amapSearchUrl(`${city}${district}${placement.schoolName.trim()}`),
      category: "school",
    };
  }
  return { url: amapSearchUrl(`${city}${district}`), category: "district" };
}

function amapSearchUrl(keyword: string): string {
  // callnative=0：未安装高德 App 时停留在网页版，不强制唤起
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(keyword)}&callnative=0`;
}
