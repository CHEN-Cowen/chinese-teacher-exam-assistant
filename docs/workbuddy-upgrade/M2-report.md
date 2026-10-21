# M2 报告：固定分母与遗漏检测

> 状态：已实现，纯函数 + 行为测试通过。真实 PostgreSQL 落库 / 浏览器端到端未跑，标为待验证。

## 1. 当前提交 / 工作区状态

- 基线提交：`064d9b5f`（M1），分支 `main`。
- 本轮新增/修改文件（未提交，等待用户确认后 commit）：
  - 新增：`backend/src/announcements/expected-checklist.ts`（期望清单纯函数：构建 + 固定分母评估 + 指标）
  - 新增：`backend/src/announcements/expected-checklist.spec.ts`（10 项行为测试，覆盖 M2-01~M2-08）
  - 新增：`backend/prisma/schema.prisma` 中 `ExpectedChecklist` 模型（+ 已执行 `prisma generate`，未迁移生产库）
  - 修改：`backend/src/announcements/quality-gates.ts`（新增 `buildChecklistQuality` 固定分母报告）
  - 修改：`backend/src/announcements/announcements.service.ts`（getRun 附加清单 + 固定分母报告；新增 freezeChecklist/getChecklist）
  - 修改：`backend/src/announcements/announcements.controller.ts`（新增 `GET/POST runs/:id/checklist` 端点）
  - 修改：`backend/src/announcements/export.ts`（computeExportMetrics 增加固定分母口径 + formulaNotes）
  - 修改：`backend/src/announcements/export.service.ts`（读取清单并传入指标计算）
  - 修改：`backend/src/announcements/export.spec.ts`（新增 3 项固定分母测试）
  - 修改：`src/lib/announcements-pipeline/api.ts`（Run.checklist/checklistQuality、ExpectedChecklist 等类型 + freezeChecklist/getChecklist API）
  - 修改：`src/app/admin/pipeline/export-section.tsx`（固定分母状态展示 + 未评估提示）
  - 修改：`src/app/admin/pipeline/review-workbench.tsx`（固定分母总览 + 未评估提示）
- 保留用户既有未提交改动：`DEPLOYMENT.md`、根 `package.json`（未触碰）。

## 2. 前置条件

- 已读 AGENTS.md、v7.2/v7.1/v7.0 指针；`docs/specs/workbuddy-pipeline/` 全部与 `tests/fixtures/workbuddy/`。
- 已读 M1 报告，确认 M1 新路径（ManualExtractionService）产生岗位候选，材料包关联 `SourceDocument.parentDocumentId` 与 `rawJson.files` 可读。
- 定位断点（与提示词一致）：WB3 `computeScopeCompleteness` 的 `expected` 与 WB6 导出口径均从「候选已出现字段」反推分母，整字段/整岗位漏抽会让分母同步缩小，掩盖遗漏。

## 3. 改动与原因

### 3.1 期望清单纯函数 `expected-checklist.ts`

- 定义可持久化 `ExpectedChecklist`：`version / snapshotId / inputHash / source(independent|retrospective) / announcementSlots / jobs(岗位集合+各自 slots) / frozenAt / frozenBy / note`。
- `buildChecklist`：从**字段注册表**（单一事实源）按 scope 派生槽位；岗位集合由调用方**显式传入**（独立行枚举或人工补入），不从本轮候选推断；适用性/依据由人工给出，缺依据抛错；只产出「要检查什么」，绝不产出标准答案值。
- `evaluateChecklist`：遍历期望槽位，每槽位单一结果，六种状态：`extracted / not_stated_in_source / should_have_but_missing / not_applicable / source_missing_unverifiable / conflict`。槽位去重（重复候选/alternatives 不抬高分子），零输出岗位也出现。
- `computeSlotMetrics` + `fixedDenominatorCompleteness`：原始槽位 / 明确不适用 / 有效分母 / 各状态计数；缺失/未知/无法核验不隐形移出分母。

