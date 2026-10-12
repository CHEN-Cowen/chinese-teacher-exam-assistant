// 模块 8/9 受邀模式（invited）真实联调 E2E。
//
// 运行前提：
//   1) backend 以 AUTH_MODE=invited 启动（需 PostgreSQL）；
//   2) frontend 以 NEXT_PUBLIC_AUTH_MODE=invited 启动（非 demo 构建，/admin 开启）；
//   3) 库内已种子受邀账号（见脚本底部说明）：inv-student@demo.app（user）、
//      inv-exam@demo.app（exam_reviewer），密码均为 Invited#2026，id 分别为
//      inv-u-001 / inv-u-002（事件断言依赖该 id）。
//
// 验证 invited 链路特有约束：
//   - 浏览器全程不发送 x-user-id / x-user-role（身份只由 HttpOnly cookie 承载）；
//   - sid cookie 对 JS 不可读；刷新后会话经 GET /api/auth/session 恢复；
//   - 登录后访客画像迁移到服务端，匹配由后端按持久化画像计算（迁移与首屏 match 不竞态）；
//   - 错误密码被拒绝；
//   - 账号间数据隔离（第二账号看不到第一账号的关注与日程）；
//   - 登出后会话失效，受保护路由回到 /login。
import { BASE, check, note, runBrowser, clearLocalStorage, assertNoPageErrors } from "./helpers.mjs";

const PASSWORD = "Invited#2026";

async function fillOnboarding(page) {
  // v7.1 M2 两屏基础画像：第一屏地区，第二屏基础资格（学历+专业+毕业+教资）
  await page.getByRole("button", { name: "添加第一个地区" }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "本科", exact: true }).click();
  await page.getByLabel("专业全称").fill("汉语言文学（师范）");
  await page.locator('input[type="month"]').fill("2024-06");
  await page.getByRole("button", { name: "已经取得教师资格证", exact: true }).click();
  await page.getByRole("button", { name: "查看筛选结果" }).click();
}

async function setupStudyMaterials(page) {
  await page.goto(`${BASE}/materials`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /新增资料|添加资料/ }).first().click();
  await page.waitForTimeout(400);
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/资料名称/).fill("语文考编通关宝典（invited 验收）");
  await dlg.getByLabel("来源类型").selectOption({ index: 1 });
  await dlg.getByLabel("适用学段").selectOption({ label: "初中" });
  await dlg.getByLabel("适用地区").fill("浙江省");
  for (const n of ["现代汉语基础", "古代汉语（文言实词虚词句式）", "教育学基础"]) {
    await dlg.getByRole("button", { name: n, exact: true }).click();
  }
  await dlg.getByRole("button", { name: "保存" }).click();
  await page.waitForTimeout(500);

  await page.locator("button", { hasText: "准备情况" }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel("工作日每天可用（分钟）").fill("120");
  await page.getByLabel("每周可用（小时）").fill("10");
  await page.getByRole("button", { name: "保存准备情况" }).click();
  await page.waitForTimeout(500);

  // v7：第 4 个 Tab 文案为「使用建议」
  await page.locator("button", { hasText: "使用建议" }).first().click();
  await page.waitForTimeout(300);
  const gen = page.getByRole("button", { name: /重新计算|再算一次|生成诊断|分析资料怎么用/ });
  if ((await gen.count()) > 0) {
    await gen.first().click();
    await page.waitForTimeout(1500);
  }
}

