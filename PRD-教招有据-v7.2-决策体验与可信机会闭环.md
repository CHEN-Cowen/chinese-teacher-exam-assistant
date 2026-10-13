# PRD：教招有据 v7.2 决策体验与可信机会闭环

> 文档状态：设计冻结，可进入开发拆解；代码尚未实现
> 日期：2026-10-13
> 适用范围：首次体验、资格预筛、结果页、定向补充、保存后行动、官方公告抓取与附件解析
> 当前代码基线：v7.1
> 本文优先级：用户最新要求 → 本文 → v7.1 → v7.0 → V6.1 兼容文档

## 1. Summary

v7.2 把两项原本分开的改造合并成一次完整迭代：一端重做用户从首页到结果、补充信息和继续报考的决策体验；另一端把官方公告从代码样本升级为可发现、可留档、可审核、可发布、可被匹配系统消费的真实数据闭环。

本轮的完成标准不是“页面更好看”或“爬到了更多链接”，而是用户能用更少步骤找到值得看的真实岗位，理解系统为什么这样判断；当信息不足时只补缺失项；管理员发布官方公告后，不改代码、不重新部署，岗位即可进入机会匹配。

## 2. Contacts

| 角色 | 负责人 | 本轮职责 |
|---|---|---|
| 产品负责人 | 项目所有者 | 决策范围、来源优先级、最终验收 |
| UI/UX | 项目所有者 / 执行工具 | 依据本文和原型完成高保真设计与响应式实现 |
| 前端 | 待执行 | 页面、状态、画像读写、无障碍、埋点 |
| 后端 | 待执行 | 抓取 Worker、文档解析、审核发布、目录投影 |
| 数据审核 | 管理员角色 | 核对高影响字段、发布与撤回 |
| 试用用户 | 受邀用户 | 完成任务测试并反馈误解、漏报与重复填写 |

## 3. Background

### 3.1 为什么现在需要这次迭代

连续试用和原型讨论暴露了两类相互关联的问题。

用户侧：

- 首页先展示大量解释和长示例，价值出现得太慢；
- 用工偏好在填写结束后才被再次询问，打断获得结果；
- 优先机会、补充后判断和偏好范围外没有真正分开；
- 岗位卡字段等权，地点、截止时间和主要风险不够突出；
- 地图入口藏得太深；
- 桌面端像放大的移动页面；
- “补充信息”错误地回到基础画像，重复询问地区、学历和专业。

数据侧：

- URL 提交链路尚未可靠下载官网正文；
- 机会列表主要依赖代码中的静态目录；
- 数据库已经存在抓取快照、抽取、证据、审核和发布骨架，但发布结果没有成为用户端事实源；
- PDF、Excel、ET、DOCX 和扫描件没有统一解析层；
- 没有主动发现、限速、重试、来源健康和附件归档。

这两个问题不能分开处理。界面如果承诺“真实公告、逐条可核对”，数据链路就必须支撑；数据即使入库，如果仍不能进入匹配页，也不会改善用户体验。

### 3.2 当前可以复用的基础

- 前端已有 Next.js 16、React 19、Tailwind CSS 4 和可复用 UI；
- 已有访客画像、受邀用户画像、匹配规则、详情、关注、日程和咨询记录；
- 详情页已有 `SupplementForm` 和保存后重算基础；
- 后端已有 NestJS 12、Prisma 6、PostgreSQL 17；
- 数据库已有 `Source`、`SourceSnapshot`、`ExtractionRun`、`EvidenceAnchor`、`ReviewRecord`、`PublishedAnnouncementVersion`；
- 部署已有前端、后端、迁移和 PostgreSQL 容器；
- 当前生产镜像使用 Node.js 24，适合本轮 HTML、队列和文档解析技术。

本轮采用增量改造，不更换主框架，不重写匹配引擎。

## 4. Objective

### 4.1 Objective A：让用户先得到答案，再阅读解释

用户进入产品后，能快速理解产品价值、完成必要信息、看见互斥结果，并在十秒内指出一个最值得优先查看的岗位及原因。

### 4.2 Objective B：让“补充信息”成为连续任务

用户从某个岗位进入补充流程时，只回答当前缺失事实；保存后立即重算并回到该岗位的新状态，不能重新填写整份基础画像。

### 4.3 Objective C：建立可信官方公告供应链

系统能低频检查三个已登记来源，安全保存正文与附件，解析为带证据位置的候选数据，经人工审核发布后进入机会匹配。

### 4.4 Key Results

