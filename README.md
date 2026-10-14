# 教招有据（前后端单仓库）

“教招有据”面向教师招聘意向用户，验证**可追溯的语文教师招聘机会、可解释的资格预筛与报考推进**。仓库同时包含前端（根目录）与后端（[`backend/`](./backend/)），Docker 部署配置在 [`deploy/`](./deploy/)。旧后端仓库仅作历史记录，后续代码统一提交到这里。

> **学科范围**：产品长期面向各学科，**当前只开放语文学科**；语文是首个验证板块，不是长期边界。

> **品牌口径**：“教招有据”是产品名；“验证版”是阶段标签，不默认拼进 Logo；固定副标题为“教师招聘机会与资格预筛”。所有资格结论均为**预筛**，最终以官方公告和招聘单位审核为准。商标/域名占用状态待核查，见 [`docs/教招有据-模块0-品牌清单与版本决策记录.md`](./docs/教招有据-模块0-品牌清单与版本决策记录.md)。

## 当前版本与基线

| 项目 | 值 |
|---|---|
| 当前代码基线 | **v7.2**（工作包 WP0–WP5 已实现，2026-10-14 整合收口） |
| 需求基线文档 | [`PRD-教招有据-v7.2-决策体验与可信机会闭环.md`](./PRD-教招有据-v7.2-决策体验与可信机会闭环.md) |
| 需求状态事实来源 | [`docs/v7.2-implementation-tracking.md`](./docs/v7.2-implementation-tracking.md)（唯一追踪表，改流程必须同步） |
| 技术栈 | 前端 Next.js 16.3.8 + React 19.2.8 + Tailwind 4；后端 NestJS 12 + Prisma 6 + PostgreSQL + BullMQ/Redis |

v7.2 把两件事合并成一次迭代：一端重做「首页 → 两屏填写 → 结果工作台 → 定向补充 → 保存后下一步」的决策体验；另一端把官方公告从代码样本升级为**可发现、可留档、可解析、可审核、可发布、可被匹配消费**的真实数据闭环。

> **冲突优先级**：用户最新要求 → v7.2 PRD → v7.1 PRD → v7.0 PRD → V6.1 参考文档。

---

## 一、现状速览（2026-10-14）

```text
首次使用：结果先行首页 → 两屏填写（地区意向 → 基础资格+用工偏好） → 访客示例 / 登录
结果阶段：结果工作台（优先机会 / 补充后判断 / 偏好范围外 三互斥标签）
补充阶段：定向补充（只问仍缺失的子字段）→ 重算 → 返回原分类并聚焦
保存阶段：保存机会 → 一个最高优先级下一步（日程 / 材料 / 官方确认）
数据阶段：来源发现 → 安全获取 → 快照归档 → 附件解析 → 候选 → 人工审核 → 发布 → 用户匹配
```

- 首页 `ff_new_home` 开启时渲染**结果先行**首页：主标题「哪些教师岗位，你现在就能报？」+ 唯一高强调 CTA「开始匹配岗位」+ 右侧结果预览（明确标注「示例」）。
- 首访画像为**两屏**：第一屏只收地区意向与考虑程度；第二屏按序收学历 → 毕业时间 → 专业 → 教师资格 → **用工偏好**。偏好只影响筛选与排序，**不改变资格判断**。
- 结果工作台按 `ff_new_results` 渲染**三类互斥标签**（同一岗位只属一个展示分类）。
- 定向补充固定路由 `/opportunities/[unitId]/supplement`（演示岗 `/preview/supplement/[unitId]`），只问仍缺失的子字段；**回退目标是岗位详情内联表单，绝不回 `/onboarding`**（测试锁定）。
- 数据库发布无需改代码或重新部署即可进入用户匹配（`ff_db_catalog` / 后端 `FF_DB_CATALOG`）。
- 首批主动抓取来源：**杭州、宁波、鄞州**三个官方站点，具备检查状态、失败原因与最近成功时间。

---

## 二、文档地图

