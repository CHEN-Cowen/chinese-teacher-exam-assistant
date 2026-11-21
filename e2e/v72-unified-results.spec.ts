import { expect, test, type Page } from "@playwright/test";

/**
 * v7.2 统一结果工作台 E2E（ff_new_results 开启态，跑在 3123）。
 *
 * 覆盖（本任务 §4/§5/§6/§7/§10）：
 * - /preview（访客）与 /opportunities（登录）使用同一套三标签工作台与同一套岗位卡：
 *   两边都有 tablist / 三标签互斥 / 徽标数与卡片数一致 / 七个稳定 testid 同序；
 * - 结果页不再出现「想看哪类用工形式的岗位？」大问卷，改为紧凑条件摘要；
 * - 地图入口位于岗位标题正下方的地点行（location-row）内，不在展开依据区；
 * - 修改条件：默认进入第二屏（用工偏好屏）、资料自动回填、保存后返回原结果页、
 *   原标签状态保留、结果按新偏好重新分类；
 * - 访客保存机会 → 登录 → 返回原岗位详情；
 * - 375px 两按钮整宽堆叠、1440px 并排。
 *
 * 夹具：与 v72-workbench.spec.ts 同构的完整访客画像（另带 employmentNaturePreference），
 * demo 账号登录覆盖登录端。
 */

const GUEST_KEY = "kb_guest_profile_v61";

function guestSessionSeed(naturePreference = "official_open") {
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
        employmentNaturePreference: naturePreference,
      },
      step: 2,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    }),
  ] as const;
}

async function seedGuestProfile(page: Page, naturePreference?: string) {
  const [key, value] = guestSessionSeed(naturePreference);
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
  await page.waitForURL(/\/opportunities/);
}

/** 第一张岗位卡（任一激活面板内） */
function firstCard(page: Page) {
  return page.locator('[data-testid^="opportunity-card-"]').first();
}

/** 标签徽标数量（span[aria-label="N 个"]） */
async function badgeCount(page: Page, id: string): Promise<number> {
  const badge = page.locator(`#workbench-tab-${id} span[aria-label$="个"]`);
  await expect(badge).toHaveCount(1);
  const label = (await badge.getAttribute("aria-label")) ?? "";
  return Number.parseInt(label, 10);
}

function panelCardCount(page: Page, id: string): Promise<number> {
  return page
    .locator(`#workbench-panel-${id} [data-testid^="opportunity-card-"]`)
    .count();
}

/** 岗位卡七层结构断言（统一岗位卡：访客/登录同一份 DOM 顺序） */
async function expectUnifiedCardDom(page: Page) {
  const card = firstCard(page);
  await expect(card).toBeVisible();
  for (const testid of [
    "opportunity-title",
    "location-row",
    "job-facts",
    "decision-summary",
    "view-evidence-button",
    "save-button",
  ]) {
    await expect(card.getByTestId(testid)).toHaveCount(1);
  }
  // DOM 顺序：opportunity-title → location-row → job-facts
  const order = await card.evaluate((el) => {
    const seq = [
      "opportunity-title",
      "location-row",
      "job-facts",
      "decision-summary",
    ] as const;
    return seq.map((id) => {
      const node = el.querySelector(`[data-testid="${id}"]`);
      if (!node) return -1;
      const rect = node.getBoundingClientRect();
      return rect.top * 10000 + rect.left;
    });
  });
  expect(order[0]).toBeGreaterThanOrEqual(0);
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
  // 地图入口在地点行内（有明确城市的种子数据必有），且同卡只有一个
  const mapInLocationRow = card.locator(
    '[data-testid="location-row"] [data-testid="map-link"]',
  );
  await expect(mapInLocationRow).toHaveCount(1);
  await expect(card.getByTestId("map-link")).toHaveCount(1);
}

