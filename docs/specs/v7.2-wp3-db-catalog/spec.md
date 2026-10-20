# v7.2 工作包 3（WP3）— 数据库已发布目录 + 单来源 HTML 闭环 · Spec

> 状态：待批准（批准后执行 tasks.md）。
> 范围：**仅** WP3（R-WP3-01..05）+ 一个官方来源的 HTML 闭环样例。
> 不做：BullMQ/Redis/对象存储/PDF 解析/第二个来源/前端 UI 改造/Prisma migration。
> 约束：不提交、不推送；保留无关未跟踪文件与本地保护文件。

## 1. 目标与非目标

**目标链路（真实闭环）**

官方测试栏目/黄金样本 → SafeFetcher 安全获取 HTML（不可变快照）→ 单来源 Adapter 解析为
候选（最小元数据）→ 人工审核 → 写入 `PublishedAnnouncementVersion`（status=published，
payload 为目录载荷）→ `PublishedCatalogRepository.listPublished()` 读 DB → 匹配引擎 →
用户端机会结果。**全程不改代码、不重部署。**

**非目标**

- 不新建“第二套事实目录”，不改静态目录内容；
- 不重写现有 announcements 发布流水线（其 payload 为 `ExtractionCandidate`，见 §4 说明）；
- 不接入 Redis/队列/对象存储；Adapter 只处理 1 个来源（杭州）。

## 2. 现状与关键事实（已核对）

- `backend/src/opportunities/opportunities.service.ts` L69-74 `getPublishedAnnouncements()` 同步合并
  `getRollingCatalogAnnouncements()` + `REAL_ANNOUNCEMENTS`；消费点：match/unitDetail/syncSubscription/
  listGoals/follow/mergeGuestFollows/transition/setMaterialStatus/saveConsultationNote/setRole/
  setRemindersMuted/submitCorrection/listMyCorrections/listCorrectionsForStaff/reviewCorrection/listFollows/toDTO。
- Prisma 模型 `PublishedAnnouncementVersion` 已存在（schema L319-337）：`status` published/superseded/
  withdrawn、`payload Json`、`versionNumber`、`previousVersionId`、`runId unique`。**无需 migration。**
- `AnnouncementsService.publish()` 当前写入的 payload 是 `ExtractionCandidate`
  （`{fields, parserVersion, rawJson}`，domain.ts L70/L255）→ 不是用户端目录载荷。
- `tests/fixtures/samples/published-announcement.ts` 与 `backend/src/opportunities/v72-chain-regression.spec.ts`
  约定 WP3 目录载荷为 `{ dataset, announcement, version }`。
- 后端无 HTML 解析依赖（package.json 无 cheerio/jsdom）；适配器用确定性正则解析。
- `tests/fixtures/isolation.test.ts` 扫描 `src/` 与 `backend/src/`，禁止 **import/require/from** 指向
  `tests/fixtures`。读取黄金样本必须用 `fs` + 运行时拼接路径（不出现 import 语句）。
- `PrismaModule` 为 `@Global()`，直接导出 `PrismaService`。
- 后端测试：`vitest run`，`include: ['**/*.spec.ts']`（含 `backend/test/` 与 `backend/src/`）。

## 3. 决策（需批准）

### D1. Feature Flag `ff_db_catalog`
新增 `backend/src/catalog/feature-flag.ts`：

```ts
export function isDbCatalogEnabled(env = process.env): boolean {
  const v = env.FF_DB_CATALOG;
  if (v === 'on' || v === 'true' || v === '1') return true;
  if (v === 'off' || v === 'false' || v === '0') return false;
  return env.NODE_ENV === 'production'; // 生产默认开，dev/test 默认关（=现状）
}
```

- **开**：匹配只读 DB 已发布版本（生产唯一事实源），静态目录一律不参与；
- **关**：沿用现状（滚动演示 + 真实台账），仅 Demo/测试。
- 新公告发布后**无需重部署**：flag 由环境变量在部署时一次性设置，内容是数据（DB 行），
  新增行即时生效。

### D2. Repository 状态读取口径
`listPublished(now)` 读取 `status ∈ {published, superseded, withdrawn}`，但语义严格分层：