| Key Result | v7.2 验收目标 |
|---|---|
| 首页任务理解 | 受邀测试中，用户 10 秒内能说清产品用途并找到唯一主入口 |
| 结果理解 | 用户 10 秒内能指出优先岗位、地点、截止紧迫度和一个风险 |
| 分类正确 | 三个结果标签互斥；同一岗位只属于一个展示分类 |
| 重复提问 | 定向补充端到端测试中，已经填写的地区、学历、专业重复提问数为 0 |
| 回程正确 | 补充后 100% 返回正确分类并聚焦原岗位或新位置 |
| 数据闭环 | 数据库发布后无需修改代码或重新部署即可进入用户端 |
| 证据完整 | 学历、专业、年龄、教师资格、报名时间等高影响字段证据覆盖率 100% |
| 来源闭环 | 杭州、宁波、鄞州三个首批来源具备检查状态、失败原因和最近成功时间 |
| 去重 | 相同内容重复检查不生成重复快照或重复公告 |
| 响应式 | 320px、768px、1024px、1440px 关键视口完成验收，无横向溢出和主操作遮挡 |

在获得真实数据前，对外只能写“预期改善”和“待验证”，不能宣称转化率已经提升。

## 5. Market Segments

### 5.1 首次判断型用户

任务：快速知道自己有哪些岗位值得继续看，而不是先学习复杂招聘规则。

约束：不了解“备案制、员额制、专业目录、应届口径”等术语，移动端使用比例高，对重复填写很敏感。

### 5.2 谨慎核对型用户

任务：看见每个判断来自哪条官方公告，在不确定时知道应该问什么。

约束：不会信任无法解释的匹配分，也不能把系统建议误认为官方承诺。

### 5.3 多目标推进型用户

任务：保存岗位、处理阻塞条件、准备材料和日程，形成主要目标与备选目标。

约束：当前真实岗位数量仍少，多岗位比较的需求必须先用行为数据验证。

### 5.4 数据审核人员

任务：确认来源健康、比对原文和候选字段、发布或撤回版本。

约束：不能依赖查看服务器日志判断任务是否成功，必须在管理后台看见来源、快照、解析和投影状态。

## 6. Value Propositions

### 6.1 对报考用户

- 从“自己阅读所有公告”变成“先看值得关注的岗位，再回到官方依据”；
- 从“信息不足等于看不懂结果”变成“只补一项即可继续判断”；
- 从“收藏后不知道做什么”变成“保存后得到一个最重要的下一步”；
- 从“系统假装确定”变成“未知、建议确认和明确不符被清楚区分”。

### 6.2 对产品可信度

- 每个高影响结论都能回到官方网页、PDF 页码或表格单元格；
- 官网变化形成新快照和版本，不覆盖历史；
- OCR、AI 和用户个人咨询不能直接成为公共资格事实；
- 未覆盖地区显示“暂未收录”，不显示“没有招聘”。

### 6.3 对维护者

- 官网变化集中在对应 Adapter，网络安全和重试不散落在各来源；
- 文件格式差异集中在文档解析 Module；
- 用户端只消费已发布目录，不感知抓取内部细节；
- 原型、需求、代码边界和验收在同一文档中对齐。

## 7. Solution

### 7.1 本轮范围

#### 必须完成：v7.2.0

1. 首页“结果先行”；
2. 两屏填写，并把用工偏好放入第二屏；
3. 结果页三类互斥标签；
4. 岗位卡层级、地图入口、按钮系统与响应式布局；
5. 真实岗位定向补充流程；
6. 访客与受邀用户画像读写统一；
7. 数据库已发布公告接入机会匹配；
8. 安全 URL 获取和一个来源的 HTML 闭环；
9. 端到端测试和小范围开关。

#### 随后完成：v7.2.1

1. 杭州、宁波、鄞州三个官网 Adapter；
2. BullMQ、Redis 和独立 Worker；
3. PDF、XLS/XLSX/XLSB/ET 解析；
4. OSS 原件归档；
5. 来源健康、立即检查和失败告警；
6. 自动发现、自动解析、人工发布。

#### 验证后完成：v7.2.2

1. 保存后只给一个下一步；
2. 公告歧义转成可编辑的官方咨询问题；
3. DOCX 与按需 OCR；
4. 补充、延期、取消公告关系；
5. 根据受邀用户地区扩展到 10—20 个来源。

#### 本轮不承诺

- 全国实时全覆盖；
- 默认内嵌地图或定位权限；
- AI 自动发布高影响字段；
- 录取概率、竞争度、学校排名和综合匹配分；
- 自动拨号、自动发送咨询或把个人答复变成公共规则；
- 多岗位比较正式上线。比较原型保留，满足触发条件后进入后续版本。

### 7.2 UX 与原型

#### 原型入口