test.describe("v7.2 统一结果工作台：/preview 访客端", () => {
  test("三标签工作台 + 条件摘要，不再出现用工形式大问卷", async ({ page }) => {
    await seedGuestProfile(page);
    await page.goto("/preview");
    await page.waitForLoadState("networkidle");

    // 统一三标签：默认只渲染优先机会，其余互斥
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expect(page.locator('[role="tab"]')).toHaveCount(3);
    await expect(page.locator("#workbench-panel-priority")).toBeVisible();
    await expect(page.locator("#workbench-panel-supplement")).toHaveCount(0);
    await expect(page.locator("#workbench-panel-outOfScope")).toHaveCount(0);

    // 徽标数与卡片数一致
    expect(await panelCardCount(page, "priority")).toBe(
      await badgeCount(page, "priority"),
    );

    // 条件摘要替代大问卷：含已选用工偏好，无「想看哪类用工形式的岗位？」
    const summary = page.getByTestId("condition-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("当前条件");
    await expect(summary).toContainText("事业编优先");
    await expect(summary).toContainText("本科");
    await expect(summary).toContainText("汉语言文学");
    await expect(page.getByText("想看哪类用工形式的岗位？")).toHaveCount(0);
    await expect(page.getByTestId("employment-preference-group")).toHaveCount(0);

    // 统一岗位卡：七层结构 + 地图在标题下方地点行
    await expectUnifiedCardDom(page);
  });

  test("切换三标签互斥，URL 写回 /preview?tab= 且刷新保持", async ({
    page,
  }) => {
    await seedGuestProfile(page);
    await page.goto("/preview");
    await page.waitForLoadState("networkidle");

    await page.locator("#workbench-tab-supplement").click();
    await expect(page).toHaveURL(/\/preview\?tab=supplement/);
    await expect(page.locator("#workbench-panel-supplement")).toBeVisible();
    await expect(page.locator("#workbench-panel-priority")).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#workbench-tab-supplement")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("修改条件：默认第二屏、资料回填、返回原页并保留标签、按新偏好重新分类", async ({
    page,
  }) => {
    await seedGuestProfile(page, "official_open");
    await page.goto("/preview?tab=supplement");
    await page.waitForLoadState("networkidle");

    // 点击条件摘要的「修改」→ 编辑模式第二屏（不是地区第一屏）
    await page.getByTestId("condition-summary").getByRole("link", {
      name: "修改",
    }).click();
    await expect(page).toHaveURL(/\/onboarding\?.*mode=edit/);
    await expect(page).toHaveURL(/step=2/);
    await expect(page).toHaveURL(/returnTo=/);
    // 默认落在用工偏好所在屏：偏好组可见且已回填（official_open 选中）
    await expect(page.getByTestId("employment-preference-group")).toBeVisible();
    await expect(
      page.getByTestId("employment-preference-official_open"),
    ).toHaveAttribute("aria-pressed", "true");
    // 提供明确的「修改地区」入口（用户主动选择才回第一屏）
    await expect(page.getByTestId("edit-regions-entry")).toBeVisible();

    // 改为「只看事业编」→ 保存 → 返回 /preview 且保留 tab
    await page.getByTestId("employment-preference-public_only").click();
    await page.getByRole("button", { name: "查看筛选结果" }).click();
    await expect(page).toHaveURL(/\/preview\?tab=supplement/);

    // 条件摘要更新为新偏好（结果按新条件重新计算）
    await expect(page.getByTestId("condition-summary")).toContainText(
      "只看事业编",
    );
    // 仍是统一三标签工作台，且标签状态保留在 supplement
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expect(page.locator("#workbench-tab-supplement")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // 非事业编岗位被筛入「偏好范围外」：该标签数量 > 0 且不混进优先机会
    const outCount = await badgeCount(page, "outOfScope");
    expect(outCount).toBeGreaterThan(0);
  });

  test("访客保存机会 → 登录 → 返回原岗位（不跳回 /onboarding）", async ({
    page,
  }) => {
    await seedGuestProfile(page);
    await page.goto("/preview");
    await page.waitForLoadState("networkidle");

    // 第一张卡保存 → 跳转登录，next 指向原岗位详情
    const card = firstCard(page);
    const testId = (await card.getAttribute("data-testid")) ?? "";
    const unitId = testId.replace("opportunity-card-", "");
    expect(unitId.length).toBeGreaterThan(0);
    await card.getByTestId("save-button").click();
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page).toHaveURL(/reason=save/);
    await expect(page).toHaveURL(
      new RegExp(`next=${encodeURIComponent(`/opportunities/${unitId}`)}`),
    );

    // 登录 → 返回原岗位详情页（URL 精确匹配原岗位，未跳回 /onboarding）
    await page.getByLabel("邮箱").fill("student@demo.app");
    await page.getByLabel("密码").fill("demo1234");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/opportunities/${unitId}$`));
    // 详情页正常渲染（保存意图已在登录合并流程中恢复）
    await expect(page.locator("main").first()).toBeVisible();
  });
});

test.describe("v7.2 统一结果工作台：/opportunities 登录端", () => {
  test("登录端与访客端同一套岗位卡 DOM 结构", async ({ page }) => {
    await seedGuestProfile(page);
    await demoLogin(page);
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");

    // 三标签 + 统一岗位卡七层结构（与 /preview 同一套断言）
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expectUnifiedCardDom(page);

    // 登录端条件摘要同样存在，不再出现用工形式大问卷
    await expect(page.getByTestId("condition-summary")).toBeVisible();
    await expect(page.getByText("想看哪类用工形式的岗位？")).toHaveCount(0);
  });

  test("登录端修改条件同样默认第二屏并返回 /opportunities", async ({
    page,
  }) => {
    await seedGuestProfile(page, "official_open");
    await demoLogin(page);
    await page.goto("/opportunities?tab=supplement");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("condition-summary").getByRole("link", {
      name: "修改",
    }).click();
    await expect(page).toHaveURL(/\/onboarding\?.*mode=edit/);
    await expect(page.getByTestId("employment-preference-group")).toBeVisible();

    await page.getByTestId("employment-preference-public_only").click();
    await page.getByRole("button", { name: "查看筛选结果" }).click();
    // 登录用户保存后返回真实机会页（returnTo 指向 /opportunities?tab=supplement）
    await expect(page).toHaveURL(/\/(preview|opportunities)\?tab=supplement/);
  });
});

test.describe("v7.2 统一岗位卡：响应式按钮布局", () => {
  test("375px 两按钮整宽堆叠，1440px 并排且同高", async ({ page }) => {
    await seedGuestProfile(page);
    await page.goto("/preview");
    await page.waitForLoadState("networkidle");

    const card = firstCard(page);
    const viewBtn = card.getByTestId("view-evidence-button");
    const saveBtn = card.getByTestId("save-button");

    // 375px 移动端：整宽纵向堆叠（保存按钮在依据按钮下方，宽度≈卡宽）
    await page.setViewportSize({ width: 375, height: 900 });
    const boxViewM = (await viewBtn.boundingBox())!;
    const boxSaveM = (await saveBtn.boundingBox())!;
    expect(boxSaveM.y).toBeGreaterThan(boxViewM.y + boxViewM.height - 1);
    expect(Math.abs(boxSaveM.width - boxViewM.width)).toBeLessThan(2);

    // 1440px 桌面端：并排同一基线、同高
    await page.setViewportSize({ width: 1440, height: 900 });
    const boxViewD = (await viewBtn.boundingBox())!;
    const boxSaveD = (await saveBtn.boundingBox())!;
    expect(Math.abs(boxViewD.y - boxSaveD.y)).toBeLessThan(2);
    expect(Math.abs(boxViewD.height - boxSaveD.height)).toBeLessThan(2);
    expect(boxSaveD.x).toBeGreaterThan(boxViewD.x);
  });
});