| 文档 | 负责回答 |
|---|---|
| [`PRD-教招有据-v7.2-决策体验与可信机会闭环.md`](./PRD-教招有据-v7.2-决策体验与可信机会闭环.md) | 当前迭代需求与验收标准 |
| [`docs/v7.2-implementation-tracking.md`](./docs/v7.2-implementation-tracking.md) | v7.2 逐条需求实现状态、Feature Flag 与回归保护（唯一事实来源） |
| [`PRD-教招有据-v7.1-首次体验与报考闭环优化版.md`](./PRD-教招有据-v7.1-首次体验与报考闭环优化版.md) | v7.1 未覆盖行为的需求基线 |
| [`PRD-全国教师公开招聘助手-v7.0-研究验证版.md`](./PRD-全国教师公开招聘助手-v7.0-研究验证版.md) | 产品定位、资格规则、数据可信度基础事实 |
| [`docs/prototypes/README.md`](./docs/prototypes/README.md) | 原型入口、实施状态与 Coding 工具读取顺序 |
| [`docs/教招有据-UIUX改版详细方案-2026-10-13.md`](./docs/教招有据-UIUX改版详细方案-2026-10-13.md) | 页面信息架构与视觉改版方案 |
| [`docs/教招有据-主动抓取与附件解析技术方案-2026-10-13.md`](./docs/教招有据-主动抓取与附件解析技术方案-2026-10-13.md) | 抓取、解析、证据与发布的技术设计 |
| [`docs/china-network-accessibility.md`](./docs/china-network-accessibility.md) | 国内网络可访问基线、允许域名与验收方法 |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 两种部署形态、Feature Flag 发布阶段预设与回退操作 |
| [`deploy/README.md`](./deploy/README.md) / [`deploy/STANDALONE.md`](./deploy/STANDALONE.md) | GHCR 镜像 + Docker Compose + Caddy 部署手册 |
| [`backend/README.md`](./backend/README.md) | 后端模块、环境变量与边界 |

V6.1 兼容参考（历史路由迁移、既有领域对象、数据管线、回退策略）：[`PRD-全国教师公开招聘与备考助手-v6.1.md`](./PRD-全国教师公开招聘与备考助手-v6.1.md)、[`docs/v6.1-migration-plan.md`](./docs/v6.1-migration-plan.md)、[`docs/v6.1-information-architecture.md`](./docs/v6.1-information-architecture.md)、[`docs/v6.1-data-pipeline.md`](./docs/v6.1-data-pipeline.md)。

---

## 三、技术栈

**前端**（仓库根目录）
- Next.js 16.3.8（App Router）+ React 19.2.8 + TypeScript 5（strict）+ Tailwind CSS 4
- 状态与数据：服务层 + `useSyncExternalStore` 订阅；demo 数据存 `localStorage`（`kb_*` 键）
- 测试：Vitest 3 + jsdom（单元/组件）；Playwright（`e2e/`，浏览器端到端）
- 浏览器只调用同源 `/api/*`（[`src/app/api/[...path]/route.ts`](./src/app/api/%5B...path%5D/route.ts) 服务端反代，注入 `x-internal-token`）；CSP `default-src/connect-src 'self'`（[`next.config.ts`](./next.config.ts)）

**后端**（[`backend/`](./backend/)）
- NestJS 12（ESM）+ Prisma 6 + PostgreSQL（**14 个迁移**）
- 队列与 Worker：BullMQ + ioredis（`REDIS_URL`），独立 Worker 进程 `src/worker.ts`
- 文档解析：HTML、PDF（pdfjs-dist）、电子表格（XLS/XLSX/XLSB/ET，SheetJS）、DOCX（Mammoth）、按需 OCR
- 对象存储：OSS 实现与本地卷实现并存（`OBJECT_STORE_DIR`）
- 测试：Vitest（单元/领域/集成）
- 容器：多阶段构建，`node:24-alpine`

**部署**：GitHub Actions 构建 GHCR 镜像 → 阿里云 Docker Compose + Caddy 自动 HTTPS（[`deploy/`](./deploy/)）

---

## 四、仓库结构

```text
考编助手/
├── src/app/                 # Next.js App Router 页面与同源 API 反代
├── src/components/          # UI 组件库（ui/）+ 业务组件（opportunities/ 等）
├── src/lib/                 # 领域模块：flags/ profile/ opportunities/ guest/
│                            #   matching/ schedule/ plans/ analytics/ auth/ ...
├── e2e/                     # Playwright 浏览器端到端用例与 global-setup
├── scripts/                 # check-external-deps.mjs、e2e-prebuild.mjs 等
├── backend/
│   ├── src/                 # NestJS 模块：auth/ profile/ opportunities/ matching/
│   │                        #   announcements/ sourcing/ catalog/ document-processing/
│   │                        #   schedule/ plans/ trial/ health
│   ├── prisma/              # schema.prisma + migrations/
│   └── test/                # 后端测试
├── deploy/                  # Docker Compose、Caddyfile、env 模板、发布手册
├── docs/                    # 原型、方案、追踪表、网络基线
└── AGENTS.md                # 仓库级编码约定与文档读取顺序
```