- **published 是唯一事实源**：一个公告的“当前事实”取 versionNumber 最高、且投影成功的 published 行；
- **superseded 仅用于**：① 版本链展示（`buildUnitDetail.previousVersions`）；② 投影失败回退；
- **withdrawn 仅用于**：标记 `lifecycle='withdrawn'`（审计保留 + 命中 `announcement_withdrawn` 闸门）；
- 不新增任何事实，不引入反向依赖（不读 run/snapshot/source 关系）。

> 备选（更严格字面）：只读 `status='published'`。代价：无法实现“投影失败保留上一版”与
> withdrawn 审计标记。默认采用上表；如需改严格字面，请在批准时指明。

### D3. 目录载荷契约（CatalogPayload）

```ts
interface CatalogAnnouncementPayload {
  dataset: 'test' | 'demo' | 'real';
  announcement: Omit<RecruitmentAnnouncement, 'versions'>; // lifecycle 以行状态为准
  version: AnnouncementVersion; // 含 officialSource / timeline / units
}
```

同一 `announcementId` 的多行构成版本链 → 组装为一个 `RecruitmentAnnouncement{ versions:[...] }`
（对齐 `backend/src/matching/types.ts`）。**不改变** 现有 publish 流水线的 `ExtractionCandidate`
语义（本工作包不重写该流水线）。

## 4. 交付物（精确文件）

### 4.1 `backend/src/catalog/`
- `feature-flag.ts`：D1。
- `publication-projector.ts`：
  - `class ProjectionError extends Error { readonly fieldPath: string }`
  - `projectCatalogVersion(row, now): { announcement: RecruitmentAnnouncement; version: AnnouncementVersion }`
  - 严格结构校验：dataset 枚举；announcement 必需字段（id/title/publisher/organizationType/officialUrl/
    subjectScope(string[])/region/firstPublishedAt）；version 必需字段（id/announcementId/versionNumber(int)/
    sourceKind(枚举)/publishedAt(合法 ISO)/officialSource(含 state)/timeline(object)/units(array)）；
    每个 unit 校验 id/code/name/announcementId/versionId/region/subject/stage/headcount(int)/
    organizationType/employmentNature/allocation/requirements(array)。
  - 任一缺失/类型错误 → 抛 `ProjectionError`（**不静默**，message 含字段路径）。
  - `lifecycle` 由行状态派生：`status==='withdrawn' → 'withdrawn'`，否则 payload 或 `'active'`。
- `published-catalog.repository.ts`：
  - `constructor(private readonly prisma: PrismaService)`
  - `listPublished(now: Date): Promise<RecruitmentAnnouncement[]>`：D2 + 逐 versionNumber 降序投影，
    首个成功者为 current，失败者跳过并 `Logger.warn`（含 announcementId/versionNumber/字段路径，**不记 URL query**）；
    全部失败则该公告整体跳过（**失败不覆盖上一版**）。
  - `getUnit(unitId, now): Promise<{ announcement; version; unit } | null>`。
  - 仅调用 `prisma.publishedAnnouncementVersion.findMany`（与回归 spec 的 mock 兼容）。
- `catalog.module.ts`：providers/exports `PublishedCatalogRepository`。

### 4.2 `backend/src/sourcing/`
- `fetch/safe-fetcher.ts`：
  - 类型：`SafeFetchRequest{url}`、`FetchResult{status, finalUrl, headers{etag?,lastModified?,contentType?},
    body, contentHash, mimeType, durationMs, redirects, bytes}`、`SafeFetchError{code}`。
  - 选项（全部可注入以便测试）：`allowedHosts`、`maxRedirects=3`、`connectTimeoutMs=5000`、
    `totalTimeoutMs=15000`、`maxBytes=8MiB`、`userAgent`（明确 UA）、`expect:'html'|'any'`、
    `resolveDns(host)=>Promise<string[]>`、`fetchImpl`、`retry{attempts=3,baseDelayMs}`、`sleep`。
  - 校验顺序见 §5 安全策略表。
- `official-site-adapter.ts`：`DownloadedSnapshot{url,mimeType,content,fetchedAt}`、
  `ParsedListItem{title,publishedAt,detailUrl}`、`ParsedDetail{canonicalUrl,title,publishedAt,bodyText,attachments}`、
  `interface OfficialSiteAdapter { sourceId; listItems(s); parseDetail(s); }`。
