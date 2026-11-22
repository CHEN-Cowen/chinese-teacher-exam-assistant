"use client";

/**
 * 报考日程旧路由兜底页：正常流量经 src/proxy.ts 跳转到
 * /applications?tab=schedule；本页仅兜底直达访问，渲染同一视图组件。
 */
import { ScheduleView } from "@/components/schedule/ScheduleView";

export default function SchedulePage() {
  return <ScheduleView />;
}