---

## 五、快速开始

### 前端（demo 模式，无需后端）

```bash
npm ci
npm run dev          # http://localhost:3000
```

demo 模式下：内置演示账号仅在本机浏览器生效，画像、示例匹配、关注/日程/计划与事件全部存 `localStorage`；`/api/*` 拒绝代理，虚构公告链接不可点击，`/admin` 整体关闭。

### 后端联调（invited 模式）

```bash
cd backend
npm install
# 准备 PostgreSQL 与 Redis，按 .env.example 配置（DATABASE_URL、REDIS_URL 等）
npx prisma migrate deploy
npm run start:dev        # API
npm run build && node dist/worker.js   # 独立 Worker（抓取/解析消费，与 API 同一镜像的不同入口）
curl http://localhost:3000/health
```

前端以 `NEXT_PUBLIC_AUTH_MODE=invited` 启动，经同源 `/api/*` 访问后端；任何模式失败都**不静默回退 Mock**。

### 环境变量

| 位置 | 用途 |
|---|---|
| [`deploy/.env.example`](./deploy/.env.example) | 构建期变量总览：`NEXT_PUBLIC_AUTH_MODE`、`NEXT_PUBLIC_APP_ENV`、`NEXT_PUBLIC_FF_*`、后端 `FF_DB_CATALOG` 等 |
| [`deploy/frontend.env.example`](./deploy/frontend.env.example) | 前端容器**运行时**服务端变量：`BACKEND_URL`、`INTERNAL_TOKEN`（`NEXT_PUBLIC_*` 在构建镜像时固定，不在此文件） |
| [`deploy/backend.env.example`](./deploy/backend.env.example) | 后端容器变量：`DATABASE_URL`、`REDIS_URL`、`INTERNAL_TOKEN`、`AUTH_MODE`、`CRAWL_WORKER_PAUSED`、OSS 凭证等 |
| [`backend/.env.example`](./backend/.env.example) | 本地后端开发变量 |

真实密钥只经部署平台环境变量/Secret 注入，不提交仓库、不写日志、不进前端产物。

---

## 六、Feature Flag 与发布阶段

开关实现：[`src/lib/flags/index.ts`](./src/lib/flags/index.ts)。环境变量为 `NEXT_PUBLIC_FF_*`，**构建期内联**——修改后必须重新构建前端才生效，严禁放密钥。

**除 `ff_db_catalog` 外全部默认关闭 = 保持 v7.1 现状行为**（未设置或值不是 `"true"` 一律关闭）。

| Flag | 控制范围 | 默认 | 关闭（回退）行为 |
|---|---|---|---|
| `ff_new_home` | 结果先行首页、两屏填写与用工偏好 | 关 | 恢复 v7.1 旧首页 |
| `ff_new_results` | 结果工作台三互斥标签 + 新岗位卡 | 关 | 恢复旧的四档堆叠分组 |
| `ff_targeted_supplement` | 定向补充专用路由与重算回程 | 关 | 岗位详情页**内联**表单（`#supplement`），**绝不回 `/onboarding`** |
| `ff_db_catalog` | 数据库已发布目录进匹配（前端镜像后端语义；后端消费 env 名 `FF_DB_CATALOG`） | 显式 true/false 优先，未设置时 production 开、dev/test 关 | 静态目录（滚动演示 + 真实台账） |
| `ff_active_crawl` | 主动抓取与来源管理页 | 关 | `/admin/sources` 空态，不抓取；**暂停不删快照** |
| `ff_post_save_next` | 保存后「一个下一步」+ 官方确认 | 关 | 保存成功提示走 `actionNotice`（StatusMessage） |

发布阶段预设与逐步开放/回退步骤见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)「Feature Flag 与发布阶段预设」。新增开关必须同步登记到 [`docs/v7.2-implementation-tracking.md`](./docs/v7.2-implementation-tracking.md) 第 5 节，否则视为未登记开关。

---

## 七、路由与页面分工