- `adapters/hangzhou-education.adapter.ts`：唯一来源=杭州；确定性正则；
  相对 URL 转绝对；输出规范化 URL + 最小元数据；**只读快照、不联网、不写库、不抽资格结论**；
  DOM 失配抛 `AdapterParseError('DOM_MISMATCH: ...')`（**绝不静默返回 0**）。
- `sourcing.module.ts`：providers/exports SafeFetcher、HangzhouEducationAdapter。

### 4.3 `backend/src/opportunities/opportunities.service.ts`（改造）
- 构造：新增第 4 个参数 `@Optional() @Inject(PublishedCatalogRepository) catalogRepository?`
  （缺省时内部 `new PublishedCatalogRepository(prisma)`）→ 现有 3 参构造测试保持可用。
- `private async loadCatalog(now: Date): Promise<readonly RecruitmentAnnouncement[]>`：
  flag 开 → `catalogRepository.listPublished(now)`；关 → 现状静态（滚动 + 真实台账）。
- 将同步 `getPublishedAnnouncements()` 的消费点改为**按请求加载一次**并把 catalog 作为参数下传：
  `findCatalogUnit(unitId, catalog)`、`findCatalogUnitMeta(unitId, catalog)`、
  `initialMaterialStatuses(unitId, catalog)`、`buildCatalogSnapshot(catalog)`、
  `fromRow(row, catalog)`、`toDTO(follow, catalog)`、`toCorrectionDTO(row, catalog)`。
- 所有公开方法（均已 async）在开头 `const catalog = await this.loadCatalog(new Date())`。
- flag 开时静态目录**完全不参与**（不 merge）。

### 4.4 `backend/src/opportunities/opportunities.module.ts`
`imports` 增加 `CatalogModule`（保证 DI 注入 repository）。

### 4.5 测试文件
| 文件 | 覆盖 |
|---|---|
| `backend/src/catalog/publication-projector.spec.ts` | 结构合法投影；缺字段/类型错抛 ProjectionError；withdrawn→lifecycle |
| `backend/src/catalog/published-catalog.repository.spec.ts` | 发布/草稿（无行=不出现）/撤回（withdrawn 标记或排除）/投影失败保留上一版/静态不进入生产/仅用 findMany |
| `backend/src/sourcing/fetch/safe-fetcher.spec.ts` | allowlist；协议；凭据 URL；localhost/环回/私网/链路本地/元数据；DNS 复查；逐跳重定向复查+次数上限；私网与跨域重定向拒绝；连接/总超时；超大响应；错误 MIME/magic bytes；301/302/304/429；429/408/502/503/504 重试、普通 4xx 不重试；相同哈希；日志脱敏 |
| `backend/src/sourcing/adapters/hangzhou-education.adapter.spec.ts` | 黄金样本正常解析（列表/正文/附件/相对→绝对 URL）；DOM 变化抛 DOM_MISMATCH（不返回 0） |
| `backend/src/sourcing/wp3-html-closure.e2e.spec.ts` | 真实端到端：黄金 list→detail → SafeFetcher（注入 fetch/dns）→ 快照 → Adapter → 目录载荷 → 写 published 行 → repository → match 出现该 unit，且未改静态目录 |
| `backend/src/opportunities/v72-chain-regression.spec.ts` | 链路③：flag 关=现状（dbReads 0、无 DB 单元）；flag 开=目标（DB 单元出现、dbReads>0）→ 去掉 `it.fails` |
| `tests/fixtures/isolation.test.ts` | 不变（保持通过；spec 用 fs 路径读取样本，不 import） |

> 黄金样本读取统一用 `fs.readFileSync(path.resolve(__dirname, <segments...>))`，路径段不含
> import/require 语句，满足隔离测试正则。

## 5. SafeFetcher 安全策略（R-WP3-03，SSRF）

