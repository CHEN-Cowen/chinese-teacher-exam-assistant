// 模块 9 高风险回归（运行时网络）：
//  A. 核心页面不得产生任何未列入允许清单的境外（跨源）运行时请求；
//  B. 阻断全部跨源请求后，首页/登录/机会/日程/备考/管理审核仍可完成核心操作。
//
// 实现：在浏览器上下文层拦截所有请求，同源（含 Next 代理的 /api）放行，
// 其余一律 abort 并登记。产品口径为 default-src/connect-src 'self'，
// 因此正常运行时“尝试跨源请求”本身即视为违规（用户点击的政府外链是导航/新窗口，
// 不是自动运行时请求，不在本脚本断言范围）。
//
// 运行前提：frontend + backend + PostgreSQL 均可用（与 m9-p0-flow 相同）。
//
// 两种模式（管理端在公开演示构建中按产品设计关闭，必须在非 demo 构建上验证）：
//   node m9-blocked-runtime.mjs                # user：首页/登录/机会/日程/备考
//   node m9-blocked-runtime.mjs admin          # admin：审核员登录 + 考情审核队列
//
// admin 模式的目标源由环境变量指定（非 demo 构建，例如 3001）：
//   $env:QA_ADMIN_BASE="http://localhost:3001"; node m9-blocked-runtime.mjs admin
import { BASE, ACCOUNTS, check, note, runBrowser, guestOnboarding, demoLogin } from "./helpers.mjs";

const MODE = process.argv[2] === "admin" ? "admin" : "user";
const ORIGIN = MODE === "admin" ? process.env.QA_ADMIN_BASE ?? BASE : BASE;

await runBrowser(async (page, context) => {
  const blockedCrossOrigin = [];
  await context.route("**/*", (route) => {
    const req = route.request();
    const u = new URL(req.url());
    // 同源（含 Next HMR 与 /api 同源代理）放行；data:/blob: 为浏览器内联资源，一并放行
    if (u.origin === ORIGIN || u.protocol === "data:" || u.protocol === "blob:") {
      return route.continue();
    }
    blockedCrossOrigin.push(`${req.method()} ${u.origin}${u.pathname} (from ${page.url()})`);
    return route.abort();
  });
  note(`已阻断全部跨源请求；同源放行（${ORIGIN}）`);

  if (MODE === "user") {
    // 1) 首页：访客价值主张与画像入口可用
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    let body = await page.locator("body").innerText();
    // v7.1 M1：首页主标题为「找到真正适合你报考的教师招聘机会」
    check("首页核心内容可见", body.includes("找到真正适合你报考的教师招聘机会"), "");
    check("首页画像入口可用", await page.getByTestId("start-onboarding").isVisible(), "");

    // 2) 访客画像 → 登录：在断跨源条件下完成画像、预览与 demo 登录
    await page.evaluate(() => localStorage.clear());
    await guestOnboarding(page, BASE);
    // v7：preview 为虚构示例，不引导关注/登录；直接进入登录页
    await page.goto(`${BASE}/login?next=/opportunities`, { waitUntil: "networkidle" });
    await page.fill("#account", ACCOUNTS.student.account);
    await page.fill("#password", ACCOUNTS.student.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/opportunities", { timeout: 15000 });
    check("登录成功并进入机会页", page.url().includes("/opportunities"), page.url());

    // 3) 机会：即时匹配列表可读（轮询等待列表结论）
    await page.getByText("优先查看", { exact: true }).first().waitFor({ timeout: 15000 });
    body = await page.locator("body").innerText();
    check("机会页核心操作可用（列表结论与优先机会）", body.includes("优先查看") && body.includes("机会结论"), "机会结论 + 优先查看");

    // 4) 日程：时间线/空态可读
    await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    body = await page.locator("body").innerText();
    check("日程页核心内容可用", body.includes("完整时间线") || body.includes("还没有不能错过的事") || body.includes("近期没有需要处理的节点"), "");

    // 5) 备考：门禁/任务页可读（不要求新用户一定有今日任务）
    await page.goto(`${BASE}/study`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    body = await page.locator("body").innerText();
    check(
      "备考页核心内容可用（主目标门禁或今日任务）",
      body.includes("先选择一个重点准备的机会") ||
        body.includes("今天") ||
        body.includes("生成我的 7 天计划") ||
        body.includes("确认示例考情") ||
        body.includes("先打开官方公告核对"),
      "",
    );
  } else {
    // 6) 管理审核：审核员在非 demo 构建登录后审核队列可读
    await demoLogin(page, ORIGIN, ACCOUNTS.exam.account, ACCOUNTS.exam.password);
    await page.goto(`${ORIGIN}/admin/reviews`, { waitUntil: "networkidle" });
    await page.getByText("考情审核队列").waitFor({ timeout: 15000 });
    const body = await page.locator("body").innerText();
    check("管理审核核心页面可用（考情审核队列）", body.includes("考情审核队列"), "");
  }

  // —— 网络断言：全程无自动跨源运行时请求 ——
  check(
    "核心页面无任何跨源运行时请求（默认仅允许同源）",
    blockedCrossOrigin.length === 0,
    blockedCrossOrigin.slice(0, 10).join(" | ") || "全部同源",
  );
});
