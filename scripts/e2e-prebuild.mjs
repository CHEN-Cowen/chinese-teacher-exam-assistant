/**
 * v7.2 E2E 预构建：在 Playwright 启动 webServer 之前，用「v7.2 全开关开启」的
 * 环境变量跑一次 `npm run build`，产出 3100 生产服务所需的编译期开关快照。
 *
 * 为什么不在 playwright.config.ts 的 webServer 里 build：
 * NEXT_PUBLIC_* 在 Next 编译期内联。若构建与 3000 的 `next dev` 并发运行，
 * 会清空/争用 `.next/dev`，把 dev 的按需编译拖慢（实测 /opportunities 冷编译
 * 被拖到 19-20s），令既有 legacy 用例超过 60s 测试超时。
 * 因此把构建提前到 `pretest:e2e`，让 dev 在测试期间独占资源。
 *
 * 只服务于 E2E，不改变正常 `npm run build` 的行为。
 */
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NEXT_PUBLIC_FF_NEW_HOME: "true",
  NEXT_PUBLIC_FF_NEW_RESULTS: "true",
  NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT: "true",
  NEXT_PUBLIC_FF_POST_SAVE_NEXT: "true",
  NEXT_PUBLIC_FF_ACTIVE_CRAWL: "true",
  // production 构建下 ff_db_catalog 默认开启；demo/E2E 无后端数据库，显式关闭。
  NEXT_PUBLIC_FF_DB_CATALOG: "false",
};

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env,
  shell: true,
});

process.exit(result.status ?? 1);