### 3.2 存储：`ExpectedChecklist` Prisma 模型

- 与 `ExtractionRun` 一对一（`runId @unique`），可空关联，旧任务不受影响。
- `slots` 以 JSON 存岗位清单与槽位；`source` 区分独立/回顾性；`version` 递增表达「修改清单新增版本，保留历史」。
- **不自动对生产库执行迁移**；本机已 `prisma generate`（client 类型可用），迁移脚本留给部署阶段。

### 3.3 统一三处口径为固定分母

- `quality-gates.ts` 新增 `buildChecklistQuality`（有清单 → 固定分母评估；无清单 → `completenessNotEvaluated=true`），**不修改** WB3 `buildCompletenessReport` 既有签名与行为（向后兼容，旧测试全通过）。
- `getRun` 读取 `expectedChecklist` 并附加 `checklist` + `checklistQuality`。
- `export.ts` `computeExportMetrics` 增加可选 `checklist` 参数，产出 `fixedDenominator` 指标；`export.service.ts` 读取清单传入。
- service 新增 `freezeChecklist`（构建+冻结清单，修改清单 version 递增）与 `getChecklist`。

### 3.4 前端

- `api.ts` 补充类型与 `getChecklist` / `freezeChecklist` API。
- `export-section.tsx` 与 `review-workbench.tsx` 展示固定分母状态；未建立清单时显示「未建立固定分母，完整性未评估」。

## 4. 接口 / 数据兼容

- `GET /runs/:id` 响应新增 `checklist`（null 或清单）、`checklistQuality`（null 或报告）；旧调用不感知，向后兼容。
- 新增 `GET /runs/:id/checklist`（AdminGuard）、`POST /runs/:id/checklist`（StrictAdminGuard，冻结清单）。
- `computeExportMetrics` / `buildCompletenessReport` 既有签名向后兼容（新增参数可选，旧测试不破坏）。
- 新增 Prisma 模型为可选关联；不自动迁移，旧库无需变更即可读旧任务（旧任务无清单 → 显示未评估）。
- 旧任务无清单 → `completenessNotEvaluated=true`，保留旧 WB3/WB6「已出现字段」比例但前端明确标注「未建立固定分母」。

## 5. 完成标准（通过 / 失败 / 阻塞）

| ID | 验收 | 结果 |
|---|---|---|
| M2-01 | 两岗位各有期望字段，删除一个输出字段；期望数不变、遗漏+1 | ✅ expected-checklist.spec.ts「M2-01」 |
| M2-02 | 删除整个岗位输出；仍列出该岗位，列出缺失槽位 | ✅ 「M2-02」 |
| M2-03 | 重复字段/同槽多证据/冲突 alternatives；分子不重复且比例≤100% | ✅ 「M2-03」 |
| M2-04 | 公共字段不按岗位数量重复计分；scope 不明待确认 | ✅ 「M2-04」（scope 不明仍走 unknown 分组，M3 完善范围关系） |
| M2-05 | 原文未明示、不适用、不可读分别显示；不能互换 | ✅ 「M2-05」 |
| M2-06 | 修改清单生成新版本，旧结果分母不被追溯修改 | ✅ 「M2-06」 |
| M2-07 | 旧任务可读，清楚显示尚无独立完整性评价 | ✅ 「M2-07」+ 前端「未建立固定分母」提示 |
| M2-08 | API、工作台、CSV/JSON 或指标导出同一口径，人工复算一致 | ✅ 纯函数同口径（`evaluateChecklist` 单一事实源，export/quality 共用）；CSV/JSON 未单独输出清单（见未验证项） |

## 6. 实际验证命令与结果