| 路由 | 说明 |
|---|---|
| `/` | 首页；`ff_new_home` 开=结果先行首页，关=v7.1 价值首页 |
| `/learn` | 30 秒三步说明：公告难点、逐项核对方式与预筛边界 |
| `/onboarding` | 两屏基础画像：地区意向（只考虑/优先考虑/也可以考虑）→ 基础资格 + 用工偏好 |
| `/preview` | 访客结果示例（虚构示例，明确标注不代表真实招聘）；偏好卡作为「调整」入口 |
| `/preview/supplement/[unitId]` | demo 模式定向补充（不写户籍/出生日期/社保等敏感事实） |
| `/login` | demo 演示登录 / invited 服务端登录；支持 `?next=`；访客画像与暂存事件登录后迁移 |
| `/opportunities` | 结果工作台；`ff_new_results` 开=三互斥标签，关=旧堆叠分组 |
| `/opportunities/[unitId]` | 机会详情三层：结论与下一步 / 逐项资格核对 / 官方依据与版本；关注、设主目标、补充资格 |
| `/opportunities/[unitId]/supplement` | 真实岗位定向补充（`?origin=preview\|opportunities\|detail&bucket=…`，非法参数安全回退） |
| `/applications` | 报考中心：主目标工作区、报名倒计时、材料完成度、官方报名入口、状态历史 Timeline |
| `/schedule` | 报名与考试时间线、下一件不能错过的事 |
| `/study` | 备考：主要目标门禁、考情核对门禁、7 天计划、今日一项任务、反馈与重排（次级入口） |
| `/me` | 个人中心：画像结论、资料、备考、通知、设置与纠错入口 |
| `/materials` | 资料清单、准备情况与使用建议 |
| `/settings` | 高频学习设置、通知、账号、隐私与危险操作 |
| `/admin`、`/admin/reviews`、`/admin/pipeline`、`/admin/exams`、`/admin/resources`、`/admin/feedback`、`/admin/corrections`、`/admin/trial`、`/admin/sources` | 运营后台（仅工作人员角色；公开演示环境整体关闭） |

已删除的 v5.2 旧路由 `/exam`、`/today`、`/plan` 由 [`src/proxy.ts`](./src/proxy.ts) 307 跳转到 `/opportunities`、`/study`（保留查询参数）；映射表与 [`src/lib/ia/nav.ts`](./src/lib/ia/nav.ts) 的 `LEGACY_ROUTE_REDIRECTS` 一致，`src/proxy.test.ts` 覆盖。

用户端主导航只有 **机会 / 日程 / 我的** 三个入口；备考、资料、设置为次级页面。

---

## 八、前端领域模块（`src/lib/`）

| 模块 | 职责 |
|---|---|
| `flags/` | v7.2 六个 Feature Flag 读取与 `resolveSupplementTarget` 路由决策（回退绝不指向 `/onboarding`） |
| `guest/` | 访客会话（7 天 TTL）、两屏画像草稿、结果示例引擎、登录幂等迁移、访客关注合并 |
| `profile/` | 统一画像读写抽象 `ProfileRepository`（Guest/Server 双适配器 + patch 白名单 + `expectedUpdatedAt` 乐观锁与 409 恢复） |
| `opportunities/` | 报考单元、四值匹配展示、列表/详情视图、分类（`classify.ts`）、地图链接、下一动作选择 |
| `matching/` | 四值资格规则纯函数（**不读取用工偏好**，偏好不影响资格判断） |
| `schedule/`、`goals/`、`materials/`、`resources/`、`plans/` | 时间线与提醒、主要/备选目标、资料诊断、资源匹配、PlanEngine/ReplanEngine |
| `analytics/` | 事件字典（`dictionary.ts`）与指标纯函数；seed/live 分流；详见第十一节 |
| `auth/` | `AuthService` 接口 + `DemoAuthProvider`/`HttpAuthProvider`，`instance.ts` 按 `NEXT_PUBLIC_AUTH_MODE` 切换 |
| `evidence/`、`governance/`、`announcements/`、`admin/` | 证据、纠错与隐私、公告版本视图、后台审核服务 |
| `useOnlineStatus.ts` | 在线状态监听与 401/403 识别，供离线/无权限状态分支复用 |

组件库在 [`src/components/ui/`](./src/components/ui/)（token 见 `src/app/globals.css`），统一从 `index.ts` 导出：Button / Card / Input / Badge / Loading / Skeleton / EmptyState / ErrorState / Modal / Tabs / Progress / Switch / TaskCard / Disclosure / Drawer / StatusMessage，以及 Toast、Timeline、QualifyConclusionCard、EvidenceCard、FeedbackBar、OpportunityCard、ApplicationTargetCard、MaterialList、Callout。

