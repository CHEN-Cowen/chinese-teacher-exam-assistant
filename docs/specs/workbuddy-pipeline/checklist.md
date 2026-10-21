# WorkBuddy 完成清单（WB1–WB6）

> 状态：WB0 已完成（规格 + 黄金样本 + 隔离测试）。WB1、WB2、WB3、WB4、WB5、WB6 已完成。
> 本文把后续工作拆成六个模块，每个模块标注前置条件、完成门、非目标。

## 总前置条件（所有模块共用）

- 已读 `docs/specs/workbuddy-pipeline/spec-workbuddy.md`、`field-catalog.md`、`checklist.md`；
- 已读 `tests/fixtures/workbuddy/golden-sample.json` 与 `README.md`；
- 遵守 `AGENTS.md`：涉及领域模型改动前读 v7.2/v7.1/v7.0 文档；
- 不修改 `src/` / `backend/src/` 生产逻辑之外的契约（除非该模块明确允许）。

## 模块拆分

### WB1：候选字段契约落地（scope/status/jobKey/ruleVersion）

- **目标**：把 `backend/src/announcements/domain.ts` 的 `CandidateField` 扩展为规格 §3 契约，
  补齐 `status`（extracted/unknown/conflict）、`scope`、`jobKey`、`ruleVersion`、`alternatives`。
- **前置条件**：WB0 规格与黄金样本就绪（已完成）。
- **完成门**：
  - `CandidateField` 具备规格 §3 全部字段，且向后兼容旧字段；
  - 三种状态语义与规格 §4 一致（unknown ≠ 不符合；conflict 不静默覆盖）；
  - 单测覆盖状态机与 `alternatives` 保留规则；
  - 黄金样本 `golden-sample.test.ts` 仍通过。
- **非目标**：不做抽取器改造、不做审核界面、不做发布转换。

### WB2：多行岗位表抽取（消除“只取首行”）

- **目标**：改造 `field-extractor.ts`，让表格抽取支持多行岗位，
  每行独立产出 `scope=job` + `jobKey` 的字段，消除“只取首数据行”的缺口。
- **前置条件**：WB1 契约落地。
- **完成门**：
  - 同一工作表的多行岗位各自产生字段，jobKey 互不相同；
  - 岗位字段值不跨行混用（用黄金样本跨岗位混值断言守护）；
  - 无官方岗位编号时生成位置键并标记“待人工固化”；
  - 单测覆盖 2+ 行岗位表、跨岗位不同专业/学历。
- **非目标**：不建稳定岗位持久化（那是 WB3）、不做审核界面。

### WB3：高风险字段与质量门禁（已完成）

- **目标**：让未知、冲突、语义保真和证据要求成为可执行规则。建立单一字段注册表，
  语义保真标准化纯函数，完整性与冲突报告 + 门禁纯函数；不实现 UI、正式发布或导出。
- **前置条件**：WB1、WB2 完成。
- **完成门**：
  - 字段清单只有一个代码事实源（`field-registry.ts`，`HIGH_IMPACT_FIELDS` 从它派生）；
  - 语义保真标准化只做 Unicode/空白/全半角/首尾清理，保留「师范」、不合并学历、
    编制不猜测、年龄基准日/例外不推断、报名 URL 不猜测（`normalization.ts`）；
  - 完整性与冲突报告为纯函数：逐岗位 expected/extracted/unknown/conflict 计数、
    缺证据高影响字段、未确认 AI/OCR 字段、冲突替代值数量、阻塞审核/发布原因（均带 scope+field）；
  - 门禁：pending/unknown/conflict/高影响缺证据不静默进入可发布状态；
    可选字段 unknown 可进人工审核但结果可见；AI/OCR 门禁继续有效；
  - 不声称字段正确率，只报告完整性/采用率/修改率等可复算指标；
  - 旧公告级候选兼容（「必需字段缺失」不作硬发布门禁）。
- **非目标**：不做候选→目录两阶段转换与稳定 jobId 持久化（那是后续 WB 的目录转换职责）、
  不做审核 UI、不做发布/导出行为。

### WB4：按岗位人工审核工作台（已完成）

- **目标**：在现有 `/admin/pipeline` 三层对照上扩展为按岗位审核工作台，不新建第二套后台。
  让管理员能按岗位完成采用（adopt）/编辑（edit）/退回（reject）/待确认（pending）并看到真实审核记录。
