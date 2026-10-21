# M3 报告：跨文件归属与冲突复核

> 状态：已实现，纯函数 + 真实链路集成测试通过。浏览器端到端 / 真实 DB / 真实官方样本未跑，标为待验证。

## 1. 当前提交 / 工作区状态

- 基线提交：`7144e195`（M2 固定分母与遗漏检测），分支 `main`。
- 本轮新增/修改文件（未提交，等待用户确认后 commit）：
  - 新增：`backend/src/announcements/field-reconciler.ts`（跨文件归属与冲突复核纯函数）
  - 新增：`backend/src/announcements/field-reconciler.spec.ts`（13 项测试，M3-01~M3-09）
  - 新增：`docs/workbuddy-upgrade/contracts.md`（M1–M3 共享契约单一事实源）
  - 修改：`backend/src/announcements/domain.ts`（CandidateField 加 `batchId?`/`anchors?`；FieldAlternative 加 `ruleVersion?`/`sourceFile?`；fieldIdentity 纳入 batchId；**修复 applyFieldDecisions 裁决 conflict 后 status 不转移的缺陷**）
  - 修改：`backend/src/announcements/extraction/field-extractor.ts`（去掉跨范围 claimed 抢占 + 文本规则跳过表格单元格块 + 文本规则显式 status）
  - 修改：`backend/src/announcements/manual-extraction.service.ts`（接入 reconcileFields；附件带回 relationType；rawJson.reconciliation 持久化复核报告）
  - 修改：`backend/src/announcements/expected-checklist.ts`（新增 findJobsOutsideChecklist）
  - 修改：`backend/src/announcements/quality-gates.ts`（buildChecklistQuality 加 jobsOutsideChecklist）
  - 修改：`backend/src/announcements/manual-extraction.service.spec.ts`（新增 3 项真实链路集成测试）
  - 修改：`backend/src/document-processing/testing/fixture-builders.ts`（新增 buildCorrectionXlsxFixture 更正表构造器）
  - 修改：`src/app/admin/pipeline/review-workbench.tsx`（多来源证据/批次徽标、冲突替代值显示来源文件与提取版本）
  - 修改：`src/app/admin/pipeline/review-panel-three-layer.test.tsx`（冲突文案断言随 M3 语义更新）
- 保留用户既有未提交改动：`DEPLOYMENT.md`、根 `package.json`（未触碰）。

## 2. 前置条件与实际核对

- 已读 AGENTS.md、WB 专项文档、M1/M2 报告。
- **核对结论（与提示词一致的三处断点）**：
  1. `field-extractor.ts` 的 `claimed` 集合预置表格字段名 → 表格产出 job 级字段后，正文文本的公告级同名字段（总人数/公共条件）被静默丢弃（单文件内的首次命中抢占）；
  2. `manual-extraction.service.ts` 逐文件 `extractFields` 后直接拼接 `allFields` → **跨文件从未进入同一复核**：同岗位同字段不同值产生两条独立 `extracted`（不判 conflict、不阻塞发布）；同值产生重复记录（证据只留一条）；
  3. `fieldIdentity` 无批次维度 → 两批次报名入口同字段会被错误合并。
- 另发现并修复当前模块内缺陷：`applyFieldDecisions` 裁决 conflict（adopt/edit）后 `status` 不转移 → 已裁决冲突永久阻塞 `submitReview` 冲突门禁与发布（M3-09 测试暴露；修复后符合 spec §4.1「conflict——人工裁决——► edit」状态转移，alternatives 保留审计留痕）。

## 3. 改动与原因

### 3.1 身份契约扩展（domain.ts）

- `CandidateField.batchId?`（批次/适用范围，缺省=同一无名批次）、`anchors?`（同值合并的多来源证据）；
- `FieldAlternative.ruleVersion?` / `sourceFile?`（冲突复核保留双方提取版本与来源文件）；
- `fieldIdentity` 纳入 batchId：同字段不同批次 = 不同槽位，不合并、不自动判冲突。

