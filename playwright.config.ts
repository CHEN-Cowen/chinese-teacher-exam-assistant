import { defineConfig, devices } from "@playwright/test";

/**
 * v7.2 浏览器 E2E（P0 回归：补充信息绝不进入 /onboarding）。
 *
 * 开关态覆盖（NEXT_PUBLIC_* 在 Next 编译期内联，必须随构建进程注入）：
 * - 3001「回退态」：仅开 NEXT_PUBLIC_FF_POST_SAVE_NEXT，其余 v7.2 开关默认关闭，
 *   渲染 v7.1 旧首页 / StackedResultSections 旧式结果布局 / 详情页内联 #supplement。
 *   供既有用例 + v72-flag-fallback 使用。
 * - 3123「v7.2 开启态」：production 产物由 `pretest:e2e`
 *   （scripts/e2e-prebuild.mjs）预先用全开关构建完成，此处只 `next start`。
 *
 * 为何预构建：若在 webServer 内 `npm run build`，它会与 3000 的 `next dev`
 * 并发运行并清空/争用 `.next/dev`，把 dev 的按需编译拖慢（实测 /opportunities
 * 冷编译被拖到 19-20s），令既有 legacy 用例超过 60s 测试超时。
 * 预构建把 build 提前到 Playwright 启动前，dev 在测试期独占资源。
 *
 * 两个服务并存：next dev 产物在 .next/dev，next build 产物在 .next/，互不覆盖
 * （已实测 dev(3000) 在 build 期间持续可用；生产构建不会删除 .next/dev）。
 */
// 3000 曾被本机常驻的无关进程（lark-channel-bridge）占用，
// reuseExistingServer 会把响应该端口的外部服务误当 dev server，legacy 用例全灭；
// 回退态 dev 迁到 3001（CI 上均为空闲端口，无影响）。
const FALLBACK_PORT = 3001;
// 3100 是本机「演示服务」约定端口（scripts/start-demo.ps1），常驻运行会与 E2E 抢占；
// v7.2 E2E 改用 3123，互不干扰（CI 上均为空闲端口，无影响）。
const V72_PORT = 3123;

export default defineConfig({
  testDir: "./e2e",
  // webServer 就绪后、测试开始前，顺序预热两个服务的关键路由，
  // 把 3000 dev 的按需冷编译提前到测试期之外（详见 e2e/global-setup.ts）。
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "legacy",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${FALLBACK_PORT}`,
      },
      testMatch: [
        "supplement-flow.spec.ts",
        "v72-saved-next-action.spec.ts",
        "v72-flag-fallback.spec.ts",
      ],
    },
    {
      name: "v72",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${V72_PORT}`,
      },
      testMatch: [
        "v72-home.spec.ts",
        "v72-workbench.spec.ts",
        "v72-responsive.spec.ts",
        "v72-unified-results.spec.ts",
      ],
    },
  ],
  webServer: [
    {
      command: `npx next dev -p ${FALLBACK_PORT}`,
      url: `http://localhost:${FALLBACK_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      // v7.2 E2E 锁定的是「保存后的下一步」开关开启后的行为。
      env: {
        ...process.env,
        NEXT_PUBLIC_FF_POST_SAVE_NEXT: "true",
      },
    },
    {
      // 产物已由 `pretest:e2e`（scripts/e2e-prebuild.mjs）用 v7.2 全开关构建完成；
      // webServer 只启动，不在测试期 build（避免与 3000 dev 并发争用）。
      command: `npx next start -p ${V72_PORT}`,
      url: `http://localhost:${V72_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_FF_NEW_HOME: "true",
        NEXT_PUBLIC_FF_NEW_RESULTS: "true",
        NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT: "true",
        NEXT_PUBLIC_FF_POST_SAVE_NEXT: "true",
        NEXT_PUBLIC_FF_ACTIVE_CRAWL: "true",
        // production 构建下 ff_db_catalog 默认开启会改变目录来源；demo/E2E 无后端数据库，显式关闭。
        NEXT_PUBLIC_FF_DB_CATALOG: "false",
      },
    },
  ],
});
