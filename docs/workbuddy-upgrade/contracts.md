# WorkBuddy 升级共享契约（M1–M3 汇总）

> 本文件是 M 系列模块的**单一契约事实源**：范围/身份键、合并与冲突规则、
> 固定分母与清单同步、更正关系。后续模块（M4+）引用本文件，不复制多份事实源。
> 代码事实源：`backend/src/announcements/`（domain.ts / field-reconciler.ts /
> expected-checklist.ts / field-registry.ts）。

## 1. 候选字段身份（对齐键）

```
identity = 公告 + scope + jobKey + field + batchId
```

- **公告身份**：一个 `ExtractionRun` = 一个公告的材料包；run 内天然按公告隔离，
  跨 run（不同公告）的相同岗位代码**不能合并**。
- **scope**：`announcement`（公告公共）/ `job`（岗位）/ `unknown`（归属不明，待人工）。
- **jobKey**：官方岗位编号优先（`job:<jobCode>`），否则位置键（`src:<sourceKey>:<sheet>:row:<row>`）；
  岗位代码只是业务属性，不是唯一技术依赖。`job:unknown` / 空 key = 身份不明，待人工确认。
- **field**：字段注册表（`field-registry.ts`）口径。
- **batchId**（M3）：批次/适用范围；缺省视为同一（无名）批次。同字段不同 batchId
  = 不同槽位，不合并、不自动判冲突。
- 实现入口：`domain.ts fieldIdentity`。

## 2. 范围归属规则（spec §1.3）

- 表格单元格 → 按列映射归属到岗位行（job scope，每行一个 jobKey）；
- 正文段落/标题/列表块（非表格）→ announcement scope；
- **表格单元格文本不参与公告级文本规则**（避免单元格值被误抽为公告条件）；
- 原文结构无法判定 → `scope: unknown`，进人工待确认，不猜归属；
- 公告统一规则（announcement）与岗位特例（job）**分别保留**，不凭「岗位优先」覆盖；
  并存时在复核报告 `applicabilityRelations` 给出适用关系对照。

## 3. 跨文件合并与冲突（M3，`field-reconciler.ts`）

同一 identity 的多来源候选：

| 情形 | 处理 |
|---|---|
| 值全部相同 | 合并为一条候选；`anchors[]` 保留**全部**来源证据（不只第一次）；不重复计数 |
| 值不同（同批次） | `conflict`：主值取公告正文来源优先（权威原文），否则第一来源；`alternatives[]` 保留全部值 + 各自来源定位/摘录/提取版本/来源文件；阻塞审核通过与发布 |
| 值不同（不同 batchId） | 不同槽位，各自保留，不判冲突（批次对照由人工确认） |
| 身份不明（scope=unknown / jobKey 空） | 独立保留 + 复核报告 `unattributed` 待人工；不与已知岗位合并 |
| 涉及 replacement/supplement 来源 | 冲突报告标 `suspectedCorrection`；**不自动覆盖旧值**——人工裁决（adopt/edit）后旧值失效，alternatives 保留审计留痕 |

- 岗位专属人数不能由公告总招聘数推成（announcement 与 job 是不同槽位）；
- 复核报告随 `candidate.rawJson.reconciliation` 持久化（conflicts / merged /
  unattributed / applicabilityRelations / warnings）。

## 4. 冲突裁决（WB4 + M3 修复）

- `applyFieldDecisions` 的 **adopt/edit 裁决 conflict 字段后 status 转 `extracted`**
  （spec §4.1 状态转移）；否则已裁决冲突会永久阻塞审核/发布门禁（M3 修复的缺陷）；
- reject/pending 不转（字段仍待处理/不进发布载荷）；
- 裁决写入既有审计：decision（action/before/after/reason/operator/decidedAt）、
  原 alternatives 与全部证据保留；发布与导出消费裁决结果但不抹掉历史。

## 5. 固定分母与清单同步（M2 + M3）

- 期望清单（`expected-checklist.ts`）是完整性评估的固定分母；岗位集合显式传入，
  **不从候选推断**；清单冻结后修改必须 `version` 递增（保留历史）；
- 复核发现**清单外岗位**：`checklistQuality.jobsOutsideChecklist` 只报告、不改清单
  ——需显式新增清单版本后才纳入固定分母；
- 未归属（unattributed）、材料缺失（source_missing_unverifiable）**不计为正确提取**；
- 指标口径：完整性 = extracted / 有效分母（原始槽位 − 明确不适用）；
  缺失/未知/无法核验不移出分母；**完整性不是准确率**。

## 6. 更正关系（M3-07）

- 复用 `SourceDocument.relationType`（replacement/supplement 等已确认值）与
  公告版本链；附件的 relationType 由来源文档层人工确认后生效；
- 值冲突时标「疑似更正」进人工裁决；只有官方明确关系或人工确认后旧值才失效；
- 不开发通用语义推断平台：自动判断边界 = 结构化对齐（identity/批次/关系标注），
  语义取舍一律人工裁决留痕。

## 7. 人工操作步骤（自动判断边界之外）

1. 提交来源（正文 + 附件材料包）→ `POST /api/announcements/sources`；
2. 执行提取 → `POST /runs/:id/extract`（跨文件复核自动发生，冲突/合并/待归属入报告）；
3. 冻结期望清单 → `POST /runs/:id/checklist`（岗位集合人工清点；改清单 = 新版本）；
4. 审核工作台逐字段裁决冲突/未知/待归属 → `POST /runs/:id/review`（fieldDecisions）；
5. 发布 → `POST /runs/:id/publish`（门禁：未裁决冲突/未知必需字段/缺证据/AI 未确认均阻塞）；
6. 导出（JSON/CSV/指标）含完整审计（decision + alternatives + 多来源证据）。