- **前置条件**：WB1（scope/status/decision）、WB2（多岗位抽取）、WB3（字段注册表+质量门禁）完成。
- **完成门**：
  - 5 分区信息架构：公告公共事实 / 岗位列表 / 当前岗位字段 / 原文证据与解析警告 / 质量门禁与审核动作；
  - 逐字段 adopt/edit/reject/pending，unknown/conflict 显著可见，证据定位可复制不泄露签名 URL；
  - 批量操作仅当前岗位，不提供「一键全部通过」；公告级与岗位字段分别审核；
  - 提交前再次调用 WB3 门禁（冲突未裁决阻塞 approve）；AI/OCR 字段仅 adopt/edit 写入确认时间；
  - 乐观并发（baseUpdatedAt 不匹配返回 409）；保存失败保留输入；提交成功刷新服务端真实记录；
  - 旧公告级候选无 scope 归入「公告公共事实」兼容分组；
  - UI 不自行计算正确率，只显示后端 WB3 可复算质量状态。
- **非目标**：不改抓取器、普通用户机会页、匹配算法、目录 projector 或 publish 行为；不新增 Prisma migration。

### WB5：目录载荷与发布闭环（已完成）

- **目标**：修复 announcements 发布载荷（`ExtractionCandidate`）与 catalog projector
  契约（`{ dataset, announcement, version }`）之间的断点，用集成测试证明闭环。
  单一目录载荷构造器把「已审核候选 + 受信元数据 + 版本上下文」构造成 projector
  接受的目录载荷；发布前加门禁与严格结构校验；失败发生在事务前或整体回滚。
- **前置条件**：WB1（scope/status/decision）、WB2（多岗位抽取）、WB3（质量门禁）、
  WB4（审核工作台）完成。
- **完成门**：
  - 单一目录载荷构造器 `catalog-payload-assembler.ts`（纯函数），元数据只来自可信
    DB 字段/审核输入/官方证据，缺失返回结构化错误，禁止从标题或 URL 猜地区/单位/
    用工性质/报名入口；
  - 每个已审核 job scope 映射一个 catalog unit，unit id/version id 稳定；
  - unknown/conflict/pending/缺证据的高影响字段不静默进入「已确认」要求；
  - 发布顺序：读 run+审核 → assertCanPublish + WB3 门禁 → 构造目录载荷 →
    事务前 projectCatalogVersion 严格校验 → 事务内 supersede+insert+run update；
  - legacy `ExtractionCandidate` 发布行不可变、不批量重写，投影失败记录失败/回退；
  - 显式 payload 类型守卫（`isCatalogPayload`），禁止 `as unknown as` 掩盖契约差异；
  - `dataset` 只允许 test/demo/real，real 要求官方来源证据且演示来源不得标 real；
  - 集成测试覆盖两个岗位两个 units、字段不混岗、各阻塞路径、事务原子性、
    重复发布、legacy 兼容、撤回与版本链回归。
- **非目标**：不扩展抓取来源、普通用户 UI、导出、匹配规则或静态目录。
- **已知风险（2026-10-21 验收登记）**：旧版手动提取路径 `AnnouncementsService.runExtraction`
  仍走 `parser.ts`（公告级、无 scope）；经该路径产生的候选没有 job scope，发布会正确报错
  「没有已审核岗位」而非静默发布。生产多岗位链路应走队列
  `AnnouncementExtractService` → `extractFields`（WB2 抽取器已接入）。后续应统一
  提取入口或在操作规范中明示该约束。
- **实现文件**：
  - `backend/src/announcements/catalog-payload-assembler.ts`（构造器 + 类型守卫）
  - `backend/src/announcements/announcements.service.ts`（publish 门禁与事务）
  - `backend/src/announcements/announcements.controller.ts`（publish 接收 dataset）
  - `backend/src/announcements/catalog-payload-assembler.spec.ts`
  - `backend/src/announcements/publish-catalog.integration.spec.ts`

> 说明：本清单原 WB5「字段标准化与证据链完善」内容已由 WB3（标准化纯函数）承接，
> 原「稳定岗位标识与发布载荷转换」职责由本次 WB5（目录载荷构造 + 发布闭环）落实。
> WP3（v7.2-wp3-db-catalog）当时**未重写** announcements publish 流水线（见其 spec §8），
> 本次 WB5 是补上该断点的新增工作，不与 WP3 历史范围混为一谈。

### WB6：审核导出与实测指标（已完成）

