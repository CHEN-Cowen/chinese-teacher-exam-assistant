import { expect, test, type Page } from "@playwright/test";

/**
 * v7.2 机会工作台三标签浏览器 E2E（ff_new_results 开启态，跑在 3123）。
 *
 * 覆盖（PRD §7.4 / §7.7）：
 * - /opportunities 默认只渲染「优先机会」数据集（依赖 [role=tablist]）；
 * - 三标签严格互斥：任一时刻只有一个 tabpanel 在 DOM 中；
 * - 每个标签的数量徽标与其面板内岗位卡数量一致（页面叙事与数据同源）；
 * - 键盘 ArrowLeft/ArrowRight 切换并跟随焦点（roving tabindex）；
 * - 切换写回 ?tab=，刷新后状态保持；
 * - 浏览器前进/后退跨 URL 条目时按 URL 恢复标签状态；
 * - WAI-ARIA：aria-selected 仅激活标签为 true，roving tabindex 仅激活=0。
 *
 * 夹具：预置完整访客画像（与 v72-saved-next-action 同构）+ demo 登录，
 * 使三个数据集有稳定数据来源；断言只比较「同页面内」的数量，不写死具体条数。
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
  await page.getByLabel("邮箱").fill("student@demo.app");
  await page.getByLabel("密码").fill("demo1234");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/opportunities$/);
}

/** 标签徽标数量（span[aria-label="N 个"]） */
async function badgeCount(page: Page, id: string): Promise<number> {
  const badge = page.locator(`#workbench-tab-${id} span[aria-label$="个"]`);
  await expect(badge).toHaveCount(1);
  const label = (await badge.getAttribute("aria-label")) ?? "";
  return Number.parseInt(label, 10);
}

/** 某标签面板内的岗位卡数量（机会卡稳定 data-testid 前缀） */
function panelCardCount(page: Page, id: string): Promise<number> {
  return page
    .locator(`#workbench-panel-${id} [data-testid^="opportunity-card-"]`)
    .count();
}

test.describe("v7.2 工作台三标签（ff_new_results 开）", () => {
  test.beforeEach(async ({ page }) => {
    await seedGuestProfile(page);
    await demoLogin(page);
  });

  test("默认只显示「优先机会」，ARIA 与 roving tabindex 正确，徽标数与卡片数一致", async ({
    page,
  }) => {
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    // 工作台三标签存在
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expect(page.locator('[role="tab"]')).toHaveCount(3);

    // 默认只渲染 priority 面板，其余不进入 DOM（互斥，非 CSS 隐藏）
    await expect(page.locator("#workbench-panel-priority")).toBeVisible();
    await expect(page.locator("#workbench-panel-supplement")).toHaveCount(0);
    await expect(page.locator("#workbench-panel-outOfScope")).toHaveCount(0);

    // WAI-ARIA：仅激活标签 aria-selected=true 且 tabindex=0
    await expect(page.locator("#workbench-tab-priority")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#workbench-tab-priority")).toHaveAttribute(
      "tabindex",
      "0",
    );
    for (const id of ["supplement", "outOfScope"]) {
      await expect(page.locator(`#workbench-tab-${id}`)).toHaveAttribute(
        "aria-selected",
        "false",
      );
      await expect(page.locator(`#workbench-tab-${id}`)).toHaveAttribute(
        "tabindex",
        "-1",
      );
    }

    // 徽标数量 == 面板内岗位卡数量（数据与叙事同源）
    expect(await panelCardCount(page, "priority")).toBe(
      await badgeCount(page, "priority"),
    );

    // 页面摘要（Hero 结论）与 priority 数量一致：为你找到 N 个初步符合的机会
    const heroConclusion = await page
      .locator('section[aria-label="结论与下一步"] h2')
      .innerText();
    const matched = heroConclusion.match(/为你找到\s*(\d+)\s*个初步符合的机会/);
    if (matched) {
      expect(Number(matched[1])).toBe(await badgeCount(page, "priority"));
    }
  });

  test("依次切换三标签：每次只显示对应数据集，且徽标数与卡片数一致", async ({
    page,
  }) => {
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    // → 补充后判断
    await page.locator("#workbench-tab-supplement").click();
    await expect(page.locator("#workbench-panel-supplement")).toBeVisible();
    await expect(page.locator("#workbench-panel-priority")).toHaveCount(0);
    await expect(page.locator("#workbench-panel-outOfScope")).toHaveCount(0);
    expect(await panelCardCount(page, "supplement")).toBe(
      await badgeCount(page, "supplement"),
    );

    // → 偏好范围外
    await page.locator("#workbench-tab-outOfScope").click();
    await expect(page.locator("#workbench-panel-outOfScope")).toBeVisible();
    await expect(page.locator("#workbench-panel-priority")).toHaveCount(0);
    await expect(page.locator("#workbench-panel-supplement")).toHaveCount(0);
    expect(await panelCardCount(page, "outOfScope")).toBe(
      await badgeCount(page, "outOfScope"),
    );

    // → 回到优先机会（默认标签会删除 tab 参数）
    await page.locator("#workbench-tab-priority").click();
    await expect(page.locator("#workbench-panel-priority")).toBeVisible();
    await expect(page.locator("#workbench-panel-supplement")).toHaveCount(0);
    await expect(page.locator("#workbench-panel-outOfScope")).toHaveCount(0);
    expect(await panelCardCount(page, "priority")).toBe(
      await badgeCount(page, "priority"),
    );
  });

  test("键盘 ArrowLeft/ArrowRight 切换标签并跟随焦点", async ({ page }) => {
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    await page.locator("#workbench-tab-priority").focus();
    await expect(page.locator("#workbench-tab-priority")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#workbench-tab-supplement")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#workbench-panel-supplement")).toBeVisible();
    // roving tabindex：焦点跟随激活标签
    await expect(page.locator("#workbench-tab-supplement")).toBeFocused();
    await expect(page.locator("#workbench-tab-priority")).toHaveAttribute(
      "tabindex",
      "-1",
    );

    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#workbench-tab-priority")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#workbench-tab-priority")).toBeFocused();
  });

  test("切换写回 ?tab=，刷新保持；浏览器后退/前进按 URL 恢复标签", async ({
    page,
  }) => {
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    // 点击切换到「偏好范围外」→ URL 带 ?tab=outOfScope
    await page.locator("#workbench-tab-outOfScope").click();
    await expect(page).toHaveURL(/[?&]tab=outOfScope/);

    // 刷新后标签状态保持（URL 是状态来源）
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#workbench-tab-outOfScope")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#workbench-panel-outOfScope")).toBeVisible();

    // 浏览器后退/前进跨 URL 条目 → 标签状态随 URL 恢复
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#workbench-tab-priority")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goto("/opportunities?tab=supplement");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#workbench-tab-supplement")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.goBack();
    await expect(page).toHaveURL(/\/opportunities$/);
    await expect(page.locator("#workbench-tab-priority")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.goForward();
    await expect(page.locator("#workbench-tab-supplement")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
