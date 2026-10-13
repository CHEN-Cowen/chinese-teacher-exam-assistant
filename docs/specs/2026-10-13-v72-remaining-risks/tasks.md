# 任务清单（对应 spec.md）

## T1 风险1：登录迁移冲突 UI
- [x] 1.1 改 `src/lib/profile/profileApi.ts`：`migrateGuestProfileIfNeeded` 返回 `{kind, guestFacts?}`，两个冲突分支带 guestFacts
- [x] 1.2 改 `src/lib/auth/HttpAuthProvider.ts`：冲突 payload 存 `{at, guestFacts}`
- [x] 1.3 新建 `src/components/opportunities/MigrationConflictBanner.tsx`（两按钮 + busy + 409 重试提示）
- [x] 1.4 改 `src/app/opportunities/page.tsx`：懒读取 sessionStorage 标记、渲染 Banner、onResolved 后 reload + 成功提示
- [x] 1.5 新增/扩展单测：profileApi 冲突返回 guestFacts；Banner 两按钮行为

## T2 风险2：Playwright E2E
- [x] 2.1 `npm i -D @playwright/test`，核对 chromium revision，必要时 `npx playwright install chromium`
- [x] 2.2 新建 `playwright.config.ts`（reuseExistingServer:true）
- [x] 2.3 新建 `e2e/supplement-flow.spec.ts`（seed localStorage → /preview → 补充 → 断言不进 /onboarding → 填出生日期保存 → 断言成功播报 + localStorage）
- [x] 2.4 package.json 加 `test:e2e` 脚本

## T3 风险4：后端 PATCH HTTP e2e
- [x] 3.1 新建 `backend/test/profile-patch.e2e-spec.ts`（8 个用例，见 spec）

## T4 验证
- [x] 4.1 前端 `npm test`（481 全绿）、`npm run lint`（0 error）、`npm run build` + `npm run check:external`（阻断项 0）
- [x] 4.2 `npx playwright test`（1 passed）
- [x] 4.3 后端 `npm test`（288 passed + 2 expected fail）、`npm run test:e2e`（9 passed）
- [x] 4.4 输出修复报告（不提交、不推送）