### 3.2 抽取器根因修复（field-extractor.ts）

- 去掉 `claimed` 跨范围抢占：公告级文本候选与岗位级表格候选共存（总人数 vs 岗位人数、公共条件 vs 岗位特例是不同槽位）；
- 文本规则只作用于非表格块：表格单元格语义由列映射按岗位行归属（spec §1.3），避免单元格值被误抽为公告级条件（此前被 claimed 部分掩盖）；
- 文本规则产出补显式 `status: 'extracted'`（与表格字段一致）。

### 3.3 跨文件复核（field-reconciler.ts 纯函数）

- 输入各来源独立抽取结果（含文件元信息 + relationType），按 identity 分组：
  - 同值 → 合并一条，`anchors[]` 保留全部来源证据（M3-04）；
  - 不同值 → `conflict`：主值取公告正文来源优先（权威原文），`alternatives[]` 保留全部值+来源定位+摘录+提取版本+来源文件（M3-01）；阻塞审核与发布；
  - 身份不明（scope=unknown / jobKey 空）→ 独立保留 + 报告待归属，不猜、不合并（M3-08）；
  - suspectedCorrection：replacement/supplement 来源的冲突标「疑似更正」，不自动覆盖旧值（M3-07）；
- `applicabilityRelations`：公告统一规则与岗位特例并存的适用关系对照（M3-05），不凭「岗位优先」覆盖；
- 报告随 `candidate.rawJson.reconciliation` 持久化。

### 3.4 接入与 M2 同步

- `runExtraction` 逐文件收集后调用 `reconcileFields`（正文+附件全部进入同一复核任务）；附件经 `SourceDocument.relationType` 带回更正关系；
- `findJobsOutsideChecklist`：复核后候选中出现清单外岗位 → `checklistQuality.jobsOutsideChecklist` 只报告、不改清单（需显式新增清单版本），实现「新发现岗位不静默修改已冻结清单」；
- M2 的 `evaluateChecklist` 消费合并后无重复 identity 的候选：未归属/材料缺失不计为正确提取（既有六态语义不变）。

## 4. 接口 / 数据兼容

- `CandidateField` / `FieldAlternative` 新增字段全部可选（WB1 兼容风格），旧 JSON 兼容读取；
- `fieldIdentity` 对无 batchId 的字段输出与旧格式一致（`job:<key>:<field>` / `<scope>:<field>`），既有决策 identity 不漂移；
- `applyFieldDecisions` 的 conflict→extracted 转移是行为修复（此前已裁决冲突无法通过审核）；现有测试无相反断言；
- 无新增 Prisma 模型/迁移（复核报告存 `candidate.rawJson`，复用现有 JSON 字段）；
- 前端类型与展示增量更新，旧候选（无 anchors/batchId）正常显示。

## 5. 完成标准（通过 / 失败 / 阻塞）

| ID | 输入 | 预期 | 结果 |
|---|---|---|---|
| M3-01 | 同岗位正文 2 人、附件 3 人 | conflict，两值两证据，未裁决不发布 | ✅ 纯函数 + **真实链路**（xlsx 岗位表 2 + xlsx 更正表 3 → conflict 两值两证据 + assertPublishable 阻塞） |
| M3-02 | 岗位 A 2 人、岗位 B 3 人 | 独立岗位，不误报冲突 | ✅ 纯函数 |
| M3-03 | 公告总人数 5、岗位 A 2/B 3 | 不把总数塞入任一岗位 | ✅ 纯函数 + **真实链路**（正文「招聘50名教师」announcement 级保留，岗位级不覆盖；适用关系对照） |
| M3-04 | 同岗位同值两来源 | 不重复计数，保留双证据 | ✅ 纯函数 + **真实链路**（两 xlsx 同岗位 education 同值 → 合并一条 + anchors 双证据） |
| M3-05 | 公共年龄 35、硕士例外 40 | 保留公共条件和例外，展示适用关系 | ✅ 纯函数（age/age_basis_date/age_exception 独立 + applicabilityRelations） |
| M3-06 | 两批次不同报名入口/时间 | 不串批次，不自动判冲突 | ✅ 纯函数（batchId 身份维度；同批次值不同保守冲突） |
| M3-07 | 明确更正文件将 2 改 3 | 新有效值 3，旧值与更正关系可查 | ✅ 纯函数（suspectedCorrection + 裁决后 value=3、alternatives 保留 [2,3]） |
| M3-08 | 不明来源/岗位或更正关系不明 | 待人工，不猜归属或覆盖 | ✅ 纯函数（scope_unknown / job_identity_unknown / relationType=null 三路） |
| M3-09 | 裁决→保存→重新读取→导出 | 最终值和完整审计一致 | ✅ 纯函数（buildExportRows：value=3、human_revision=edit、alternatives [2,3]；指标不重复计数） |

