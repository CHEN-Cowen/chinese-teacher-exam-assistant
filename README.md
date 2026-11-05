# 教招有据

面向教师招聘考生的官方机会发现、可解释资格预筛与报考推进工具。当前已取消语文学科限制，支持全学科资料、匹配与筛选，并提供基于官方公告与政策的 RAG 问答。全国是逐步扩源目标，实际服务以运行时覆盖和最近核对时间为准。所有结论均为预筛，最终以招聘单位审核为准。

产品要求统一维护在 **[PRD.md](PRD.md)**。本文介绍当前架构与开发入口，不代表生产已部署或商业服务已开放。

**分支说明：** 当前功能盘点基于 [`codex/all-subject-rag`](https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant/tree/codex/all-subject-rag)。`main` 尚未合并全学科与知识库问答升级；开发和运行最新功能请使用该分支。

## 当前状态

截至 2026-11-05，开发分支已包含全学科字典与画像、可解释匹配、往年参考、单位关注、纠错闭环、报考推进、来源采集与审核发布、知识库入库/切分/索引、公告问答、地区政策检索、会员及模拟支付等实现。

- 15 个已核验官方来源适配器：14 个教师招聘来源（杭州、宁波、鄞州、丽水、绍兴、嘉兴、萧山、湖州、南京、苏州、常州、泰州、蚌埠、亳州）+ 1 个安徽省级政策来源；另有江苏省教育厅、浙江省教育厅 2 个候选入口与无锡市教育局 1 个受阻入口。连续 7 天线上采集观察尚未完成（N1 首日两次真实采样已记录，窗口 0/7）。
- 全国教师招聘公告采集是当前最高优先级。招聘来源实际仅覆盖浙江、江苏、安徽 3 个省级行政区；31 个省级行政区目录账本、实际接入缺口与分批计划见 [全国来源账本](docs/nationwide-recruitment-source-ledger.md)，产品范围与验收见 [PRD 第 13 节](PRD.md)。
- RAG 已接入真实百炼：Embedding `text-embedding-v4`、Rerank `qwen3-rerank`、Chat `qwen-plus`。提交 `4f38df4` 的隔离验收（[run 42016047916](https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant/actions/runs/42016047916)）使用 `pgvector/pgvector:pg17` + Redis + API + Worker，W4 权限与 W5 政策检索流程通过。
- 常规 CI（[run 42016047880](https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant/actions/runs/42016047880)）前后端检查、浏览器测试与镜像发布通过。后端 110 个文件 / 1338 项通过（1 expected fail、2 skipped），前端 74 个文件 / 794 项通过（2 skipped），Playwright 25 项通过。
- 最终端到端验收仍为“有阻塞未完成”：浏览器未与真实模型同一隔离实例联动；召回率、忠实度、引用正确率、拒答正确率、延迟与成本尚无固定样本数据；连续七天观察 0/7 天。详见 [RAG 最终验收](docs/all-subject-rag-final-acceptance.md) 与 [升级验收](docs/recruitment-upgrade-acceptance.md)。
- 订单、权益授予、全额退款和手动对账仅模拟链路。**真实微信渠道尚未实现，当前只有 `wechat_mock`**；Native/JSAPI/H5 是预留标识。会员增值权益清单为空，售卖默认关闭。
- SMTP、线上 HTTPS 会话、生产迁移/回退及真实发布流水线仍需验证；真实发布匹配、关注通知、纠错处理的完整多角色联调仍待验。

## 技术架构

前后端同仓库，分别安装、构建和运行；后端 API 与 Worker 是两个独立进程。API 负责鉴权、业务读写、检索问答与任务投递；Worker 负责抓取、解析和知识索引。

```mermaid
flowchart TD
  B[浏览器] --> N[Next.js 页面与同源 API 代理]
  N --> A[NestJS API：会话/画像/匹配/机会/知识库/问答/会员/支付]
  A --> P[(PostgreSQL + Prisma)]
  A --> V{pgvector 可用？}
  V -->|是| P
  V -->|否| F[Float[] + 应用层余弦降级]
  A --> Q[(Redis / BullMQ)]
  Q --> W[独立 Worker：抓取/解析/知识索引]
  W --> O[官方站点与附件]
  W --> S[本地卷或 OSS 原件存储]
  W --> P
  A --> M[百炼：Embedding / Rerank / Chat]
  W --> M
```

浏览器调用同源 `/api/*`，Next.js 服务端注入内部令牌访问 API。检索前按权限、审核状态、版本与有效期过滤；回答只返回后端校验过的引用，AI 不可用时基础招聘与原文浏览不受影响。

