"use client";

/**
 * 我的关注旧路由兜底页：正常流量经 src/proxy.ts 跳转到
 * /applications?tab=follows；本页仅兜底直达访问，渲染同一视图组件。
 */
import { FollowsView } from "@/components/follows/FollowsView";

export default function FollowsPage() {
  return <FollowsView />;
}
