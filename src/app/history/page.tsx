"use client";

/**
 * 往年参考旧路由兜底页：正常流量经 src/proxy.ts 跳转到
 * /opportunities?tab=history；本页仅兜底直达访问，渲染同一列表组件。
 */
import { HistoryListView } from "@/components/history/HistoryListView";

export default function HistoryPage() {
  return <HistoryListView />;
}
