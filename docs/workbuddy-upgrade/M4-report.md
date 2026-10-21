# M4 报告：审核工作台效率优化

> 状态：已实现，前端工作台改造 + 一个提交语义 bug 修复。离线测试（前端 23 + 后端 246）通过。
> 浏览器端到端 / 真实 DB 落库未跑，标为待验证。

## 1. 当前提交 / 工作区状态

- 基线提交：`af2fae22`（M3 遗留修复），分支 `main`。
- 本轮新增/修改文件（未提交，等待用户确认后 commit）：
  - 修改：`src/app/admin/pipeline/review-workbench.tsx`（核心：风险排序、未解决计数、漏抽岗位视图、提交语义修复、切岗提示、键盘导航）
  - 修改：`src/app/admin/pipeline/review-panel-three-layer.test.tsx`（「批量操作不跨岗位」测试随 M4 切岗确认语义更新）
  - 新增：`src/app/admin/pipeline/review-workbench-m4.test.tsx`（M4 专属 5 项测试）
  - 修改：`backend/src/announcements/review-workbench.service.spec.ts`（新增 M4-03 后端 approve+fieldDecisions 测试）
- 保留用户既有未提交改动：`DEPLOYMENT.md`、根 `package.json`（未触碰）。

## 2. 前置条件与实际核对

- 已读 AGENTS.md、M2/M3 报告、`docs/workbuddy-upgrade/contracts.md`、`docs/specs/workbuddy-pipeline/`。
- 核对结论（与提示词一致的断点）：
  1. **提交语义 bug（M4-03 阻断）**：前端 `submitScope` 用 `action:"approve_with_edit"` + `editedFields`（整体覆盖字段）。后端 `submitReview` 先应用 `fieldDecisions`，再被 `editedFields`（用的是**原始值** `f.value` 而非 edit 后新值）整体覆盖 → edit 决策的 `afterValue` 被丢弃。这是真 bug。
  2. **无风险排序（M4-01）**：岗位导航顺序 = `Map` 插入序（字段出现顺序），不按「冲突/遗漏/来源失败优先」排序；`defaultKey` 只选第一个有 conflict/unknown 的岗位，导航无「每岗位未解决项数」。
  3. **漏抽岗位不进入待处理视图（M4-01b）**：M2 checklist 的零输出岗位（`should_have_but_missing`）只进 `checklistQuality.evaluation.jobs`，前端导航只从候选分组 `jobs` 取 key，漏抽岗位无法点进去看。
  4. **切岗静默清空（M4-09）**：`switchScope` 直接 `resetForScope()` 清空未保存决策，无提示。

后端能力已齐备（`fieldDecisions` adopt/edit/reject/pending、`baseUpdatedAt` 409、冲突门禁、`applyFieldDecisions` 的 conflict→extracted 状态转移），M4 主要是前端工作台改造 + 上述 bug 修复，不重复造后端。

## 3. 改动与原因

### 3.1 提交语义修复（M4-03，review-workbench.tsx）

- `submitScope` 由 `action:"approve_with_edit"` + `editedFields` 改为 `action:"approve"` + 仅 `fieldDecisions`。
- 原因：`approve_with_edit` 的 `editedFields` 会整体覆盖候选字段，丢弃 edit 决策的 afterValue；
  `approve` + `fieldDecisions` 走 `applyFieldDecisions` 纯函数，正确写入 before/after/原因，并处理 conflict→extracted。
- 后端新增测试 `M4-03：approve + fieldDecisions（无 editedFields）→ edit 决策的 afterValue 正确持久化` 证明该路径正确。

### 3.2 风险排序 + 未解决计数（M4-01）

- 新增纯函数 `computeJobRisk(jobKey, quality, checklistQuality)`：
  - 未解决项 = 冲突 + 未知 + 漏抽槽位（`should_have_but_missing`）+ 来源不可核验（`source_missing_unverifiable`）；
  - 风险分级：3 = 冲突/来源失败/必需遗漏；2 = 高影响缺证据；1 = 普通待审（unknown）；0 = 无。
- `orderedJobKeys` 按风险降序，同等级按 key 稳定排序；`defaultKey` 选中风险最高岗位。
- 导航 badge 显示未解决项数，`badgeTone` 区分 danger（冲突/不可核验）/ warning（遗漏/未知）。
- 数据来源全为服务端 `quality`（WB3）+ `checklistQuality`（M2 固定分母），前端只排序呈现，不复制门禁算法。

### 3.3 漏抽岗位进入待处理视图（M4-01b）

- `allJobKeys` 合并候选岗位 key 与 checklist 岗位 key；
- 新增 `MissingJobView`：候选无字段但清单有 `should_have_but_missing`/`source_missing_unverifiable` 槽位时，
  显示「该岗位疑似整岗位漏抽」+ 缺失槽位列表 + 引导核对「漏抽 vs 不适用」。

### 3.4 切岗未保存提示（M4-09）+ 409 引导（M4-05）+ 键盘（M4-08）

- `switchScope`：有未保存决策/原因时弹确认框，确认后才清空切换；
- `submitScope` catch：只匹配明确并发冲突语义（`409`/`已被他人更新`/`并发冲突`），显示「重新加载后再比对提交」；
  不误伤「冲突字段未裁决」等普通门禁错误；
- 分区导航：`roving tabindex` + 方向键/Home/End 键盘导航 + 切岗后焦点恢复（`ref` 聚焦）。

