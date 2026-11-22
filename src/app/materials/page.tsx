"use client";

/**
 * 材料清单旧路由兜底页：正常流量经 src/proxy.ts 跳转到
 * /study?tab=materials；本页仅兜底直达访问，渲染同一视图组件。
 */
import { MaterialsView } from "@/components/materials/MaterialsView";

export default function MaterialsPage() {
  return <MaterialsView />;
}
