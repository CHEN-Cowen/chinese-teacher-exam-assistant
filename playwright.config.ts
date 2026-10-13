import { defineConfig, devices } from "@playwright/test";

/**
 * v7.2 浏览器 E2E（P0 回归：补充信息绝不进入 /onboarding）。
 *
 * - demo 模式下匹配与详情走纯本地 demoApi，无需后端；
 * - 优先复用已在运行的 dev server（reuseExistingServer），未运行时自动启动；
 * - 前端 vitest include 仅 src/**、tests/**、scripts/**，e2e/** 不会被单元测试扫描。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
