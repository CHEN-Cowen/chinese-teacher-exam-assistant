"use client";

import { useParams, useSearchParams } from "next/navigation";
import { SupplementPageView } from "@/components/opportunities/SupplementPageView";

/**
 * v7.2 演示岗位定向补充页（PRD 7.4.4 / 7.8）。
 * 路由：/preview/supplement/[unitId]?origin=preview&bucket=need_more_info
 *
 * Demo 模式：
 * - 使用独立的 preview supplement 路由；
 * - 不持久化敏感事实（出生日期/户籍/社保/工作经历只写本机会时缓存）；
 * - 补充信息绝不进入 /onboarding。
 */
export default function PreviewSupplementPage() {
  const params = useParams<{ unitId: string }>();
  const searchParams = useSearchParams();
  const unitId = params?.unitId ?? "";
  const searchParamsString = searchParams?.toString() ?? "";

  return (
    <SupplementPageView
      mode="demo"
      unitId={unitId}
      searchParamsString={searchParamsString}
    />
  );
}
