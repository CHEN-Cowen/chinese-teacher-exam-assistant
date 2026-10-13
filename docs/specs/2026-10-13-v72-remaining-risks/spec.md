# v7.2 剩余风险 1/2/4 修复规格

日期：2026-10-13
范围：只修复上轮验收报告中的剩余风险 1（登录迁移冲突无 UI）、2（缺访客浏览器 E2E）、4（PATCH 只有 service 级测试）。不引入新功能。

## 风险 1：登录迁移冲突 UI

### 现状
- `src/lib/auth/HttpAuthProvider.ts:62-69`：`migrateGuestProfileIfNeeded()` 返回 `conflict` 时仅写 `sessionStorage["kb_profile_migration_conflict"]={"at":iso}`，无任何 UI 读取，用户无从确认 → 违反 v7.2「冲突要求用户确认，不静默覆盖」。
- `src/lib/profile/profileApi.ts:95-163`：两个冲突分支（PATCH 失败 L157、双方都有补充事实 L162）不返回访客事实，UI 无法解决冲突。

### 决策
1. `profileApi.migrateGuestProfileIfNeeded` 返回类型扩展为 `{ kind, guestFacts?: SupplementFacts }`，两个冲突分支带上 `guestFacts`。
2. `HttpAuthProvider.login` 存储 payload 改为 `{ at, guestFacts }`（无 guestFacts 时省略该字段）。
3. 新建 `src/components/opportunities/MigrationConflictBanner.tsx`：
   - props: `{ guestFacts: SupplementFacts | undefined, onResolved: (choice: "guest" | "server") => void }`；
   - 文案：账号中已有保存过的补充信息，与本次访客期间填写的不同，请确认保留哪一份；
   - 按钮 A「使用本次填写的信息」：`getProfileWithMeta()` 取最新 updatedAt → `patchProfile(patch, updatedAt)`（patch 只含白名单字段：birthDate/hukouProvinceCode/hukouCityCode/socialSecurityMonths/workExperienceMonths/extraAnswers）→ 成功调 `onResolved("guest")`；409 时提示「信息刚在其他设备更新，请重试」可再点；其他错误显示 message；
   - 按钮 B「保留已保存的信息」：`supplementFactsService.clear()` 清除本地访客补充事实（避免下次登录再冲突）→ `onResolved("server")`；
   - busy 态防重复点击；不清除访客基础草稿（kb_guest_profile_v61）。
4. `src/app/opportunities/page.tsx`：仿照 L50-55 `kb_post_login_notice` 懒读取模式，新增 `migrationConflict` state 从 sessionStorage 读取 `kb_profile_migration_conflict`（读出即 removeItem）；渲染 `<MigrationConflictBanner>`；`onResolved` 后显示成功 StatusMessage 并调 `reload()` 刷新匹配。
5. 单测：profileApi 冲突分支返回 guestFacts（扩展现有 profileApi 测试文件，若不存在则在 MigrationConflictBanner.test.tsx 中以 mock fetch 覆盖）；Banner 组件两按钮行为（mock profileApi）。

## 风险 2：访客补充流程浏览器 E2E

### 现状
无 e2e/ 目录、无 playwright 配置；`%LOCALAPPDATA%\ms-playwright` 已缓存 chromium-1243；前端 vitest include 仅 `src/**`、`tests/**`、`scripts/**`，根 `e2e/**` 不会被 `npm test` 扫到；demo 模式 `unitDetail` 走纯本地 demoApi，E2E 不需要后端。