- **目标**：让 WorkBuddy 比赛成果「可下载、可复核、可复算」。提供审核导出（JSON/CSV）
  与实测指标摘要；不修改抽取、候选质量判定或正式发布逻辑。
- **前置条件**：WB1（scope/status）、WB2（多岗位抽取）、WB3（注册表/门禁）、
  WB4（审核工作台与字段决策）完成。
- **完成门**：
  - 两种导出：JSON（保留结构化 scope、证据定位、alternatives、人工审核记录）；
    UTF-8 CSV（一行一个「岗位 × 字段」，14 列固定顺序：sample_id/job_id/field/value/
    source_file/quote/locator/status/scope/rule_version/run_id/human_revision/reason/
    alternatives，schema 版本 `wb-export@1.0.0`）；
  - 导出基于服务端已保存记录（run.candidate + reviewRecords），不从 UI 状态拼装；
  - CSV 公式注入防护（= + - @ 前缀 `'`，原值可追溯，JSON 导出保留完全原值）；
    逗号/引号/换行/中文正确转义；
  - 脱敏：URL locator 复用既有 redactUrl 规则（host+path，query 丢弃）；不输出访问令牌、
    Cookie、签名 query、数据库连接信息或用户敏感画像；rawJson 不导出；
  - 导出接口复用管理员权限（AdminGuard），Content-Type/Content-Disposition/
    Cache-Control: no-store 齐备；
  - 实测指标按 run + 按公告公共/逐岗位输出：应有字段数、extracted/unknown/conflict、
    有证据/应有高影响字段数、adopt/edit/reject/pending、人工修改字段数、
    总耗时/人工审核耗时/重试次数；每个比例同时给分子、分母、公式；
    无时间戳显示「未记录」不补零；无黄金答案不输出准确率/召回率/提效百分比；
  - UI：/admin/pipeline 审核页提供下载 JSON/CSV、指标口径说明、数据集标记
    （测试/演示/真实/未标记 + example 域名提示）；导出失败给出可恢复错误，
    不生成空文件冒充成功。
- **非目标**：不改抽取器、质量门禁、publish、matching、Prisma schema 或普通用户页面；
  不新增 CSV 库（标准 RFC 4180 自实现）。
- **实现文件**：
  - `backend/src/announcements/export.ts`（纯函数：CSV 构造/转义/防护、脱敏、指标）
  - `backend/src/announcements/export.service.ts`（只读导出服务）
  - `backend/src/announcements/announcements.controller.ts`（三个只读导出端点）
  - `src/app/admin/pipeline/export-section.tsx`（导出按钮与指标摘要组件）
  - `src/lib/announcements-pipeline/api.ts`（导出 API 与指标类型）
  - `backend/src/announcements/export.spec.ts`（25 项纯函数测试，含黄金样本复算）
  - `backend/src/announcements/export.service.spec.ts`（7 项服务与权限测试）
  - `src/app/admin/pipeline/export-section.test.tsx`（8 项 UI 测试）

> 说明：本清单原 WB6「端到端回归与验收」按用户最新要求重定义为「审核导出与实测指标」。
> 原回归验收内容（全链路回归、追踪表更新）已随各模块完成时分别验证。

## 依赖顺序

```text
WB0（本清单，已完成）
 └─► WB1（契约） ─► WB2（多行抽取） ─► WB3（高风险字段+质量门禁，已完成）
        │              │                    │
        └─► WB4（审核工作台，已完成）  WB5（目录载荷与发布闭环，已完成）
             WB6（审核导出与实测指标，已完成，消费 WB1–WB4 全部产物）
```

> 注：WB3 按用户最新要求重定义为「高风险字段与质量门禁」，WB4 按用户最新要求
> 重定义为「按岗位人工审核工作台」，WB5 按用户最新要求重定义为「目录载荷与发布闭环」，
> WB6 按用户最新要求重定义为「审核导出与实测指标」（原端到端回归内容已随各模块完成时分别验证）。
> WP3（v7.2-wp3-db-catalog）仅落地了 projector/repository 读取侧，未重写 publish 写入侧；
> WB5 补上写入侧闭环。

## 非目标（全模块共通）

- 不重建抓取器、队列、对象存储（v7.2 WP4 已存在）；
- 不重建后台管理页面（`/admin/sources`、`/admin/pipeline` 已存在）；
- 不新增依赖、migration、页面、API（除非模块完成门明确要求）；
- 不在 WB6 之前宣称任何 WB1–WB5 已完成。
