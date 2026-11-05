# 全学科与官方材料 RAG 升级 · 最终隔离端到端验收报告

> 被测提交：`4f38df4f0022662d8f4fef5b65b67db86df93f26`（`codex/all-subject-rag`，2026-11-05）
> 被测产品：教招有据（全学科 + 官方材料 RAG 问答，W0—W5）
> 验收方式：GitHub Actions 隔离环境（临时 PostgreSQL / Redis / 编译后 API / Worker / 真实百炼模型）+ 常规 CI（含 Playwright 浏览器流程）
> 结论：**有阻塞未完成**。W0—W5 开发链路与真实模型基础联通已通过；浏览器与真实模型未在同一隔离实例联动、固定样本量化指标未执行、连续七天观察未满，最终结论保留「待验」。

## 1. 被测版本与环境

### 1.1 提交与分支

| 项 | 值 |
| --- | --- |
| 最终提交 | `4f38df4f0022662d8f4fef5b65b67db86df93f26` |
| 分支 | `codex/all-subject-rag` |
| 远端 | `origin` = https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant-project |
| 最终提交内容 | 仅修改 `backend/scripts/smoke-runtime.mjs` 的真实模式断言（+5/-1），无业务代码变更；本报告与台账提交只改 docs |
| 工作区 | 存在与本任务无关的既有未提交文件（旧文档/探针脚本/CSV 等），未纳入验收提交 |

### 1.2 W0—W5 交付提交

| 阶段 | 提交 | 内容 | 对应检查 |
| --- | --- | --- | --- |
| W0 | `ddd4fd87` | 现状盘点、台账、专用分支 | CI run `41970922907` |
| W1 | `c1579d5b` | 全学科字典、画像/岗位/订阅/筛选 | CI run `41976619675` |
| W2 | `7fbe324` | 材料入库/版本/切分/索引/pgvector 降级 | CI run `41978689823` |
| W3 | `6277ddb` | 公告级检索、生成、引用校验、反馈 | CI run `41981679441` |
| W4 | `128308f`（过程 `09e06e2`/`3ac7a80`/`99f97fd`/`effefd7`） | 权限、越权、恢复、预算、健康语义 | CI run `41992002619` |
| W5 | `c7df42d`（证据 `94cc7b2`） | 地区政策检索、覆盖投影、冲突、安徽来源 | CI run `42008914142` |
| 验收脚本 | `68f6b5f` → `48eb256` → `8421d00` → `65af204` → `4f38df4` | 真实百炼隔离验收工作流与断言修正 | 见第 4 节 |

### 1.3 隔离环境

| 项 | 实际值 |
| --- | --- |
| Runner | GitHub Actions `ubuntu-latest`，Node.js 24，npm 11 |
| 数据库 | 临时容器 `pgvector/pgvector:pg17`（随机宿主端口，匿名卷） |
| Redis | 临时容器 `redis:7-alpine`（随机宿主端口） |
| 迁移 | `prisma migrate deploy`（全新空库） |
| 应用 | 编译后的 `dist/main.js`（API）与 `dist/worker.js`（Worker） |
| 鉴权 | 主实例 `AUTH_MODE=invited`；W4/W5 角色实例 `NODE_ENV=development` + 回环地址 + `AUTH_MODE=demo`；AI 关闭对照实例 `AI_ENABLED=false` |
| 功能开关 | `CRAWL_SCHEDULER_ENABLED=false`、`CRAWL_WORKER_PAUSED=true`、`FF_DB_CATALOG=off` |
| 密钥 | 仅来自 GitHub Repository Secret `DASHSCOPE_API_KEY`；未写入仓库、日志、前端产物 |

### 1.4 真实模型配置

| 模型 | 值 |
| --- | --- |
| Embedding | `text-embedding-v4`，1024 维 |
| Rerank | `qwen3-rerank` |
| Chat | `qwen-plus`（`temperature=0.1`，`max_tokens=900`） |
| 重试 | `BAILIAN_MAX_RETRIES=1` |
| 健康标识 | 真实运行 `/health` 返回 `"ai":"real"` |

