# 全学科与官方材料 RAG 升级 · 执行台账

> 任务基线：`codex/all-subject-rag`，起点 `a3c881a9`（自 `codex/modular-development` 切出）。
> 本文件是跨阶段续接的唯一进度来源；每个阶段完成后更新「状态 / 提交 / 验证证据 / 遗留风险」。
> 产品基线始终以 `PRD.md` 为准；本文件只记录执行事实，不改写需求。

## 0. 执行约定

- 阶段顺序：W0 盘点 → W1 全学科 → W2 材料入库/索引 → W3 公告问答 → W4 加固 → W5 政策检索 → 整体隔离验收。
- 每个阶段：开发 → 自检完整调用链 → 单测/构建 → 修复 → 更新本台账 → 仅提交本任务文件 → 推送专用分支 → 核对同一提交的远端 CI。
- 不将模拟结果、跳过用例、历史通过记录写成本阶段通过。
- 未提交的其他工作（`PRD.md` 既有改动、未跟踪脚本/CSV/旧文档）原样保留，不纳入本任务提交。

## 1. W0 现状盘点（2026-11-05）

### 1.1 仓库与基线

| 项 | 事实 |
| --- | --- |
| 分支 / HEAD | `codex/modular-development` → 新建 `codex/all-subject-rag`，起点 `a3c881a9` |
| 远端 | `origin` = 项目仓库；`target` = 对外发布仓库（当前开发分支跟踪 `target/codex/modular-development`） |
| CI | `.github/workflows/docker-publish.yml`，`push` 触发；jobs：`verify`（后端 npm ci/lint/test/build/`smoke-runtime.mjs`）、`frontend-verify`（npm ci/lint/test/build/Playwright）、`publish`（仅两 job 通过后） |
| 后端测试 | `backend/vitest.config.ts`，`**/*.spec.ts`，forks、4 worker、15s |
| 前端测试 | 根 `vitest.config.ts`（`src/**/*.test.ts(x)`、`tests/**`、`scripts/**/*.test.mjs`）；Playwright 见 `npm run test:e2e` |
| 数据库 | PostgreSQL + Prisma；现有 24 条迁移，最新 `20261028150000_follow_baseline_synced_at` |
| 部署库镜像 | 官方 `postgres:17-alpine`（**不含 pgvector**），见 `scripts/smoke-runtime.mjs` / 部署 compose |
| 外部依赖 | 百炼 Embedding/Rerank/Chat、Redis（BullMQ）、对象存储目录、隔离验收环境 |

### 1.2 现有事实（与本案直接相关）

1. **学科闸门**：`backend/src/matching/types.ts` 的 `OPEN_SUBJECTS` 仅 `['chinese']`；`matching/engine.ts` 以 `unit.subject` 是否在其中决定 `subject_not_open`。
2. **数据模型**：`ApplicationUnit.subject` 为单值；`UnitSubjectScope` 仅是自由文本补充；`OpportunitySubscription.subject` 单值；画像 `teacherCert` 与学科是不同概念（`UserRecruitmentProfile.teacherCert.subject`）。
3. **前端学科硬编码**：`src/lib/announcements/types.ts` 的开放学科、`src/lib/ia/labels.ts` 学科标签、`src/lib/subscription` 订阅卡、`src/lib/targets` 备考目标、demo 数据与种子（见 W1 逐项改造清单）。
4. **解析能力可直接复用**：`document-processing` 已支持 HTML/PDF/XLSX（DOCX 受开关）、表格与 OCR 受控状态，`ParsedBlock` 带 `page/sheet/cell/row/selector` 等定位信息；`DocumentParseRun` 以 `snapshotId + parserVersion` 幂等；扫描件缺文本时进入待人工状态而非伪造。
5. **发布链路**：`ExtractionRun` 审核（`ReviewGuard`：staff 角色）→ `publish` 生成 `PublishedAnnouncementVersion`；撤回保留历史（`withdraw`）。用户端目录由 `catalog` 投影器从 payload 构建，`FF_DB_CATALOG` 控制数据库目录/静态目录。
6. **权限**：全局 `InternalTokenGuard` + `SessionAuthGuard`；`AdminGuard`（staff）用于一般管理；`ReviewGuard` 用于审核/发布；`StrictAdminGuard` 仅 `admin`。
7. **队列**：BullMQ + 独立 `worker.js`，`crawl` 队列以 `jobId` 幂等、attempts/backoff 可配，暂停开关 `CRAWL_WORKER_PAUSED`。
8. **AI/RAG 现状**：代码库无任何 LLM、Embedding、Rerank、pgvector、问答模型或预算控制实现；无通用外部模型客户端。需从零新增，不能声称已接通。

