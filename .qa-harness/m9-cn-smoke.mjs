// 中国大陆无代理网络冒烟（模块 9）。
// 必须以 QA_FORCE_DIRECT=1 运行：浏览器被强制直连（绕过系统代理/TUN），
// 因此脚本结果代表“普通大陆网络、无代理”的真实可达性。
//
// 采集三类证据：
//   1) 浏览器自身出口 IP 与归属地（页面内请求，非 curl）；
//   2) 一条真实政府官网可打开（产品外链的同类目标；种子内为 example.gov.cn 占位，
//      占位不可达是预期行为，故这里测真实站点证明链路本身不依赖代理）；
//   3) 产品核心链路在零跨源请求下可用（首页→画像→预览→登录→有效机会）。
//
// 用法：$env:QA_FORCE_DIRECT="1"; node m9-cn-smoke.mjs
import { BASE, ACCOUNTS, check, note, runBrowser, guestOnboarding } from "./helpers.mjs";

await runBrowser(async (page, context) => {
  if (process.env.QA_FORCE_DIRECT !== "1") {
    note("未设置 QA_FORCE_DIRECT=1：浏览器可能走系统代理，本次结果不得作为无代理冒烟证据");
  } else {
    note("QA_FORCE_DIRECT=1：浏览器已强制直连");
  }

  // 1) 浏览器出口（http 明文服务，仅取归属地文本）
  await page.goto("http://myip.ipip.net", { waitUntil: "domcontentloaded", timeout: 15000 });
  const egress = (await page.locator("body").innerText()).trim();
  note(`浏览器出口：${egress}`);
  check("浏览器直连出口落在中国大陆", /中国/.test(egress), egress);

  // 2) 真实政府官网（用户主动点击外链的同类目标）
  const gov = await context.newPage();
  let govOk = false;
  let govTitle = "";
  try {
    await gov.goto("https://www.hangzhou.gov.cn/", { waitUntil: "domcontentloaded", timeout: 15000 });
    govTitle = await gov.title();
    govOk = /杭州/.test(govTitle);
  } catch (e) {
    govTitle = String(e).slice(0, 120);
  }
  check("真实政府官网（杭州市政府）可直连打开", govOk, govTitle);
  await gov.close();

  // 3) 产品核心链路：记录跨源请求（产品页应为 0）
  const crossOrigin = [];
  context.on("request", (req) => {
    const u = new URL(req.url());
    if (u.origin !== BASE && u.protocol.startsWith("http")) crossOrigin.push(`${req.method()} ${u.origin}`);
  });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await guestOnboarding(page, BASE);
  let body = await page.locator("body").innerText();
  // v7.1：preview 展示虚构示例判断（「看看以后会怎样帮你判断」），不再以关注/登录引导
  check("访客初步机会可见", body.includes("看看以后会怎样帮你判断"), "");

  // v7.1 M8：登录通过独立入口完成，登录后进入机会列表继续 demo 闭环
  await page.goto(`${BASE}/login?next=/opportunities`, { waitUntil: "networkidle" });
  await page.fill("#account", ACCOUNTS.student.account);
  await page.fill("#password", ACCOUNTS.student.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/opportunities", { timeout: 15000 });
  // v7.1：机会列表以「优先查看」分区展示即时匹配结果
  await page.getByText("优先查看", { exact: true }).waitFor({ timeout: 15000 });
  body = await page.locator("body").innerText();
  check("登录后即时匹配可用", body.includes("优先查看"), "");

  // 仅统计发往产品页面的跨源（排除出口探测与政府站页签）
  const appCross = crossOrigin.filter((c) => !c.includes("myip.ipip.net"));
  check(
    "产品页面零跨源运行时请求（无代理网络下不依赖任何境外/第三方主机）",
    appCross.length === 0,
    appCross.slice(0, 8).join(" | ") || "全部同源",
  );
});
