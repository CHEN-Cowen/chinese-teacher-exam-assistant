import { expect, test } from "@playwright/test";

/**
 * v7.2 结果先行首页浏览器 E2E（ff_new_home 开启态，跑在 3100）。
 *
 * 覆盖（PRD 7.4.1 / 7.2 + UIUX §5）：
 * - 首屏只有一个高强调主按钮「开始匹配岗位」（唯一 data-testid=start-onboarding）；
 * - 结果预览示例卡有明确「示例」标识（aria-label 含「示例」）；
 * - 375px 移动端 DOM 顺序：主按钮在结果预览之前；
 * - 点击主按钮进入 /onboarding，且过程中无未捕获页面错误（埋点前提下不报错）。
 *
 * 与服务端渲染契约：首页是客户端组件，SSR 阶段 useCurrentUser 处于 loading，
 * 真实内容在浏览器水合后出现，因此这里全部在浏览器层断言。
 */

test.describe("v7.2 结果先行首页（ff_new_home 开）", () => {
  test("首屏只有一个高强调主按钮「开始匹配岗位」", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const primary = page.getByTestId("start-onboarding");
    await expect(primary).toHaveCount(1);
    await expect(primary).toBeVisible();
    await expect(primary).toContainText("开始匹配岗位");

    // 新首页主标题，且不再出现 v7.1 旧首页主按钮文案
    await expect(
      page.getByRole("heading", { name: "哪些教师岗位，你现在就能报？" }),
    ).toBeVisible();
    await expect(page.getByText("开始资格预筛")).toHaveCount(0);
  });

  test("结果预览示例卡明确标识为示例", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const preview = page.getByTestId("result-preview");
    await expect(preview).toBeVisible();
    // 文字化示例标识：aria-label 含「示例」，不只靠颜色
    await expect(preview).toHaveAttribute("aria-label", /示例/);
    await expect(preview.getByText("结果预览 · 示例")).toBeVisible();
  });

  test("375px 移动端：主按钮在结果预览之前（DOM 顺序）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const order = await page.evaluate(() => {
      const cta = document.querySelector('[data-testid="start-onboarding"]');
      const preview = document.querySelector('[data-testid="result-preview"]');
      if (!cta || !preview) return "missing";
      // cta 在 preview 之前时，preview 出现在 cta 之后
      return cta.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING
        ? "cta-before-preview"
        : "preview-before-cta";
    });
    expect(order).toBe("cta-before-preview");
  });

  test("点击主按钮进入 /onboarding，过程中无未捕获错误", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("start-onboarding").click();
    await expect(page).toHaveURL(/\/onboarding/);

    // 记录埋点（home_start_match_clicked）不得抛出未捕获错误
    expect(pageErrors).toEqual([]);
  });
});
