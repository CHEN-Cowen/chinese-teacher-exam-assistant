// QA 验收辅助库（仅本地验收用，不属于产品代码）
import { chromium } from "playwright";

export const BASE = (process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
export const SHOT_DIR = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export const ACCOUNTS = {
  student: { account: "student@demo.app", password: "demo1234" },
  exam: { account: "exam@demo.app", password: "demo1234" },
  resource: { account: "resource@demo.app", password: "demo1234" },
  admin: { account: "admin@demo.app", password: "demo1234" },
};

const results = [];
export function check(name, ok, evidence = "") {
  results.push({ name, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${evidence ? ` | ${evidence}` : ""}`);
}
export function note(msg) {
  console.log(`NOTE | ${msg}`);
}
export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  return failed.length;
}

export async function freshContext(browser, { mobile = false } = {}) {
  const context = mobile
    ? await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      })
    : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    const url = r.url();
    if (url.includes("/favicon")) return;
    const s = r.status();
    if (s >= 400) failedRequests.push(`${r.request().method()} ${url} :: HTTP ${s}`);
  });
  page.__consoleErrors = consoleErrors;
  page.__failedRequests = failedRequests;
  return { context, page };
}

export async function assertNoPageErrors(page, label) {
  await page.waitForTimeout(400);
  const errs = page.__consoleErrors.filter((e) => !e.includes("favicon"));
  check(`[${label}] 控制台无 error`, errs.length === 0, errs.slice(0, 5).join(" ;; ") || "clean");
  check(`[${label}] 无失败网络请求`, page.__failedRequests.length === 0, page.__failedRequests.slice(0, 5).join(" ;; ") || "clean");
}

export async function clearLocalStorage(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
}

export async function login(page, who) {
  const cred = typeof who === "string" ? ACCOUNTS[who] : who;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#account", cred.account);
  await page.fill("#password", cred.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/opportunities", { timeout: 10000 });
  await page.waitForTimeout(500);
}

export async function logout(page) {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const btn = page.getByRole("button", { name: /退出登录/ }).first();
  await btn.click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
}

/**
 * 访客完成 5 组基础画像并到达 /preview（两个 m9 脚本共用）。
 * 起始状态：已清空 localStorage、停在首页。
 */
export async function guestOnboarding(page, base = BASE) {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByTestId("start-onboarding").click();
  await page.waitForURL("**/onboarding", { timeout: 10000 });
  // v7.1 M2 两屏基础画像：第一屏地区，第二屏基础资格（学历+专业+毕业+教资）
  await page.getByRole("button", { name: "添加第一个地区" }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "本科", exact: true }).click();
  await page.getByLabel("专业全称").fill("汉语言文学（师范）");
  await page.locator('input[type="month"]').fill("2024-06");
  await page.getByRole("button", { name: "已经取得教师资格证", exact: true }).click();
  await page.getByRole("button", { name: "查看筛选结果" }).click();
  await page.waitForURL("**/preview", { timeout: 10000 });
}

/** 用演示账号登录并等待落到机会页（任意 origin） */
export async function demoLogin(page, base, account, password) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#account", account);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/opportunities", { timeout: 15000 });
}

export async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}${name}.png`, fullPage: true });
}

export async function runBrowser(fn, { mobile = false } = {}) {
  const browser = await chromium.launch(
    // QA_FORCE_DIRECT=1：强制浏览器忽略系统代理直连（大陆无代理网络冒烟用）
    process.env.QA_FORCE_DIRECT === "1" ? { args: ["--no-proxy-server"] } : {},
  );
  const { context, page } = await freshContext(browser, { mobile });
  let code = 0;
  try {
    await fn(page, context);
    code = await summary();
  } catch (e) {
    console.error("HARNESS ERROR:", e);
    code = 99;
  } finally {
    await context.close();
    await browser.close();
  }
  process.exit(code === 0 ? 0 : 1);
}

export async function lsGet(page, key) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

export async function lsKeys(page) {
  return page.evaluate(() => Object.keys(localStorage));
}
