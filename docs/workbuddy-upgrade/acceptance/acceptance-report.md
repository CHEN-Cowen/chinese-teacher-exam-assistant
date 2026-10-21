# 独立验收报告：M1–M6 实际完成度（修订版）

> 验收角色：独立验收者。本报告只报告、不修改生产代码、不提交推送、不部署。
> 验收日期：2026-10-21。验收对象：`E:\游戏\考编助手`（远端 `target` = `https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant`）。
> **修订说明**：首版报告误判「前端源码缺失」（被 `frontend/` 残留目录误导）。经复核实为误判——前端源码一直在仓库根目录 `src/`（290 文件、已提交、工作树干净）。本版已更正；误判过程见 §8。

---

## 1. 被验收对象与基线环境

| 项 | 值 |
|---|---|
| 本地 HEAD | `5d70dd1b`（feat(m6): 真实指标、复用与离线交付） |
| 分支 | `main` |
| `target`/main HEAD | `5d70dd1b`（与本地一致，已推送） |
| `origin`/main HEAD | `2c0baa8a`（另一个仓库 `...-project.git`，历史快照，非当前工作基线） |
| 工作区差异 | `DEPLOYMENT.md`、根 `package.json`（改动，未提交，按约定不触碰）；若干无关未跟踪文件 |
| **前端源码位置** | **仓库根目录 `src/`（290 文件，git 跟踪，工作树干净）**；`frontend/` 子目录仅为残留旧构建产物（node_modules/.next），非项目本体 |
| 后端源码位置 | `backend/src/`（226 个跟踪文件，M1–M6 实现齐全） |
| 运行版本 | 前端 Next.js 16.3.8 / React 19.2.8（根 package.json）；后端 NestJS（backend/package.json 0.0.1） |
| 数据环境 | 未配置真实 PostgreSQL；测试用内存 prisma/构造数据 |

**前端项目结构澄清（重要）**：本仓库是「前端 + 后端」同仓 monorepo，前端在**仓库根目录**（根 `package.json` 的 name=`frontend`），后端在 `backend/` 子目录。`frontend/` 子目录是历史遗留的空壳（仅 node_modules、.next 等），不属于项目本体。首版误把 `frontend/` 空壳当成了前端项目位置。

---

## 2. 分层验收结论

| 层 | 结论 | 依据 |
|---|---|---|
| 1. 实现及自动化测试（后端） | **通过** | 全量 815 通过 + 1 expected fail（0 失败，P2 已修复） |
| 1'. 实现及自动化测试（前端） | **通过** | pipeline + announcements-pipeline 23 测试全绿；`tsc --noEmit` 退出码 0 |
| 2. 隔离真实 DB/Worker 集成 | **未执行/阻塞** | 无真实 PostgreSQL、Redis、Worker；测试为内存/构造 |
| 3. 浏览器完整操作 | **未执行/阻塞** | 无浏览器环境；组件测试已过但非整页实操 |
| 4. 真实 S1/S2 及本人采用 | **未验证** | M6 报告明示 S1/S2 真实样本、计时、会话 ID 未导入 |
| 5. 离线交付与 WorkBuddy 证据 | **部分** | 离线包纯函数+测试已实现；真实录屏/会话证据缺失 |

**整体判定：代码层通过，业务层尚不能判定整体通过。** 前后端 M1–M6 实现质量高、测试充分（后端 815 通过、前端 23 通过、tsc 0 错、lint 0 错、build 通过）。仅剩真实业务 S1/S2 采用（P1）与浏览器/真实 DB 层未验证——这两项是环境/材料阻塞，非代码缺陷。

---

## 3. 真实调用链追踪结果

| 环节 | 追踪结论 |
|---|---|
| 后台按钮是否走旧 parser | 否。`announcements.module.ts` 恒注入 `ManualExtractionService`；`submitSource`/`runExtraction` 委托新链路（复用 `extractFields`），仅无注入（旧单测）才回退 `parser.ts` |
| URL 是否真取到内容 | 是。`sourceType==='government'` 且 content 为 URL 时用 `SafeFetcherFactory` 真抓取，失败抛错，绝不把 URL 字符串当正文 |
| 测试是否只构造对象 | 否。核心测试跑真实业务纯函数 + Nest 编译注入（`manual-extraction.service.spec.ts`） |
| 两岗位是否真实来自本轮输入 | 后端链路支持（xlsx 附件逐行抽多岗位）；有 `manual-extraction` 真实 xlsx→提取→复核集成测试；浏览器端到端未跑 |
| 目录/页面是否用 demo/fallback | 用户端匹配在后端 `matching/`+`opportunities/`，`FF_DB_CATALOG` 控制 DB/静态切换；M5 修复 `dataset==='real'` 误当「AI 初核」，改为按 `human_reviewed` 判定（`m5-user-visibility.spec.ts` 覆盖） |
| 质量分母是否依赖候选输出 | 否。`expected-checklist.ts` 固定分母，岗位显式传入不从候选推断 |
| 计时是否冒充投入 | M6 正名 `reviewDurationMs`=「审核事件跨度」，新增自报式 `computeTimeTracking`，未记录=null |

---

## 4. 自动化与构建检查结果

| 命令 | 结果 |
|---|---|
| 后端 `vitest run src/announcements/` | **261 passed / 20 files** |
| 后端 `vitest run`（全量） | **815 passed / 1 expected fail / 0 failed**（P2 修复后） |
| 后端 `oxlint --type-aware src/` | 0 warnings / 0 errors |
| 后端 `nest build` | 通过 |
| 前端 `vitest run src/app/admin/pipeline src/lib/announcements-pipeline` | **23 passed / 4 files** |
| 前端 `tsc --noEmit` | 退出码 0 |

