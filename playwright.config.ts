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
    // v7.2 E2E 锁定的是「保存后的下一步」开关开启后的行为；
    // NEXT_PUBLIC_* 在 dev 编译期内联，必须随 dev server 进程注入。
    env: {
      ...process.env,
      NEXT_PUBLIC_FF_POST_SAVE_NEXT: "true",
    },
  },
});
