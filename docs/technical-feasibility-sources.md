# 《全国教师公开招聘与备考助手 v6.1》技术可行性与技术选型：官方资料研究笔记

> 历史技术/实施记录：保留当时的设计与验证语境，不作为当前需求基线。其中的阶段、章节号和未实现描述仅对应原时间；当前产品要求统一见 [PRD](../PRD.md)，架构与启动见 [README](../README.md)。旧 PRD 可从 Git 历史追溯。

研究日期：2026-10-04  
历史研究对象：已移除的 v6.1 PRD；当前需求见 [PRD](../PRD.md)。
资料范围：法律法规原文、IETF 标准、框架/数据库/云服务官方文档。本文是技术与产品合规研究，不替代律师、属地通信管理局或网信部门的正式意见。

## 1. 结论先行

1. **技术上可行，整体难度中高。** 做页面、账号、收藏、日程并不难；最难的是把全国各地格式不一、不断修订的公告与岗位附件，持续变成“有原文证据、能解释、可回滚、经得住纠错”的结构化数据。技术能力都已有成熟方案，真正的壁垒是数据工程、规则运营和人工质检流程。
2. **不建议重写现有技术栈。** 仓库已经采用 Next.js 16、React 19、NestJS 12、Prisma 6。Next.js 和 Nuxt 都能做 SSR/混合渲染与中国大陆自托管，但切换 Nuxt 只会带来 Vue 重写成本，不产生用户价值。Next.js 官方已有 PWA、Web Push、Docker 和自托管指南，继续使用更适合本项目。
3. **资格匹配必须“规则优先、AI 辅助”。** 学历、专业、教师资格、年龄、户籍、报名时间等硬条件应进入结构化字段和版本化规则；大模型可辅助提取、解释和生成备考计划，但不能直接把一段公告“读完后拍脑袋判定能报”。所有高影响字段必须保留公告页、附件、页码/工作表/单元格位置和人工核验状态。
4. **首版无需微服务、Kubernetes、Kafka 或独立 Elasticsearch 集群。** 一个模块化 NestJS 后端，配 PostgreSQL、OSS、Redis/BullMQ 和独立 Worker 就足够。数据量、搜索复杂度和团队规模达到阈值后，再引入 OpenSearch、CloudFlow/Temporal 或容器编排。
5. **建议部署在中国大陆云地域，并尽量让用户画像、日志、OCR、LLM 调用都留在境内链路。** 这能降低访问时延，也避免过早进入个人信息出境合规。云厂商应通过接口层隔离，避免把业务规则绑定到某一家。
6. **合规不是上线前补一份隐私政策，而是产品功能。** 画像最小化、字段用途说明、自动化决策解释、非个性化入口、关闭推荐、用户标签删除、账号注销、数据删除、投诉纠错、AI 内容标识、供应商委托处理协议，都应进入需求和验收标准。
7. **“公开网页”不等于“可以无限抓取或任意再发布”。** 抓取器必须按站点检查 robots.txt 与使用规则，低频访问，遵守 429/Retry-After，不绕过验证码/登录/反爬，并优先使用站点提供的公开数据接口、信息公开目录、附件或 sitemap。大规模抓取、再分发和疑似新闻信息转载应在正式上线前做专项法律审查。

## 2. 对 PRD 的技术拆解与难度

| 模块 | 可行性 | 难度 | 真正难点 |
|---|---|---:|---|
| 手机端 Web/PWA、画像、收藏、日程 | 高 | 中 | 移动端体验、弱网、状态一致性、PWA 通知权限 |
| 官方公告发现与抓取 | 高 | 高 | 站点差异、访问边界、频控、附件失效、补充公告关联 |
| PDF/Excel/图片解析 | 高 | 高 | 合并单元格、跨页表格、扫描件、旧版 XLS、字段命名差异 |
| 资格匹配 | 高 | 高 | 地方规则语义差异、专业目录、应届定义、证据链、规则版本 |
| 变化检测与通知 | 高 | 中高 | 去重、误报、补充公告影响范围、重复发送、截止时间准确性 |
| 备考计划与 AI 解释 | 高 | 中 | 有依据生成、幻觉防护、引用、AI 标识、内容安全 |
| 全国扩张 | 可分阶段实现 | 很高 | 不是服务器容量问题，而是每个来源与规则的运营成本 |

**工程判断：** 若限定 3–5 个代表性地区、只做语文学科、保留人工审核，首版可控；若一开始就承诺“全国完整、自动解析、自动判定且零高影响错误”，风险极高。PRD 中“逐步开放覆盖、未覆盖不等于没有招聘”是正确的技术边界。

## 3. 推荐的总体架构

```text
手机 Web / PWA（Next.js）
          |
          v
业务 API（NestJS，模块化单体）
  |       |         |               |
  v       v         v               v
PostgreSQL  OSS   Redis/BullMQ   LLM/RAG 适配层
事实/规则   原件   抓取/解析/提醒   仅辅助解释与备考
  ^                   |
  |                   v
审核后台 <--- 解析/OCR/规则 Worker
  |
  v
经核验的数据版本 -> 匹配 -> 日程/提醒 -> 用户反馈
```

