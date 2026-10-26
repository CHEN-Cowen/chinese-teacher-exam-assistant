# S5 首批来源扩源交付说明（截至 2026-10-26）

## 1. 本阶段结论

S5 目标是把首批官方教师招聘来源从 4 个扩到 10—20 个，每个来源都必须具备：

- 官方发布机构 + 具体招聘栏目；
- 真实列表、正文、附件样本；
- 专属适配器；
- 独立对账依据；
- 可持续检查记录。

**当前达成：9 个 ready 来源**（南京、杭州、宁波、鄞州、绍兴、嘉兴、苏州、常州、丽水），
目录总数 13（ready 9 / candidate 2 / blocked 2）。

**尚未达标**：

1. 数量未到 10—20 下限（差至少 1 个）；
2. 9 个来源**全部没有持续监测记录**，状态只能停在 `verifying`。

## 2. ready / candidate / blocked 口径

沿用 S0 规范（`national-expansion-s0-scope.md`）：

| 状态 | 含义 | 是否进入 seed |
|---|---|---|
| `ready` | 入口、适配器、真实样本回放和人工核验齐备 | 是 |
| `candidate` | 已登记官方入口，等待栏目/附件/持续检查核验 | 否 |
| `blocked` | 核验发现入口不可用或无教师招聘栏目 | 否 |

**关键区分**：`ready` 只代表"核验通过"，**不等于"已在持续监测"**。

## 3. 来源级检查记录（本次新增）

S0 规范明确要求：

> "正常监测"必须有来源级检查记录，**不能仅凭代码中存在适配器判断**。

此前代码里这件事只有一句自然语言（coverageNote 里写"持续监测未验证"），机器无法据此判断
"这个来源现在能不能对外声称在监测"。本次把它显式建模：

- 新增 `backend/src/sourcing/source-monitoring.ts`：
  - `SourceCheckRecord`：单次检查的可复算事实（时间、结果、发现条目数、内容指纹）；
  - `summarizeMonitoring()`：纯函数，由检查记录推导状态，不允许手写"正常监测"；
  - `canClaimMonitoring()`：对外声称"正常监测"的**唯一**判定入口；
  - `MONITORING_STREAK_THRESHOLD = 2`：连续成功 2 次才算 `monitoring`
    （单次成功可能只是网络偶发成功；该阈值是本项目自定工程口径，非 S0 官方指标）。
- 新增 `backend/src/sourcing/source-monitoring.spec.ts`（10 个用例）。
- `source-catalog.ts` 新增 `SOURCE_MONITORING_RECORDS` / `getSourceMonitoringRecord()` /
  `appendSourceCheck()` / `getCatalogSourceKeys()`。
- `GET /sourcing/catalog` 现在为每个来源附带 `monitoring` 状态。

### 状态推导

| 状态 | 条件 |
|---|---|
| `unverified` | 无任何检查记录 |
| `verifying` | 有记录但连续成功次数 < 2 |
| `monitoring` | 连续成功 >= 2 次 |
| `degraded` | 最近一次检查失败 |
| `paused` | 来源被明确暂停（优先于其它状态） |

`no_new`（304 / 内容未变）算成功；`zero_suspect`（空栏目）**不算**成功——
空栏目必须人工判断是"栏目确实空"还是"抓取失败"。

### 当前 9 个来源的真实状态

每个来源都只执行过**一次真实采样**（即首轮抓取并落离线样本），连续成功次数为 1，
因此状态全部是 `verifying`，**不得对外声称"正常监测"**。

这与 fixture manifest 里 `stableMonitoringVerified: false` 是一致的——
该字段未被改写，因为单次采样确实不构成持续监测证据。

## 4. 各来源核验要点