| 层 | 当前技术 |
|---|---|
| 前端 | Next.js 16.3.8、React 19.2.8、TypeScript、Tailwind CSS 4 |
| API | NestJS 12、ESM、Prisma 6.19、PostgreSQL（部署模板使用 17，28 项迁移） |
| RAG | 混合检索（向量 + 中文二元组词法）、Rerank、引用校验、有效版本切换；`mode=mock\|real` |
| 向量 | 优先 pgvector；扩展不可用时 Float[] 降级；验收使用 `pgvector/pgvector:pg17` |
| AI | 百炼 `text-embedding-v4`（1024 维）、`qwen3-rerank`、`qwen-plus`；模型与接入点均由环境变量配置 |
| 任务 | BullMQ 6.3、Redis、Nest 定时投递、独立 Worker |
| 解析 | Cheerio、pdfjs-dist、SheetJS、Mammoth；OCR 保留人工回退 |
| 存储 | 本地快照卷及 OSS 实现，数据库保存业务与发布版本 |
| 测试 | Vitest、后端 oxlint、前端 ESLint、Playwright |
| 部署 | Node.js 24 容器、GitHub Actions/GHCR、Docker Compose；按形态由 Caddy 或既有反代提供 HTTPS |

依赖精确版本以两份 package.json 与 lockfile 为准。

## 仓库结构

```text
.
├── PRD.md                     # 唯一产品需求基线
├── AGENTS.md                  # 开发约定与文档入口
├── src/
│   ├── app/                   # 页面（含 /policy、/history、/follows）、管理端、同源 API 代理
│   ├── components/            # 业务和基础 UI，含问答面板与覆盖提示
│   └── lib/                   # 画像、匹配、机会、知识库与政策 API 等
├── backend/
│   ├── src/
│   │   ├── auth/ profile/ subjects/ matching/ opportunities/
│   │   ├── announcements/ sourcing/ catalog/ document-processing/
│   │   ├── knowledge/        # 文档、切分、索引、检索与 qa
│   │   ├── ai/               # 百炼 Embedding / Rerank / Chat 适配
│   │   ├── membership/ payments/ schedule/ plans/ trial/
│   │   ├── app.module.ts      # API 模块入口
│   │   └── worker.ts          # 独立 Worker 入口
│   ├── prisma/               # Schema 与迁移
│   └── test/
├── e2e/                       # 浏览器关键流程
├── scripts/                   # 构建检查与运维辅助
├── deploy/                    # Compose、反代和环境模板
└── docs/                      # 技术、网络、来源、验收与观察模板
```

## 本地开发

准备 Node.js 24 和 npm；需要真实服务端时准备 PostgreSQL、Redis。环境文件仅存本机，真实密钥不提交。

### 前端演示

```bash
npm ci
npm run dev
```

默认 `http://localhost:3000`。demo 模式使用本机浏览器数据与明确示例，不代表真实招聘；管理端与代理受模式限制，不用于承接正式用户。

### API 与 Worker

在 backend/ 下根据 `.env.example` 创建 `.env`，配置数据库、Redis、认证、内部令牌、快照目录与 AI 参数。密钥只写入本机 `.env` 或部署环境，不进入仓库、日志或前端产物。

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

后端 PORT 默认 3000；与前端同机运行时应在后端环境设为例如 3002。另开终端启动 Worker，共用数据库、Redis 和存储：

```bash
cd backend
npm run build
node dist/worker.js
```

知识库问答至少需要以下配置：

```dotenv
AI_ENABLED=true
AI_MOCK_MODE=false
DASHSCOPE_API_KEY=your-server-side-key
BAILIAN_EMBEDDING_MODEL=text-embedding-v4
BAILIAN_RERANK_MODEL=qwen3-rerank
BAILIAN_CHAT_MODEL=qwen-plus
```

`AI_MOCK_MODE=true` 只用于本地链路验证，不用于回答质量结论；`AI_ENABLED=false` 时问答明确返回不可用，公告与基础招聘仍可用。更换 Embedding 模型或维度后需重建并切换索引版本。

根目录前端 `.env.local` 联调示例：

```dotenv
NEXT_PUBLIC_AUTH_MODE=invited
BACKEND_URL=http://127.0.0.1:3002
INTERNAL_TOKEN=replace-with-the-same-strong-local-token-as-backend
```

后端对应 `AUTH_MODE=invited`，内部令牌保持一致。账号初始化、公开注册和代理配置见 [部署说明](DEPLOYMENT.md)，公网不使用演示默认凭证。

## 模式与开关