| 原型 | 用途 | 实施状态 |
|---|---|---|
| [首页方向原型](docs/prototypes/教招有据-v7.2-首页方向原型.html) | 对比结果先行、直接开始、依据先行 | 实施“结果先行” |
| [结果与补充流程原型](docs/prototypes/教招有据-v7.2-结果与补充流程原型.html) | 结果分类、岗位卡、桌面/移动与补充流程 | v7.2.0 依据 |
| [结果后行动原型](docs/prototypes/教招有据-v7.2-结果后行动原型.html) | 保存下一步、官方确认、多岗位比较 | 分阶段实施 |
| [原型索引](docs/prototypes/README.md) | Coding 工具读取顺序和优先级 | 交接入口 |

原型只定义信息架构、内容层级、主次操作和响应式方向。实现必须复用 `src/app/globals.css` 的现有设计 Token，不照搬原型颜色，不引入远程字体或远程图标。

#### 首页原型摘要

```text
┌──────────────────────────────────────────────────────────┐
│ 教招有据                                           登录 │
├─────────────────────────┬────────────────────────────────┤
│ 30 秒完成资格预筛        │ 结果预览 · 示例                │
│ 哪些教师岗位，你现在能报？│ [1 优先][2 补充][3 偏好外]     │
│ 简短说明                 │ 一条岗位 + 地点 + 地图         │
│ [开始匹配岗位]           │ 3 项通过 · 1 项待确认          │
│ 无需登录 · 约 30 秒      │ [查看官方依据]                 │
└─────────────────────────┴────────────────────────────────┘
```

#### 结果页原型摘要

```text
1 个优先机会，2 个补充后可判断                最后核对时间
当前条件：杭州优先 · 本科 · 汉语言文学 · 初中语文    修改
[优先机会 1] [补充后判断 2] [偏好范围外 3]

真实公告 · 已核对                              6 天后截止
杭州某公办初中 · 语文教师
杭州 · 余杭区 · 学校名称                       地图 ↗
事业编 · 初中语文 · 招 2 人
3 项已通过                         户籍待确认
[查看官方依据]                    [保存机会]
```

### 7.3 统一用户流程

```text
首页
  ↓
地区意向
  ↓
基础资格 + 用工偏好
  ↓
结果工作台
  ├─ 优先机会 → 官方依据 / 保存
  ├─ 补充后判断 → 定向补充 → 重算 → 回到新分类
  └─ 偏好范围外 → 查看 / 调整偏好
  ↓
岗位详情
  ↓
保存后下一步 → 日程 / 材料 / 官方确认
```

页面职责固定：

- 首页：让用户理解并开始；
- 填写页：收集影响结果的信息；
- 结果页：回答哪些岗位值得先看；
- 补充页：只解决一个缺失事实；
- 详情页：证明判断并推进报名；
- 日程页：持续跟踪。

### 7.4 页面需求

#### 7.4.1 首页

- 主标题：`哪些教师岗位，你现在就能报？`；
- 唯一高强调按钮：`开始匹配岗位`；
- 右侧仅展示结果形状，不展开完整公告；
- 示例只做一次页面级标识；
- 桌面端左 5 栏、右 7 栏；移动端先按钮、后预览；
- 页面视觉舞台铺满，内容容器最大 1280px。

#### 7.4.2 两屏填写

第一屏只收地区意向和考虑程度。第二屏按顺序收集学历、毕业时间、专业、教师资格和用工偏好。

用工偏好固定为：

- 只看事业编；
- 事业编优先，也看其他官方岗位；
- 暂不确定，先全部看看。

说明：偏好只影响筛选和排序，不改变资格判断。

#### 7.4.3 结果工作台

- 初始只展示“优先机会”；
- 点击标签后只显示对应数据集；
- 岗位分类顺序为资格状态、偏好、截止紧迫度，不使用综合分；
- 当前条件使用一句摘要，不堆叠大量胶囊；
- 地点和地图入口在岗位第一层；
- “查看官方依据”和“保存机会”同高、同圆角、同基线，但前者实心、后者描边；
- 偏好范围外使用安静视觉，不使用红色或“不符合”。

#### 7.4.4 定向补充

真实岗位固定路由：

```text
/opportunities/[unitId]/supplement?origin=preview&bucket=need_more_info
```

规则：

- `origin` 只接受 `preview | opportunities | detail`；
- `bucket` 只接受定义好的分类枚举；
- 缺失字段必须根据最新岗位和当前画像重新计算，不能相信 URL；
- 页面只展示仍缺失的子字段；
- `MANUAL_REVIEW` 进入官方确认，不进入可自动重算表单；
- 用户暂不提供时保持 UNKNOWN，不转换为 FAIL；
- 保存失败保留输入；
- 岗位截止、来源失效或版本变化优先展示最新闸门状态。

如果 `/preview` 继续展示虚拟岗位，则使用 `/preview/supplement/[unitId]` 的 demo 模式，不保存户籍、出生日期或社保等事实。真实任务和虚拟体验不得共用同一种承诺。

