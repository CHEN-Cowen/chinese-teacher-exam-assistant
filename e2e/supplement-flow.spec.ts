import { expect, test } from "@playwright/test";

/**
 * v7.2 P0 回归（浏览器 E2E）：访客点击「补充信息后判断」绝不进入 /onboarding。
 *
 * 流程：预置完整访客基础画像（localStorage）→ /preview → 点击补充 →
 * /preview/supplement/<unitId>?origin=preview&bucket=need_more_info →
 * 只补缺失子字段（出生日期）→ 保存并重新判断 → 成功播报 + 本机持久化。
 *
 * demo 模式下匹配与详情走纯本地 demoApi，无需后端；demo 不持久化敏感事实到服务端，
 * 补充事实只写本机 localStorage（kb_profile_supplement_v61）。
 */

const GUEST_KEY = "kb_guest_profile_v61";
const SUPPLEMENT_KEY = "kb_profile_supplement_v61";

function guestSessionSeed() {
  const now = Date.now();
  return [
    GUEST_KEY,
    JSON.stringify({
      draft: {
        regions: [
          { code: "330100", province: "浙江省", city: "杭州市", level: "required" },
        ],
        educationLevel: "bachelor",
        degree: "bachelor",
        majorFullName: "汉语言文学",
        graduationDate: "2020-06-30",
        teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
        intendedSubject: "chinese",
        acceptedEmploymentNatures: [],
      },
      step: 2,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    }),
  ] as const;
}

test("访客补充信息流程：点击补充进入定向补充页，绝不回 /onboarding", async ({
  page,
}) => {
  const [key, value] = guestSessionSeed();
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, value],
  );

  await page.goto("/preview");
  await page.waitForLoadState("networkidle");
  // 画像完整时不应被重定向到 onboarding
  await expect(page).not.toHaveURL(/\/onboarding/);
  await expect(
    page.getByText("看看以后会怎样帮你判断"),
  ).toBeVisible();

  // 「补充信息后判断」是 need_more_info 卡的主按钮；可能在折叠区里
  let supplementBtn = page
    .getByRole("button", { name: "补充信息后判断" })
    .first();
  if (!(await supplementBtn.isVisible().catch(() => false))) {
    await page.getByText("查看其他示例判断").click();
    supplementBtn = page
      .getByRole("button", { name: "补充信息后判断" })
      .first();
  }
  await expect(supplementBtn).toBeVisible();

  // 慢文件系统下 React 水合可能滞后于可见性：重试点击直到路由真正跳转；
  // 已跳转后不再重复点击（按钮已随页面卸载），只等 URL 断言成立
  await expect(async () => {
    if (!page.url().includes("/preview/supplement/")) {
      await supplementBtn.click({ timeout: 2_000 });
    }
    await expect(page).toHaveURL(/\/preview\/supplement\/[^?]+/, {
      timeout: 3_000,
    });
  }).toPass({ timeout: 45_000 });

  // P0 断言：进入定向补充路由（携带正确参数），绝不进入 /onboarding
  await expect(page).toHaveURL(
    /\/preview\/supplement\/[^?]+\?origin=preview&bucket=need_more_info/,
  );
  await expect(page).not.toHaveURL(/\/onboarding/);
  // 已知基础信息（学历/专业/教资）不被重新询问：页面是补充缺失信息，不是基础画像表单
  await expect(page.getByText("补充缺失信息后重新判断")).toBeVisible();

  // 只补仍缺失的子字段：有哪些补哪些（出生日期/社保/工作经历）
  const birthInput = page.getByLabel("出生日期");
  if (await birthInput.count()) {
    await birthInput.fill("1995-06-15");
  }
  const socialInput = page.getByLabel("社保累计缴纳月数");
  if (await socialInput.count()) {
    await socialInput.fill("0");
  }
  await page.getByRole("button", { name: "保存并重新判断" }).click();

  // 保存成功播报（可访问状态播报 role=status），仍不在 /onboarding
  await expect(page.getByRole("status").filter({ hasText: "信息已保存" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).not.toHaveURL(/\/onboarding/);

  // demo 不持久化敏感事实到服务端：只写本机 localStorage
  const saved = await page.evaluate(
    (k) => window.localStorage.getItem(k),
    SUPPLEMENT_KEY,
  );
  expect(saved).toBeTruthy();
  const facts = JSON.parse(saved!) as Record<string, unknown>;
  if (await birthInput.count()) {
    expect(facts.birthDate).toBe("1995-06-15");
  }
});
