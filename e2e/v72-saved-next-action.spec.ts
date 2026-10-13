import { expect, test, type Page, type Locator } from "@playwright/test";

/**
 * v7.2「保存后的下一步 + 官方确认」浏览器 E2E（demo 模式，纯本地 demoApi）。
 *
 * 覆盖：
 * 1. 登录用户保存：绿色面板 + 唯一主动作 + 明确「不是报名」；连点幂等不升级；刷新安静态可恢复；
 * 2. 访客保存带 return-to：跳登录、本机暂存意图、登录后回原岗位、绝不进 /onboarding、暂存清除；
 * 3. MANUAL_REVIEW：主动作直达官方确认；原因/原文/可编辑问题/复制/官方联系方式；
 *    四态个人答复刷新保留、公共判定不变、已消解阻塞不再出现；
 * 4. 375px 移动端：面板与主动作可用、主按钮整宽堆叠；
 * 5. 键盘：保存后焦点落主动作、Enter 执行锚点、role=status/aria-live 播报。
 */

const GUEST_KEY = "kb_guest_profile_v61";
const GUEST_FOLLOWS_KEY = "kb_guest_follows_v1";

/**
 * 与匹配引擎 BASE_PROFILE 同构的完整访客画像：
 * 杭州→初步符合、苏州→专业 MANUAL_REVIEW（2026 届汉语言文学师范）。
 */
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

/** 模拟访客点击保存后的本机暂存（kb_guest_follows_v1 的真实结构） */
async function seedGuestFollow(page: Page, unitId: string) {
  await page.addInitScript(
    ([key, id, at]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          [id]: {
            unitId: id,
            status: "considering",
            materialStatuses: {},
            consultationNotes: {},
            updatedAt: at,
          },
        }),
      );
    },
    [GUEST_FOLLOWS_KEY, unitId, new Date().toISOString()],
  );
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