#### 7.4.5 保存后下一步

保存成功后不只显示 Toast。系统在岗位卡下方或移动端底部区域展示一个下一步：

1. 影响能否报名的阻塞条件；
2. 72 小时内到期节点；
3. 缺失材料；
4. 普通日程；
5. 待官方通知提醒。

首版只展示一个主动作，避免重新形成仪表盘。

#### 7.4.6 官方确认

当公告本身存在歧义时，页面展示：为什么需要确认、对应原文、可编辑咨询问题、官方联系方式和个人答复记录。

个人答复只改变该用户的岗位状态，不改变公共规则，也不自动成为其他用户的依据。

#### 7.4.7 响应式

| 视口 | 行为 |
|---|---|
| 320—479px | 单列、16px 留白、标签可横向滚动、主按钮整行 |
| 480—767px | 单列、20px 留白、事实标签可换行 |
| 768—1023px | 表单可两列，结果卡保持清楚阅读顺序 |
| 1024—1439px | 12 栏网格、结果卡内部双区 |
| ≥1440px | 背景铺满、内容最大 1280px 并居中 |

移动端顺序固定为：状态 → 岗位 → 地点 → 事实 → 判断 → 操作。桌面端利用横向空间，但不把文字拉满屏幕。

### 7.5 事实与状态模型

页面必须区分：

- 官方事实：公告原文、日期、岗位、地点、人数；
- 系统判断：初步符合、补充后判断、建议官方确认、明确不符；
- 用户偏好：地区和用工形式；
- 用户事实：学历、专业、教资、户籍等；
- 未知：公告未明确或用户未填写。

显示分类使用互斥规则：

```text
岗位不可用/已截止/来源失效 → 不进入正常机会
存在明确 FAIL              → 非优先结果
存在 MANUAL_REVIEW         → 建议官方确认
存在 UNKNOWN               → 补充后判断
资格通过但偏好不匹配        → 偏好范围外
资格通过且偏好匹配          → 优先机会
```

未知不是不符合，偏好范围外也不是资格不符合。

### 7.6 技术架构

```text
Next.js 页面
   │
   ├── Profile Module ──访客 Adapter──> localStorage
   │                  └─受邀 Adapter──> NestJS /profile
   │
   └── Opportunities Module ──────────> PublishedCatalogRepository
                                                │
                                                ▼
                                          PostgreSQL 已发布版本
                                                ▲
                                                │
管理员审核 <─ Announcement Review Module <─ Document Processing Module
                                                ▲
                                                │
                  Redis / BullMQ <─ Sourcing Module <─ 官方网站与附件
                         ▲
                         │
                 NestJS 定时器 / 管理员立即检查
```

#### 7.6.1 Profile Module

Interface：

```ts
interface ProfileRepository {
  read(): Promise<ActiveProfile>;
  patch(changes: ProfilePatch, expectedUpdatedAt?: string): Promise<ActiveProfile>;
}
```

两个真实 Adapter：

- `GuestLocalProfileAdapter`：写入现有本机画像和补充事实；
- `ServerProfileAdapter`：调用服务端画像接口。

已登录用户新增 `PATCH /profile`：服务端只接受白名单字段，合并本次变化，并使用 `expectedUpdatedAt` 做乐观锁。现有 `PUT /profile` 保留给完整迁移与兼容，但新补充流程不再使用客户端读—改—全量覆盖。

登录迁移按字段合并：服务端非空优先；服务端缺失而访客已补充则迁入；两边冲突时要求用户确认，不静默覆盖。

#### 7.6.2 Sourcing Module

外部 Interface 保持很小：

```ts
interface CrawlOrchestrator {
  checkSource(sourceId: string, trigger: 'schedule' | 'admin' | 'retry'): Promise<CrawlRunRef>;
}
```

Implementation 内部处理调度、限速、安全获取、URL 规范化、去重、快照、任务投递和来源健康。

确定技术：

- `@nestjs/schedule` 只负责定时投递；
- `@nestjs/bullmq` + BullMQ + Redis 保存后台任务；
- 增加独立 `worker` 容器，使用同一后端镜像运行 `node dist/worker.js`；
- Node.js 原生 `fetch` + `AbortSignal` 执行普通请求；
- 同域并发默认 1；
- 429、408、502、503、504 指数退避并尊重 `Retry-After`；
- 普通 4xx 不盲目重试；
- 验证码、登录和封禁转人工。

#### 7.6.3 Official Site Adapter Seam

Interface：

```ts
interface OfficialSiteAdapter {
  readonly key: string;
  discover(input: ListPageSnapshot): DiscoveredDocument[];
  locateArticle(input: ArticlePageSnapshot): LocatedArticle;
}
```

