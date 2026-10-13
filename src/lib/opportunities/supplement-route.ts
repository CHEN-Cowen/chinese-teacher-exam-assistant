/**
 * v7.2 定向补充路由工具（PRD 7.4.4 / 7.8 / 7.10）。
 *
 * - 真实岗位固定路由：/opportunities/[unitId]/supplement?origin=...&bucket=...
 * - 演示岗位路由：/preview/supplement/[unitId]?origin=...&bucket=...
 * - origin 只接受 preview | opportunities | detail；非法值安全回退到 preview。
 * - bucket 只接受定义好的枚举；非法值安全回退到 need_more_info。
 * - 缺失字段必须根据最新岗位和当前画像重新计算，不信任 URL（本模块只管路由
 *   生成与参数校验，字段重算在补充页面内完成）。
 */

/** 合法来源（决定保存后回到哪个上下文） */
export const SUPPLEMENT_ORIGIN_VALUES = [
  "preview",
  "opportunities",
  "detail",
] as const;
export type SupplementOrigin = (typeof SUPPLEMENT_ORIGIN_VALUES)[number];

/** 合法分类桶（决定渲染哪些缺失子字段） */
export const SUPPLEMENT_BUCKET_VALUES = [
  "need_more_info",
  "manual_review",
] as const;
export type SupplementBucket = (typeof SUPPLEMENT_BUCKET_VALUES)[number];

/** 默认回退值 */
export const DEFAULT_SUPPLEMENT_ORIGIN: SupplementOrigin = "preview";
export const DEFAULT_SUPPLEMENT_BUCKET: SupplementBucket = "need_more_info";

/** 判断字符串是否是合法 origin */
export function isSupplementOrigin(
  value: unknown,
): value is SupplementOrigin {
  return (
    typeof value === "string" &&
    (SUPPLEMENT_ORIGIN_VALUES as readonly string[]).includes(value)
  );
}

/** 判断字符串是否是合法 bucket */
export function isSupplementBucket(
  value: unknown,
): value is SupplementBucket {
  return (
    typeof value === "string" &&
    (SUPPLEMENT_BUCKET_VALUES as readonly string[]).includes(value)
  );
}

/**
 * 构建真实岗位的定向补充路由。
 * 真实岗位使用 /opportunities/[unitId]/supplement。
 */
export function buildSupplementRoute(
  unitId: string,
  origin: SupplementOrigin = DEFAULT_SUPPLEMENT_ORIGIN,
  bucket: SupplementBucket = DEFAULT_SUPPLEMENT_BUCKET,
): string {
  const params = new URLSearchParams({ origin, bucket });
  return `/opportunities/${encodeURIComponent(unitId)}/supplement?${params.toString()}`;
}

/**
 * 构建演示岗位的定向补充路由。
 * 演示岗位使用 /preview/supplement/[unitId]，不持久化敏感事实。
 */
export function buildPreviewSupplementRoute(
  unitId: string,
  origin: SupplementOrigin = DEFAULT_SUPPLEMENT_ORIGIN,
  bucket: SupplementBucket = DEFAULT_SUPPLEMENT_BUCKET,
): string {
  const params = new URLSearchParams({ origin, bucket });
  return `/preview/supplement/${encodeURIComponent(unitId)}?${params.toString()}`;
}

export interface ParsedSupplementParams {
  origin: SupplementOrigin;
  bucket: SupplementBucket;
  /** true=参数原样合法；false=至少一个参数非法并已回退 */
  valid: boolean;
}

/**
 * 解析并校验 URL search params 中的 origin 和 bucket。
 * 非法值安全回退到默认值，valid=false 标记发生了回退。
 * 调用方据此决定是否需要重新计算缺失字段（无论 valid 与否都应重算）。
 */
export function parseSupplementParams(
  searchParams: URLSearchParams | Record<string, string> | undefined,
): ParsedSupplementParams {
  const get = (key: string): string | null => {
    if (!searchParams) return null;
    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key);
    }
    return searchParams[key] ?? null;
  };

  const rawOrigin = get("origin");
  const rawBucket = get("bucket");

  const origin = isSupplementOrigin(rawOrigin)
    ? rawOrigin
    : DEFAULT_SUPPLEMENT_ORIGIN;
  const bucket = isSupplementBucket(rawBucket)
    ? rawBucket
    : DEFAULT_SUPPLEMENT_BUCKET;

  return {
    origin,
    bucket,
    valid:
      isSupplementOrigin(rawOrigin) && isSupplementBucket(rawBucket),
  };
}