- demo 是本机演示；invited 使用真实会话和服务端数据，失败不回退 Mock。
- 前端 `NEXT_PUBLIC_*` 在构建期内联，变更需重新构建，不能包含密钥。
- 六个页面开关为 `NEW_HOME`、`NEW_RESULTS`、`TARGETED_SUPPLEMENT`、`DB_CATALOG`、`ACTIVE_CRAWL`、`POST_SAVE_NEXT`，共同前缀 `NEXT_PUBLIC_FF_`。除目录开关外，非显式 true 默认关闭。
- DB_CATALOG 未设置时 production 开、dev/test 关，后端对应 `FF_DB_CATALOG`。开启消费已发布数据库目录；关闭路径用于演示/测试静态目录。
- 前端来源管理开关不等于暂停 Worker；实际由 `CRAWL_SCHEDULER_ENABLED`、`CRAWL_WORKER_PAUSED` 等控制，部署时协调。
- RAG 开关与预算由 `AI_ENABLED`、`AI_MOCK_MODE`、`QA_QUESTION_MAX_CHARS`、`QA_DAILY_REQUESTS_PER_USER`、`QA_DAILY_REQUESTS_PER_IP`、`QA_DAILY_REQUESTS_GLOBAL`、`QA_DAILY_TOKENS_GLOBAL` 控制；知识索引与抓取共用 Worker，队列暂停不影响已发布内容读取。
- `MEMBERSHIP_SALES_ENABLED` 与 `MEMBERSHIP_ANNUAL_SALES_ENABLED` 默认关闭。`PAYMENT_MOCK_ENABLED` 仅供受控测试，生产禁止。真实微信不是当前可配置即用能力。

完整变量见 [后端模板](backend/.env.example)、[部署模板](deploy/.env.example)、[前端容器模板](deploy/frontend.env.example)。

## 检查与测试

前端根目录：

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run test:e2e
```

build 后自动检查外部依赖。test:e2e 的 pretest 会预构建，当前浏览器测试使用 3001（回退态）和 3123（新流程）端口。首次使用安装浏览器：`npx playwright install chromium`；避免其他服务占用端口。浏览器用例使用演示数据，不等同真实模型同实例验收。

后端：

```bash
cd backend
npm run lint
npm test
npm run build
npx prisma validate
```

隔离启动冒烟（mock，临时 PostgreSQL/Redis，适合本地与 CI）：

```bash
node backend/scripts/smoke-runtime.mjs
```

真实百炼隔离验收（需本机或 CI Secret 中的 Key；使用 pgvector 镜像）：

```bash
SMOKE_REAL_AI=1 DB_IMAGE=pgvector/pgvector:pg17 \
DASHSCOPE_API_KEY=your-server-side-key \
node backend/scripts/smoke-runtime.mjs
```

GitHub Actions 的真实模型验收工作流为 `.github/workflows/rag-acceptance.yml`，只从 Repository Secret `DASHSCOPE_API_KEY` 读取密钥。fixture、真实材料、模拟 AI 与线上观察分别记录；缺快照而跳过不算通过，expected fail 仍代表未落地目标。模拟 API 通过不代表真实供应商、国内网络或生产已验收。

## 部署与文档

部署包含迁移、API、Worker、PostgreSQL、Redis 和原件存储。API/数据库保持内网隔离，可信反代提供 HTTPS。迁移前备份，回退优先使用兼容代码并保留业务数据，不直接删除支付或审核记录。知识库使用 pgvector 时需确认目标数据库镜像含扩展；不含扩展时应用走 Float[] 降级，不能据此宣称向量路径已验证。

| 文档 | 用途 |
|---|---|
| [PRD](PRD.md) | 当前完整定位、范围、流程、视觉、商业与验收 |
| [部署说明](DEPLOYMENT.md) | 环境、开关与发布 |
| [容器部署](deploy/README.md) / [独立部署](deploy/STANDALONE.md) | 部署拓扑与运维 |
| [国内网络基线](docs/china-network-accessibility.md) | 依赖与验证 |
| [来源验收](docs/m08-source-acceptance-report.md) | 来源证据与持续观察缺口 |
| [集成验收](docs/final-e2e-acceptance-report.md) | 历史本地测试及待生产验证 |
| [升级验收](docs/recruitment-upgrade-acceptance.md) | 2026-10-29 版本、CI、已知问题与部署门槛 |
| [RAG 最终验收](docs/all-subject-rag-final-acceptance.md) | 全学科与知识库问答的隔离证据、覆盖与遗留 |
| [采集观察](docs/source-observation-template.md) | 连续运行记录模板 |

开发方案、分模块提示词、任务稿与过程台账已从当前文件树移除，可通过 Git 历史追溯。后续产品变更直接更新 PRD，不新增并行需求基线。
