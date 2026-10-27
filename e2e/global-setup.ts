import { request, type APIRequestContext } from "@playwright/test";

/**
 * E2E 预构建之后的「预热」步骤（Playwright 保证 globalSetup 在 webServer 就绪后执行）。
 *
 * 背景：`pretest:e2e`（scripts/e2e-prebuild.mjs）只把 3123 的 v7.2 生产产物提前构建好；
 * 3001 仍是 `next dev`，路由按需冷编译。若 4 个并行 worker 同时首访同一路由，
 * 冷编译成本会累加并触发 60s 测试超时（实测 /opportunities 冷编译 19-20s）。
 *
 * 这里在测试开始前把两个服务的关键路由各顺序预热一次，使路由编译在测试期之前完成。
 * 只做 HTTP GET，不注入任何产品开关/断言，不改动既有测试行为。
 */

// 与 playwright.config.ts 的 FALLBACK_PORT 保持一致（3000 被本机无关进程占用，迁至 3001）。
const FALLBACK_BASE = "http://localhost:3001";
const V72_BASE = "http://localhost:3123";

// 3001（dev，仅 NEXT_PUBLIC_FF_POST_SAVE_NEXT=true）在既有/回退用例中被访问的路由。
const FALLBACK_ROUTES = [
  "/",
  "/login",
  "/onboarding",
  "/preview",
  "/opportunities",
  "/opportunities/unit-hangzhou-01",
  "/opportunities/unit-suzhou-01",
  "/preview/supplement/unit-hangzhou-01",
];

// 3123 为预构建产物，预热成本低，做一遍稳妥。
const V72_ROUTES = ["/", "/login", "/opportunities", "/opportunities/unit-hangzhou-01"];

async function warm(ctx: APIRequestContext, base: string, routes: string[]) {
  for (const route of routes) {
    const started = Date.now();
    try {
      const res = await ctx.get(base + route, {
        timeout: 120_000,
        maxRedirects: 5,
        failOnStatusCode: false,
      });
      console.log(
        `[warmup] ${base}${route} → ${res.status()} (${Date.now() - started}ms)`,
      );
    } catch (err) {
      // 预热失败不应中断测试；真正的失败由测试用例本身报告。
      console.log(
        `[warmup] ${base}${route} ✗ (${Date.now() - started}ms): ${
          (err as Error).message
        }`,
      );
    }
  }
}

export default async function globalSetup() {
  const ctx = await request.newContext();
  try {
    await warm(ctx, FALLBACK_BASE, FALLBACK_ROUTES);
    await warm(ctx, V72_BASE, V72_ROUTES);
  } finally {
    await ctx.dispose();
  }
}