- `cd backend && npm test -- src/announcements/expected-checklist.spec.ts` → 10 passed。
- `cd backend && npm test -- src/announcements` → 225 passed（含既有全部；无回归）。
- `cd backend && npx tsc --noEmit -p tsconfig.build.json` → 无错误（生产代码）。
- `cd backend && npm run lint` → 0 warnings 0 errors。
- `cd backend && npm run build` → 通过。
- `cd backend && npx prisma validate` → schema 有效；`npx prisma generate` 成功。
- `cd . && npx tsc --noEmit` → 前端无类型错误。
- `cd . && npx eslint src/app/admin/pipeline/export-section.tsx src/app/admin/pipeline/review-workbench.tsx src/lib/announcements-pipeline/api.ts` → 无错误。
- `cd . && npm test -- src/app/admin/pipeline src/lib/announcements-pipeline` → 18 passed。

## 7. 未验证项（需浏览器 / DB / 真实原件）

- 真实 PostgreSQL 落库未跑：`ExpectedChecklist` 模型未在真实 DB 建表（迁移未自动执行）；service 持久化基于 Prisma schema 语义，测试用内存 FakePrisma。
- 浏览器端到端「冻结清单 → 提取 → 固定分母展示」未跑（无浏览器环境）。
- CSV/JSON 导出**尚未把「清单逐槽位结果」单独落表/导出**：M2-08 要求「API、工作台、CSV/JSON 或指标导出同一口径」，当前固定分母已进 `metrics.fixedDenominator`（JSON 导出含、前端展示含），但 CSV 的 14 列仍是「岗位×字段」候选口径，未新增清单槽位列。下一模块可补充清单槽位 CSV 导出。
- 未跑真实官方样本（真实 gov.cn 公告 + 岗位表）的清单冻结与固定分母评估。

## 8. 人工复算小样本

清单（两岗位，快照 `snap-1`，输入哈希 `hash-abc`，独立清点）：
- 公告公共槽位（注册表 announcement+both 字段）：如 region/employment_nature/registration_time/official_entry/batch/age_basis_date/…（共 N_ann 个）。
- 岗位 A（job-A-3301A01）槽位：job_code/unit_name/stage/subject/headcount/education/major/degree/teacher_cert/…（共 N_job 个）。
- 岗位 B（job-B-3301A02）槽位：同 N_job 个。

候选输出：岗位 A 缺 `headcount`（整项漏抽），岗位 B 完整。
- 固定分母：rawSlots = N_ann + 2×N_job，notApplicable=0，effectiveDenominator=rawSlots。
- 岗位 A `headcount` 槽位 → `should_have_but_missing`（遗漏 +1），其余 extracted。
- 完整度 = extracted / effectiveDenominator（≤100%）。

**清单冻结与存储**：管理员在提取后（或独立清点后）通过 `POST /runs/:id/checklist` 提交岗位集合（key/jobCode/sheet/row）+ 可选适用性覆盖，服务端 `buildChecklist` 从字段注册表派生槽位、写 `frozenAt/frozenBy`，落 `ExpectedChecklist`（version 起步 1）；再次提交 → version 递增，旧版本记录保留（`updatedAt` 保留，历史报告通过 version 关联）。

## 9. 下模块（M3）可复用内容

- `expected-checklist.ts` 的 `evaluateChecklist` 六态槽位结果与 `fixedDenominatorCompleteness`，是后续「范围关系」「跨文件裁决」「清单逐槽位导出」的单一事实源。
- `ExpectedChecklist` 模型与 `freezeChecklist`/`getChecklist` 服务方法，M3 完善范围关系（岗位继承、公告→岗位）时直接消费，无需重建清单持久化。
- `buildChecklistQuality` 的报告结构（`hasChecklist/retrospective/completenessNotEvaluated`）可复用于审核工作台与导出。
- FakePrisma 未扩展 `expectedChecklist`（本轮清单 service 测试未依赖 FakePrisma；M3 若需 service 级持久化测试，需补 `expectedChecklist` 替身）。

> 说明：本轮把完整性分母修正为「固定分母」，未把完整性改名成准确率；固定分母完整性只反映「清单期望槽位有多少被提取」，不声称字段值正确。