### 1.3 外部依赖与待用户配置项（尽早列出）

| 编号 | 配置项 | 用途 | 未配置时的行为 |
| --- | --- | --- | --- |
| C1 | `DASHSCOPE_API_KEY`（百炼） | Embedding / Rerank / Chat | `AI_ENABLED=true` 时调用明确失败并记录 `not_configured`；默认关闭 |
| C2 | `BAILIAN_EMBEDDING_MODEL`（默认 `text-embedding-v4`） | 向量化 | 需按实际账号可用模型调整 |
| C3 | `BAILIAN_RERANK_MODEL`（默认 `qwen3-rerank`；`gte-rerank` 将于 2026-05-30 下线） | 重排 | 同上 |
| C4 | `BAILIAN_CHAT_MODEL`（默认 `qwen-plus`，以实际开通为准） | 回答生成 | 同上 |
| C5 | 预算/限流参数 | 单用户/IP/日调用与 token 上限 | 默认保守限额，超限返回 `budget_exceeded` |
| C6 | PostgreSQL `vector` 扩展或安装权限 | pgvector 精确/近似检索 | 迁移降级为浮点数组存储 + 应用内余弦，不阻断迁移；真实向量库验收待扩展可用后执行 |
| C7 | Redis 可达 | 异步索引 Worker | API 可入队失败时明确报错；测试走内联索引 |
| C8 | 隔离验收环境（DB/Redis/浏览器/网络） | W4/最终验收 | 未提供时结论只能标「待验证」，不得冒充通过 |

> 说明：以上仅列占位符，真实密钥只进部署环境变量，不写入仓库、日志或前端产物。

### 1.4 设计决策（W0 定稿，后续阶段不反复）

- **学科代码稳定**：使用稳定英文 code（`chinese/mathematics/...`），展示名、别名、学段/地区歧义单独维护；未知学科保留原名并进入审核队列，不丢弃、不猜成已知学科。
- **向后兼容**：旧单值字段保留；新增 `subjects` 复数与 `subjectOriginal`，读取时按「复数优先，单值回退」合并，旧数据可继续匹配。
- **向量存储可降级**：迁移以条件块尝试 `CREATE EXTENSION vector` 与 `vector(1024)` 列 + HNSW 索引；扩展不可用时自动保留浮点数组，检索走应用余弦。pgvector 真实效果必须在具备扩展的环境重测。
- **AI 分层配置**：Embedding、Rerank、Chat 三个独立 base URL / model / 超时；无不透明回退。Mock 仅在 `AI_MOCK_MODE=true` 的测试/演示环境使用，并在响应中显式标记 `mode=mock`。
- **证据优先**：回答必须带材料级引用（文档/版本/片段/定位），后端校验引用属于本次上下文；无依据时返回「材料未覆盖」，不给资格结论。

### 1.5 验收阈值（测试前固定，避免事后放宽）

| 指标 | 目标 | 测量方式 |
| --- | --- | --- |
| 关键依据召回 Recall@5 | ≥ 0.90 | 固定 10 题样本，人工标注关键片段 |
| 引用可定位率 | 100% | 每条引用必须能在入库片段中找到且定位字段完整 |
| 无依据肯定结论 | 0 条 | 无答案/冲突样本必须拒答或要求官方确认 |
| 跨地区/跨岗位错误套用 | 0 条 | 仅使用公告作用域内材料 |
| 问答 p95 延迟 | ≤ 15s | 隔离环境真实调用；Mock 不计入 |
| 真实 API 失败率 | ≤ 5% | 限流/超时/重试后统计 |