| 步骤 | 规则 | 失败 |
|---|---|---|
| 协议 | 仅 `http:`/`https:` | `PROTOCOL_NOT_ALLOWED` |
| 凭据 | `url.username`/`password` 非空即拒 | `URL_HAS_CREDENTIALS` |
| allowlist | host 必须等于/后缀匹配 `allowedHosts` | `HOST_NOT_ALLOWED` |
| 字面 host | `localhost`、`*.localhost`、`metadata.google.internal` 拒绝 | `BLOCKED_HOST` |
| DNS 复查 | 解析全部 A/AAAA；任一 IP 命中封禁网段即拒 | `BLOCKED_IP` |
| 封禁网段 | IPv4: `0.0.0.0/8,127/8,10/8,172.16/12,192.168/16,169.254/16,100.64/10,198.18/15,224/4`；IPv6: `::1,::,fc00::/7,fe80::/10,ff00::/8` | 同上 |
| 重定向 | 每跳重新执行以上全部校验；最多 `maxRedirects` 跳 | `TOO_MANY_REDIRECTS` / `HOST_NOT_ALLOWED` |
| 超时 | 连接超时 + 覆盖重定向与读体的总超时（AbortController） | `TIMEOUT` |
| 体积 | 流式累计，超 `maxBytes` 即中止 | `TOO_LARGE` |
| MIME | `expect='html'` 时 Content-Type 须 text/html；magic bytes 嗅探首段（doctype/`<`）不符即拒 | `BAD_CONTENT_TYPE` / `MAGIC_BYTES_MISMATCH` |
| 编码 | 记录 Content-Encoding；交由 fetch 解压；不写入日志明文 | — |
| UA | 显式 User-Agent | — |
| 记录 | status、ETag、Last-Modified、sha256、耗时、跳数、字节数 | — |
| 日志 | 只记 host+path（去 query）、状态、hash、耗时；**不记凭据/query** | — |
| 重试 | 429/408/502/503/504 指数退避（尊重 `Retry-After`）；普通 4xx **不重试** | — |

## 6. 静态目录 / 生产隔离

- flag **开**（生产）：唯一数据源 = `PublishedAnnouncementVersion(status=published)`；`catalog.ts`/
  `rolling-catalog.ts`/`real-catalog.ts` 不参与。
- flag **关**（Demo/测试）：现状静态目录。
- 测试样本（`dataset:'test'`）与 `tests/fixtures` 不入生产（隔离测试守护）。
- 无 Prisma migration。

## 7. 完成标准与验证命令

- 新公告发布后无需改代码/重部署即可匹配 ✔（flag 开路径 + E2E 测试）
- 生产不读静态目录 ✔（flag 开路径测试 + 代码审查）
- SafeFetcher 通过 SSRF 测试 ✔
- 结构异常不静默 ✔（Adapter DOM_MISMATCH / Projector ProjectionError）
- 高影响事实保留证据 ✔（payload 含 officialSource/requirements evidence）
- 失败不覆盖上一版 ✔（repository 回退/跳过）

**验证**（在 `backend/` 目录）：
```
npm test
npm run lint
npm run build
```
若改动触及根前端则另跑根目录 `npm test && npm run lint && npm run build && npm run check:external`
（本工作包预期不改前端）。

## 8. 风险

- 服务层同步→异步改造面较大，需回归 `follow`/`goals` 既有 spec；`fromRow` 依赖 catalog 参数需逐点核对。
- 现有 publish 流水线 payload（ExtractionCandidate）与目录载荷不一致：本工作包**不重写**，
  由 E2E 测试以目录载荷写入 published 行证明读取闭环；如需生产 publish 直接写目录载荷，
  另立后续工作包。

> **后续说明（WB5，2026-10-20）**：该断点已由 WorkBuddy 流水线 WB5「目录载荷与发布闭环」
> 补齐——`backend/src/announcements/catalog-payload-assembler.ts` 提供单一目录载荷构造器，
> `announcements.service.ts` 的 `publish()` 现按「门禁 → 构造 → 事务前 projector 严格校验 →
> 事务内 supersede+insert+run update」写入目录载荷。WP3 本包的历史范围（projector/repository
> 读取侧）保持不变；WB5 是新增的写入侧工作，两者分开记录，不互相改写。
- `evidence_stale`（72h）可能使 DB 样本落入 `groups.closed`，但该单元仍出现在响应 JSON 中，
  满足回归断言；如断言改为“进 preliminary”，需把样本 checkedAt 设为近期（属于测试数据，非代码）。
