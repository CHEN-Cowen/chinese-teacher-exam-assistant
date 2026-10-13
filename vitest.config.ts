import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 配置（项目此前无测试框架，v5.2 为关键规则补单元测试而引入）。
 * - 纯函数域层（domain.ts）与本地 Mock service 是主要测试对象；
 * - service 层依赖 localStorage，测试环境使用 jsdom；
 * - 路径别名与 tsconfig 的 "@/*" 保持一致。
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts", // 工作包 0：样本自检/隔离守护/链路回归
      "tests/**/*.test.tsx",
      "scripts/**/*.test.mjs", // 网络基线守卫（模块 0A）
    ],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