> 以上为产品级目标；Mock 环境只能验证功能与拒答逻辑，真实模型质量结论保持「待验证」。

### 1.6 W0 结论与风险

- 结论：现有解析、发布、权限、队列基建可复用；学科单值硬编码是 W1 主要改造点；RAG 全链路缺失，需新增。
- 风险 R1：生产库缺 pgvector 扩展 → 已设计降级路径，但真实向量检索验收受阻。
- 风险 R2：无 API Key → W2/W3 的真实模型联调与质量阈值无法完成，只能做 Mock 功能验证。
- 风险 R3：CI 的 `smoke-runtime.mjs` 使用无扩展的 `postgres:17-alpine` → 迁移必须对扩展缺失安全。
- 风险 R4：材料版权与来源范围 → 只接入官方公开页面/附件，保留来源链接与抓取时间；首批来源按 W5 清单扩展并记录实际覆盖。

## 2. W1 全学科闭环（2026-11-05）

### 2.1 实现范围

| 层 | 产物 | 说明 |
| --- | --- | --- |
| 字典 | `backend/src/subjects/subject-catalog.ts`、`subject-catalog.spec.ts` | 23 个稳定学科代码；歧义（艺术/计算机）多候选；未知保留原名并标记审核；旧代码归一（math→mathematics 等） |
| 接口 | `backend/src/subjects/subjects.controller.ts` | `GET /subjects`、`GET /subjects/resolve`；只读，已加入会话守卫公开路径 |
| 兼容 | `backend/src/matching/*`、`catalog/publication-projector.ts` | 岗位支持 `subjects` 多学科 + `subjectOriginal`；任一学科开放即通过闸门；旧单值 `subject` 继续生效 |
| 订阅/历史 | `backend/src/opportunities/*` | 订阅新增 `subjects`（保留旧 `subject`）；筛选按任一岗位学科匹配；订阅变更触发条件同步 |
| 画像 | `backend/src/profile/profile.service.ts` | `intendedSubjects` / `preferredStages` 校验与归一；未知代码保留不猜测 |
| 迁移 | `backend/prisma/migrations/20261105080000_subscription_subjects` | 只新增 `subjects JSONB`，可重复执行，不批量改写旧数据 |
| 前端 | `src/lib/subjects/catalog.ts`、画像/订阅/历史/标签 | 全学科选项、多学科订阅、历史学科筛选、未知学科显示原文；不默认锁定语文 |

### 2.2 阶段验证（2026-11-05）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端学科/切分单测 | `npx vitest run src/knowledge src/subjects` | 11 passed |
| 后端 lint | `npm run lint` | 0 error（8 warning 为既有/风格项） |
| 后端构建 | `npm run build` | 成功 |
| 前端全量单测 | `npm test` | 74 files / 796 tests passed |
| 前端类型 | 以 `npm run build` 为准（`.next/dev` 生成类型噪声不作为结论） | 待 CI 复核 |

### 2.3 遗留

- 旧数据未被批量猜测为语文；仅在读取时做代码归一。
- 学科别名人工审核表已建模（`subject_alias_reviews`），管理端审核界面留待 W2/W4 与后台页面一起验收。

## 3. 阶段状态

| 阶段 | 状态 | 提交 | CI | 证据 |
| --- | --- | --- | --- | --- |
| W0 | 完成（盘点） | `ddd4fd87` | 待核对 | 本文第 1 节 |
| W1 | 实现完成，待提交/CI | 待填 | 待核对 | 本文第 2 节 |
| W2 | 未开始 | - | - | - |
| W3 | 未开始 | - | - | - |
| W4 | 未开始 | - | - | - |
| W5 | 未开始 | - | - | - |
| 最终验收 | 未开始 | - | - | - |
