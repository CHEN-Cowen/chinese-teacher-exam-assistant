# 验收核对表（2026-10-13 全部核实通过）

## 风险 1：登录迁移冲突 UI
- [x] `migrateGuestProfileIfNeeded` 返回 `{kind, guestFacts?}`，两个冲突分支均带 guestFacts（profileApi.test.ts 4 例覆盖）
- [x] HttpAuthProvider.login 冲突 payload 存 `{at, guestFacts}`（无 guestFacts 时省略）
- [x] MigrationConflictBanner：两按钮 + busy 防重复 + 409 提示「信息刚在其他设备更新，请重试」；patch 仅含白名单六字段；无 guestFacts 时只显示保留按钮（Banner 5 例单测覆盖）
- [x] opportunities 页懒读取 sessionStorage 标记（读出即 removeItem）、渲染 Banner、onResolved 后 StatusMessage + reload
- [x] 全程不静默覆盖：冲突必须用户二选一确认

## 风险 2：访客补充流程浏览器 E2E
- [x] @playwright/test 已装，chromium 与 browsers.json revision 匹配（chromium-1248）
- [x] playwright.config.ts：testDir ./e2e、baseURL :3000、webServer reuseExistingServer:true
- [x] e2e/supplement-flow.spec.ts：seed localStorage → /preview → 点「补充信息后判断」→ 断言进 /preview/supplement/...?origin=preview&bucket=need_more_info 且绝不进 /onboarding → 填出生日期保存 → 断言保存成功播报 + kb_profile_supplement_v61 持久化
- [x] `npx playwright test` 1 passed（6.0s）
- [x] package.json 有 `test:e2e` 脚本
- [x] E2E 暴露的两个真实 P0 Bug 已修复：AppShell 公共路径白名单补 `/preview/` 前缀；demoApi.load() 对无会话访客只读返回空数据

## 风险 4：后端 PATCH /profile HTTP 集成测试
- [x] backend/test/profile-patch.e2e-spec.ts 8 例全绿：401 / GET 空 / PUT+GET / 白名单过滤 / 全非白名单 409 / 乐观锁成功+过期 409 VERSION_CONFLICT 含最新 profile / 部分合并保留基础字段 / 幂等
- [x] 使用真实 UserGuard（demo 模式 x-user-id/x-user-role 头），未 override
- [x] 内存 fake Prisma，不启动真实数据库

## 完成门
- [x] 前端 `npm test`：47 文件 481 passed
- [x] 前端 `npm run lint`：0 error 0 warning
- [x] 前端 `npm run build` 成功（23 路由）+ postbuild `check:external`：阻断项 0、无密钥泄漏
- [x] `npx playwright test` 全绿
- [x] 后端 `npm test`：25 文件 288 passed + 2 expected fail；`npm run test:e2e`：9 passed
- [x] 未提交、未推送

## 明确不做（确认未越界）
- [x] 未改 supplement 路由、未改 ProfileRepository 接口
- [x] 未动本地保护文件
- [x] Banner 无字段级 diff（仅整体二选一）
