"use client";

import { useParams, useSearchParams } from "next/navigation";
import { SupplementPageView } from "@/components/opportunities/SupplementPageView";
import { isDemoMode } from "@/lib/demo/config";

/**
 * v7.2 真实岗位定向补充页（PRD 7.4.4 / 7.8）。
 * 路由：/opportunities/[unitId]/supplement?origin=preview|opportunities|detail&bucket=need_more_info|manual_review
 *
 * 不变量：
 * - origin 只接受 preview | opportunities | detail；非法安全回退；
 * - bucket 只接受定义好的枚举；非法安全回退；
 * - 缺失字段根据最新岗位和画像重算，不信任 URL；
 * - 补充信息绝不进入 /onboarding（已知字段不重复问）。
 *
 * D05：渲染通道跟随构建环境（构建期内联，不读运行时 env）。demo 构建里
 * 本路由只服务浏览器本地演示岗位（无后端代理，/api 恒 503）；硬编码
 * mode="real" 会让已登录演示账号走受邀式 PATCH /api/profile 持久化，
 * 保存即整页报错。受邀构建保持 mode="real"。
 */
export default function SupplementPage() {
  const params = useParams<{ unitId: string }>();
  const searchParams = useSearchParams();
  const unitId = params?.unitId ?? "";
  const searchParamsString = searchParams?.toString() ?? "";

  return (
    <SupplementPageView
      mode={isDemoMode ? "demo" : "real"}
      unitId={unitId}
      searchParamsString={searchParamsString}
    />
  );
}