## 2. 验收结果总览

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| W0—W5 后端单测 | 通过 | 110 files / 1338 passed，1 expected fail，2 skipped（1341） |
| 前端单测 | 通过 | 74 files / 794 passed，2 skipped（796） |
| 后端 lint / 构建 | 通过 | CI `verify` 作业成功 |
| 前端 lint / 构建 | 通过 | CI `frontend-verify` 作业成功 |
| Playwright 浏览器流程 | 通过（演示数据） | 25 passed（36.8s） |
| 常规启动隔离冒烟（mock） | 通过 | CI `verify` 中 `smoke-runtime.mjs` PASS |
| 真实百炼隔离验收 | 通过 | run `42016047916`，job `real-model` success |
| 镜像构建与发布 | 通过 | frontend / backend 两个 publish job success |
| 真实模型回答质量指标 | **未执行** | 无固定评测集与用量汇总证据 |
| 浏览器 × 真实模型同实例联动 | **未执行** | Playwright 使用演示数据，未连接真实模型实例 |
| 连续七天观察 | **未完成（0/7 天）** | 2026-11-05 起算 |

## 3. 需求到代码 / 测试 / 证据追踪

| 需求 | 代码落点 | 测试 / 证据 | 状态 |
| --- | --- | --- | --- |
| 全学科字典与旧代码兼容 | `backend/src/subjects/subject-catalog.ts` | W1 单测；`GET /subjects` | 通过 |
| 多学科画像、岗位、订阅、历史筛选 | `backend/src/profile/profile.service.ts`、`opportunities/*`、前端画像/订阅/历史 | W1 单测；前端 796 用例 | 通过 |
| 官方材料入库、版本、审核、发布、撤回 | `backend/src/knowledge/knowledge.service.ts` | W4 冒烟：入库→送审→批准→发布→撤回；撤回后检索 0 命中 | 通过 |
| 解析与切分、定位信息、幂等索引 | `knowledge-index.service.ts`、`chunker.ts` | W2/W4 单测；真实快照索引 `ready` | 通过 |
| 混合检索、Rerank、引用校验、拒答 | `knowledge-search.service.ts`、`qa/qa-domain.ts`、`qa.service.ts` | W3/W4 单测；真实运行问答带引用 | 通过（结构） |
| 多角色权限、横向越权、AI 关闭隔离 | `auth/*`、`qa.service.ts`、`health.controller.ts` | W4 冒烟：访客 401/403、他人反馈 404、AI-off 503 | 通过 |
| 索引恢复、并发 supersede、预算 | `knowledge-index-recovery.service.ts`、`ai.config.ts` | W4 单测；Worker 重启恢复 | 通过（单测） |
| 地区/年份政策检索入口 | `POST /knowledge/questions` | W5 冒烟：省级问题 `answered` | 通过 |
| 政策覆盖投影与省份/城市分列 | `policy-coverage.service.ts` | W5 冒烟：省级 `queryable=2`、城市 `descendants=1` | 通过 |
| 公告×政策冲突并列 | `policy-domain.ts`、`qa.service.ts`、`src/app/policy/page.tsx` | W5 冒烟：`conflicts>=1`、`needsOfficialConfirmation=true` | 通过（后端） |
| 失效材料排除 | 检索层 SQL + 应用层 | W5 冒烟：过期材料不进引用、回答不含其正文 | 通过 |
| 无覆盖与检索/模型故障分离 | `qa.service.ts` | W5 冒烟：`no_coverage` 零引用；AI-off `503 ai_disabled`；覆盖查询仍 200 | 通过 |
| 全国行政区划支持 | `normalizeRegionCode` | 接受全国 `000000` 与任意 6 位代码；单测 11 项 | 通过（入口） |
| 首批官方来源扩源 | `anhui-education-policy` 适配器与目录 | 列表 32 条、正文解析、两次监测记录 | 通过（单来源） |
| 覆盖展示只反映实测来源 | `policy-coverage.service.ts` | 省级不把城市材料计入全省；其他省份为空 | 通过 |
| 浏览器端政策入口 | `src/app/policy/page.tsx` | 前端 lint/build 通过；**无 E2E 用例** | 部分 |

## 4. 测试命令、结果与证据

### 4.1 常规 CI（提交 `4f38df4`）

- 运行：[docker-publish run 42016047880](https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant-project/actions/runs/42016047880)
- 结论：`success`，四个作业全部成功：

