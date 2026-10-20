# WorkBuddy 黄金样本（WB0）

> 本目录是 WorkBuddy 抽取/审核契约的**黄金样本**，供 WB1–WB6 的测试与验收使用。
> 全部内容为**脱敏/构造**数据，显式标注，**不得伪装成真实在招岗位**。
> 不进入 `src/` 或 `backend/src/` 生产目录（`tests/fixtures/isolation.test.ts` 守护）。

## 文件

| 文件 | 内容 |
|---|---|
| `golden-sample.json` | 主黄金样本：一份公告的候选字段 + 预期审核结论 |
| `README.md` | 本文件 |

## 黄金样本覆盖要点（对应验收标准）

| 要求 | 样本中的落点 |
|---|---|
| 公告公共条件块 | `announcement` scope 字段：标题、地区、批次、报名起止、年龄基准日 |
| 同一工作表两个不同岗位行 | `jobKey: "job-A-3301A01"` 与 `"job-B-3301A02"`，岗位编号不同 |
| 两个岗位不同专业/学历 → 发现跨岗位混值 | 岗位 A 专业“汉语言文学（师范）”、岗位 B 专业“数学与应用数学”，学历也不同 |
| “汉语言文学（师范）”保留“师范” | 岗位 A 专业字段值保留“（师范）”，有断言 |
| 年龄基准日 + 例外条件 | `age_basis_date` = 公告级基准日；`age_exception` = “硕士放宽至 40 周岁” |
| 明确事业编/用工性质 | `employment_nature` = “事业编制” |
| 未知字段 | 岗位 B 的 `degree`（学位）为 `status: "unknown"` |
| 正文与附件值冲突 | `headcount` 岗位 A：正文 2 人 vs 附件 3 人 → `status: "conflict"`，两个值+证据 |
| 报名时间/材料/入口属于明确批次 | `batch` 字段，报名起止、材料、入口都挂 `batchId` |
| 每个值有 worksheet/cell、段落或 URL 锚点 | 每条 `evidence` 带 `locator`（worksheet+cell / excerpt / url） |

## 如何人工复算

- 每个 `conflict` 字段列出 `value` + `alternatives`（各带证据），人工可从证据 `excerpt` 反查原文；
- 每个 `unknown` 字段显式 `status: "unknown"` 且无 `value`，而非空白；
- 公共字段 `scope: "announcement"`，岗位字段 `scope: "job"` + `jobKey`，归属可复核。

## 断言测试

`tests/fixtures/workbuddy/golden-sample.test.ts` 对本样本做结构断言，验证上述要点不退化。