### 3.5 脱敏复核（M4-07）

- 复核确认（无需改动）：后端 `export.ts` 已用 `redactUrl`（协议+host+path，丢弃 query 凭据）脱敏证据 URL；
  前端 `evidenceLocatorText` 只输出 selector/page/cell 定位，不输出 URL query。已由既有测试覆盖。

## 4. 接口 / 数据兼容

- 无后端接口变更、无 Prisma 迁移。
- 前端 `submitReview` 请求语义变更：`action` 由 `approve_with_edit` 改为 `approve`，去掉 `editedFields`。
  `approve` 是既有合法 action，后端兼容；`fieldDecisions` 契约不变。
- 旧候选（无 scope / 无 checklistQuality）仍正常显示（既有测试「旧候选没有 scope」通过）。
- 无 checklistQuality 的任务：`computeJobRisk` 只基于 WB3 `quality`，未解决 = 冲突+未知，行为降级但不崩溃。

## 5. 完成标准（通过 / 失败 / 阻塞）

| ID | 验收 | 结果 |
|---|---|---|
| M4-01 | 冲突/遗漏优先出现，选岗位只处理该岗位，计数来自服务端 | ✅ `review-workbench-m4.test.tsx`「M4-01」（冲突岗排最前 + badge 计数）+「M4-01b」（漏抽岗进导航） |
| M4-02 | 字段与证据/批次/岗位对应，切岗不沿用引用 | ✅ 既有「批量操作不跨岗位」测试（M4 语义更新为确认后清空） |
| M4-03 | 编辑+原因→提交→刷新→JSON/CSV 前后值一致 | ✅ 前端「M4-03」（approve+fieldDecisions 无 editedFields）+ 后端「M4-03」（afterValue 持久化）；JSON/CSV 由 WB6 导出消费候选，前后值一致（待浏览器端到端实测） |
| M4-04 | 保存失败输入仍在，重试成功；服务端仍旧值时 UI 不显示已保存 | ✅ 既有「保存失败保留输入」测试通过（输入保留）；「服务端仍旧值」依赖 onDone 刷新（待端到端） |
| M4-05 | 两会话并发提交触发 409，已保存数据不被覆盖 | ✅ 后端「乐观并发 baseUpdatedAt→409」既有测试 + 前端「M4-05」（409 显示重新加载引导）；两会话真实并发待端到端 |
| M4-06 | 批量当前岗位不影响其他岗位/公告公共区 | ✅ 既有「批量操作不跨岗位」（确认后清空，决策只作用于当前分区） |
| M4-07 | 脱敏后证据仍可定位，输出不含凭据 | ✅ 既有「证据定位不泄露签名 query」+ 后端 redactUrl（协议+host+path，丢弃 query） |
| M4-08 | 键盘完成选岗/打开证据/编辑/提交，状态不只靠颜色 | ⚠️ 部分：方向键导航 + focus 语义已实现并测试「键盘可聚焦」；端到端键盘实操未跑（无浏览器），状态徽标已用文字（danger/warning 文字 + aria-selected）不只靠颜色 |

## 6. 实际验证命令与结果

- `cd . && npm test -- src/app/admin/pipeline src/lib/announcements-pipeline` → **23 passed**（4 文件：export-section 8 + review-panel-three-layer 8 + review-workbench-m4 5 + api 2）。
- `cd backend && npm test -- src/announcements` → **246 passed**（19 文件；新增 1 项 M4-03 后端测试）。
- `cd backend && npm run lint` → 0 warnings 0 errors。
- `cd . && npx tsc --noEmit` → 无错误。
- `cd . && npx eslint src/app/admin/pipeline/review-workbench.tsx src/app/admin/pipeline/review-workbench-m4.test.tsx src/app/admin/pipeline/review-panel-three-layer.test.tsx` → 无错误。

## 7. 未验证项（需浏览器 / DB / 真实原件）

- **浏览器端到端**「找异常 → 查证据 → 改值 → 保存 → 刷新」未跑（无浏览器环境）。组件测试不等价于整页实操，需有浏览器工具时补一次真实流程 + 脱敏截图。
- 两会话真实并发提交触发 409 的端到端（后端单测已覆盖 409 语义，但真实双客户端并发未跑）。
- 焦点恢复的屏幕阅读器/真实键盘实测未跑（代码已实现 roving tabindex + ref 聚焦，测试只验证 focus 语义存在）。
- 真实 PostgreSQL 落库（M2 ExpectedChecklist 仍未迁移生产库）——M4 只读消费 `checklistQuality`，不新增持久化，但漏抽岗位视图依赖真实清单数据才能完整呈现。

## 8. 下模块可复用内容

- `computeJobRisk`（风险分级 + 未解决计数）是「审核待办优先级」的单一事实源，后续若做审核员工作队列/看板可直接复用。
- `MissingJobView`（漏抽岗位视图）可复用为「清单例外确认」入口（漏抽 vs not_applicable）。
- `submitScope` 的 `approve` + `fieldDecisions` 语义是后续所有逐字段审核的统一路径，勿回退到 `approve_with_edit` 整体覆盖。
- 后端 `applyFieldDecisions` 的 conflict→extracted 状态转移 + `markAutoFieldsConfirmed` 已由 M3/M4 测试锁定，后续模块复用。

> 自动判断边界：风险排序/未解决计数/漏抽视图是结构化呈现；语义取舍（冲突选值、漏抽 vs 不适用、更正确认）仍由人工裁决留痕。