| 来源 | 栏目 | 机构级别 | 核验日 | 特殊协议点 |
|---|---|---|---|---|
| 南京 | 南京市教育局教师招聘栏目 | city | 2026-10-21 | 分页；含 PDF 岗位表样本 |
| 杭州 | 「教师招聘」专栏 | city | 2026-10-26 | jpaas 公开接口列表 + 分页 |
| 宁波 | 通知公告栏目 | city | 2026-10-24 | 动态 AuthorizedRead 列表 |
| 鄞州 | 区教育局/人社局招聘栏目 | district | 2026-10-24 | 公开接口列表 |
| 绍兴 | 「教师招聘」专栏 | city | 2026-10-26 | jpaas 公开接口 + 分页 |
| 嘉兴 | 「人才招聘」专栏 | city | 2026-10-26 | 列表日期为短格式，年份取自官方文章路径 |
| 苏州 | 人事信息公示 | city | 2026-10-26 | 公开列表接口 |
| 常州 | 教师招聘栏目 | city | 2026-10-26 | 公开列表接口 |
| 丽水 | 「人事招聘」专栏 | city | 2026-10-26 | **jpaas + initJpage 内联分页** |

### 丽水的三个特殊点（已被测试锁住）

1. 外壳页 `queryData` 含 `pageId`，必须完整透传才能取到列表（缺 `pageId`/`tagId` 拿不到列表）；
2. **分页参数不在 DOM 属性上，而在官方内联脚本 `initJpage({ count: 130, rows: 10, pageNo: 1, ... })` 中**；
3. 列表有两种官方单元（`tbody.page-content tr` / `.page-content li`），日期都是 `[2026-09-23]` 方括号格式。

后续页协议：`{"pageNo": 2, "pageSize": "10"}`（沿用官方 `rows`）。

## 5. candidate / blocked 来源

| 来源 | 状态 | 原因 |
|---|---|---|
| 江苏省教育厅 | candidate | 省级来源不发布市县教师招聘公告（且按 S0 规范不得挂栏目列表冒充市县覆盖） |
| 浙江省教育厅 | candidate | 同上 |
| 无锡市教育局 | blocked | 缺核验资料 |
| 湖州市教育局 | blocked | 公告栏目无教师招聘主公告 |

## 6. 已排除的候选（勿重复探测）

| 来源 | 排除原因 |
|---|---|
| 南通、宿迁「人事信息」 | 主要是职务任免，非教师招聘 |
| 泰州、萧山、扬中等 | 混合栏目，不够专一 |
| 临沂「教师招聘」 | 栏目为空 |
| 宜昌 | HTTPS 会降级到 HTTP |
| 武汉通知公告 | 空壳动态页 |

## 7. 本阶段自检结果

| 项 | 结果 |
|---|---|
| 生产编译 `tsc -p tsconfig.build.json` | 0 错误 |
| 全量类型检查（含 spec） | 39 错误，与改动前基线**完全一致**（历史遗留，非本次引入） |
| oxlint | 0 warning / 0 error |
| Prettier | 本次涉及文件全部合规 |
| 后端全量测试 | 84 文件 / 942 passed + 1 expected fail / 0 failed |
| sourcing 模块测试 | 23 文件 / 274 passed |
| `git diff --check` | 通过 |

## 8. 未完成事项（进入 S6 前必须补）

1. **来源数量补到 10—20**：还需核验至少 1 个（建议继续在浙江/江苏找市级专栏）。
2. **持续监测记录**：9 个来源都需补真实调度产生的连续检查记录，才能声称 `monitoring`。
3. **独立人工对账**：按 S0 规范 7.1 建立"人工按官方栏目分页建立的独立目标清单"，
   系统召回率不能用系统自己发现的公告作分母。
4. **真实附件解析 → 审核 → 发布闭环验证**。
5. 真实 DB 迁移、`next build`、部署。

## 9. 工程注意事项

- `npm run build`（`nest build`）在本机会被 safe-delete 钩子拦截：`deleteOutDir: true`
  要先删 `backend/dist`（375 个文件），超过 50 的阈值。**验证编译请用**：
  `tsc -p tsconfig.build.json --outDir .build-check --incremental false`，用完删除临时目录。
- `node ./node_modules/.bin/oxlint` 会报 `SyntaxError`（`.bin` 下是 shell 脚本），
  **必须用 `bash ./node_modules/.bin/oxlint ...`**，prettier 同理。
- 后端测试必须在 `backend/` 目录运行。
- 全仓 `tsc --noEmit` 有 39 个既有 spec 类型错误（`announcements` / `document-processing` /
  `trial` 等），与本阶段无关。判定"是否引入新错误"：暂存改动编译取基线 → 恢复 → 再编译对比。