首批三个 Adapter：

- `HangzhouEducationAdapter`；
- `NingboEducationAdapter`；
- `YinzhouGovernmentAdapter`。

Adapter 接收已经安全下载的快照，不自行联网、不写数据库、不抽取学历专业。获取优先级固定为：公开 RSS/API/站点地图 → HTML + Cheerio → 必要时 Playwright → 人工。

首版不引入 Crawlee，避免与 BullMQ 形成两套队列。来源达到约 20 个且链接发现明显复杂后再评估。

#### 7.6.4 Document Processing Module

Interface：

```ts
interface DocumentParser {
  supports(mimeType: string, magicBytes: Uint8Array): boolean;
  parse(snapshot: StoredSnapshot): Promise<ParsedDocument>;
}
```

统一输出块和证据位置：

- HTML：Cheerio `loadBuffer`，保留源 URL、正文定位和原始 HTML；
- PDF：`pdfjs-dist`，保留页码，必要时保留坐标；
- XLS/XLSX/XLSB/ET：SheetJS，保留工作表、行、列、原始值和展示值；
- DOCX：Mammoth，保留段落和表格位置；
- 扫描 PDF/图片：无有效文本层时调用阿里云文档智能，保留页码、坐标和置信度。

文件格式解析与招聘业务抽取分开：

- `DocumentParseRun`：原始字节 → 标准文档；
- `ExtractionRun`：标准文档 → 公告、岗位、规则和证据候选。

确定性规则优先。AI 只辅助复杂条款，必须返回结构化候选和原文锚点，不能自动发布。

#### 7.6.5 Announcement Review Module

沿用现有审核与不可变发布版本：

- 原始快照不可覆盖；
- 高影响字段没有证据不能审核通过；
- OCR/AI 标记清楚；
- 补充、延期、取消公告建立关系；
- 修改发布产生新 `PublishedAnnouncementVersion`；
- 撤回不删除历史。

#### 7.6.6 Published Catalog Module

新增 `PublishedCatalogRepository`。v7.2.0 直接读取 `PublishedAnnouncementVersion.status='published'` 的 `payload`，映射成现有匹配领域对象，不新增第二套目录表。

`OpportunitiesService.getPublishedAnnouncements()` 删除对生产静态目录的依赖。静态目录只在明确的 Demo Adapter 和测试中使用。

Interface：

```ts
interface PublishedCatalogRepository {
  listPublished(now: Date): Promise<RecruitmentAnnouncement[]>;
  getUnit(unitId: string, now: Date): Promise<RecruitmentUnit | null>;
}
```

发布成功后投递 `catalog.project` 任务，用于校验 payload、刷新缓存、同步已关注岗位日程和变更提醒。数据库仍是唯一事实源。

### 7.7 三条必须跑通的端到端链路

#### 链路 A：首次预筛

```text
首页点击开始
→ /onboarding 第 1 屏写地区草稿
→ 第 2 屏写基础资格与用工偏好
→ ProfileRepository 保存
→ POST /opportunities/match
→ PublishedCatalogRepository 读取 published 数据
→ 匹配引擎产生互斥分类
→ /preview 或 /opportunities 展示结果
```

失败处理：保存失败保留表单；匹配失败展示可重试错误；数据暂不可用时不伪造空结果。

#### 链路 B：定向补充

```text
点击“补充 1 项继续判断”
→ 打开稳定岗位路由
→ POST /opportunities/units/:unitId/detail 获取最新缺失维度
→ 字段注册表只渲染缺失子字段
→ ProfileRepository.patch
→ 重新请求详情与匹配
→ 比较补充前后状态
→ 返回 tab + focus 对应分类
```

失败处理：重复提交幂等；409 提示画像已更新并重新加载；岗位截止时终止补问；取消时保持原状态。

#### 链路 C：官网公告进入用户端

```text
定时器/管理员触发 source.discover
→ Worker 读取 Source 和 Adapter
→ SafeFetcher 获取栏目页
→ Adapter 发现公告 URL
→ document.fetch 保存原始正文和附件到 OSS
→ SourceSnapshot 写入哈希和 HTTP 元数据
→ document.parse 生成标准文档
→ announcement.extract 生成候选字段和证据
→ 管理员审核
→ PublishedAnnouncementVersion 发布
→ catalog.project 校验并同步
→ 用户下一次 match 读取新公告
```

失败处理：304 不生成快照；相同哈希不重复；附件失败进入待处理但不覆盖旧版本；投影失败时新版本不进入正常机会，并保留上一版已审核数据。

#### 链路 D：保存后推进

```text
保存机会
→ POST /opportunities/units/:unitId/follow
→ 生成/同步日程
→ NextActionSelector 计算一个最高优先级动作
→ 岗位卡显示“已保存 + 下一步”
→ 用户进入补充、咨询、材料或日程
```