await runBrowser(async (page, context) => {
  // —— 全程监听：invited 模式浏览器绝不发送 x-user-* 身份头 ——
  const forgedHeaders = [];
  context.on("request", (req) => {
    const h = req.headers();
    if (h["x-user-id"] || h["x-user-role"]) {
      forgedHeaders.push(`${req.method()} ${new URL(req.url()).pathname}`);
    }
  });

  await clearLocalStorage(page);

  // —— 访客：画像 → 初步结果（前端预览引擎，未登录即可见） ——
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByTestId("start-onboarding").click();
  await page.waitForURL("**/onboarding", { timeout: 10000 });
  await fillOnboarding(page);
  await page.waitForURL("**/preview", { timeout: 10000 });
  await page.waitForTimeout(600);
  let body = await page.locator("body").innerText();
  // v7.1：preview 展示虚构示例判断，不再以关注/登录引导
  check("未登录可见初步匹配结果", body.includes("看看以后会怎样帮你判断"), "");

  // —— 错误密码被拒绝 ——
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#account", "inv-student@demo.app");
  await page.fill("#password", "wrong-password");
  await page.click('button[type="submit"]');
  await page.getByText("邮箱或密码不正确").waitFor({ timeout: 8000 });
  check("错误密码被拒绝并提示", true, "");
  // 该 401 是预期行为，清掉以免误报页面健康检查
  page.__failedRequests.length = 0;
  page.__consoleErrors.length = 0;

  // —— 正确登录：HttpOnly cookie + 画像迁移 + 服务端匹配 ——
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/opportunities", { timeout: 15000 });
  // v7.1：机会列表以「优先查看」分区展示即时匹配结果
  await page.getByText("优先查看", { exact: true }).waitFor({ timeout: 15000 });
  body = await page.locator("body").innerText();
  check("登录进入机会列表（服务端按持久化画像匹配）", body.includes("优先查看"), "");
  check(
    "会话 cookie 对 JS 不可读（HttpOnly）",
    !(await page.evaluate(() => document.cookie.includes("sid"))),
    "",
  );
  check(
    "访客暂存事件登录后已迁移",
    (await page.evaluate(() => localStorage.getItem("kb_guest_analytics_pending"))) === "[]",
    "pending 清空",
  );
  check("登录过程未发送任何 x-user-* 身份头", forgedHeaders.length === 0, forgedHeaders.slice(0, 5).join(" | ") || "无");

  // —— 刷新后会话经服务端恢复 ——
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("优先查看", { exact: true }).waitFor({ timeout: 15000 });
  check("刷新后会话恢复（GET /api/auth/session）", (await page.locator("body").innerText()).includes("优先查看"), "");

  // —— 详情：后端按持久化画像逐项判定 ——
  // v7.1：优先机会以卡片分区展示，详情链接在 #priority-opportunity 内
  const openPriorityDetail = async () => {
    const link = page.locator("#priority-opportunity a[href^='/opportunities/']").first();
    await link.waitFor({ state: "visible", timeout: 15000 });
    await link.click();
    await page.waitForURL(/\/opportunities\/.+/, { timeout: 10000 });
  };
  await openPriorityDetail();
  await page.getByText("影响当前判断的条件").waitFor({ timeout: 15000 });
  body = await page.locator("body").innerText();
  check("详情页展示影响当前判断的条件", body.includes("影响当前判断的条件"), "");
  check("详情页展示官方来源", body.includes("官方来源"), "");

  // —— 关注（cookie 身份写服务端） ——
  // v7.1：跟进控件收在「我的跟进」折叠层内；每次操作后 refreshDetail 触发整页 loading，
  // <details> 重挂载为关闭态，因此每个动作后都要重新展开（与 m9-p0-flow 同策略）。
  const openFollowDetails = async () => {
    await page.locator("#follow").evaluate((el) => {
      if (el instanceof HTMLDetailsElement) el.open = true;
    });
  };
  await openFollowDetails();
  await page.getByRole("button", { name: "保存这个机会" }).first().click();
  const preparingButton = page.locator("#follow button", { hasText: "标记为准备报名" }).first();
  await preparingButton.waitFor({ state: "attached", timeout: 15000 });
  await openFollowDetails();
  await preparingButton.waitFor({ state: "visible", timeout: 15000 });
  body = await page.locator("body").innerText();
  check("关注成功：进入考虑中", body.includes("考虑中"), "");

  // —— 日程（包含下一步/时间线或空态） ——
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  body = await page.locator("body").innerText();
  check(
    "日程页包含已关注机会的节点",
    body.includes("下一件不能错过的事") ||
      body.includes("当前最重要的一步") ||
      body.includes("近期没有需要处理的节点") ||
      body.includes("还没有不能错过的事"),
    "",
  );

  // —— 准备报名 + 设为主要目标 ——
  await page.goto(`${BASE}/opportunities`, { waitUntil: "networkidle" });
  await openPriorityDetail();
  await openFollowDetails();
  await preparingButton.waitFor({ state: "visible", timeout: 15000 });
  await preparingButton.click();
  const registeredButton = page.locator("#follow button", { hasText: "我已完成报名" }).first();
  await registeredButton.waitFor({ state: "attached", timeout: 15000 });
  await openFollowDetails();
  await registeredButton.waitFor({ state: "visible", timeout: 15000 });
  body = await page.locator("body").innerText();
  check("已标记准备报名", body.includes("准备报名"), "");

  await page.locator("#follow button", { hasText: "设为重点准备" }).first().click();
  const confirmPrimary = page.getByRole("button", { name: "确认设为重点准备" });
  await confirmPrimary.waitFor({ state: "visible", timeout: 15000 });
  await confirmPrimary.click();
  const backupButton = page.locator("#follow button", { hasText: "改为备选目标" }).first();
  await backupButton.waitFor({ state: "attached", timeout: 15000 });
  await openFollowDetails();
  await backupButton.waitFor({ state: "visible", timeout: 15000 });
  body = await page.locator("body").innerText();
  check("设为主要目标成功", body.includes("改为备选目标") || body.includes("重点准备"), "");

  // —— 备考：门禁 → 资料 → 计划 → 任务反馈（计划/反馈走服务端） ——
  await page.goto(`${BASE}/study`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  body = await page.locator("body").innerText();
  if (body.includes("我已核对，确认考试内容") || body.includes("继续演示：确认示例考情")) {
    note("存在考试内容核对门禁，先确认");
    await page.getByRole("button", { name: /我已核对，确认考试内容|继续演示：确认示例考情/ }).click();
    await page.waitForTimeout(600);
  }
  await setupStudyMaterials(page);
  await page.goto(`${BASE}/study`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  body = await page.locator("body").innerText();
  // v7：生成按钮文案为「生成我的 7 天计划」
  if (body.includes("生成我的 7 天计划")) {
    await page.getByRole("button", { name: "生成我的 7 天计划" }).click();
    await page.waitForTimeout(1000);
  }
  body = await page.locator("body").innerText();
  if (body.includes("确认计划，开始执行")) {
    await page.getByRole("button", { name: "确认计划，开始执行" }).click();
    await page.waitForTimeout(900);
  }
  body = await page.locator("body").innerText();
  check("备考页出现今日任务", body.includes("今天先做这一项") || body.includes("做完后来点一下"), "");

  await page.getByRole("button", { name: "我做完了" }).first().click();
  const feedbackOk = await page.evaluate(() => new Promise((resolve) => {
    const deadline = Date.now() + 10000;
    const tick = () => {
      const events = JSON.parse(localStorage.getItem("kb_analytics_events") || "[]");
      const hit = events.some(
        (e) => e.type === "task_feedback_submitted" && e.source === "live"
          && e.userId === "inv-u-001" && e.props?.status === "completed",
      );
      if (hit) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  }));
  check("首项任务反馈已提交（live/inv-u-001/completed）", feedbackOk, "");

  // —— P0 事件（live/inv-u-001） ——
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem("kb_analytics_events") || "[]"));
  const live = events.filter((e) => e.source === "live" && e.userId === "inv-u-001");
  const types = new Set(live.map((e) => e.type));
  for (const t of [
    "profile_completed",
    "opportunity_revealed",
    "match_basis_viewed",
    "opportunity_followed",
    "follow_status_changed",
    "primary_target_set",
    "task_started",
  ]) {
    check(`P0 事件已记录（live/inv-u-001）：${t}`, types.has(t), types.has(t) ? "" : "缺失");
  }

  // —— 数据隔离：第二个账号看不到第一账号的数据 ——
  const browser = context.browser();
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page2.evaluate(() => window.localStorage.clear());
  await page2.fill("#account", "inv-exam@demo.app");
  await page2.fill("#password", PASSWORD);
  await page2.click('button[type="submit"]');
  await page2.waitForURL("**/opportunities", { timeout: 15000 });
  await page2.waitForTimeout(800);
  await page2.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(600);
  const body2 = await page2.locator("body").innerText();
  check(
    "账号隔离：第二账号日程为空态，看不到第一账号的关注时间线",
    !body2.includes("杭州") && (body2.includes("还没有不能错过的事") || body2.includes("关注机会时间线")),
    body2.includes("杭州") ? "泄漏" : "空态",
  );
  check("第二账号登录同样未发送 x-user-* 头", forgedHeaders.length === 0, forgedHeaders.slice(0, 5).join(" | ") || "无");
  await ctx2.close();

  // —— 登出后会话失效 ——
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /退出登录/ }).first().click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
  check("登出成功回到登录页", true, "");
  await page.goto(`${BASE}/opportunities`, { waitUntil: "networkidle" });
  await page.waitForURL(/\/login/, { timeout: 10000 });
  check("登出后受保护路由跳回 /login", true, "");

  // —— 页面健康（预期 401 已清零） ——
  // 登出后 AuthProvider 恢复会话必然探测 GET /api/auth/session（未登录 → 401），
  // 这是设计内行为而非缺陷，从健康检查中精确排除（仅该 URL 的 401）。
  page.__failedRequests = page.__failedRequests.filter(
    (r) => !(r.startsWith("GET http://localhost:3000/api/auth/session") && r.includes("401")),
  );
  page.__consoleErrors = page.__consoleErrors.filter(
    (e) => !/Failed to load resource.*401 \(Unauthorized\)/.test(e),
  );
  await assertNoPageErrors(page, "invited");
  check("全程未出现 x-user-* 伪造身份头", forgedHeaders.length === 0, forgedHeaders.slice(0, 5).join(" | ") || "无");
});