建议把系统先做成**模块化单体 + 独立后台 Worker**，而不是多个微服务：

- `source-registry`：官方来源登记、robots/条款、访问频率、覆盖状态；
- `crawler`：网页与附件获取、条件请求、限速、失败重试；
- `document`：原始文件、哈希、版本、文本层、页码/单元格定位；
- `recruitment`：公告、报考单元、补充公告、时间节点；
- `rule-engine`：结构化条件、规则版本、判断证据；
- `review`：人工审核、四眼复核、纠错与回滚；
- `profile`：最少画像、用途、同意、删除；
- `matching`：排除、待补充、人工确认、排序；
- `timeline/notification`：事件、偏好、发送幂等与回执；
- `study-plan`：目标、诊断、计划与反馈；
- `ai-gateway`：模型供应商隔离、提示词版本、脱敏、引用与审计。

## 4. 技术选型及“为什么选它而不是其他方案”

### 4.1 前端：继续 Next.js，做响应式 Web + PWA

**推荐：Next.js App Router + React + TypeScript，先做 PWA，不立即做原生 App。**

理由：

- 项目已经是 Next.js/React，继续开发没有迁移损耗。
- Next.js 官方 PWA 指南覆盖 manifest、Service Worker、Web Push、安装到主屏幕和安全头；一套代码即可覆盖桌面和手机。[Next.js PWA 官方指南](https://nextjs.org/docs/app/guides/progressive-web-apps)
- Next.js 可作为 Node 服务或 Docker 容器自托管，Docker 部署支持完整功能，不依赖某个海外托管平台。[Next.js 部署方式](https://nextjs.org/docs/app/getting-started/deploying)；[Next.js 自托管指南](https://nextjs.org/docs/app/guides/self-hosting)
- 招聘公告详情需要公开链接、首屏快、可被搜索引擎理解；SSR/服务端渲染比纯 SPA 更合适。

为什么此时不选 Nuxt：

- Nuxt 同样支持默认 SSR、静态生成、客户端渲染与混合渲染，技术能力足够。[Nuxt 官方介绍](https://nuxt.com/docs/4.x/getting-started/introduction)；[Nuxt 部署方式](https://nuxt.com/docs/3.x/getting-started/deployment)
- 但当前团队已有 React/Next 代码，换成 Nuxt 等于重写界面和组件；两者能力差距不足以抵消迁移成本。因此这不是“Next 绝对优于 Nuxt”，而是**在本项目现状下更优**。

为什么先不做 iOS/Android 原生：

- 当前验证重点是数据可信、匹配与推进闭环，而不是设备能力；原生会增加双端开发、商店审核和版本发布成本。
- PWA 可安装和推送，但 Web Push 不应成为唯一提醒渠道：Next.js 官方文档明确，iOS 需 16.4+ 且应用先安装到主屏幕；还需用户授权通知。[Next.js PWA Web Push 限制](https://nextjs.org/docs/app/guides/progressive-web-apps)
- 当真实用户证明“微信入口/原生通知”对转化至关重要后，再评估小程序或原生壳。

### 4.2 后端：保留 NestJS，不把所有逻辑塞进 Next.js

**推荐：NestJS 模块化单体 + 一个或多个 Worker 进程。**

理由：

- NestJS 面向可测试、可扩展、松耦合的 Node.js 服务端应用，适合把抓取、文档、规则、审核、通知拆成清晰模块。[NestJS 官方概览](https://docs.nestjs.com/recipes/documentation)
- 本项目有大量异步、重试、定时、审计和人工审核任务，独立后端比只用前端框架的 API 路由更清楚。
- Next.js 官方把自身后端能力定位为 Backend for Frontend，并明确说明它不是完整后端替代品。[Next.js Backend for Frontend 指南](https://nextjs.org/docs/app/guides/backend-for-frontend)

为什么不立即微服务化：

- 首版团队与流量尚小，微服务会新增服务发现、分布式追踪、部署、数据一致性和故障排查成本。
- 先在代码层保持模块边界，把耗时任务放到 Worker；当某个模块出现独立扩容、语言或合规需求时再拆服务。

### 4.3 主数据库：PostgreSQL + Prisma

**推荐：PostgreSQL 作为唯一事实库；Prisma 延续现有数据访问与迁移。**

理由：

- 公告、报考单元、附件、条件、规则、用户、关注、事件和审核记录之间关系明确，需要事务、外键、唯一约束和审计；关系数据库比文档库更合适。
- PostgreSQL 的 `jsonb` 可为各地差异字段保留弹性，并支持索引；不是要求一开始把所有地方字段都硬编码。[PostgreSQL JSON/JSONB](https://www.postgresql.org/docs/16/datatype-json.html)
- B-tree 适合地区、状态、时间、学科等精确和范围筛选；`pg_trgm` 可做名称相似、错别字和模糊匹配。[PostgreSQL 索引类型](https://www.postgresql.org/docs/current/indexes-types.html)；[`pg_trgm` 官方文档](https://www.postgresql.org/docs/current/pgtrgm.html)
- Prisma 6 已在项目中，并官方支持 PostgreSQL 的关系、JSON 等能力。[Prisma 支持数据库](https://docs.prisma.io/docs/orm/core-concepts/supported-databases)；[Prisma PostgreSQL 连接器](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)

为什么不首选 MongoDB：

- 地方原始字段看似适合 JSON，但用户匹配、补充公告影响分析、时间冲突、版本与审计需要大量关联和事务。PostgreSQL 已能用 `jsonb` 处理“不完全统一”的字段，无需牺牲关系约束。

为什么 PostgreSQL 比 MySQL 更适合本项目：

- 两者都能完成核心业务；PostgreSQL 的 `jsonb`、多种索引、`pg_trgm`、全文检索与向量扩展让“结构化筛选 + 模糊检索 + 小规模 RAG”能在一个数据库中起步，减少早期组件数量。

数据建模上必须区分：

- `source_snapshot`：每次获取的原始网页/文件和哈希；
- `announcement_version`：公告版本；
- `exam_unit_version`：报考单元版本；
- `field_evidence`：字段值对应的来源、页码、工作表、单元格/文本片段；
- `rule_version`：判断规则和生效范围；
- `review_decision`：谁在何时确认/驳回什么；
- `match_result`：基于哪一版画像、公告和规则得出的结果。

不要原地覆盖高影响字段；应新增版本并计算受影响用户。

### 4.4 原件与附件：对象存储，不放本地磁盘或数据库大字段

**推荐：OSS（或同类中国大陆对象存储）保存网页快照、PDF、Excel、解析产物和导出文件；PostgreSQL 只保存元数据、哈希、证据定位和权限。**

理由：

- 对象存储适合任意类型文件，有 REST API、权限策略、生命周期、跨区域复制等能力。[阿里云 OSS 产品说明](https://help.aliyun.com/zh/oss/user-guide/what-is-oss)
- OSS 版本控制可保留覆盖/删除前的历史版本，符合公告追溯和误操作恢复需要。[OSS 版本控制](https://help.aliyun.com/zh/oss/user-guide/overview-78/)
- 本地磁盘不利于多实例、备份和容灾；把大附件放 PostgreSQL 会放大数据库备份和恢复成本。

实现要求：私有 Bucket、服务端加密、最小权限、短时签名 URL、文件类型与大小校验、恶意文件扫描、内容哈希、版本控制和生命周期策略。公开原文链接与内部归档副本应分开管理。

### 4.5 异步任务：BullMQ + Redis/Tair；复杂工作流后置

**推荐首版：BullMQ + 托管 Redis 兼容服务，承载抓取、解析、OCR、变化检测、批量匹配和提醒。**

理由：

- BullMQ 是基于 Redis 的 Node.js 队列，支持并行 Worker、延迟任务、计划任务、重试、崩溃恢复和父子依赖，适合现有 TypeScript/NestJS 栈。[BullMQ 官方能力](https://docs.bullmq.io/)
- NestJS 官方将队列用于削峰、避免阻塞事件循环、跨进程可靠处理，并支持新增消费者水平扩展。[NestJS Queue 指南](https://docs.nestjs.com/v6/techniques/queues)
- 阿里云 Tair 提供 Redis 协议兼容的托管服务，可减少自行维护 Redis 的工作。[Tair 产品说明](https://help.aliyun.com/zh/redis/)；[兼容客户端说明](https://help.aliyun.com/zh/redis/developer-reference/redis-clients)

必须接受的限制：

- BullMQ 最坏情况下可能至少投递一次，因此业务处理必须幂等。[BullMQ 官方语义](https://docs.bullmq.io/)
- 延迟任务不能保证在指定毫秒精确执行，忙时可能稍晚。[BullMQ Delayed Jobs](https://docs.bullmq.io/guide/jobs/delayed)
- 用稳定业务键作为 `jobId` 可防止未删除任务重复入队，但任务删除后不能只依赖队列去重。[BullMQ Job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- 官方建议把 Job 设计得原子、简单、可重试。[BullMQ 幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs)

因此，提醒的正确设计是：**PostgreSQL 中的提醒事件/发送记录是事实源，BullMQ 只是执行器**；数据库唯一键、Outbox、供应商请求幂等键和发送回执共同保证“不漏、不重”。

为什么不首选 Kafka/RocketMQ：

- 当前主要是后台作业，不是海量事件流和多消费者日志平台；消息流系统会增加运维与认知成本。

何时升级 CloudFlow/Temporal 类工作流：

- 一个流程跨数天、包含多人审核、等待外部回调、条件分支、补偿和可视化恢复时，再使用耐久工作流。阿里云 CloudFlow 官方定位就是将多步骤分布式任务编排为全托管工作流。[CloudFlow 产品说明](https://help.aliyun.com/zh/product/113549.html)

### 4.6 搜索：先 PostgreSQL，达到阈值再上 OpenSearch

**首版推荐：结构化筛选 + PostgreSQL B-tree/GIN/`pg_trgm`；不要先建设独立搜索集群。**

原因：

- 用户真正需要的是“地区、学科、学段、用工性质、截止时间、资格状态”的结构化过滤，不是对几百万篇文章做开放全文检索。
- PostgreSQL 自带全文检索与相关性排序，也支持索引；但中文分词效果需要额外验证，不能因为“有全文检索”就假定中文体验足够。[PostgreSQL 全文检索](https://www.postgresql.org/docs/15/textsearch-intro.html)
- `pg_trgm` 对机构名、专业名和岗位名的相似匹配很实用，且比增加一个搜索集群简单。

升级条件：公告/岗位规模显著扩大、中文分词/同义词/拼音召回成为核心、搜索延迟或排序效果无法满足时，再接 OpenSearch。阿里云 OpenSearch 提供结构化搜索、行业查询分析、文本/向量检索以及 RAG 组件；教育也是其行业版覆盖方向之一。[OpenSearch 产品与版本](https://help.aliyun.com/zh/open-search/)；[OpenSearch 选型](https://help.aliyun.com/zh/open-search/select-an-opensearch-edition)

为什么不一开始就用 Elasticsearch/OpenSearch：多一套索引同步、集群、监控和数据一致性；首轮 20–50 人试用很难证明这项复杂度必要。

### 4.7 HTML、PDF、Excel、OCR：分层解析，不押注单一“万能 AI”

推荐流水线：

1. HTML 先提取正文、标题、发布日期、附件链接；保留原始 HTML。
2. Excel 用 SheetJS 读取 XLSX、XLS、XLSB、CSV 等；保留工作表、原始行列、合并单元格与原始格式，不直接扁平化后丢失位置。[SheetJS 支持格式](https://docs.sheetjs.com/docs/miscellany/formats/)；[SheetJS 解析选项](https://docs.sheetjs.com/docs/api/parse-options/)
3. 带文字层 PDF 用 PDF.js 获取逐页文本、位置和样式；PDF.js 官方 API 的 `TextItem` 提供字符串、方向、变换矩阵、宽高和行尾信息。[PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
4. 扫描 PDF/图片再调用 OCR；表格优先用表格/文档结构化识别。阿里云 OCR 官方提供全文高精版、表格识别和文档结构化识别接口。[OCR API 能力](https://help.aliyun.com/zh/ocr/developer-reference/api-ocr-api-2021-07-07-overview)
5. 大模型只把已解析文本映射到候选字段，并返回证据位置、置信度和“不确定原因”。
6. 截止时间、招聘人数、专业、学历、身份、教师资格、用工性质、分配方式等高影响字段，在发布前进入人工审核队列。

为什么不全靠 OCR/LLM：

- PDF 可能已有可靠文字层，先 OCR 会增加费用并引入识别错误。
- Excel 是结构化数据，用通用大模型读取既慢又难保留单元格证据。
- OCR 和 LLM 输出都不是事实源；原始文件、确定性解析、规则校验和人工复核共同组成可信链路。

人工审核后台至少需要：原件与结构化字段并排、证据高亮、置信度、校验错误、同公告版本对比、审批人、审批时间、退回原因和一键回滚。

### 4.8 提醒：站内事件为主，Web Push 可选，关键节点用短信兜底

建议优先级：

1. 站内日程与事件中心：唯一事实来源；
2. Web Push：用户安装 PWA 并授权后使用；
3. 短信：只给用户明确订阅的高价值截止提醒或验证码；
4. 微信服务通知/小程序订阅消息：有明确用户需求后单独评估平台规则。

阿里云短信提供 API/SDK、签名、审核模板、通知短信与投递状态回执，适合作为关键提醒通道。[阿里云短信产品说明](https://help.aliyun.com/zh/sms/product-overview/what-is-alibaba-cloud-sms)；[短信新手接入与审核周期](https://help.aliyun.com/zh/sms/getting-started/get-started-with-sms/)

为什么不只用短信：有成本、签名/模板/实名报备周期，也不适合普通信息。为什么不只用 Web Push：依赖浏览器、权限和 iOS 主屏幕安装，触达不能保证。

提醒系统必须有：用户订阅记录、渠道偏好、静默时段、单机会关闭、事件版本、发送幂等键、供应商回执、失败重试、取消/变更通知，以及“没有变化不重复发送”。

### 4.9 LLM/RAG：用在解释与学习，不用作资格事实源

**推荐用途：**

- 从已解析文本生成“候选字段 + 证据”；
- 把结构化规则结果改写为通俗解释；
- 根据已核验考情和用户时间生成首周学习计划；
- 基于公告原文回答问题并给出引用。

**不推荐用途：**

- 直接决定“明确符合/不符合”；
- 猜测公告未说明的时间、专业范围或分配方式；
- 用向量相似度替代硬条件；
- 把用户姓名、手机号、完整画像直接放进提示词。

RAG 的标准链路是解析、切片、向量化、索引、检索、重排、生成。阿里云百炼官方说明 RAG 会先检索相关片段，再把片段和问题交给大模型生成有依据的回答，并支持展示来源。[百炼 RAG 核心概念](https://help.aliyun.com/zh/model-studio/rag/concepts)；[百炼知识库](https://help.aliyun.com/zh/model-studio/rag-knowledge-base)

首版可以：

- 直接用 PostgreSQL 存放文本切片和引用；需要语义检索时增加 `pgvector`。pgvector 支持精确与近似近邻、余弦/L2/内积和 HNSW/IVFFlat。[pgvector 官方项目](https://github.com/pgvector/pgvector)
- 数据和问答量增大后再切换到 OpenSearch/百炼知识库。阿里云 AI 搜索平台也提供文档解析、切片、向量化、文本/向量检索、排序和模型服务。[AI 搜索平台能力](https://help.aliyun.com/zh/open-search/search-platform/product-overview/introduction-to-search-platform)

模型调用应通过自建 `ai-gateway`：隐藏供应商差异、只传必要字段、提示词和模型版本留档、输出做结构校验、超时/失败可降级、关键输出有引用、用户可看到“AI 生成/辅助”。选择中国大陆可用地域和接口，供应商合同中核对数据用途、留存、训练、子处理者和跨境情况；不能仅因“云服务在国内可购买”就默认所有数据处理都在境内。

## 5. 中国大陆合规对产品设计的直接影响

### 5.1 个人信息：画像可以收，但必须最小化、讲清用途、可删除

《个人信息保护法》要求目的明确、范围最小、公开透明，自动化决策需透明、公平；对权益有重大影响的纯自动决定，个人有权要求说明并拒绝。敏感个人信息需特定目的、充分必要、严格保护和单独同意；自动化决策、委托处理、对外提供和出境等场景需事前开展个人信息保护影响评估。[个人信息保护法全文（中央网信办转载中国人大网）](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm?eqid=a4b2c80d0005b17000000003648d21ce)

对本产品的落地要求：

- 保持 PRD 的渐进式画像；年龄只收判断所需的最小形式，能存“是否满足某公告年龄线”时不必保存身份证号。
- 不采集身份证号、社保账号、证书原件等 P0 非必要数据。
- 在每个字段旁说明“为什么需要、影响哪些机会、保存多久”。
- 提供画像查看、修改、删除、撤回同意、注销账号和申诉入口。
- 资格结果展示命中规则、未确定项、证据来源和“最终以招聘单位审核为准”。
- 提供不使用个人画像的普通搜索/筛选入口，以及关闭个性化推荐的能力。
- 上线前对画像匹配、OCR/LLM 委托处理、提醒供应商和任何境外调用做个人信息保护影响评估并留档。

《网络数据安全管理条例》进一步要求隐私规则集中、醒目、清晰，列出目的、方式、种类、保存期限和用户权利；委托处理需合同约定并监督；安全措施包括加密、备份、访问控制和认证；自动化采集到不必要或未经同意的个人信息应删除或匿名化。[网络数据安全管理条例](https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm)

供应商边界：OCR、短信、云存储和 LLM 若处理个人信息，应纳入委托处理清单，约定目的、范围、期限、安全义务、返还/删除与再委托条件。尽量不把用户画像发送给 OCR/LLM；公告本身是公开数据，用户身份和公告检索可以分离。

### 5.2 自动匹配与排序：很可能落入算法推荐规范

《互联网信息服务算法推荐管理规定》把个性化推送、排序精选、检索过滤和调度决策都列入算法推荐技术；要求告知算法服务情况和基本原理，提供非个性化或关闭选项，允许选择/删除用户标签，并设置投诉申诉机制。只有“具有舆论属性或者社会动员能力”的提供者才触发该规定中的算法备案要求，不能把备案理解成所有排序算法一律备案。[算法推荐管理规定](https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm)

产品实现：

- 公开排序原则：地域偏好 → 资格确定性 → 用工性质；
- 让用户调整排序、关闭个性化、删除标签；
- 保存某次推荐使用的画像版本、规则版本和候选集；
- 高影响结论可申诉和人工复核；
- 正式上线前根据业务形态、内容类别、规模和社会动员能力向专业机构核验是否需算法备案/安全评估。

### 5.3 生成式 AI：面向公众生成解释或计划时，应按“服务提供者”风险设计

《生成式人工智能服务管理暂行办法》适用于面向中国境内公众提供生成式 AI 服务；“提供者”包括利用生成式 AI 技术向用户提供服务的组织/个人，也包括 API 服务。其要求包括合法数据/模型来源、个人信息保护、用户协议、适用场景说明、输入和使用记录保护、投诉举报，以及特定情形下的安全评估和算法备案。[生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)

《人工智能生成合成内容标识办法》自 2025-09-01 施行，生成合成内容包括文本；适用的服务提供者需要按场景添加显式/隐式标识，并在用户协议说明标识方法。文本可在起始、末尾、中间或交互界面周边加显著提示；下载、复制、导出时也需考虑标识。[AI 生成合成内容标识办法](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)

产品实现：

- 学习计划、AI 解释、AI 摘要界面显示“AI 生成/AI 辅助，依据如下”；
- 事实字段仍显示官方原文和人工核验状态，避免把 AI 文本伪装成官方结论；
- 导出的计划/解释保留显式标识；涉及文件导出时按强制标准核验隐式标识要求；
- 建立模型输出抽检、违法/不良内容处置、投诉纠错和提示词/模型版本审计；
- 上线前对具体功能是否触发生成式 AI 备案/安全评估做正式核验，不能仅依赖基础模型厂商已经备案这一事实。

### 5.4 网络与数据安全：从首版就保留安全与审计能力

现行《网络安全法》（2025 修正，2026-01-01 起施行）要求网络安全等级保护、内部制度、网络安全负责人、攻击防护、日志留存、数据分类、备份和加密，并规定网络日志按要求留存不少于六个月。[网络安全法（2025 修正）](https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm)

首版最低要求：

- 生产、测试、开发数据隔离；
- 账号分权、管理员 MFA、最小权限、密钥托管与定期轮换；
- 传输 TLS、数据库/对象存储加密、备份恢复演练；
- 高影响字段、规则、审核、导出、删除均记录审计日志；
- 漏洞修复、事件响应和用户/主管部门通知预案；
- 与专业机构核验等保定级、备案与测评要求，避免到临上线才补架构。

### 5.5 网站备案、经营许可与内容边界

《互联网信息服务管理办法》规定：非经营性互联网信息服务实行备案，经营性互联网信息服务实行许可；网站首页需标明许可或备案编号。该办法还提到依法需要前置审核的新闻、出版、教育等服务。[互联网信息服务管理办法](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_483f0dd8eb1b4dc5961e4e008bd4a083.html)

因此：

- 中国大陆服务器公开上线前准备 ICP 备案；若有付费会员、广告、课程等经营模式，正式确认是否需要增值电信业务许可。
- “教师招聘工具/备考助手”是否属于需前置审批的“教育互联网信息服务”，不能仅凭名称判断，应向属地主管部门核验具体业务。
- 若产品扩展为新闻采编、转载或传播平台，《互联网新闻信息服务管理规定》对新闻信息服务有许可要求；该规定将政治、经济、军事、外交等社会公共事务报道评论及社会突发事件报道评论定义为新闻信息。[互联网新闻信息服务管理规定](https://www.cac.gov.cn/2017-05/02/c_1120902760.htm)
- 首版应聚焦官方招聘事实、结构化字段和原文链接，不做时政新闻编辑，不把未经核验的二手内容作为来源。

## 6. 官方政府站点抓取、频控、变化检测与人工核验原则

### 6.1 规范底线

- **遵守 robots.txt。** RFC 9309 要求成功获取 robots.txt 后遵循可解析规则，同时明确 robots 不是访问授权机制。[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)
- **不干扰站点。** 《网络数据安全管理条例》第十八条要求使用自动化工具访问、收集网络数据时评估对网络服务的影响，不得非法侵入或干扰正常运行。[网络数据安全管理条例](https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm)
- **尊重限流。** HTTP 429 表示请求过多，响应可以用 `Retry-After` 指示等待时间；抓取器应停止并按该值或更长时间退避。[RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html)
- **使用条件请求。** 保存 `ETag`/`Last-Modified`，再次抓取时用 `If-None-Match`/`If-Modified-Since`；服务器可返回 304，减少带宽和站点压力。[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
- **公开不等于任意利用。** 政府信息公开条例要求通过政府网站等公开并提供检索、查阅和下载，但不构成对高频抓取、绕过技术措施或任意再发布的普遍许可。[政府信息公开条例](https://www.moe.gov.cn/jyb_xxgk/moe_1777/moe_1778/202007/t20200731_476017.html)

### 6.2 推荐的抓取器行为

为每个主机建立 `source_policy`：

- 官方主体、主机名、栏目、允许路径、禁止路径；
- robots 获取时间和规则版本；
- 使用条款/版权声明链接与人工审批人；
- 请求间隔、并发上限、允许时段；
- 是否有 API、RSS、sitemap、信息公开目录或附件列表；
- 联系方式、异常记录、暂停开关；
- 是否允许归档、全文展示或只保留事实字段和原文链接。

建议默认策略（工程保守值，不是法律规定）：单主机低并发（通常 1）、请求间隔加入抖动、夜间也不突发扫描、429 严格等待、5xx 指数退避、验证码/登录/封禁出现即停止，不轮换 IP 绕过限制。用清楚的 User-Agent 标识产品和联系邮箱。

优先级应为：官方开放 API/数据下载 > sitemap/RSS/信息公开目录 > 官方栏目增量页 > 详情页与附件。大规模接入某站点前，优先联系网站运营方或主管单位获取许可/接口。

### 6.3 变化检测

1. 先用 ETag/Last-Modified；
2. 对下载内容计算 SHA-256；
3. HTML 做规范化后再计算正文哈希，过滤访问计数、随机 token 和时间戳；
4. PDF/Excel 同时比较文件哈希、解析后结构哈希和关键字段；
5. 新版本不覆盖旧版本，保存获取时间、URL、HTTP 状态、响应头、对象版本和解析器版本；
6. 识别“补充公告/更正公告/延期/取消”关系，不只比较原公告 URL；
7. 高影响变化经人工确认后，才批量重算匹配并通知用户；
8. 通知内容说明“什么变了、依据在哪里、何时核对、对用户有什么影响”。

国务院《政府网站发展指引》要求政府网站信息准确权威、及时更新，文件修改/废止/失效应明确标注，发布或转载要注明来源；这支持本产品保留来源、更新时间和变化记录，但不意味着第三方可以忽略站点规则。[政府网站发展指引](https://www.moe.gov.cn/jyb_xxgk/moe_1777/moe_1778/201706/t20170609_306674.html)

### 6.4 人工核验门槛

以下内容在进入“初步符合”推荐或触发用户提醒前，建议至少一人审核；会把用户从符合改为不符合、报名截止提前、岗位取消等变更建议双人复核：

- 报名开始/截止、缴费、考试日期；
- 招聘人数、学科、学段、用工性质、报考单元与分配方式；
- 学历、学位、专业目录、应届身份、教师资格、年龄、户籍、社保、经历；
- 补充公告对原公告的替换关系；
- 原文与附件冲突、OCR 低置信度、合并单元格或跨页表格。

自动校验可以拦截明显错误：截止早于开始、岗位人数非正、附件总人数与公告不一致、相同岗位代码重复、时间变化却未生成影响记录。自动校验通过不等于免人工审核。

## 7. 云服务组合与定位（以阿里云中国站为例）

以下只是能力匹配示例，不表示它在价格上一定优于腾讯云、华为云或其他大陆云；最终按团队经验、合同、地域、可用区、数据处理条款和压测选择。

| 需求 | 首版建议 | 定位与原因 | 何时升级 |
|---|---|---|---|
| Web/API/Worker | 1–2 台 ECS 上运行 Docker，Nginx 反代 | 最容易理解和排障，Next.js 官方支持 Docker；ECS 给完整软件栈控制权。[ECS 官方说明](https://help.aliyun.com/zh/ecs/user-guide/what-is-ecs?parentId=35469) | 多实例自动伸缩、团队有平台工程能力后再用 ACK |
| PostgreSQL | RDS PostgreSQL | 托管高可用、备份恢复，降低 DBA 工作。[RDS PostgreSQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/what-is-apsaradb-rds-for-postgresql) | 读压力、容量或可用性要求上升时调规格/只读实例 |
| 原件 | OSS 私有 Bucket + 版本控制 | 附件、快照、解析产物与数据库解耦，可追溯 | 大规模冷数据再加生命周期/归档 |
| 队列/缓存 | Tair Redis 兼容版 + BullMQ | 与 Node/Nest 集成简单，托管备份与监控 | 超长流程改 CloudFlow；事件流再评估 MQ |
| OCR | OCR 文档/表格结构化接口 | 仅给扫描件和难解析表格调用 | 版式固定且量大时评估文档自学习/专用模型 |
| 搜索 | PostgreSQL | 少组件、足够验证 | 中文检索/向量规模与效果成为瓶颈后 OpenSearch |
| LLM/RAG | 百炼/国内合规模型 API，经自建网关 | 中国大陆地域可用，支持模型、Embedding、知识库 | 量大或强可控时评估专属实例/自部署 |
| 短信 | 短信服务 | 关键提醒和验证码，高触达；需提前走资质/签名/模板 | 不作为普通信息默认渠道 |
| 突发文件处理 | 暂不需要；可选函数计算 | OSS 事件触发、按需运行，适合突发解析；官方定位为事件驱动全托管计算。[函数计算](https://help.aliyun.com/zh/functioncompute/what-is-function-compute) | 任务有持续常驻进程或本地状态时继续用 Worker |

为什么首版不选 Kubernetes/ACK：ACK 的核心价值是企业级 Kubernetes 生命周期、弹性、发布、监控与安全；对一个小规模验证产品，这些能力会引入集群和网络运维。[ACK 产品说明](https://help.aliyun.com/zh/ack/product-overview/product-introduction) 等流量、团队与发布频率证明需要后再使用。

建议用 Docker、S3 兼容/自有存储接口、标准 PostgreSQL、Redis 协议和统一 AI/OCR/SMS 适配层保持可迁移性；业务表中不要存云厂商专用资源 ID 作为唯一业务主键。

## 8. 分阶段开发建议

### 阶段 0：数据样本与审核工具优先

- 选 20–30 份覆盖 HTML、PDF、扫描 PDF、XLS/XLSX、直接报学校/岗位组/录取后分配的样本；
- 先设计公告、报考单元、证据、版本、补充公告和规则模型；
- 做解析与人工审核后台，而不是先做精美用户首页；
- 建立 20–30 条高风险黄金样本回归测试。

### 阶段 1：3–5 个地区的小范围闭环

- Next.js PWA + NestJS + PostgreSQL + OSS + BullMQ；
- 官方源登记、低频抓取、Excel/PDF 解析、人工发布；
- 画像、规则匹配、证据解释、关注、时间线；
- 站内提醒，Web Push 作为实验，不立即上 RAG/独立搜索集群。

### 阶段 2：20–50 人真实试用

- 增加 SMS 关键提醒、纠错、变化影响分析；
- 每周统计误报、漏报、待人工确认比例、来源故障率、审核耗时；
- 先证明“高影响错误为零”和 7 日推进指标，再扩地区。

### 阶段 3：备考与有限 AI

- 只对已核验考试内容做 RAG/计划；
- 输出带引用、AI 标识、用户可反馈；
- AI 输出不改变官方事实和资格状态。

### 阶段 4：按证据升级基础设施

- 搜索瓶颈 → OpenSearch；
- 向量数据与语义问答增大 → pgvector/OpenSearch/百炼知识库；
- 流程跨天且分支/补偿复杂 → CloudFlow/Temporal；
- 多实例与发布运维成为主要成本 → ACK；
- 数据来源扩张 → 为每个省/市建立来源适配器与运营 SLA，而不是“一个通用爬虫覆盖全国”。

## 9. 上线前技术与合规核对清单

- [ ] ICP 备案/许可和可能的教育、新闻、生成式 AI、算法备案边界已正式核验；
- [ ] 等保定级、备案/测评路径已咨询专业机构；
- [ ] 隐私规则清楚列出字段、用途、保存期限、供应商和用户权利；
- [ ] 有非个性化搜索、关闭推荐、删除标签、申诉和人工确认入口；
- [ ] 画像删除/账号注销会清理派生匹配、计划和不再需要的数据；
- [ ] OCR、短信、云、LLM 委托处理协议和数据地域已经核验；
- [ ] 不必要的个人信息不会进入日志、队列 payload、对象存储或模型提示词；
- [ ] 原始网页/附件、哈希、证据位置、解析器版本、审核记录可追溯；
- [ ] robots、条款、频控、429/Retry-After、条件请求和紧急停爬已实现；
- [ ] 抓取器不绕过验证码、登录、封禁或访问控制；
- [ ] 高影响字段和变更有人审，关键变更双人复核；
- [ ] 规则、匹配和提醒有幂等键、回归测试、回滚和审计；
- [ ] AI 输出有来源、标识、抽检、投诉和降级方案；
- [ ] 备份恢复、漏洞修复、安全事件和供应商故障做过演练；
- [ ] 对外文案没有把“初步符合”写成“保证可报”，也没有把覆盖地区写成全国完整。

## 10. 核心来源索引

### 法律法规与政府规范

- [中华人民共和国个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm?eqid=a4b2c80d0005b17000000003648d21ce)
- [网络数据安全管理条例](https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm)
- [中华人民共和国网络安全法（2025 修正）](https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm)
- [互联网信息服务算法推荐管理规定](https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm)
- [生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)
- [人工智能生成合成内容标识办法](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)
- [互联网信息服务管理办法](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_483f0dd8eb1b4dc5961e4e008bd4a083.html)
- [互联网新闻信息服务管理规定](https://www.cac.gov.cn/2017-05/02/c_1120902760.htm)
- [政府信息公开条例](https://www.moe.gov.cn/jyb_xxgk/moe_1777/moe_1778/202007/t20200731_476017.html)
- [政府网站发展指引](https://www.moe.gov.cn/jyb_xxgk/moe_1777/moe_1778/201706/t20170609_306674.html)

### 网络抓取与 HTTP 标准

- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 6585: Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585.html)

### 技术与云服务

- [Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Next.js 部署](https://nextjs.org/docs/app/getting-started/deploying)
- [Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)
- [Nuxt 介绍](https://nuxt.com/docs/4.x/getting-started/introduction)
- [NestJS 概览](https://docs.nestjs.com/recipes/documentation)
- [PostgreSQL JSONB](https://www.postgresql.org/docs/16/datatype-json.html)
- [PostgreSQL 全文检索](https://www.postgresql.org/docs/15/textsearch-intro.html)
- [`pg_trgm`](https://www.postgresql.org/docs/current/pgtrgm.html)
- [BullMQ](https://docs.bullmq.io/)
- [SheetJS 文件格式](https://docs.sheetjs.com/docs/miscellany/formats/)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [阿里云 RDS PostgreSQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/what-is-apsaradb-rds-for-postgresql)
- [阿里云 OSS](https://help.aliyun.com/zh/oss/user-guide/what-is-oss)
- [阿里云 Tair](https://help.aliyun.com/zh/redis/)
- [阿里云 OCR API](https://help.aliyun.com/zh/ocr/developer-reference/api-ocr-api-2021-07-07-overview)
- [阿里云 OpenSearch](https://help.aliyun.com/zh/open-search/)
- [阿里云百炼 RAG](https://help.aliyun.com/zh/model-studio/rag/concepts)
- [阿里云短信](https://help.aliyun.com/zh/sms/product-overview/what-is-alibaba-cloud-sms)