保存不等于已报名，系统不能自动改变为 preparing 或 registered。

### 7.8 路由与接口决策

#### 前端路由

| 路由 | 职责 |
|---|---|
| `/` | 结果先行首页 |
| `/onboarding` | 首次填写或用户主动整体编辑 |
| `/preview` | 访客预筛；若使用示例必须明确 demo |
| `/opportunities` | 已登录真实结果工作台 |
| `/opportunities/[unitId]` | 详情、证据、关注和报名推进 |
| `/opportunities/[unitId]/supplement` | 真实岗位定向补充 |
| `/preview/supplement/[unitId]` | 可选的无持久化演示补充 |
| `/schedule` | 统一日程 |

#### 新增或调整的后端接口

| 方法与路径 | 用途 |
|---|---|
| `PATCH /profile` | 白名单字段级更新与乐观锁 |
| `POST /admin/sources/:sourceId/check` | 管理员立即检查来源 |
| `GET /admin/sources/:sourceId/runs` | 查看抓取运行历史 |
| `GET /admin/sources/health` | 来源健康摘要 |

现有 `POST /opportunities/match`、`POST /opportunities/units/:unitId/detail`、关注、咨询、审核与发布接口继续复用。

### 7.9 数据模型

#### 扩展 `Source`

- `adapterKey`；
- `listUrls`；
- `allowedHosts`；
- `pollEveryMinutes`；
- `nextCheckAt`；
- `cursor`；
- `etag`、`lastModified`；
- `healthStatus`；
- `consecutiveFailures`；
- `lastCheckedAt`。

#### 新增 `CrawlRun`

记录触发方式、时间、状态、发现数、下载数、未变化数、错误摘要和 Adapter 版本。BullMQ 记录是运行基础设施，不替代业务审计。

#### 新增 `SourceDocument`

表示逻辑官方文档，包含 `canonicalUrl`、类型、父文档、关系候选、首次/最近发现时间和最新快照。`SourceSnapshot` 继续表示不可变字节版本。

#### 新增 `DocumentParseRun`

记录快照、解析器版本、状态、标准文档存储位置、警告与错误。已有 `ExtractionRun` 不再同时承担格式解析。

#### `UserProfile`

继续使用 JSON 画像，不在本轮拆成大量列；使用现有 `updatedAt` 作为 `PATCH /profile` 的乐观锁依据。

### 7.10 代码实施地图

#### 前端

| 位置 | 变更 |
|---|---|
| `src/app/page.tsx` | 结果先行首页 |
| `src/app/onboarding/page.tsx` | 两屏填写与用工偏好；只承担首次/整体编辑 |
| `src/app/preview/page.tsx` | 互斥结果分类；真实与示例分轨 |
| `src/app/opportunities/page.tsx` | 桌面/移动结果工作台 |
| `src/app/opportunities/[unitId]/supplement/page.tsx` | 新增定向补充页 |
| `src/components/opportunities/SupplementForm.tsx` | 拆出字段注册表和聚焦表单 |
| `src/lib/profile/activeProfile.ts` | 建立统一 ProfileRepository |
| `src/lib/profile/profileApi.ts` | 增加 PATCH 与冲突处理 |
| `src/lib/ia/opportunities-view.ts` | `need_more_info` 改为 supplement，不再 onboarding |
| `src/components/ui/` | 统一按钮、标签、卡片和状态反馈，不复制另一套 UI |

#### 后端

```text
backend/src/sourcing/
  sourcing.module.ts
  crawl-orchestrator.ts
  official-site-adapter.ts
  fetch/safe-fetcher.ts
  adapters/*.adapter.ts
  jobs/*.processor.ts

backend/src/document-processing/
  document-processing.module.ts
  document-parser.ts
  parsers/*.parser.ts
  jobs/document-parse.processor.ts

backend/src/catalog/
  catalog.module.ts
  published-catalog.repository.ts
  publication-projector.ts

backend/src/worker.ts
```

Module 外部 Interface 保持小，复杂重试、编码、MIME、页码、坐标和 Adapter 选择留在 Implementation 内部，形成足够的 Depth、Leverage 和 Locality。

### 7.11 存储与部署

#### Docker Compose

在现有 `db / migrate / backend / frontend` 之外增加：

- `redis`：仅 Compose 内网访问，不暴露主机端口；
- `worker`：使用后端镜像，命令为 `node dist/worker.js`；
- Worker 与 backend 共用数据库、Redis 和 OSS 配置，但只 Worker 执行抓取与文件解析。

#### 对象存储

