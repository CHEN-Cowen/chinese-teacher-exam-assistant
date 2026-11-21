import { expect, test } from "@playwright/test";

/**
 * v7.2 结果先行首页浏览器 E2E（ff_new_home 开启态，跑在 3123）。
 *
 * 覆盖（PRD 7.4.1 / 7.2 + UIUX §5 + 蓝白重构确认文案）：
 * - 首屏只有一个高强调主按钮「开始资格预筛」（唯一 data-testid=start-onboarding）；
 * - 主标题为「哪些教师岗，你能报？」，顶部「登录」保持次级入口；
 * - 结果预览示例卡有明确「示例」标识（aria-label 含「示例」）；
 * - 375px 移动端 DOM 顺序：主按钮在结果预览之前；
 * - 点击主按钮进入 /onboarding 地区填写，且过程中无未捕获页面错误；
 * - 全开关构建不得意外渲染旧首页（旧结果示例卡是旧首页独有结构标记）。
 *
 * 与服务端渲染契约：首页是客户端组件，SSR 阶段 useCurrentUser 处于 loading，
 * 真实内容在浏览器水合后出现，因此这里全部在浏览器层断言。
 */

test.describe("v7.2 结果先行首页（ff_new_home 开）", () => {
  test("首屏只有一个高强调主按钮「开始资格预筛」", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const primary = page.getByTestId("start-onboarding");
    await expect(primary).toHaveCount(1);
    await expect(primary).toBeVisible();
    await expect(primary).toContainText("开始资格预筛");

    // 主标题「哪些教师岗，你能报？」（标题内含 <br>，用 testid 分段断言，
    // 不依赖可访问名对 <br> 的空白处理）
    const title = page.getByTestId("home-primary-title");
    await expect(title).toBeVisible();
    await expect(title).toContainText("哪些教师岗");
    await expect(title).toContainText("你能报？");

    // 登录保持次级入口：全页只有一个登录链接，主操作是高强调 button 而非它
    const login = page.getByRole("link", { name: "登录" });
    await expect(login).toHaveCount(1);
    await expect(login).toBeVisible();

    // 不得渲染旧首页/中间态文案：
    // - 「开始匹配岗位」是已被替换的 v7.2 中间态按钮文案；
    // - result-example-card 是旧首页（ff_new_home 关）独有的结构标记，
    //   新首页使用 result-preview（下方示例卡用例单独断言）。
    await expect(page.getByText("开始匹配岗位")).toHaveCount(0);
    await expect(page.getByTestId("result-example-card")).toHaveCount(0);
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

  test("点击主按钮进入 /onboarding 地区填写，过程中无未捕获错误", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("start-onboarding").click();
    await expect(page).toHaveURL(/\/onboarding/);
    // 落点是地区填写第一步，而非空白或错误页
    await expect(
      page.getByRole("heading", { name: "你想优先查看哪些地区的教师招聘？" }),
    ).toBeVisible();

    // 记录埋点（home_start_match_clicked）不得抛出未捕获错误
    expect(pageErrors).toEqual([]);
  });
});
