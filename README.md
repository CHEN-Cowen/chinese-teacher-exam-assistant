# 教招有据（前后端单仓库）

“教招有据”面向教师招聘意向用户，当前验证**可追溯的语文教师招聘机会、可解释资格预筛与报考推进**。现有 v6.1 代码另含备考计划能力，但该能力在 v7.0 验证目标中降为 P1，不是当前对外核心承诺。

本仓库现在同时包含前端（仓库根目录）与后端（[`backend/`](./backend/)）；Docker 部署配置在 [`deploy/`](./deploy/)。旧后端仓库保留作历史记录，后续代码统一提交到这里。前端仍位于仓库根目录，现有 Vercel 项目的构建根目录无需因本次合并而改变。

> **学科开放范围**：产品长期面向各学科，**当前版本只开放语文学科**；语文是首个验证板块，不是产品长期边界。

> **品牌口径**：“教招有据”是产品名；“验证版”是阶段标签，仅用于试用说明与内部文档，不默认拼进 Logo；固定功能副标题为“教师招聘机会与资格预筛”；所有资格结论均为预筛，最终以官方公告和招聘单位审核为准。商标、域名与平台账号名称占用状态为**待核查**，对外发布前须完成近似查询，详见 [`docs/教招有据-模块0-品牌清单与版本决策记录.md`](./docs/教招有据-模块0-品牌清单与版本决策记录.md)。

当前实现以 [`v6.1 PRD`](./PRD-全国教师公开招聘与备考助手-v6.1.md) 的完整业务闭环为能力基础，按 [`v7.0 研究验证版 PRD`](./PRD-全国教师公开招聘助手-v7.0-研究验证版.md) 收拢用户端叙事，并按 [`v7.1 首次体验与报考闭环优化版 PRD`](./PRD-教招有据-v7.1-首次体验与报考闭环优化版.md) 完成 M0—M10 迭代。本 README 描述仓库在 **2026-10-12** 的实际产品状态、运行方式与边界；后端能力详见 [`backend/README.md`](./backend/README.md)。