真实链路要求：「至少一个测试从真实 ParsedDocument 经过正式提取/复核服务产生冲突」——M3-01/M3-03/M3-04 的集成测试用真实 XLSX 字节（`buildXlsxFixture` + `buildCorrectionXlsxFixture`）经 `submitSource → runExtraction → DocumentParserService.parse → extractFields → reconcileFields` 正式链路产生，非手工 conflict 对象。S1 真实材料无自然冲突样本（未跑真实 gov.cn 公告，见未验证项）。

## 6. 实际验证命令与结果

- `cd backend && npm test -- src/announcements/field-reconciler.spec.ts` → 13 passed（M3-01~09 + 单一来源）。
- `cd backend && npm test -- src/announcements/manual-extraction.service.spec.ts` → 8 passed（M1 的 5 项无回归 + M3 真实链路 3 项）。
- `cd backend && npm test -- src/announcements` → **241 passed**（19 个文件全绿，无回归）。
- `cd backend && npm test -- src/document-processing/parsers/spreadsheet-document.parser.spec.ts src/document-processing/parsers/html-document.parser.spec.ts` → 22 passed。
- `cd backend && npx tsc --noEmit -p tsconfig.build.json` → 无错误。
- `cd backend && npm run lint` → 0 warnings 0 errors。
- `cd backend && npm run build` → 通过。
- `cd . && npx tsc --noEmit` → 前端无类型错误；`npx eslint`（改动文件）→ 无错误。
- `cd . && npm test -- src/app/admin/pipeline src/lib/announcements-pipeline` → 18 passed。

## 7. 未验证项（需浏览器 / DB / 真实原件）

- 真实 PostgreSQL 落库未跑（复核报告存 rawJson，测试用内存 FakePrisma）。
- 浏览器端到端（提交两附件 → 提取 → 工作台看到冲突/多来源证据 → 裁决 → 导出）未跑。
- 真实官方样本（真实 gov.cn 公告 + 岗位表 + 官方更正文件）未抓取验证；S1 无自然冲突记录（测试冲突为显式构造并标注）。
- 附件 relationType 的来源文档层人工确认链路（proposeRelation→确认→再提取）未做端到端测试（M3 消费已确认值，构造确认值验证）。
- 已知限制（记入契约）：同 run 幂等键 = 正文快照 + 抽取版本，正文不变而新增附件时返回已有 run、新附件不参与提取（材料包版本问题，超出 M3 范围，建议后续模块处理）。

## 8. 下模块可复用内容

- `field-reconciler.ts` 的 identity 分组/合并/冲突/待归属/适用关系输出，是后续「范围关系完善」「清单槽位 CSV 导出」「更正关系端到端」的单一事实源。
- `contracts.md` 已汇总 M1–M3 范围/版本契约，M4+ 直接引用。
- `buildCorrectionXlsxFixture`（更正表 xlsx 构造器）可用于后续更正链路测试。
- `checklistQuality.jobsOutsideChecklist` 可用于清单版本提醒 UI。

> 自动判断边界：结构化对齐（identity/批次/关系标注/同值合并）自动完成；语义取舍（冲突选值、更正确认、归属确认、清单版本决策）一律人工裁决留痕。不做通用语义推断平台。