async function openFollowDetails(page: Page) {
  await page.locator("details#follow").evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

async function saveFromDetail(page: Page): Promise<Locator> {
  await openFollowDetails(page);
  // Hero「结论与下一步」区也有同名按钮，这里明确操作跟进折叠区里的保存入口
  await page
    .locator("details#follow")
    .getByRole("button", { name: "保存这个机会" })
    .click();
  const panel = page.getByTestId("saved-next-action-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("v7.2 保存后的下一步", () => {
  test.beforeEach(async ({ page }) => {
    await seedGuestProfile(page);
  });

  test("登录用户保存：立即出现唯一下一步、明确不是报名；连点不升级；刷新安静态可恢复", async ({
    page,
  }) => {
    await demoLogin(page);
    await page.goto("/opportunities/unit-hangzhou-01");
    await page.waitForLoadState("networkidle");

    await openFollowDetails(page);
    // 幂等（连点不升级、不重复写入）由前后端单测锁定；E2E 走单次保存主路径
    await page
      .locator("details#follow")
      .getByRole("button", { name: "保存这个机会" })
      .click();

    const panel = page.getByTestId("saved-next-action-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-emphasized", "true");
    await expect(panel.getByText("已保存，并加入报考日程")).toBeVisible();
    await expect(
      panel.getByText("这不是报名，报名须在官方入口完成。"),
    ).toBeVisible();
    // 保存区只有这一个高强调主动作
    await expect(panel.getByTestId("saved-next-action-primary")).toHaveCount(1);
    // 状态保持「考虑中」，没有自动进入准备报名/已报名
    const followBox = page.locator("details#follow");
    await expect(followBox.getByText("考虑中").first()).toBeVisible();
    // exact：状态徽章不能是「准备报名/已报名」（「标记为准备报名」是流转按钮，不算状态）
    await expect(followBox.getByText("准备报名", { exact: true })).toHaveCount(0);
    await expect(followBox.getByText("已报名", { exact: true })).toHaveCount(0);

    // 刷新：绿色强调消失，但保存状态与下一步仍在（可恢复、持续可见）
    await page.reload();
    await page.waitForLoadState("networkidle");
    await openFollowDetails(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-emphasized", "false");
    await expect(panel.getByText("已保存，并加入报考日程")).toBeVisible();
    await expect(panel.getByTestId("saved-next-action-primary")).toHaveCount(1);
    await expect(followBox.getByText("考虑中").first()).toBeVisible();
  });

  test("访客保存带 return-to：登录后回到原岗位，绝不进 /onboarding，保存意图不丢", async ({
    page,
  }) => {
    // /opportunities/* 有登录守卫；访客点保存时先 upsertGuestFollow 再跳登录。
    // 这里直接构造「已暂存意图 + 带 next/reason 的登录页」这一真实可达状态。
    await seedGuestFollow(page, "unit-hangzhou-01");
    await page.goto("/login?next=/opportunities/unit-hangzhou-01&reason=save");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("登录后会回到刚才的机会，继续完成保存"),
    ).toBeVisible();

    const stashed = await page.evaluate((key) => {
      return window.localStorage.getItem(key);
    }, GUEST_FOLLOWS_KEY);
    expect(stashed).toContain("unit-hangzhou-01");
    expect(stashed).toContain("considering");

    await page.getByLabel("账号").fill("student@demo.app");
    await page.getByLabel("密码").fill("demo1234");
    await page.getByRole("button", { name: "登录", exact: true }).click();

    // 登录迁移完成后落地原岗位（不是列表、不是 onboarding）
    await page.waitForURL(/\/opportunities\/unit-hangzhou-01$/);
    expect(page.url()).not.toContain("/onboarding");

    await openFollowDetails(page);
    const panel = page.getByTestId("saved-next-action-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("这不是报名，报名须在官方入口完成。"),
    ).toBeVisible();
    await expect(page.locator("details#follow").getByText("考虑中").first()).toBeVisible();

    // 迁移成功后本机访客暂存已清除（clearGuestFollows 写空对象）
    const cleared = await page.evaluate((key) => {
      return window.localStorage.getItem(key);
    }, GUEST_FOLLOWS_KEY);
    expect(cleared === null || cleared === "{}").toBe(true);
  });
});

test.describe("v7.2 MANUAL_REVIEW 官方确认", () => {
  test.beforeEach(async ({ page }) => {
    await seedGuestProfile(page);
    await demoLogin(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("苏州岗位：确认原因/原文/可编辑问题/复制/联系方式；个人答复隔离且阻塞消解后不再出现", async ({
    page,
  }) => {
    await page.goto("/opportunities/unit-suzhou-01");
    await page.waitForLoadState("networkidle");
    // 该岗位整体仍是「建议人工确认」（公共判定，不因个人答复改变）
    await expect(page.getByText("建议人工确认").first()).toBeVisible();

    const panel = await saveFromDetail(page);
    // Tier1：最高优先级动作直达官方确认区
    const primary = panel.getByTestId("saved-next-action-primary");
    await expect(primary).toHaveAttribute("href", "#to-confirm");
    await primary.click();

    const card = page.getByTestId("consultation-card-major");
    await expect(card).toBeVisible();
    // 为什么需要确认 + 公告原文（卡片内含原因说明与专业条件原文）
    await expect(card.getByText(/专业/).first()).toBeVisible();

    // 可编辑咨询问题，初值来自模板（英文枚举不进正文断言，只断固定句式）
    const question = page.getByTestId("consult-question-major");
    await expect(question).toHaveValue(/请向招聘单位核对/);
    await question.fill("请问汉语言文学（师范）是否可以报考该岗位？");

    // 复制的是编辑后的文本
    await page.getByTestId("copy-question-major").click();
    await expect(page.getByTestId("copy-question-feedback-major")).toHaveText(
      "已复制",
    );
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe("请问汉语言文学（师范）是否可以报考该岗位？");

    // 官方联系方式卡存在，且没有任何 tel:/mailto: 自动拨号/发信
    await expect(page.getByTestId("copy-contact")).toBeVisible();
    expect(await page.locator('a[href^="tel:"], a[href^="mailto:"]').count()).toBe(0);

    // 结构化个人答复：官方确认我符合
    await page.getByTestId("outcome-major-confirmed_match").click();
    const record = page.getByTestId("consult-record-major");
    await expect(record).toContainText("官方确认：我符合");
    // 隔离说明始终可见
    await expect(
      card.getByText(/不会变成所有用户的判断规则/),
    ).toBeVisible();

    // 刷新：个人答复保留；公共维度仍是人工确认；保存区不再重复该阻塞动作
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("consult-record-major")).toContainText(
      "官方确认：我符合",
    );
    await expect(page.getByText("建议人工确认").first()).toBeVisible();
    await openFollowDetails(page);
    const newPrimary = page
      .getByTestId("saved-next-action-panel")
      .getByTestId("saved-next-action-primary");
    await expect(newPrimary).toBeVisible();
    await expect(newPrimary).not.toHaveAttribute("href", "#to-confirm");
  });
});

test.describe("v7.2 响应式与键盘可达", () => {
  test.beforeEach(async ({ page }) => {
    await seedGuestProfile(page);
    await demoLogin(page);
  });

  test("375px 移动端：面板与主动作整宽堆叠，可直达官方确认", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/opportunities/unit-suzhou-01");
    await page.waitForLoadState("networkidle");

    const panel = await saveFromDetail(page);
    const panelBox = await panel.boundingBox();
    const primaryBox = await panel
      .getByTestId("saved-next-action-primary")
      .boundingBox();
    expect(panelBox).not.toBeNull();
    expect(primaryBox).not.toBeNull();
    // 主动作在窄屏整宽（留下面板内边距 12px 两侧）
    expect(primaryBox!.width).toBeGreaterThan(panelBox!.width - 48);

    await panel.getByTestId("saved-next-action-primary").click();
    await expect(page.getByTestId("consultation-card-major")).toBeVisible();
  });

  test("键盘：保存后焦点落主动作，Enter 执行锚点，状态区可播报", async ({ page }) => {
    await page.goto("/opportunities/unit-suzhou-01");
    await page.waitForLoadState("networkidle");
    const panel = await saveFromDetail(page);

    await expect(panel).toHaveAttribute("role", "status");
    await expect(panel).toHaveAttribute("aria-live", "polite");

    // 焦点已落在唯一主动作上
    const activeTestId = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLElement ? el.dataset.testid ?? null : null;
    });
    expect(activeTestId).toBe("saved-next-action-primary");

    // Enter 触发页内锚点：官方确认区展开可见（页内动作用 preventDefault+展开滚动，
    // 不依赖 hash 跳转，断言以目标区可见为准）
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("consultation-card-major")).toBeVisible();

    // Tab 可继续移动焦点，不会被困在面板里
    await page.keyboard.press("Tab");
    const moved = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLElement ? el.dataset.testid ?? el.tagName : null;
    });
    expect(moved).not.toBe("saved-next-action-primary");
  });
});