| 作业 | 结果 | 关键步骤 |
| --- | --- | --- |
| `verify` | success | `npm ci` → lint → unit tests → build → `node scripts/smoke-runtime.mjs` |
| `frontend-verify` | success | lint → unit tests → build → Playwright install → E2E build → browser flow tests |
| `publish (frontend)` | success | Docker build & push |
| `publish (backend)` | success | Docker build & push |

后端单测原始计数（CI 日志）：

```text
Test Files  110 passed (110)
Tests       1338 passed | 1 expected fail | 2 skipped (1341)
```

前端单测原始计数（CI 日志）：

```text
Test Files  74 passed (74)
Tests       794 passed | 2 skipped (796)
Browser flow tests: Running 25 tests using 2 workers → 25 passed (36.8s)
```

说明：1 个 expected fail 与 2 个 skipped 为既有用例，不属于本任务新增；本任务新增用例均实际执行。

### 4.2 真实百炼隔离验收（提交 `4f38df4`）

- 运行：[RAG Real-Model Acceptance run 42016047916](https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant-project/actions/runs/42016047916)
- 作业：`real-model`，`success`，11:05:19 → 11:06:18（约 59 秒）
- 工作流：`.github/workflows/rag-acceptance.yml`
- 脚本：`backend/scripts/smoke-runtime.mjs`（`SMOKE_REAL_AI=1`）
- 产物：`rag-acceptance-4f38df4f0022662d8f4fef5b65b67db86df93f26`（保留 30 天）

完整日志（已脱敏，不含 Key）：

```text
[smoke] 启动 PostgreSQL（pgvector/pgvector:pg17）…
[smoke] 启动 Redis（redis:7-alpine）…
[smoke] PostgreSQL 健康 ✓
[smoke] Redis 健康 ✓
[smoke] 执行 prisma migrate deploy …
[smoke] 迁移成功 ✓
[smoke] 真实百炼模式：embedding=text-embedding-v4 rerank=qwen3-rerank chat=qwen-plus
[smoke] 启动 node dist/main.js …
[smoke] 启动 node dist/worker.js（CRAWL_WORKER_PAUSED=true）…
[smoke] 启动 W4 Demo API（demo 身份，AI mock）…
[smoke] 启动 W4 AI-off API（AI_ENABLED=false）…
[smoke] /health ✓ {"status":"ok","api":"up","db":"up","redis":"up","worker":"up","ai":"real",…}
[smoke] 日志无 Nest DI 致命异常 ✓
[smoke] W4 知识索引 ready ✓
[smoke] W4 多角色/横向越权/撤回/AI 关闭隔离验证 ✓
[smoke] W4 隔离知识库流程 ✓
[smoke] W5 真实来源快照入库/审核/发布/索引 ✓
[smoke] W5 覆盖投影/政策问答/冲突/无覆盖/失效排除/AI 关闭 ✓
[smoke] W5 隔离政策检索流程 ✓
[smoke] API、Worker 与 W4 实例持续运行 ✓
[smoke] PASS：后端与 Worker 真实启动冒烟通过
```

> 日志中的 `启动 W4 Demo API（demo 身份，AI mock）` 是固定文案；在 `SMOKE_REAL_AI=1` 时该实例继承 `AI_MOCK_MODE=false`，W4 断言要求 `mode=real` 且已通过，因此该实例实际走真实模型。

验收运行历史（含失败，不隐藏）：

| 运行 | 提交 | 结果 | 原因 |
| --- | --- | --- | --- |
| `42014484167` | `48eb256` | skipped | push 触发条件未满足，未执行 |
| `42014523204` | `8421d00` | failure | 仓库 Secret `DASHSCOPE_API_KEY` 为空 |
| `42015542140` | `65af204` | failure | `npm ci` 锁文件与 Node 22/npm 10 不兼容（缺少 `magicast` / `typescript` 条目） |
| `42016047916` | `4f38df4` | success | 改用 Node 24、断言适配真实模式后通过 |

### 4.3 浏览器证据