### 决策
1. `npm i -D @playwright/test`，安装后核对 `node_modules/playwright-core/browsers.json` 的 chromium revision；不为 1243 则执行 `npx playwright install chromium`（网络允许）。
2. 新建 `playwright.config.ts`：`testDir:"./e2e"`、`baseURL:"http://localhost:3000"`、`webServer:{command:"npm run dev",url,reuseExistingServer:true,timeout:120_000}`、单项目 chromium。
3. 新建 `e2e/supplement-flow.spec.ts`（P0 回归：点击补充绝不进 /onboarding）：
   - `page.addInitScript` 预写 localStorage `kb_guest_profile_v61`：完整 GuestProfileSession（draft 含 regions[浙江杭州]、educationLevel、majorFullName、graduationDate、teacherCert{status:"obtained",subject:"chinese",stage}、intendedSubject:"chinese"、acceptedEmploymentNatures:[]，step:2，expiresAt +7 天）；
   - goto `/preview` → 断言页面渲染（不跳 /onboarding）；
   - 点击文本为「补充信息后判断」的按钮（need_more_info 卡主按钮；若无则点开「查看其他示例判断」Disclosure 再找；仍无则测试失败并报告）；
   - 断言 URL 变为 `/preview/supplement/<unitId>?origin=preview&bucket=need_more_info`，且全程未出现 `/onboarding`；
   - 页面出现「出生日期」date input 时填 `1995-06-15`，点「保存并重新判断」；
   - 断言出现保存成功播报（role=status 或文本「信息已保存」），URL 仍非 /onboarding；
   - 断言 localStorage `kb_profile_supplement_v61` 含 birthDate=1995-06-15（demo 不持久化敏感事实到服务端，仅存本机——与实现一致）。
4. package.json 加脚本 `"test:e2e": "playwright test"`。

## 风险 4：后端 PATCH /profile HTTP 集成测试

### 现状
`backend/src/profile/profile.service.spec.ts` 只到 service 级；controller 的 HTTP 行为（401、409 响应体、白名单过滤经 HTTP 层）未覆盖。`backend/vitest.config.e2e.ts` include `**/*.e2e-spec.ts`，单测 glob `*.spec.ts` 不匹配 `*.e2e-spec.ts`，互不干扰；`npm run test:e2e` 已存在；supertest 已用（test/app.e2e-spec.ts）；demo 模式（AUTH_MODE 未设）UserGuard 读 `x-user-id`/`x-user-role` 头；fake Prisma 内存实现已在 service spec L11-44 就绪。

### 决策
新建 `backend/test/profile-patch.e2e-spec.ts`：
- TestingModule 最小化：`controllers:[ProfileController]`，`providers:[ProfileService, {provide:PrismaService, useValue:fakePrisma}]`（复刻内存 Map 版 fake，含 findUnique/upsert + 递增 updatedAt）；
- 每条请求带头 `x-user-id: user-1, x-user-role: candidate`；
- 用例：
  1. 无身份头 PATCH → 401；
  2. GET /profile 未保存 → `{profile:null}` 且无 updatedAt；
  3. PUT 保存后 GET 返回 profile + updatedAt；
  4. PATCH 白名单过滤：changes 含 `regions`（非白名单）+ `birthDate` → 200，结果只含 birthDate，regions 不入库；
  5. PATCH 全为非白名单 → 409（service 对空白名单抛 ConflictException）；
  6. PATCH 乐观锁：带上一次 GET 的 updatedAt 成功；用过期 updatedAt 再 PATCH → 409 且 body.error==="VERSION_CONFLICT"、body 含最新 profile/updatedAt；
  7. PATCH 部分合并：已有基础画像字段（regions 经 PUT 写入）在 PATCH birthDate 后仍保留；
  8. 幂等：同 changes 同 expectedUpdatedAt 第一次成功后，第二次以旧 updatedAt → 409（版本已前进）。

## 验证（完成门）
1. `npm test`（前端 472+ 全绿，含新增 Banner/profileApi 测试）；
2. `npm run lint` 0 error（warnings 不新增）；
3. `npm run build` + `npm run check:external` 通过；
4. `npx playwright test` 全绿（用已在跑的 :3000 dev server）；
5. `cd backend && npm test`（288+ 全绿）与 `npm run test:e2e`（含新 PATCH e2e）全绿；
6. 不提交、不推送。

## 明确不做
- 不改 supplement 路由、不改 ProfileRepository 接口；
- 不动本地保护文件（复盘/提示词/CSV）；
- 不为 Banner 加字段级 diff 视图（仅整体二选一）；
- 后端 e2e 不启动真实数据库。
