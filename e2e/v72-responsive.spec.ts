import { expect, test, type Page } from "@playwright/test";

/**
 * v7.2 响应式浏览器 E2E（跑在 3100，production 构建 + v7.2 开关开启）。
 *
 * 覆盖：在 320 / 375 / 768 / 1024 / 1440 五档视口下打开 `/` 与 `/opportunities`，
 * 断言无横向溢出（documentElement.scrollWidth <= innerWidth + 1），
 * 且 320px 下首页主操作按钮≈整行宽度。
 *
 * `/opportunities` 有登录守卫，故在该用例内 demo 登录（demo 账号）。
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
  await page.getByLabel("账号").fill("student@demo.app");
  await page.getByLabel("密码").fill("demo1234");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/opportunities$/);
}

const VIEWPORTS = [320, 375, 768, 1024, 1440];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

test.describe("v7.2 响应式：无横向溢出", () => {
  test("首页五档视口无横向溢出；320px 主按钮≈整行", async ({ page }) => {
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      expect(
        await horizontalOverflow(page),
        `首页在 ${width}px 出现横向溢出`,
      ).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const button = page.getByTestId("start-onboarding");
    await expect(button).toBeVisible();
    const buttonBox = await button.boundingBox();
    const containerBox = await button.locator("xpath=..").boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(containerBox).not.toBeNull();
    // 320px 下主操作按钮整行（≥ 容器 90%）
    expect(buttonBox!.width).toBeGreaterThanOrEqual(containerBox!.width * 0.9);
  });

  test("机会列表五档视口无横向溢出", async ({ page }) => {
    await seedGuestProfile(page);
    await demoLogin(page);
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/opportunities");
      await page.waitForLoadState("networkidle");
      expect(
        await horizontalOverflow(page),
        `机会列表在 ${width}px 出现横向溢出`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