- 来源：常规 CI `frontend-verify` → `Browser flow tests`，Chromium，25 个用例全部通过。
- 覆盖：登录/注册、画像填写、结果页、补充保存、日程入口、v7.2 开关回退等既有链路。
- 限制：
  1. 浏览器用例使用演示数据/演示服务，**未连接第 4.2 节的真实模型隔离实例**；
  2. `/policy` 政策检索页仅通过 lint 与生产构建，**没有 Playwright 用例**；
  3. 未归档截图；证据为 CI 日志与运行链接，产物随 GitHub 保留策略到期。

## 5. 真实模型证据（模拟与真实分列）

| 能力 | 模拟证据（CI 常规冒烟） | 真实证据（run `42016047916`） |
| --- | --- | --- |
| Embedding | `ai=mock`；索引 ready | `ai=real`；真实公告快照索引 ready |
| Rerank | mock 词法打分 | 真实 `qwen3-rerank` 调用（检索链路内） |
| Chat | mock 抽取式回答 | `qwen-plus` 返回回答，引用/状态断言通过 |
| 问答状态 | `answered` + 引用 | `answered` + 公告/政策引用 + 冲突提示 |
| 无覆盖 | `no_coverage` 零引用 | 同左 |
| AI 关闭 | `503 ai_disabled` | 同左 |

真实 run 中 W5 断言（脚本内固定，非人工目测）：

- 省级覆盖 `covered`，`exact.queryable=2`，`exact.expired=1`；
- 同省城市材料进入 `descendants`，`queryable=1`，不计入全省；
- 无材料城市 `no_coverage`，引用数 0；
- 政策回答引用同时包含 `announcement` 与 `policy`，且包含 `jyt.ah.gov.cn`；
- `conflicts>=1`，`needsOfficialConfirmation=true`；
- 过期政策不被引用，回答正文不含其内容；
- 匿名 `POST /knowledge/questions` 返回 401；
- AI 关闭时政策问答 `503 ai_disabled`，`GET /knowledge/policy-coverage` 仍 200。

### 5.1 量化指标（未执行）

| 指标 | 状态 | 说明 |
| --- | --- | --- |
| Recall@5 / 召回率 | 未执行 | 无固定标注评测集 |
| 忠实度 | 未执行 | 未做人工或模型评审 |
| 引用正确率 | 未执行 | 仅有“引用存在且编号有效”的结构断言 |
| 合理拒答正确率 | 未执行 | 仅有阈值触发的单例断言 |
| p95 延迟 | 未采集 | 日志未汇总分位数 |
| 单次成本 / token | 未汇总 | `ai_usage_daily` 有记账，但未导出本次运行总量 |

## 6. 实际覆盖范围与来源

| 维度 | 已实测 | 未覆盖 |
| --- | --- | --- |
| 地区 | 全国入口；安徽省 `340000`；芜湖市 `340200`（城市分列）；合肥市 `340100` 无材料对照 | 其他省级来源；市县批量接入 |
| 年份 | 2026（问答必填）；2025 过期材料对照 | 多年份回溯 |
| 学科 | 23 个稳定学科代码；开放闸门已取消单学科限制 | 真实岗位的多学科标注样本仍有限 |
| 材料类型 | `announcement`、`policy` | 岗位表附件全量解析 |
| 来源 | 安徽省教育厅通知公告（`anhui-education-policy`）；列表 32 条；真实特岗公告正文 5,604 字 | 其他省份、其他部委、区县来源 |
| 行政区划能力 | 服务端接受全国 `000000` 与任意 6 位代码；前端入口提供全国 + 31 个大陆省级行政区 | 港澳台；UI 未提供市县选择器（可按代码调用接口） |

### 6.1 首批官方来源证据

| 项 | 证据 |
| --- | --- |
| 来源 | `anhui-education-policy`，安徽省教育厅通知公告，`https://jyt.ah.gov.cn/xwzx/tzgg/index.html` |
| 发现 | 首查 `succeeded 32`；约 3 分钟后复查 `no_new 32`，内容哈希 `60d5514d…3326a` |
| 抓取 | 列表 200 / 38,266 字节（sha256 `d1e1e770…bb236`）；特岗公告 200 / 35,660 字节（sha256 `daae5b9a…bbdc`） |
| 解析 | 标题“安徽省2026年农村义务教育阶段学校教师特设岗位计划招聘公告”，日期 `2026-06-02`，正文 5,000+ 字 |
| 合规 | `robots.txt` 返回 404，无显式禁止；仅公开页面、低频轮询、保留原文链接 |
| 限制 | 只取首屏最新通知；两次人工监测不等于持续运行；栏目为综合“通知公告”，非独立教师招聘栏目 |