---

## 九、后端模块与服务（`backend/src/`）

| 模块 | 主要能力 |
|---|---|
| `auth/` | 预建账号 + 密码哈希、HttpOnly 会话、管理员账号管理；`SessionGuard`/`AdminGuard`/`StrictAdminGuard` 服务端鉴权 |
| `profile/` | 画像读写：GET/PUT 幂等隔离 + `PATCH /profile` 字段级更新（白名单 + 乐观锁） |
| `matching/` | 四值资格匹配引擎（PASS/FAIL/UNKNOWN/MANUAL_REVIEW）与总结果；`real-catalog` 真实台账与滚动演示目录并列，真实记录单独标记 |
| `opportunities/` | 机会列表/详情视图、关注状态机、主要/备选目标、订阅、纠错；`FF_DB_CATALOG` 开时经 `PublishedCatalogRepository` 读 DB 已发布版本 |
| `catalog/` | `publication-projector` 投影与 `PublishedCatalogRepository`、`feature-flag`（后端开关语义） |
| `announcements/` | 提交来源 → 快照（SHA-256，内容哈希幂等）→ 确定性解析 → 候选 → 自动校验 → 人工审核（高影响字段无证据锚点不过审）→ 发布不可变版本；公告补充/延期/取消关系确认 |
| `sourcing/` | 主动抓取：`crawl-orchestrator`、`crawl-run-store`、`source-document-store`、`adapter-registry`、`crawl-scheduler`、`crawl-health.service`、`observability`、`intervention`、AdminGuard 管理接口 |
| `sourcing/adapters/` | 杭州、宁波、鄞州三个官方来源 Adapter（各含黄金样本测试） |
| `sourcing/jobs/` | `bullmq-task-queue`、`crawl.worker`、`document-fetch`、`source-discover`；`CRAWL_WORKER_PAUSED=true` 可暂停消费但进程在线 |
| `sourcing/fetch/` | `safe-fetcher`：URL 安全获取（拒绝私网/元数据地址、重定向重新校验、304 不建快照） |
| `sourcing/storage/` | OSS 与本地卷对象存储实现 |
| `document-processing/` | 格式检出（`format-detector`）、解析器（HTML/PDF/电子表格/DOCX/OCR）、解析守卫 `parse-guard`、`DocumentParseRun` 留痕 |
| `schedule/`、`plans/`、`trial/`、`changes/` | 日程事件与幂等提醒、计划持久化、试用事件白名单、变更留痕 |
| `health.controller.ts` | `GET /health`：分层返回 api/db/redis/worker 状态；db 与 redis 均正常才 `ok`，否则 `degraded`，进程不崩溃 |

后端对外只经前端同源反代 `/api/*` 访问（注入 `x-internal-token`），浏览器不直接访问后端端口。demo 模式不依赖后端。

---

## 十、数据可信层级（Demo / 测试 / 生产隔离）

| 层级 | 位置 | 标记方式 | 隔离保障 |
|---|---|---|---|
| 前端演示数据 | `src/lib/seed/`、`src/lib/opportunities/demoApi.ts` | `AUTH_MODE === "demo"` / `isDemoMode`；页面标注「结果示例 · 非真实岗位」 | 仅 demo 调用，不进 invited 调用链 |
| 后端滚动演示目录 | `backend/src/matching/catalog.ts` | 无 `dataset` 字段 | 与真实台账并列合并 |
| 后端真实台账 | `backend/src/matching/real-catalog.ts` | `dataset: 'real'`；AI 初核证据一律 `ai_extracted`，不过 `evidence_not_reviewed` 闸门 | 未人工复核**不进主要推荐**（测试固化） |
| 生产已发布版本 | Prisma `PublishedAnnouncementVersion` | 数据库审计链 | 经 `FF_DB_CATALOG` / `ff_db_catalog` 接入用户匹配 |
| 测试样本 | `tests/fixtures/` | 文件头注释 + 目录约定，全部 `dataset: 'test'` | **不进入** `src/lib/seed/`、`backend/src/matching/` 及任何生产目录，有隔离测试守护 |