> **2026-10-12 现状速览（v7.1 M0—M10 收口）**：承接 10 人真实试用的**受邀环境已上线**：[https://kbzs.al.qich.top](https://kbzs.al.qich.top)（invited 全栈：NestJS + PostgreSQL，`/api/health` 已验证 `db:up`），仅限预建账号登录、不开放公开注册；试用用户范围扩大到**浙江省、江苏省**（选择省份不代表全省已覆盖）；首访画像为**两屏**流程（地区意向 → 基础资格）；首页仅保留单一主按钮「开始资格预筛」。当前真实官方数据监测范围为**浙江杭州、宁波**，江苏尚未接入监测，其余为明确分区的虚构试用机会——不宣称两省完整覆盖。

## 文档地图

| 文档 | 负责回答 |
|---|---|
| [`PRD-全国教师公开招聘与备考助手-v6.1.md`](./PRD-全国教师公开招聘与备考助手-v6.1.md) | 当前实现的历史需求基线 |
| [`PRD-全国教师公开招聘助手-v7.0-研究验证版.md`](./PRD-全国教师公开招聘助手-v7.0-研究验证版.md) | 本轮验证的产品目标与验收标准 |
| [`docs/PRD-v6.1-技术可行性与开发方案.md`](./docs/PRD-v6.1-技术可行性与开发方案.md) | 技术选型、架构与分阶段开发方案 |
| [`docs/v6.1-migration-plan.md`](./docs/v6.1-migration-plan.md) | v5.2 → v6.1 的路由、领域对象、模块处置与阶段回退 |
| [`docs/v6.1-information-architecture.md`](./docs/v6.1-information-architecture.md) | “机会 / 日程 / 备考”信息架构与页面内容预算 |
| [`docs/v6.1-data-pipeline.md`](./docs/v6.1-data-pipeline.md) | 公告提交、提取、审核、发布与版本留痕流水线 |
| [`docs/china-network-accessibility.md`](./docs/china-network-accessibility.md) | 国内普通网络可访问基线、允许域名与验收方法 |
| [`docs/教招有据-10人演示试用-用户访谈与旅程观察方案.md`](./docs/教招有据-10人演示试用-用户访谈与旅程观察方案.md) | 10 人演示试用方案与配套观察记录表 |
| [用户访谈提纲-10人小范围试用.md](./用户访谈提纲-10人小范围试用.md) | 10 人受邀试用后的一对一访谈提纲、任务测试卡与记录模板（2026-10-11） |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 两种部署形态（Vercel demo 与境内受邀环境）的说明与前置条件 |
| [`deploy/README.md`](./deploy/README.md) / [`deploy/STANDALONE.md`](./deploy/STANDALONE.md) | GHCR 镜像 + Docker Compose + Caddy 的实际部署操作手册 |

---

## 一、当前产品状态（2026-10-12）

> 状态标识：✅ = 仓库中已实现并有自动化测试覆盖；🚧 = 代码已写但**尚未在真实环境验证**；❌ = 未实现，不得对外宣称完成。

仓库已经完成 v6.1 模块 0—9 的代码侧闭环，按 v7.0 收拢产品结构，并完成 v7.1 M0—M10 首次体验与报考闭环优化：

```text
首次使用：了解价值（也可先看结果示例）→ 两屏基础画像（免登录）→ 查看初步匹配示例 → 独立入口登录 → 保存与关注
日常使用：机会 → 资格依据 → 关注/准备报名 → 日程推进
目标确定后：主要目标 → 资料准备 → 7 天计划 → 今日一项任务 → 反馈调整
```

两屏画像依次为「地区意向（可接受地区按只考虑/优先考虑/也可以考虑三档记录）→ 基础资格（最高学历、专业全称、毕业时间、教师资格状态）」；年龄、户籍、社保、工作经历、就业状态与用工偏好不进基础画像，在具体机会需要时按需补问。首页首屏只有**一个**高强调主按钮「开始资格预筛」，另保留「先看结果示例」次级锚点与登录次级入口；备考仅保留为文字次级入口。

用户端主导航现在只有 **机会 / 日程 / 我的**。备考能力与 `/study` 路由继续保留，但作为主要目标确定后的次级入口，不再与机会发现争夺首屏注意力。NestJS + PostgreSQL 受邀模式已作为线上受邀环境运行（见第三节），服务端代码和迁移均在同一仓库。

两种运行模式，由 `NEXT_PUBLIC_AUTH_MODE` 切换：

- **demo（默认）**：内置演示账号仅在本机浏览器生效；画像、示例机会匹配、关注/推进、日程、计划与事件均留在 `localStorage`，无需后端。`/api/*` 在此模式下拒绝代理；虚构公告链接不可点击，示例日期随当天滚动。
- **invited**：`HttpAuthProvider` 经同源 `/api/*` 使用服务端预建账号与 HttpOnly 会话 cookie（身份不进浏览器），画像、关注、日程、计划等读写 NestJS + PostgreSQL；任何模式失败都不静默回退 Mock。

> **验收状态（2026-10-10 端到端验收收口）**：本轮完成 V7 PRD 场景 A–G 全量端到端验收，结果如下：
> - **场景 A–F**（访客资料填写、登录推荐、详情资格判断、关注日程个人中心、异常边界）：33/33 浏览器级断言通过；
> - **场景 G**（响应式 1440×900 与 390×844）：16/16 通过（12 张全页截图无横向溢出、控制台 0 error）；
> - **场景 E**（公告数据管线 API 级）：16/16 通过（admin 提交→提取→审核→发布 v1→版本查询→更正发 v2→v1 superseded→审核留痕，含状态机约束：未审核不可发布、重复发布被拒、审核员不可提交来源）；
> - **项目自带 E2E**：`.qa-harness/m9-p0-flow.mjs` 25/25、`m9-blocked-runtime.mjs` 7/7（均已更新为 v7 口径）；
> - **单元测试**：前端 212/212、后端 182/182；
> - **工程检查**：Lint 0 错误、tsc 0 错误、生产构建通过、外部依赖扫描 0 阻断。
>
> 本轮发现并修复 3 个问题：① P2 详情页演示标识仅在折叠层内（已加首屏 Badge+说明）；② P2 最小画像用户详情页补充表单死胡同（已加引导块分支）；③ P1 审核员可越权提交真实公告来源（已新增 StrictAdminGuard，仅 admin 可提交）。详见 [提交 `ad293ec7`](https://github.com/CHEN1998-create/chinese-teacher-exam-assistant/commit/ad293ec7)。
>
> **2026-10-11 受邀试用收口**：
> - **受邀环境已上线**：[https://kbzs.al.qich.top](https://kbzs.al.qich.top)，阿里云服务器经 GHCR 镜像（`.github/workflows/docker-publish.yml`）+ Docker Compose + Caddy 部署，前端镜像固定 invited 模式；已实测 `GET /api/health → {"status":"ok","db":"up"}`，登录页无演示账号区块、明示「仅限受邀测试用户，不开放公开注册」，`robots.txt` 全站 Disallow。
> - 本轮补齐受邀试用真实闭环：真实官方批次（杭州、宁波）与虚构试用机会分区提示（`DatasetScopeNotice`）、无匹配时引导走完全程的「完整体验指引」（`TrialJourneyGuide`：报考信息 → 判断并保存 → 材料与日程）、关注机会材料进度/咨询记录/乐观锁字段的正式迁移（`20261010174000_follow_progress_tracking`，含迁移覆盖测试）。
> - 修复两个受邀阻断问题：受邀用户机会页崩溃（`list-view`/`useOpportunities`）、线上表结构缺跟进字段导致 Prisma P2022。
> - 首页与画像「降低演示感」重构：三阶段画像替代五组表单、首页「30 秒开始」双入口（开始匹配机会 / 先看看匹配示例）、备考弱化为文字链接；前端测试随重构更新。
> - 2026-10-11 本机复测：前端 Vitest 28 文件 224 用例、后端 19 文件 183 用例全部通过，tsc 0 错、ESLint 0 错。
>
> **2026-10-12 v7.1 M0—M10 收口**：
> - v7.1 迭代完成：M0 浙江/江苏覆盖口径与公告数据基础、M1 首页单一入口、M2 两屏基础画像、M3 用工偏好与资格分离（降噪）、M4 四档结果卡片、M5 地图轻量入口（点击后打开外部地图，不内嵌）、M6 三种无结果态与站内订阅、M7 多岗位日程自动同步/改期/冲突/幂等提醒、M8 登录后置与访客迁移、M9 分析事件与试用看板、M10 集成收口与文档同步。
> - M10 修复：demo 模式下详情页 `useActiveProfile` 的 `isGuest` 曾恒为 true，已登录演示账号「保存机会/设为重点准备」被反复重定向到登录页、原动作无法完成；已改为跟随认证状态并新增回归测试（`src/lib/opportunities/useActiveProfile.test.tsx`）。
> - 本机全量回归：前端 Vitest 36 文件 319 用例、后端 22 文件 258 用例全部通过，tsc 0 错、ESLint 0 错、生产构建 + 外部依赖扫描 0 阻断；`m9-p0-flow.mjs` 25/25、`m9-blocked-runtime.mjs` 7/7、`m9-public-safety.mjs` 2/2、`m9-cn-smoke.mjs` 5/5（QA_FORCE_DIRECT=1，中国移动直连）、`prototype-v7-smoke.mjs` 通过；`m9-invited-flow.mjs` 已同步 v7.1 口径，需在受邀环境复跑。
>
> **仍待办**：① 受邀站页脚暂未展示 ICP 备案号，正式扩大试用前按 [DEPLOYMENT.md](./DEPLOYMENT.md) 第 12 节补齐备案与合规文件，并在家庭宽带/手机蜂窝做一次无代理冒烟（记录到 [`docs/china-network-accessibility.md`](./docs/china-network-accessibility.md) 第 6.3 节）；② `m9-invited-flow.mjs` 已更新为 v7.1 口径但本机无 PostgreSQL 未复跑，需在受邀环境验证；③ Vercel demo 站为境外平台，中国大陆可达性无保障，不作为试用依赖。

### 当前界面与体验原则

2026-10-10 已完成首页、登录、画像、机会列表、机会详情、报考中心、日程、备考、我的、资料、设置、访客预览和产品说明页的连续视觉优化，并落地 v7 视觉系统。当前界面遵循以下规则：

- 每个核心页面先给出**一个结论 + 一个下一步**，详细依据按需展开；
- 主色为**温暖米白（#FCFBF8）背景 + 深海军蓝（#071A31）品牌色**，大圆角、克制阴影；绿色、黄色、红色只表达成功、待确认和风险；
- 统一 v7 组件库（`src/components/ui/`）：Button / Card / Badge / Loading / Skeleton / EmptyState / ErrorState / Modal / Tabs / Progress / Switch / TaskCard / Disclosure / Drawer / StatusMessage，以及 v7 新增 9 件——Toast/Toaster、Timeline、QualifyConclusionCard（四档状态 ok/miss/ask/no）、EvidenceCard、FeedbackBar、OpportunityCard、ApplicationTargetCard、MaterialList、Callout（ask/no/note/ok/grey 变体）；
- 减少大段说明、同权重卡片和重复免责声明，统一标题、标签页、空状态与加载骨架；
- 关注、保存资料、修改通知和学习设置后提供明确反馈（FeedbackBar / Callout(ok) / Toast）；
- **完整状态覆盖**：加载、空态、错误+重试、离线（`useOnlineStatus` hook + 离线 Callout/ErrorState）、无权限（401/403 → EmptyState + 去登录）、数据过期（materials `stale` / `newerVersion` → Callout(note)）、乐观锁冲突（VERSION_CONFLICT → Callout(no) + 重拉）、成功反馈，均有对应表达；
- 移动端保证主要按钮可见，长页面与底部导航保留安全间距；
- 匹配依据、官方来源、数据覆盖范围和“预筛不等于最终审核”的边界不因视觉简化而隐藏。

### 能力现状

| 能力 | 状态 |
|---|---|
| 两屏渐进式基础画像（地区意向三档 → 基础资格：最高学历、专业全称、毕业时间、教师资格状态）、访客 7 天恢复、返回修改重算 | ✅ demo 全程本机；invited 登录后幂等迁移到服务端 |
| 访客结果示例页（/preview）：虚构示例判断，明确标注不代表真实招聘；不引导关注，登录经独立入口；保存机会/开启提醒/设主要目标时触发登录 | ✅ |
| 全国教师公开招聘机会发现、报考单元、四值资格匹配（PASS/FAIL/UNKNOWN/MANUAL_REVIEW）与四档总结果 | ✅ demo 由前端纯函数对虚构示例计算；invited 由后端 matching 引擎计算；缺失信息永不判不符合 |
| 机会详情三层（结论与下一步 / 逐项资格核对 / 官方依据与版本）、关注与报名推进（考虑中/准备报名/已报名/放弃/结束） | ✅ |
| 主要/备选目标、设主目标二次确认、主要目标同步到备考 | ✅ |
| 受邀试用旅程：真实监测范围（杭州、宁波官方批次）与虚构试用机会分区提示；无真实匹配时用虚构示例引导走完「报考信息 → 判断保存 → 材料日程」全程 | ✅ invited 线上运行（`DatasetScopeNotice` / `TrialJourneyGuide`）；demo 同样展示虚构示例标识 |
| 关注机会跟进字段：每项材料状态、官方咨询记录、乐观锁版本（防并发覆盖） | ✅ 前端领域规则 + 后端正式迁移 `20261010174000_follow_progress_tracking`，迁移覆盖测试锁定 |
| 报名与考试时间线、站内提醒（业务唯一键去重、时间待定显示“待官方通知”） | ✅ demo 本机示例日程（不发送提醒）；invited 走后端 schedule 模块 |
| 备考页：考情核对门禁 → 资料/基线/诊断 → 7 天计划 → 今日一项任务 → 点选反馈 → 动态重排/周复盘 | ✅ 复用 v5.2 PlanEngine/ReplanEngine 纯函数，门禁改为“主要目标 + 考情已核对” |
| 公告流水线：提交来源 → 快照留档（SHA-256）→ 确定性解析提取 → 候选待审核 → 人工审核 → 不可变版本发布 | ✅ 后端模块；当前解析器为确定性规则（❌ 未接真实 AI/OCR）；快照存服务端本地卷 `.data/snapshots`（❌ 未接对象存储）；提交方式为 URL + 粘贴正文（❌ 无二进制附件上传） |
| 运营后台：指标看板（含 P0 漏斗）、考情审核、公告流水线、资源管理、纠错队列 | ✅ demo 本地数据；invited 走服务端角色校验；公开演示环境 `/admin` 整体关闭 |
| 用户纠错、结论撤回留痕、通知偏好、数据删除申请 | ✅ demo；invited 服务端接口部分覆盖（❌ 真实删除流程未全链路验证） |
| 用户端产品化体验：结论优先、唯一主行动、渐进展开、统一空态/加载态、保存与开关反馈、移动端适配 | ✅ 2026-10-10 v7 视觉系统（温暖米白+深海军蓝）落地，9 件 v7 组件 + 完整状态覆盖（离线/无权限/数据过期/冲突）覆盖主要用户页面 |
| 分析指标：27 事件（含 8 个 P0 漏斗事件）、seed/live 分流、访客暂存迁移、P0 9 阶段漏斗与 7 日有效推进率 | ✅ 模块 9 口径，见下文“分析与指标” |
| 运行时网络基线：CSP 同源、外部依赖扫描与守卫、断跨源核心操作回归 | ✅ 代码侧 + 真实网络实测：2026-10-05 中国移动家庭宽带与手机蜂窝无代理冒烟通过（[`docs/china-network-accessibility.md`](./docs/china-network-accessibility.md) 第 6.3 节）；受邀域名 [kbzs.al.qich.top](https://kbzs.al.qich.top) 已 HTTPS 可访问（2026-10-11 健康检查通过），家庭/蜂窝网络的正式冒烟记录待补 |
| 单元/领域测试 | ✅ 前端 Vitest 36 文件 319 用例 + 后端 Vitest 22 文件 258 用例（2026-10-12 本机复测），含网络基线守卫、模块 9 高风险回归、迁移覆盖测试与 M10 isGuest 回归 |
| 真实短信/微信/邮件/Web Push、自动全国爬虫、对象存储、真实 AI/OCR | ❌ 本轮明确不做/未接入 |

### 技术栈

- Next.js 16.3.8（App Router）+ React 19.2.8 + TypeScript 5（strict）+ Tailwind CSS 4
- demo 数据：localStorage（`kb_*` 键），服务层 + `useSyncExternalStore` 订阅；invited 数据：NestJS 同源 API
- 测试：Vitest 3 + jsdom；浏览器端到端脚本：Playwright（`.qa-harness/`，独立 `package.json`）
- 后端：NestJS 12 + Prisma 6 + PostgreSQL（18 个模型、9 个迁移），详见 [`backend/README.md`](./backend/README.md)
- 线上部署：GitHub Actions 构建 GHCR 镜像（前端镜像固定 invited 模式）→ 阿里云 Docker Compose + Caddy 自动 HTTPS（配置在 [`deploy/`](./deploy/)）
- 浏览器只调用同源 `/api/*`（[`src/app/api/[...path]/route.ts`](./src/app/api/%5B...path%5D/route.ts) 服务端反代，注入 `x-internal-token`）；CSP `default-src/connect-src 'self'`，配置在 [`next.config.ts`](./next.config.ts)

### 快速开始

```bash
npm ci
npm run dev        # http://localhost:3000（demo 模式）
```

质量检查：

```bash
npm test                 # Vitest 全量：319 个通过（36 个测试文件，2026-10-12）
npm run check:external   # 扫描源码与构建产物的运行时外部依赖（postbuild 自动执行）
npx tsc --noEmit         # 类型检查
npm run lint             # ESLint
npm run build            # 生产构建（构建后自动外部依赖扫描）
```

浏览器端到端脚本（demo 只需启动 frontend；invited 需 backend + PostgreSQL）：

```bash
cd .qa-harness
npm install
# 注意：demo 侧脚本需前端以公开演示配置启动（NEXT_PUBLIC_APP_ENV=demo NEXT_PUBLIC_DEMO_MODE=true npm run dev），
# 否则 /admin 关闭检查等演示环境专属断言不适用于本机默认开发配置
node m9-p0-flow.mjs                # demo P0 闭环：访客画像→登录→关注→日程→主目标→开始任务（2026-10-12 本机 25/25，v7.1 口径）
node m9-blocked-runtime.mjs        # 阻断全部跨源请求后，用户侧核心页面核心操作仍可用（7/7，v7.1 口径）
node m9-blocked-runtime.mjs admin  # 管理侧：需非 demo 构建的 frontend（demo 构建按设计关闭 /admin）；2/2
node m9-public-safety.mjs          # 公开演示安全冒烟：API 代理关闭 + /admin 关闭（2/2）
node m9-invited-flow.mjs      # 受邀链路：backend 以 AUTH_MODE=invited + PG，frontend 以 NEXT_PUBLIC_AUTH_MODE=invited，库内种子账号见脚本头注释（已更新为 v7.1 口径，本机未复跑，需在受邀环境验证）
QA_FORCE_DIRECT=1 node m9-cn-smoke.mjs  # 无代理真实网络冒烟：出口归属 + 政府站直连 + 零跨源核心链路（2026-10-12 中国移动直连 5/5）
```

后端联调（invited 模式）：

```bash
cd backend
npm install
# 准备 PostgreSQL 并配置 DATABASE_URL（见 backend/.env.example）
npx prisma migrate deploy
npm run start:dev
# 前端以 NEXT_PUBLIC_AUTH_MODE=invited 启动；健康检查 GET /api/health
```

### 演示账号

演示登录为**本地明文比对内置账号，不是真实身份认证**（仅 demo 模式）。密码均为 `demo1234`，登录页有一键填充；会话 7 天有效，刷新自动恢复。invited 模式的账号由管理员在服务端预建，密码哈希存储，会话为 HttpOnly cookie。

| 账号 | 角色 | 权限 |
|---|---|---|
| `student@demo.app` | 备考用户 | 用户端全部功能，禁入后台 |
| `exam@demo.app` | 考情审核员 | 可审核全部考情字段 |
| `resource@demo.app` | 资源审核员 | 资源管理可写，考情仅低影响字段 |
| `admin@demo.app` | 管理员 | 全部权限 |

### 当前路由与页面分工

| 路由 | 说明 |
|---|---|
| `/` | 价值首页；登录用户默认进机会页 |
| `/learn` | 30 秒三步说明：公告难点、逐项核对方式与预筛边界 |
| `/onboarding` | 两屏基础画像：地区意向（只考虑/优先考虑/也可以考虑三档）→ 基础资格（学历、专业、毕业时间、教资状态）；访客可用，第二屏可「暂不提供」，答案可返回修改 |
| `/preview` | 访客结果示例：虚构示例判断 + 真实监测事实，明确标注不代表真实招聘；不引导关注，登录经独立入口 |
| `/login` | demo 演示登录 / invited 服务端登录；支持 `?next=`；访客画像与暂存事件登录后迁移 |
| `/opportunities` | 机会列表：优先机会、其他初步符合、补问/人工确认/不符合二级分组；真实监测范围与虚构试用机会分区提示；受邀用户显示「完整体验指引」 |
| `/opportunities/[unitId]` | 机会详情三层：结论与下一步、逐项资格核对、官方依据与版本；关注/推进/设主目标/补充资格 |
| `/applications` | 报考中心：主目标工作区 + 报名倒计时 + 材料完成度 + 官方报名入口（只跳验证过的地址）+ 状态历史 Timeline + 全部报考目标 |
| `/schedule` | 关注机会报名与考试时间线、下一件不能错过的事 |
| `/study` | 备考：主要目标门禁、考情核对门禁、7 天计划、今日一项任务、反馈与重排 |
| `/me` | 登录后的个人中心：画像结论、资料、备考、通知、设置与纠错入口 |
| `/materials` | 资料准备结论、资料清单、准备情况、使用建议与补充资源 |
| `/settings` | 高频学习设置前置；通知、账号、隐私按需展开；危险操作独立分区 |
| `/admin`、`/admin/reviews`、`/admin/pipeline`、`/admin/exams`、`/admin/resources`、`/admin/feedback`、`/admin/corrections`、`/admin/trial` | 运营后台（仅工作人员角色；公开演示环境整体关闭） |

已删除的 v5.2 旧路由 `/exam`、`/today`、`/plan` 由 [`src/proxy.ts`](./src/proxy.ts) 307 跳转到 `/opportunities`、`/study`（保留查询参数）；映射表与 [`src/lib/ia/nav.ts`](./src/lib/ia/nav.ts) 的 `LEGACY_ROUTE_REDIRECTS` 锁定一致，`src/proxy.test.ts` 覆盖。

### 主要领域模块

- `src/lib/guest/`：访客会话（7 天 TTL）、两屏画像草稿与结果示例引擎、登录幂等迁移
- `src/lib/profile/`：画像聚合（访客草稿 + 账户画像）
- `src/lib/opportunities/`、`src/lib/matching/`：报考单元、四值匹配规则、列表/详情视图、关注操作
- `src/lib/schedule/`：时间线与提醒视图
- `src/lib/goals/`：主要/备选目标
- `src/lib/announcements/`：公告与报考单元 seed、版本视图（新领域只读分域 seed：`src/lib/seed/`）
- `src/lib/plans/`：PlanEngine / ReplanEngine、反馈服务（v5.2 保留，门禁后移到主要目标之后）
- `src/lib/materials/`、`src/lib/resources/`：资料诊断与资源缺口匹配规则层
- `src/lib/governance/`：纠错、撤回留痕、通知偏好、隐私删除
- `src/lib/analytics/`：27 事件字典与指标纯函数；seed/live 分流；详见下节
- `src/lib/auth/`：`AuthService` 接口 + `DemoAuthProvider` / `HttpAuthProvider`，`instance.ts` 按 `NEXT_PUBLIC_AUTH_MODE` 切换
- `src/lib/useOnlineStatus.ts`：网络在线状态监听（`navigator.onLine` + online/offline 事件）与 401/403 鉴权错误识别，供页面离线/无权限状态分支复用
- `src/components/ui/`：v7 组件库（token 见 `src/app/globals.css`）：Button / Card / Input / Badge / Loading / Skeleton / EmptyState / ErrorState / Modal / Tabs / Progress / Switch / TaskCard / Disclosure / Drawer / StatusMessage + v7 新增 Toast / Timeline / QualifyConclusionCard / EvidenceCard / FeedbackBar / OpportunityCard / ApplicationTargetCard / MaterialList / Callout，统一从 `index.ts` 导出

### 分析与指标（模块 9 口径）

- **P0 漏斗 9 阶段**（指标 id `p0_funnel`）：基础画像完成 → 获得至少一个有效机会 → 查看匹配依据 → 关注机会 → 补充资格信息 → 标记准备报名/已报名 → 设为主要目标 → 开始第一项学习任务 → 7 日内有效推进。
- **8 个漏斗事件**：`profile_completed`、`opportunity_revealed`、`match_basis_viewed`、`opportunity_followed`、`qualification_supplemented`、`follow_status_changed`、`primary_target_set`、`task_started`；第 9 阶段是派生指标（`meaningful_progress_7d`：画像完成 7×24h 内出现开始任务/反馈/确认计划/报名推进/设主目标 的去重用户占比），不新增事件。
- **seed/live 分离**：每个事件带 `source: "seed" | "live"`；seed 演示事件只由 `eventService` 的 seed 构建器产生。访客未登录时触发的事件进入 `kb_guest_analytics_pending` 暂存队列，登录成功后归属为该账号的 live 事件（保留原始时间），随后清空队列；`trackOncePerUser` 在“暂存 + 已落库”范围内去重。
- 埋点只记事实与维度数量（如补充了几个资格维度），不记录资格答案原文。

### 关键架构约定（继续生效）

- 认证逻辑、用户状态、UI 三层分离；页面一律经 `useCurrentUser()` 取用户，路由保护用 `RequireAuth` / 角色判断。
- 领域规则集中在各模块 `domain.ts` 纯函数，页面只做展示与交互。
- 未填信息永不判“不符合”；已截止不显示“正在报名”；无官方来源不进主要推荐；AI 未审核结论永不标记“已从官方公告核对”；公告新版本只追加不覆盖旧版本；同一提醒不重复生成。
- 正式（非 demo）状态不得静默回退到 Mock；演示数据必须明确标识。

---

## 二、当前产品主线与边界

当前对用户重点验证的主线：

```text
机会发现 → 可解释资格匹配 → 关注与报名推进 → 不错过关键节点
```

当用户已经选择主要目标后，再进入次级备考闭环：

```text
主要目标 → 核对考情 → 整理资料与准备情况 → 今日一项任务 → 反馈调整
```

用户端主导航只保留三个入口：

| 导航 | 回答的问题 | 主要内容 |
|---|---|---|
| 机会（`/opportunities`） | 现在有哪些值得我关注？ | 匹配结果、需补充的机会、机会详情 |
| 日程（`/schedule`） | 接下来不能错过什么？ | 报名、审核、缴费、准考证、考试、结果节点 |
| 我的（`/me`） | 我的条件、资料和设置目前是什么状态？ | 画像结论、资料、备考入口、通知、设置与纠错 |

备考、资料和设置是次级页面，不占用主导航。首次使用为**两屏基础画像**（v7.1 M2：地区意向 → 基础资格），第一屏采集可接受地区及「只考虑 / 优先考虑 / 也可以考虑」三档考虑程度，第二屏只采集最高学历、专业全称、毕业时间、教师资格状态；**未登录可看初步匹配结果，保存机会 / 开启提醒 / 设主要目标时才要求登录**。年龄、户籍、社保、就业状态、工作经历与用工形式偏好不进基础画像，仅在具体机会需要时按需补问。

资格匹配支持四种结果：**初步符合 / 补充信息后判断 / 建议人工确认 / 明确不符合**；缺失信息永远不能被判定为不符合。公告事实、机器提取候选、人工审核结论分开存储与呈现，机器候选不进主推荐。

**仍未实现 / 不在本轮**：真实 AI/OCR 提取与附件二进制上传、对象存储、真实推送渠道、自动全国采集、多学科（当前仅语文）、多目标时间分配（PRD P1）、真实删除流程的服务端全链路。路由、领域对象的新旧对应与各模块处置见 [`docs/v6.1-migration-plan.md`](./docs/v6.1-migration-plan.md)。

---

## 三、线上环境

### 3.1 受邀试用环境（当前主用，承接 10 人真实试用）

**[https://kbzs.al.qich.top](https://kbzs.al.qich.top)** — 2026-10-11 已上线，本批用户访谈与行为验证均在此环境进行。

- 环境标识 `NEXT_PUBLIC_APP_ENV=invited`、`NEXT_PUBLIC_AUTH_MODE=invited`；前端经同源 `/api/*` 访问 NestJS + PostgreSQL，已实测 `GET /api/health → {"status":"ok","db":"up"}`；任何模式失败不回退 Mock。
- **账号管理员预建**（密码哈希 + HttpOnly 会话 cookie），登录页明示「仅限受邀测试用户，不开放公开注册」，不提供演示账号与一键填充；访客本机画像在登录后幂等迁移到受邀账号。
- 数据为服务端持久化；当前**真实官方监测范围为杭州、宁波**的教师招聘批次，其余机会是明确分区标注的虚构试用示例，不可用于真实报名。
- `robots.txt` 全站 Disallow；`/admin` 不对公众开放。
- 部署形态：GitHub Actions 构建 GHCR 镜像（前端镜像固定 invited 模式）→ 阿里云服务器 Docker Compose + Caddy 自动 HTTPS；操作手册见 [`deploy/README.md`](./deploy/README.md)，前置条件与合规要求见 [DEPLOYMENT.md](./DEPLOYMENT.md) 第 12–15 节。
- **当前边界**：研究验证用轻量部署，不承诺高可用与数据备份频次；页脚暂未展示 ICP 备案号，隐私政策/用户协议等合规文件需在扩大试用前补齐；家庭宽带与手机蜂窝的正式无代理冒烟记录待补（[`docs/china-network-accessibility.md`](./docs/china-network-accessibility.md) 第 6.3 节）。

### 3.2 公开演示环境（仅功能展示）

**https://frontend-exam-test.vercel.app**

- 环境标识 `NEXT_PUBLIC_APP_ENV=demo`、`NEXT_PUBLIC_DEMO_MODE=true`；
- 所有输入仅保存在访客本机浏览器，不上传服务器；页面顶部有固定提示横幅；
- `/admin` 在演示环境整体关闭；`robots` 为 `noindex,nofollow`；
- 该部署位于 Vercel（境外平台），中国大陆普通网络的可达性与速度没有保障，**仅用于功能展示与评审，不是受邀用户的试用环境，也不得用于承接真实用户**。

---

*本 README 于 2026-10-12 按当前仓库与线上受邀环境重新核对：用户端采用"机会 / 日程 / 我的"信息架构，首访画像为 v7.1 两屏流程（地区意向 → 基础资格），首页仅保留单一主按钮「开始资格预筛」，备考作为主要目标后的次级闭环；主要页面完成 v7 视觉系统（温暖米白 + 深海军蓝 + 9 件新组件）与完整状态覆盖（加载/空态/错误+重试/离线/无权限/数据过期/冲突/成功反馈）。Vitest 前端 36 文件 319 用例 + 后端 22 文件 258 用例全部通过，类型检查与 ESLint 通过，生产构建与外部依赖扫描 0 阻断。v7.1 M0—M10 迭代完成，M10 修复 demo 模式详情页 isGuest 误判缺陷并补回归测试；E2E `m9-p0-flow` 25/25、`m9-blocked-runtime` 7/7、`m9-public-safety` 2/2、`m9-cn-smoke` 5/5（中国移动直连）。2026-10-11 受邀环境 [kbzs.al.qich.top](https://kbzs.al.qich.top) 已上线并补齐真实/虚构机会分区、试用旅程指引与跟进字段迁移。仍待办：受邀站 ICP 备案与合规文件、家庭/蜂窝网络冒烟记录、`m9-invited-flow.mjs` 已更新为 v7.1 口径但需在受邀环境复跑。未实现能力继续标注 ❌/🚧，不得移入"已实现"。*