- 开发/测试：保留 `LocalObjectStore`，使用 `.data`；
- 生产：`OssObjectStore`，私有 Bucket，开启版本控制；
- 原始事实快照长期保留；
- 临时图片和中间文件使用生命周期策略清理；
- 用户端使用受控读取或短时签名地址。

### 7.12 安全与国内网络

- 只抓取登记的官方公开来源；
- DNS 解析拒绝回环、私网、链路本地和云元数据地址；
- 每次重定向重新检查域名和 IP；
- HTTP 只对登记来源按策略放行；
- 限制重定向、连接时间、总时间、响应体、页数和表格规模；
- 响应头、扩展名和魔数共同判断格式；
- Worker 非 root；
- ZIP 防路径穿越和压缩炸弹，首版不支持 RAR；
- 条件允许时接 ClamAV；
- OCR、OSS 凭证使用最小权限；
- 不加载远程字体、远程图标、Google Maps 或境外必需资源；
- 地图由用户点击后打开国内网页，不申请当前位置；
- 日志和埋点不记录户籍、出生日期、证件号或咨询正文。

### 7.13 管理后台

来源管理页必须显示：

- 正常、延迟、结构变化、被阻止、人工暂停；
- 最近检查、最近成功、下次检查；
- 本次发现、新增、未变化和失败数量；
- 立即检查；
- Adapter 和解析器版本；
- 原始快照、标准文档、候选字段三栏对照；
- PDF/OCR/表格解析警告；
- 发布后是否成功进入用户目录；
- 待审核积压。

“静默返回 0 条”视为故障。Adapter 选择器失配必须产生健康告警。

### 7.14 埋点

用户侧只记录动作和枚举，不记录答案正文：

- `home_primary_clicked`；
- `profile_completed`；
- `result_tab_changed`；
- `official_evidence_opened`；
- `map_link_opened`；
- `supplement_opened`；
- `supplement_submitted`；
- `supplement_recomputed`；
- `supplement_returned_to_result`；
- `opportunity_followed`；
- `next_action_opened`；
- `consultation_template_copied`。

数据侧记录：检查耗时、下载状态、304、快照新增、解析成功、待审核、发布、投影失败和来源连续失败。

### 7.15 Assumptions

- 首批三个官网允许对公开栏目做低频访问；
- 受邀试用阶段人工审核量可承受；
- 当前 PostgreSQL 和单机部署能承担目录查询；
- Node.js 24、Redis 和一个 Worker 容器在当前服务器资源范围内；
- 首批主要附件格式为 HTML、PDF、XLS/XLSX/ET；
- 用工偏好三档能够覆盖首次筛选，不要求用户理解全部编制术语。

这些假设必须通过来源试跑、服务器监控和用户测试验证。

### 7.16 主要风险与应对

| 风险 | 应对 |
|---|---|
| 迭代范围过大 | 拆成 v7.2.0/1/2，每个阶段有独立可验收闭环 |
| 官网结构变化 | 每来源黄金样本、Adapter 合同测试和结构变化告警 |
| Worker 影响主站 | 独立进程、低并发、超时和资源上限 |
| OCR/AI 误识别 | 候选状态、证据锚点、人工审核、高影响字段不自动发布 |
| 发布后用户端仍读静态目录 | `PublishedCatalogRepository` 作为 v7.2.0 阻塞验收项 |
| 访客补充后登录丢失 | ProfileRepository 两 Adapter + 字段级迁移 |
| 原型被当成最终视觉 | 原型索引注明实施状态；真实 Token 和 PRD 优先 |
| 用户误把保存当报名 | 文案明确“已保存/考虑中”，状态由用户主动推进 |

## 8. Release

### 8.1 实施顺序

#### 工作包 0：基线与回归保护

- 固化当前关键测试；
- 为首页、结果分类、定向补充和数据库目录建立验收样本；
- 建立 Feature Flag；
- 建立三个官网的最小脱敏黄金样本。

完成门：旧流程关键用例可重复，新需求有失败测试或明确验收脚本。

#### 工作包 1：前端决策流程

- 首页、两屏填写、用工偏好；
- 三类互斥结果；
- 岗位卡和地图入口；
- 桌面与移动响应式；
- 按钮和状态组件统一。

完成门：所有 UI 验收在演示数据下通过，但不声称真实数据闭环已经完成。

#### 工作包 2：定向补充

- ProfileRepository；
- `PATCH /profile`；
- 专用补充路由；
- 字段注册表；
- 重算、回程、聚焦和状态播报；
- 访客、demo、invited 三种身份测试。

完成门：不再从岗位补问回到 `/onboarding`；已知字段重复提问为 0。

#### 工作包 3：真实目录闭环

- `PublishedCatalogRepository`；
- 生产机会列表移除静态目录依赖；
- 真实 URL 安全获取；
- 一条公告从快照、审核、发布进入匹配。