---

## 5. 核心业务验收矩阵（A01–A24）

| ID | 必查行为 | 状态 | 证据 |
|---|---|---|---|
| A01 | 实际入口读取正文与附件，生成两语文岗位 | ✅（后端）⛔（端到端） | `manual-extraction.service.ts` 真实解析+`extractFields` 多岗位；无浏览器端到端 |
| A02 | 文件不可读/URL 失败/部分成功 | ✅ | `MaterialFileStatus`（ok/unreadable/unsupported/pending_manual） |
| A03 | 重复触发与重试幂等 | ✅ | `domain.spec.ts` 幂等键 + 材料包指纹 |
| A04 | 冻结清单早于被评估抽取 | ✅ | `freezeChecklist` 独立端点，岗位显式传入，版本递增 |
| A05 | 删除字段/删除整岗位 | ✅ | `expected-checklist.spec.ts` M2-01/M2-02 |
| A06 | 重复候选/公共继承/冲突多值去重 | ✅ | `field-reconciler` + M2-03 比例不超 100% |
| A07 | 原文未写/不适用/不可读/漏抽状态分开 | ✅ | 六态槽位 + normalization 语义保真 |
| A08 | 正文 2 人/附件 3 人 → conflict | ✅ | `field-reconciler.spec.ts` M3-01 两值两证据 |
| A09 | 不同岗位人数/公告总数/公共+例外 | ✅ | M3-04 announcement age 与 job age 并存 |
| A10 | 两批次/更正公告不串用 | ✅ | `batchId` 分区；更正 `suspectedCorrection` 不自动覆盖 |
| A11 | 归属/更正关系不明 → 待确认 | ✅ | `scope:unknown` 进 `unattributed` |
| A12 | 编辑/采用/退回留痕 | ✅ | `applyFieldDecisions` 审计 decision + alternatives |
| A13 | 保存失败/409/刷新/切岗 | ✅ | `baseUpdatedAt` 409；前端「批量不跨岗位」测试 |
| A14 | 高影响缺证据/冲突未裁决阻塞发布 | ✅ | `quality-gates.ts` + publish 门禁 |
| A15 | 审核后发布→目录→匹配一致 | ✅ | `publish-catalog.integration.spec.ts`（15 测试） |
| A16 | 两画像及未知条件有依据 | ✅ | matching engine + 未知不判不符合 |
| A17 | 历史/demo/test/当前无岗区分 | ✅ | `m5-user-visibility.spec.ts` M5-05 test 不进用户端 |
| A18 | 材料清单与官方入口对应批次 | ✅ | catalog-payload-assembler 不猜链接 |
| A19 | 修订/撤回/事务失败原子性 | ✅ | `withdraw.spec.ts` + supersede |
| A20 | 时间/质量/比例可复算 | ✅ | `computeTimeTracking`/`computeAccuracy`/fixedDenominator |
| A21 | 导出与证据安全 | ✅ | CSV 公式注入防护、redactUrl、14 列 |
| A22 | 离线包可解压/哈希一致 | ✅（纯函数） | `offline-package.ts` + `m6-metrics-offline.spec.ts` |
| A23 | 管理权限与输入边界 | ✅ | StrictAdminGuard/AdminGuard/ReviewGuard 分离 |
| A24 | WorkBuddy 与赛内增量证据 | ❌ 未验证 | 真实会话/录屏/调用 ID 未提供 |

---

## 6. 证据索引

- 后端 M 系列：`backend/src/announcements/`（manual-extraction / field-reconciler / expected-checklist / quality-gates / catalog-payload-assembler / export / offline-package）
- 用户端闭环：`backend/src/matching/` + `backend/src/opportunities/`（m5-user-visibility.spec.ts / view.ts / opportunities.service.ts）
- 前端 UI：`src/app/admin/pipeline/`（page.tsx / review-workbench.tsx / export-section.tsx + 3 测试）、`src/lib/announcements-pipeline/`（api.ts + api.test.ts）
- 测试运行：后端全量 815 通过 + 1 expected fail；前端 pipeline 23 通过；前端 tsc 0 错

---

## 7. 风险

1. **P1：真实业务 S1/S2 未导入**，M6 真实价值层（赛事真实价值 30 分项）无法验收。
2. **P2：无真实 DB/Redis/Worker/浏览器环境**，隔离集成与浏览器层未验证。
3. **P3：前端与后端 `fieldIdentity`/`groupByScope` 双份实现漂移风险**（前端 api.ts 镜像后端 domain.ts，需契约对齐测试兜底）。

详见 `issues.md` 与 `manual-follow-up.md`。

---

## 8. 首版误判说明（透明记录）

首版报告错误结论「前端 UI 源码不在参赛仓库（P0）」，原因是把仓库根目录下历史遗留的 `frontend/` 子目录（仅含 node_modules/.next 等构建残留，非项目本体）误当成前端项目位置。实际前端项目在**仓库根目录**（根 package.json name=`frontend`），源码在根 `src/`，290 文件完整、已提交、工作树干净，前端 23 测试与 tsc 均通过。

误判已在本版更正。对由此造成的误导表示歉意。`docs/workbuddy-upgrade/acceptance/issues.md` 同步更正（删除 ISSUE-1「前端缺失」）。