核心不变量：**未填信息永不判「不符合」（UNKNOWN ≠ FAIL）**；已截止不显示「正在报名」；无官方来源不进主要推荐；AI/OCR 候选永不自动发布；公告新版本只追加不覆盖旧版本；同一提醒不重复生成；**已发布数据与静态种子目录必须隔离**。

---

## 十一、分析与埋点

- 前端事件字典唯一登记处：[`src/lib/analytics/dictionary.ts`](./src/lib/analytics/dictionary.ts)（`EVENT_DICTIONARY`）；服务端白名单：[`backend/src/trial/trial.domain.ts`](./backend/src/trial/trial.domain.ts)（`TRIAL_EVENT_TYPES`，现为 **28 类**）。
- props 只记**枚举与短标量**；资格原文、户籍、出生日期、证件信息、咨询答复正文等一律被 `sanitizeProps` 拒绝（键名命中敏感词则整事件拒绝）。
- P0 漏斗 9 阶段（`p0_funnel`）：基础画像完成 → 获得有效机会 → 查看匹配依据 → 关注机会 → 补充资格 → 标记报名 → 设主要目标 → 开始学习任务 → 7 日内有效推进。
- seed/live 分流：事件带 `source: "seed" | "live"`；访客未登录事件进暂存队列，登录后归属该账号（保留原始时间）并清空队列；`trackOncePerUser` 在「暂存 + 已落库」范围内去重。

---

## 十二、质量与验证

```bash
# 前端（仓库根目录）
npm test                 # Vitest：57 文件 / 583 用例通过（2026-10-14）
npx tsc --noEmit         # 类型检查（strict）
npm run lint             # ESLint
npm run build            # 生产构建（postbuild 自动执行外部依赖扫描）
npm run check:external   # 扫描源码与构建产物的运行时外部依赖（0 阻断境外 origin、无密钥泄漏、无远程字体）
npm run test:e2e         # Playwright 浏览器 E2E：18 用例通过（pretest:e2e 预构建全开关产物）

# 后端（backend/）
npm test                 # Vitest：55 文件 / 605 通过 + 1 expected fail（2026-10-14）
npm run lint             # oxlint --type-aware
npm run build            # nest build
npx prisma validate      # Prisma schema 校验
npm run test:e2e         # 后端 e2e（vitest.config.e2e.ts）
```

浏览器端到端（[`e2e/`](./e2e/)、[`playwright.config.ts`](./playwright.config.ts)）用**两个服务并存**覆盖开关两态：
- `3000`「回退态」：`next dev`，仅注入 `NEXT_PUBLIC_FF_POST_SAVE_NEXT=true`，其余开关默认关 → 渲染 v7.1 旧首页 / 旧堆叠结果 / 详情内联补充；
- `3100`「v7.2 开启态」：由 `pretest:e2e` 预构建的全开关 production 产物 `next start`；
- `e2e/global-setup.ts` 顺序预热关键路由，消除冷编译超时。因 `NEXT_PUBLIC_*` 编译期内联，**开关态必须在进程启动时注入**。

领域测试覆盖的高风险不变量：补充/保存绝不进入 `/onboarding`；三类结果严格互斥；UNKNOWN 不自动转 FAIL；高影响字段无证据锚点不能过审；发布版本只追加不被覆盖；已截止机会退出；关注状态机合法迁移；同一时间线事件/提醒按业务唯一键只生成一条；DB 已发布单元进匹配。

> 仓库另保留早期浏览器脚本目录 [`.qa-harness/`](./.qa-harness/)（独立 `package.json`，含 `m9-*` 系列脚本）。当前 v7.2 的浏览器验证以 [`e2e/`](./e2e/) 的 Playwright 用例为准。

---

## 十三、线上环境

### 受邀试用环境（承接真实试用）

**确认部署地址以 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 第 12–15 节与 [`deploy/README.md`](./deploy/README.md) 为准。**

- 环境标识 `NEXT_PUBLIC_APP_ENV=invited`、`NEXT_PUBLIC_AUTH_MODE=invited`；前端经同源 `/api/*` 访问 NestJS + PostgreSQL + Redis + Worker；健康检查 `GET /api/health`（api/db/redis/worker 分层）。
- 账号管理员预建（密码哈希 + HttpOnly 会话 cookie），不开放公开注册；访客本机画像登录后幂等迁移。
- **真实官方监测范围为杭州、宁波、鄞州**，其余为明确分区标注的虚构示例，不可用于真实报名。
- `robots.txt` 全站 Disallow；`/admin` 不对公众开放。
- 部署：GitHub Actions 构建 GHCR 镜像 → 阿里云 Docker Compose + Caddy 自动 HTTPS。
- **边界**：研究验证用轻量部署，不承诺高可用与备份频次；ICP 备案与隐私政策/用户协议等合规文件须在扩大试用前补齐。