完成门：后台发布后不重部署即可出现在用户端。

#### 工作包 4：主动抓取与附件解析

- Redis、BullMQ、Worker；
- 三个官网 Adapter；
- HTML、PDF、Excel、ET；
- OSS；
- 来源健康与管理员立即检查。

完成门：三个来源灰度运行一周，自动发现和解析，全部人工发布；失败不影响旧版数据。

#### 工作包 5：结果后行动

- 保存后下一步；
- 官方确认模板和个人记录；
- DOCX/OCR 按实际附件接入；
- 验证是否需要多岗位比较。

完成门：保存后 24 小时推进指标可观测；不确定性没有被错误自动判定。

### 8.2 测试矩阵

#### 前端

- 首页主入口、结果预览和移动顺序；
- 用工偏好不改变资格结论；
- 三标签键盘切换、ARIA 和互斥数据；
- 地图入口仅在地点足够明确时出现；
- 按钮高度、焦点、禁用、加载与错误；
- 320/768/1024/1440 视口；
- `prefers-reduced-motion`；
- 网络失败和骨架屏。

#### 定向补充

- 每个维度的字段映射；
- 子字段已知时不重复问；
- UNKNOWN、MANUAL_REVIEW、FAIL 分流；
- 保存失败、409、重复提交；
- 岗位截止、来源失效、版本变化；
- 返回正确标签和焦点；
- 访客登录迁移与跨设备恢复。

#### 抓取与解析

- 301/302、304、429、超时、超大响应；
- 私网 IP、跨域重定向、错误 MIME；
- 文本 PDF、扫描 PDF、多表 XLSX、ET、合并单元格、DOCX、损坏和加密文件；
- 页码和单元格证据；
- 相同哈希去重；
- Adapter DOM 变化明确失败；
- 发布、撤回、补充、延期和取消。

#### 端到端

```text
官方测试列表出现公告
→ 自动发现正文和附件
→ 生成快照、标准文档、候选字段和证据
→ 管理员审核发布
→ 用户完成画像
→ 结果页显示该岗位
→ 用户补充一个缺失事实
→ 岗位进入新分类
→ 用户查看官方依据并保存
→ 获得一个下一步和日程
```

### 8.3 发布策略

1. 先对内部管理员开启来源抓取；
2. 抓取和解析进入 Shadow Mode，只生成待审核，不影响用户；
3. 对受邀账号开启新首页和定向补充；
4. 接通一个真实来源和数据库目录；
5. 观察错误、退出和数据质量后扩大到三个来源；
6. 最后开启保存后下一步与官方确认。

### 8.4 回退策略

- UI Feature Flag 可恢复旧首页和旧结果布局；
- 定向补充回退到岗位详情内联表单，绝不能回到基础画像第 1 屏；
- Worker 可暂停来源，不删除快照；
- 新解析器失败时继续使用上一版候选和已发布版本；
- 新公告投影失败时不进入用户端；
- 数据库版本撤回保留审计链；
- 静态演示目录只能作为 Demo 回退，不能重新混入生产真实机会。

### 8.5 Definition of Done

v7.2 只有同时满足以下条件才算完成：

- 页面、流程、数据和审核不是各自演示，而是端到端连通；
- 所有高影响字段可回到官方证据；
- 用户补充事实不会重复填写或丢失；
- 数据库发布无需重新部署即可进入匹配；
- 三个首批来源可观测、可暂停、可重试；
- 移动端和桌面端分别验收；
- 国内网络基线检查通过；
- Feature Flag、回退和数据审计可用；
- 文档、原型和验收脚本与实现一致。

## 附录 A：交给 Coding 工具的执行说明

1. 不直接从旧 UI 文档挑选零散需求；本文是 v7.2 的主事实来源。
2. 先实现工作包 0—3，确认真实闭环后再做批量来源。
3. 原型中的示例数据不能进入生产目录。
4. 修改 Next.js 页面前先读取当前安装版本位于 `node_modules/next/dist/docs/` 的相关指南。
5. 新增任何远程依赖前检查 `docs/china-network-accessibility.md`。
6. 每完成一个工作包，先通过其完成门，再进入下一个工作包。
7. 发现本文与当前代码冲突时，记录差距并修正文档或实现，不静默发明第三种流程。

## 附录 B：来源文档

- `PRD-教招有据-v7.1-首次体验与报考闭环优化版.md`；
- `PRD-全国教师公开招聘助手-v7.0-研究验证版.md`；
- `docs/china-network-accessibility.md`；
- `docs/教招有据-UIUX改版详细方案-2026-10-13.md`；
- `docs/教招有据-主动抓取与附件解析技术方案-2026-10-13.md`；
- `docs/v6.1-data-pipeline.md`；
- `docs/technical-feasibility-sources.md`。
