import { expect, test, type Page } from "@playwright/test";

/**
 * v7.2 开关关闭回退态浏览器 E2E（跑在 3001，仅 NEXT_PUBLIC_FF_POST_SAVE_NEXT=true）。
 *
 * 覆盖（PRD 8.4 回退策略）：
 * - `/opportunities` 无 [role=tablist]：走 StackedResultSections 旧式堆叠分组；
 * - 页面不白屏：Hero 结论区与堆叠分组可见；
 * - P0 不变量：详情页「补充缺失信息」动作是内联锚点（#supplement），
 *   点击后仍停留在当前详情页，绝不进入 /onboarding，且不存在专用补充路由链接。
 */

const GUEST_KEY = "kb_guest_profile_v61";

function guestSessionSeed() {
  const now = Date.now();
  return [
    GUEST_KEY,
    JSON.stringify({
      draft: {
        regions: [
          { code: "330000", province: "浙江省", level: "required" },
          // 江苏为「考虑」：用于产生 need_more_info / 咨询等稳定分组
          { code: "320000", province: "江苏省", level: "consider" },
        ],
        educationLevel: "bachelor",
        degree: "bachelor",
        majorFullName: "汉语言文学（师范）",
        graduationDate: "2026-06-30",
        employmentStatus: "fresh_unemployed",
        socialSecurityMonths: 0,
        teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
        intendedSubject: "chinese",
        acceptedEmploymentNatures: [
          "public_institution_staff",
          "record_filing",
          "post_quota",
          "headcount_control",
          "other",
        ],
      },
      step: 2,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    }),
  ] as const;
}

async function seedGuestProfile(page: Page) {
  const [key, value] = guestSessionSeed();
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, value],
  );
}

async function demoLogin(page: Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("邮箱").fill("student@demo.app");
  await page.getByLabel("密码").fill("demo1234");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/opportunities$/);
}

test.describe("v7.2 开关回退态（ff_new_results / ff_targeted_supplement 关）", () => {
  test.beforeEach(async ({ page }) => {
    await seedGuestProfile(page);
    await demoLogin(page);
  });

  test("机会列表走旧式堆叠布局：无 tablist，页面不白屏", async ({ page }) => {
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    // 回退态：不存在工作台三标签
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);

    // 不白屏：Hero 结论区可见
    const hero = page.locator('section[aria-label="结论与下一步"]');
    await expect(hero).toBeVisible();
    await expect(hero.locator("h2")).not.toBeEmpty();
  });

  test("补充动作绝不进入 /onboarding：内联锚点，点击后仍停留详情页", async ({
    page,
  }) => {
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    // 展开回退态「补充…后判断」分组，取其中一个岗位详情
    const needGroup = page
      .locator("details")
      .filter({ hasText: /补充.*后判断/ })
      .first();
    await expect(needGroup).toBeVisible();
    await needGroup.locator("summary").click();

    const detailHref = await needGroup
      .locator('a[href^="/opportunities/"]')
      .first()
      .getAttribute("href");
    expect(detailHref).toBeTruthy();

    await page.goto(detailHref!);
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/onboarding/);

    // 回退态补充动作是 Hero 内联按钮（onClick → #supplement），不是专用路由链接
    const supplementAction = page.getByRole("button", {
      name: "补充缺失信息后重新判断",
    });
    await expect(supplementAction).toBeVisible();
    expect(await page.locator('a[href*="/supplement"]').count()).toBe(0);

    const urlBefore = page.url();
    await supplementAction.click();

    // P0 不变量：点击补充后仍停留在当前详情页，绝不进入 /onboarding
    await expect(page).not.toHaveURL(/onboarding/);
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator("#supplement")).toBeVisible();
  });
});