### 公开演示环境（仅功能展示）

- 环境标识 `NEXT_PUBLIC_APP_ENV=demo`、`NEXT_PUBLIC_DEMO_MODE=true`；所有输入仅存访客本机浏览器。
- `/admin` 整体关闭；`robots` 为 `noindex,nofollow`。
- 部署于境外平台，中国大陆可达性无保障，**仅用于功能展示与评审，不得承接真实用户**。

---

## 十四、关键架构约定（继续生效）

- 认证逻辑、用户状态、UI 三层分离；页面经 `useCurrentUser()` 取用户，路由保护用 `RequireAuth` / 角色判断。
- 领域规则集中在各模块 `domain.ts` 纯函数，页面只做展示与交互。
- **动作分流互不共享错误路由**：补充信息 → supplement 页；修改全部信息 → onboarding；保存机会 → follow；建议官方确认 → consultation。**补充与保存绝不进入 `/onboarding`**。
- 真实任务与虚拟体验承诺分离：`/preview` 系列不保存户籍、出生日期、社保等敏感事实。
- 正式（非 demo）状态不得静默回退 Mock；演示数据必须明确标识。
- 任何 UI 改动复用 `src/app/globals.css` 现有设计 Token，**不引入远程字体或远程图标**。

---

## 十五、明确未实现 / 边界（不得移入「已实现」）

- **真实 AI/OCR 自动发布**：OCR 只按需启用（`FEATURE_OCR_PARSE`，默认关），且低置信度强制人工确认；AI 候选永不自动发布高影响字段。
- **DOCX 解析产品化**：解析器代码存在但受 `FEATURE_DOCX_PARSE`（默认关）门控，未正式启用时结果标记「待人工处理」，不伪装成功。
- **真实通知渠道**：短信、微信、邮件、Web Push 均未接入（`NotificationRecord` 仅站内记录）。
- **计划生成服务端化**：7 天计划/重排规则仍运行在前端纯函数引擎，后端仅持久化。
- **数据删除服务端全链路**：demo 端完成，服务端处置链路未全量验证。
- **多学科**：当前仅开放语文。
- **多岗位比较**：本轮只保留原型，未上线。
- **不在本轮**：全国实时全覆盖、默认内嵌地图或定位权限、录取概率/竞争度/综合匹配分、自动拨号或自动发送咨询。

受邀阶段保持**模块化单体**，不拆微服务；明确不做 Kafka、Elasticsearch、向量数据库、Kubernetes、自动代报名、AI 直接判定资格或预测录取。

---

## 十六、维护约定

1. 修改产品流程、页面信息架构、路由、领域模型、演示数据或验收标准前，先读 [`AGENTS.md`](./AGENTS.md) 指定的文档顺序（v7.2 追踪表 → 原型 README → v7.2 PRD → v7.1 → v7.0）。
2. 每次修改产品流程、页面、接口或数据模型后，**必须同步更新** [`docs/v7.2-implementation-tracking.md`](./docs/v7.2-implementation-tracking.md) 对应行；新增 Feature Flag 必须登记其第 5 节。
3. 判断或修改 Next.js 行为前，先读 `node_modules/next/dist/docs/` 中对应指南（该版本与训练数据可能存在破坏性差异）。
4. 状态必须基于真实调用链核实，**不允许根据文件名或原型推断为已实现**。

---

*本 README 于 2026-10-14 按 v7.2 代码现状重新核对：代码基线 v7.2（WP0–WP5 已实现并整合收口），六项 Feature Flag 除 `ff_db_catalog` 外默认关闭；补充与保存均不进入 `/onboarding`（测试锁定）；三类结果互斥；数据库发布无需重新部署即可进入匹配；杭州/宁波/鄞州三来源具备检查状态、失败原因与最近成功时间；高影响字段无证据不得发布。本机全量：前端 Vitest 57 文件 583 用例、后端 55 文件 605 用例（+1 expected fail）、Playwright 浏览器 E2E 18 用例全部通过，lint/构建/外部依赖扫描 0 阻断。未实现能力继续标注为未实现，不得对外宣称完成。*