### 6.2 连续观察窗口

- 起始日期：2026-11-05。
- 已观察天数：**0 / 7 天**。
- 当前证据仅为两次人工来源监测，不能表述为“连续七天稳定运行”。

## 7. 迁移、恢复与回退

| 项 | 证据 | 状态 |
| --- | --- | --- |
| 全新库迁移 | 真实 run 中 `prisma migrate deploy` 成功 | 通过 |
| 迁移可重复执行 | 新迁移使用 `IF NOT EXISTS` / 条件建表 | 设计保证，未专门重跑 |
| 既有库升级 | 未在生产或含历史数据的库执行 | 未执行 |
| Worker 重启恢复 | W4 单测覆盖 `queued/running` 重新投递 | 通过（单测） |
| 索引并发 | W4 单测覆盖迟到任务 `superseded` | 通过（单测） |
| 应用回退 | 未演练旧镜像 + 新库的回退 | 未执行 |
| 生产迁移 | 未执行，也不在本任务授权范围 | 不适用 |

## 8. 缺口、风险与待办

### 8.1 阻断最终结论的缺口

1. **浏览器与真实模型未同实例联动**：Playwright 走演示数据；真实模型 run 只验证 API/Worker。需要新增“前端 + 真实 API + 真实模型 + 浏览器”的联合验收，才能称为完整端到端。
2. **量化指标缺失**：没有固定样本的召回率、忠实度、引用正确率、拒答正确率、延迟与成本数据，不能评价真实模型质量。
3. **连续七天观察未满**：来源持续监测、问答稳定性、预算消耗与失败率均未有七天数据。
4. **政策页无浏览器用例**：`/policy` 仅有构建级验证，交互与移动端布局未自动验证。

### 8.2 功能与覆盖缺口

- 其他省份尚无政策来源；安徽来源不能外推为全国覆盖。
- 市县层级只能通过 6 位代码调用，前端没有市县选择器。
- 附件（PDF/Word/岗位表）真实材料的多格式定位未在本次验收中逐项执行。
- pgvector 镜像已具备扩展且迁移成功，但脚本未单独断言查询走 pgvector 路径而非 Float[] 降级。
- 真实站点仅验证首屏发现/抓取/解析，未做分页回溯与持续调度。

### 8.3 风险与建议

| 风险 | 影响 | 建议 |
| --- | --- | --- |
| 真实模型质量未知 | 可能答非所问或引用错位 | 建立固定评测集（≥10 题/学科）并固化阈值 |
| 演示数据 E2E 掩盖真实接口差异 | 前端在真实环境可能失败 | 增加真实 API 的浏览器冒烟 |
| 来源监测仅人工两次 | 无法证明长期可用 | 连续七天定时监测并记录成功率 |
| 无应用回退演练 | 升级失败时恢复路径未验证 | 在隔离环境演练旧镜像 + 备份恢复 |
| 验收日志仅保留 30 天 | 证据会过期 | 将关键日志摘要固化进本报告或长期归档 |

### 8.4 待用户动作

- 如后续需要“生产验收通过”，需另行授权生产部署、迁移与真实流量观察；本报告不包含生产证据。
- 请继续自行保管百炼 Key；如曾出现在不受控位置（下载目录 CSV、截图、聊天等），建议在控制台删除并重新签发。
- 七天观察期结束后，重新执行真实模型验收并更新本报告结论。

## 9. 结论

**有阻塞未完成。**

- 已完成：W0—W5 开发与结构链路、全量单测、lint、构建、镜像发布、隔离启动冒烟、真实百炼 Embedding/Rerank/Chat 基础联通、W5 政策覆盖/冲突/无覆盖/失效排除/AI 关闭语义。
- 未完成：浏览器与真实模型同实例联动、固定样本质量指标、连续七天观察、部分真实材料格式与应用回退演练。
- 因此不能表述为「隔离验收通过」或「生产验收通过」；当前状态为「开发与真实模型基础链路通过，最终端到端验收待验」。
