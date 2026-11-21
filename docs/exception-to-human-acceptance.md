# 异常转人工与人工处理闭环升级：专项验收报告

更新日期：2026-11-08。分支 `codex/all-subject-rag`，基线提交 `7ab9cd8`。产品基线为根目录 [PRD](../PRD.md) 第 14 节；运营步骤见 [人工服务运营手册](service-desk-operations.md)。

本报告只记录本轮实际做到的检查。状态四分类含义固定：

| 状态 | 含义 |
|---|---|
| 代码已实现 | 代码与增量迁移已落地，类型检查/构建通过 |
| 单测通过 | 有自动化测试实际执行通过（含 fake Prisma / 注入时钟） |
| 隔离未验 | 需要真实数据库、Redis、Worker 或多角色浏览器，当前环境不具备，**未执行** |
| 待运营配置 / 待生产验证 | 需要真实人员账号、值守安排、生产审批，代码完成不等于已落实 |

> 本机当前无 PostgreSQL(5432)/Redis(6379) 监听、无 Docker。凡依赖真实运行环境的用例，均标为“隔离未验”，不写成通过。工作区另有其他任务未提交改动（如 `scripts/probe-*.mjs`、`src/app/page.tsx` 等），本轮未覆盖、未清理。

## 1. 结论摘要

- 第一层（原工单补充、真实发布关联、查询失败保留入口、站内通知深链）代码完成，核心门禁与状态机有单测。
- 第二层（负责人、认领转交、优先级、工作台、内部时限、暂停恢复、催办升级去重）代码完成，领域规则与扫描去重有单测。
- 扫描件待人工与来源告警已作为派生任务接入统一工作台，并有各自结案门禁。
- 未能执行：真实迁移、真实 Worker + DB + Redis 演练、四角色浏览器验收、375px/1440px/键盘检查。
- 真实日常/备用负责人、值守安排、生产 Worker 状态：**待运营配置**，不得对外宣称运营已就绪。

## 2. 本轮改动清单

### 后端

| 文件 | 作用 |
|---|---|
| [schema.prisma](../backend/prisma/schema.prisma) | `User.isActive`、`NotificationRecord.linkPath`、纠错/补录关联字段；新增 `ServiceTask`、`TicketSupplement`、`TicketEvent`、`ServiceDeskConfig`、`ServiceDeskPolicy`、`ServiceDeskConfigAudit`、`ServiceDeskReminder` |
| [migration.sql](../backend/prisma/migrations/20261108120000_service_desk_closure/migration.sql) | 增量迁移：`ADD COLUMN IF NOT EXISTS`、`CREATE TABLE/INDEX IF NOT EXISTS`；历史已收录无关联仅标记 `history_pending_verification`，不伪造回填 |
| [service-desk.domain.ts](../backend/src/service-desk/service-desk.domain.ts) | 状态机、优先级建议、SLA、暂停恢复、提醒周期键、负责人校验、补充输入校验、发布门禁、派生结案、编号 |
| [service-desk.service.ts](../backend/src/service-desk/service-desk.service.ts) | 配置/策略/审计、建壳与派生同步、补充、队列/详情、认领转交、优先级、备注、请求补充、结案、扫描催办升级、指标、发布结果检索 |
| [service-desk.controller.ts](../backend/src/service-desk/service-desk.controller.ts) | `/admin/service-desk` 全套接口，`AdminGuard`/`StrictAdminGuard` 鉴权 |
| [service-desk.worker.ts](../backend/src/service-desk/service-desk.worker.ts)、[service-desk-worker.module.ts](../backend/src/service-desk/service-desk-worker.module.ts)、[service-desk.tokens.ts](../backend/src/service-desk/service-desk.tokens.ts) | BullMQ 重复扫描任务、advisory lock、可用 `SERVICE_DESK_SCAN_INTERVAL_MS` 缩短隔离演练间隔 |
| [opportunities.service.ts](../backend/src/opportunities/opportunities.service.ts) | 提交时同事务建壳并返回受理编号；本人列表分页与详情；原工单补充委托；补录结案强门禁与撤回/取代竞态复核；通知 `linkPath` |
| [opportunities.controller.ts](../backend/src/opportunities/opportunities.controller.ts) | 新增本人列表/详情/补充路由；员工补录处理 DTO 增加预期公告/版本/依据 |
| [corrections.domain.ts](../backend/src/opportunities/corrections.domain.ts)、[announcement-submission.domain.ts](../backend/src/opportunities/announcement-submission.domain.ts) | `pending_review`、状态文案、工单编号、历史待核验与关联字段 |
| [schedule.service.ts](../backend/src/schedule/schedule.service.ts) | 通知 DTO 增加 `linkPath` 并透传 |
| [app.module.ts](../backend/src/app.module.ts)、[worker-app.module.ts](../backend/src/worker-app.module.ts) | 接入 API 模块与 Worker 模块 |
| 单测 | [service-desk.domain.spec.ts](../backend/src/service-desk/service-desk.domain.spec.ts)（23）、[service-desk.service.spec.ts](../backend/src/service-desk/service-desk.service.spec.ts)（5）、[opportunities.service.spec.ts](../backend/src/opportunities/opportunities.service.spec.ts)（54，含新增门禁用例）、[prisma-migrations.spec.ts](../backend/test/prisma-migrations.spec.ts)（新增迁移静态覆盖） |

### 前端

| 文件 | 作用 |
|---|---|
| [MyTicketSection.tsx](../src/components/opportunities/MyTicketSection.tsx) | 我的纠错/补录固定入口；加载/空/失败+重试/旧数据+最后成功时间/登录返回；详情、公开时间线、历次补充、原工单补充表单；分页与深链 |
| [me/page.tsx](../src/app/me/page.tsx) | 接入上述组件；`pending_review` 文案；已收录且有有效版本时给“查看公告”入口 |
| [api.ts](../src/lib/opportunities/api.ts)、[api-types.ts](../src/lib/opportunities/api-types.ts)、[demoApi.ts](../src/lib/opportunities/demoApi.ts) | 分页列表、详情、补充与演示模式等价实现 |
| [NotificationCenter.tsx](../src/components/governance/NotificationCenter.tsx) | 仅接受站内相对 `linkPath`，否则回退默认入口 |
| [workbench/page.tsx](../src/app/admin/workbench/page.tsx) | 8 分组、筛选、分页、详情操作（认领/核对/请求补充/转交/优先级/备注/纠错结案/补录检索发布版本结案/派生任务结案/历史/未配置提示） |
| [settings/service-desk/page.tsx](../src/app/admin/settings/service-desk/page.tsx) | 管理员配置日常/备用负责人、原因留痕、三档时限编辑 |
| [admin/layout.tsx](../src/app/admin/layout.tsx) | 后台新增“人工工作台”入口 |
| [service-desk/api.ts](../src/lib/service-desk/api.ts) | 工作台/配置/检索客户端与类型 |

### 文档与脚本

| 文件 | 说明 |
|---|---|
| [PRD.md](../PRD.md) | 新增第 14 节：边界、流程、状态、门禁、运营能力、时限、指标与手册指向 |
| [service-desk-operations.md](service-desk-operations.md) | 运营手册（配置、日常检查、备用接手、结案、故障恢复、时限调整、待配置清单） |
| [exception-to-human-acceptance.md](exception-to-human-acceptance.md) | 本报告 |
| [service-desk-sla-drill.mjs](../scripts/service-desk-sla-drill.mjs) | E08 隔离演练脚本：真实 API + DB + Redis + 独立 Worker，缩短时限验证催办/升级/去重/并发转交 |

## 3. 需求—实现—验证映射（验收用例）

### A 原工单补充

| 用例 | 需求 | 代码 | 测试/证据 | 状态 |
|---|---|---|---|---|
| A01 | 员工请求补充→站内通知→用户回复→待复核→原负责人继续 | `requestSupplement`（service-desk.service.ts）、`reviewCorrection` need_supplement 分支、`notifySupplementReceivedTx` | `opportunities.service.spec`：`D08：need_supplement 必须附说明…`；domain：`待复核只能由补充产生…` | 代码已实现 / 单测通过 / 浏览器未验 |
| A02 | 多轮补充保留、编号与原文不变 | `TicketSupplement` 追加式、`TicketEvent` 追加式、编号由 `refId` 确定性生成 | domain：`用户补充只允许「待用户补充」…`；编号测试 `同一业务对象生成稳定编号` | 代码已实现 / 单测部分 / 隔离未验 |
| A03 | 空白、超长、危险链接拒绝；安全转义 | `validateSupplementInput`（1—2000 字、≤5 链接、仅 http/https、拒绝凭据/内网/危险协议）；前端同规则校验 | domain：`正文 1—2000 字…`、`最多 5 个链接…` | 代码已实现 / 单测通过 |
| A04 | 双击/重发/并发幂等只保存通知一次 | `dedupeKey` 唯一索引 + 预查 + 条件 `updateMany` + `P2002` 容忍 | 现有单测未直接覆盖补充幂等 | 代码已实现 / 单测未覆盖 / 隔离未验 |
| A05 | 匿名、他人、终态、非法转换拒绝 | `UserGuard` 所有权校验、`canUserSupplement`、终态不可补充 | domain：`用户补充只允许…终态不能补充或重开` | 代码已实现 / 单测通过 / 他人访问待隔离验 |
| A06 | 失败保留草稿；401/409/超时/服务故障区分；已保存但刷新失败文案 | `MyTicketSection.tsx` 提交状态机、错误文案分层、`requestSeq` 防覆盖 | 前端无组件单测 | 代码已实现 / 浏览器未验 |
| A07 | 结案与补充并发只有一方成功 | 结案与补充均用 `statusVersion` 条件更新，冲突返回 409 | 无并发单测 | 代码已实现 / 单测未覆盖 / 隔离未验 |

### B 发布关联

| 用例 | 需求 | 代码 | 测试/证据 | 状态 |
|---|---|---|---|---|
| B01 | 采纳但未发布不能结案 | `resolveAnnouncementSubmission` 强制 `expectedAnnouncementId/expectedVersionId`，无关联拒绝 | `opportunities.service.spec`：`发布关联门禁：无关联、草稿/撤回/演示公告均拒绝…` | 代码已实现 / 单测通过 |
| B02 | 草稿、撤回、演示、无关公告、错误版本被拒 | `validatePublishedResolution`（published/未撤回/未取代/dataset=real/来源可信）+ 事务内复核 | 同上；domain：`草稿、撤回、被取代、演示数据、错误版本均拒绝` | 代码已实现 / 单测通过 |
| B03 | 合法结案通知与详情可打开真实公告 | 通知 `linkPath=/opportunities/<unitId>?version=<versionId>`；补录详情返回 `resolvedUnitId` | `员工处理补录…resolved 通知已收录`；纠错版本通知用例 | 代码已实现 / 单测通过 / 浏览器未验 |
| B04 | 已有相同公告直接关联，不重复创建 | 同 URL 规范哈希直接关联；补录去重 | domain：`相同链接可直接关联；不同链接必须填写 ≥10 字核验依据` | 代码已实现 / 单测通过 |
| B05 | 历史缺关联标记待核验，不伪造回填与查看入口 | 迁移只置 `history_pending_verification`；DTO 暴露标记；无 `resolvedUnitId` 不出“查看公告” | 迁移静态测试；`…历史待核验不伪造入口` | 代码已实现 / 单测通过（静态） / 真实迁移未执行 |
| B06 | 撤回与结案并发一致，后续变化不丢历史 | 事务内二次读取版本状态；撤回不删除结案记录 | 撤回/取代分支有门禁单测；并发时序未测 | 代码已实现 / 单测部分 / 隔离未验 |

### C 查询失败保留入口

| 用例 | 需求 | 代码 | 测试/证据 | 状态 |
|---|---|---|---|---|
| C01 | 空列表与失败不同，失败不隐藏入口 | `MyTicketSection`：loading / empty / error+retry 三态分离，模块常驻 | 前端无组件单测 | 代码已实现 / 浏览器未验 |
| C02 | 刷新失败保留旧数据与最后成功时间；重试只查不写 | `lastSuccessAt` + stale 提示；重试仅调用列表/详情接口 | 同上 | 代码已实现 / 浏览器未验 |
| C03 | 两模块独立失败；第 11 条之后可访问 | 纠错/补录各自状态；分页 `page/pageSize`，后端返回 `{items,total,page,pageSize}` | 后端分页结构有单测（`listMy*` 返回对象断言） | 代码已实现 / 单测部分 / 浏览器未验 |
| C04 | 登录返回原详情；切号不泄漏；旧请求不覆盖 | `/me?ticket=<kind>:<id>` 深链；`requestSeq`；401 提示登录 | 前端无组件单测 | 代码已实现 / 浏览器未验 |

### D 责任与权限

| 用例 | 需求 | 代码 | 测试/证据 | 状态 |
|---|---|---|---|---|
| D01 | 两不同有效员工可配置；相同/停用/无权拒绝 | `validateOwnerPair`、`updateConfig` | domain：`必须同时配置两个不同、启用且有处理权限的账号` | 代码已实现 / 单测通过 |
| D02 | 未配置/失效可见；用户仍可提交；不静默丢任务 | `getConfig.issues`、未分配队列、扫描路由管理员 | service：`负责人未配置且无备用：任务进入管理员未分配队列并被通知` | 代码已实现 / 单测通过 |
| D03 | 待认领、待复核、转交、备用接手记录完整 | `claim`/`transfer`/`startReview` + `TicketEvent` | 转交/认领仅有代码，无服务层单测 | 代码已实现 / 单测未覆盖 / 隔离未验 |
| D04 | 并发认领/转交保持单一负责人 | `updateMany where statusVersion` 条件更新 | 无并发单测；E08 脚本含旧版本 409 检查 | 代码已实现 / 隔离未验 |
| D05 | 负责人不自动获得发布权；会员不能管理；内部备注不外泄 | 负责人仅 `REVIEW_ROLES`；发布仍走审核流程；`visibility` 区分公开/内部 | `admin.guard.spec` 与门禁用例间接覆盖 | 代码已实现 / 单测部分 / 隔离未验 |
| D06 | 优先级与原因准确；未知截止不编造 | `suggestPriority`、`validatePriorityChange`（≥5 字原因） | domain：`已知报名截止在 72 小时内…`、`未知截止不编造…`、`人工调整必须填写…` | 代码已实现 / 单测通过 |

### E 催办与升级

| 用例 | 需求 | 代码 | 测试/证据 | 状态 |
|---|---|---|---|---|
| E01 | 注入时钟验证三档响应/更新/升级宽限 | `computeDeadlines`/`computeUpdateDeadlines` | domain：`默认三档时限…一致`、`首次响应与升级截止按自然小时计算` | 代码已实现 / 单测通过 |
| E02 | 查看、认领、内部备注不算有效响应 | `isEffectiveResponse` 白名单 | domain：`认领、查看、内部备注不算有效响应` | 代码已实现 / 单测通过 |
| E03 | 待补充暂停/恢复剩余额度；48h 提醒；7 天长期待补充 | `pauseDeadline`/`resumeDeadline`、`SUPPLEMENT_REMINDER_HOURS`、`LONG_WAITING_SUPPLEMENT_HOURS` | domain：`待用户补充暂停计时…`、`已超时暂停保存为 0`、`等待用户提醒阈值…`；service：`待用户补充只发补充提醒…` | 代码已实现 / 单测通过 |
| E04 | 一次催办、一次升级、接收人去重 | `ServiceDeskReminder` 唯一键 + `skipDuplicates` + 周期键 | service：`到期未有效响应只催办一次…`、`升级接收人去重…` | 代码已实现 / 单测通过 |
| E05 | 多 Worker/重扫/重启/补跑不轰炸；结案停止提醒 | BullMQ 持久化重复任务 + `pg_try_advisory_xact_lock` + 去重键 | service：重复扫描用例、`多实例互斥…` | 代码已实现 / 单测通过（fake Prisma） / 真实 Worker 未验 |
| E06 | 转交不清超时；配置/优先级不能静默延长期限 | 转交不改期限字段；`adjustDeadlineForPriority` 只提前不延长 | domain：`提高优先级可提前…降低不延长`；转交保留期限为代码保证 | 代码已实现 / 单测部分 |
| E07 | Redis/DB/通知故障恢复不丢任务、不造假成功 | 扫描失败捕获并记录，恢复后重扫；通知与业务同事务 | 故障分支无自动化注入测试 | 代码已实现 / 单测未覆盖 / 隔离未验 |
| E08 | 真实独立 Worker + 隔离 DB/Redis 缩短时限演练 | [service-desk-sla-drill.mjs](../scripts/service-desk-sla-drill.mjs) | 脚本已就绪、语法检查通过；本机无 DB/Redis/Docker，**未执行** | 隔离未验（环境阻塞） |

### F 其他人工任务

| 用例 | 需求 | 代码 | 测试/证据 | 状态 |
|---|---|---|---|---|
| F01 | 扫描件人工提取、校验、审核交接真实接通 | `completeDerivedTask`：校验 `documentParseRun.snapshotId` 与 `extractionRun` 同快照、状态与证据说明 | domain：`扫描件待人工必须交接到同快照的审核任务并附证据说明` | 代码已实现 / 单测通过（规则） / 真实交接未验 |
| F02 | 来源故障复用活动待办；恢复与漏采核对有据 | `syncDerivedTx` 从 `sourcingAlert` 复用未结案任务；`validateSourceAlertCompletion` 要求恢复复查/故障窗口/漏采核对 | domain：`来源受限不能标记已恢复…`；service 派生任务同步代码 | 代码已实现 / 单测部分 |
| F03 | 受限来源保留覆盖缺口，不把暂停当恢复 | `outcome=limited` 单独结案，写回告警说明 | domain 同 F02 | 代码已实现 / 单测通过（规则） |
| F04 | 原件权限、内部日志、内部任务不外泄 | 后台接口 `AdminGuard`；事件 `visibility=internal` 不进入用户详情 | 无专门泄漏测试 | 代码已实现 / 隔离未验 |

### G 迁移与回归

| 用例 | 需求 | 证据 | 状态 |
|---|---|---|---|
| G01 | 旧库增量迁移保留记录；重复迁移不破坏数据 | 迁移全量使用 `IF NOT EXISTS`；新增静态测试 `service desk closure migration is incremental, repeatable and never fabricates links` 通过；**真实库执行未做** | 代码已实现 / 静态检查通过 / 隔离未验 |
| G02 | 资格判断、定向补充、账号隔离、发布撤回、来源健康、通知不回归 | 后端全量 `121 files / 1479 passed / 1 expected fail / 2 skipped`；前端全量 `74 files / 796 passed`；后端 `tsc` 与 `nest build` 通过；前端 `tsc` 与 `next build` 通过 | 单测通过 |
| G03 | 浏览器连同一隔离后端，验证四类角色 | 需运行 API+DB+Redis+前端；本轮未执行 | 隔离未验 |
| G04 | 375px 手机、1440px 桌面、键盘操作 | 同上 | 隔离未验 |
| G05 | 单测、lint、类型、构建、Prisma validate、必要 E2E | 见第 6 节命令与结果；浏览器 E2E 未跑 | 部分通过 |

## 4. 完整案例（可执行步骤，当前未在真实环境执行）

### 4.1 原工单补充 → 纠错修正反馈

1. 用户 `POST /opportunities/units/:unitId/corrections`，响应返回 `{ id, ticketNo }`。
2. 员工在工作台详情 `POST /admin/service-desk/tasks/:id/request-supplement`，正文必填具体问题。
3. 用户收到站内通知，`linkPath=/me?ticket=correction:<id>`；未登录先登录再返回该地址。
4. 用户 `GET /opportunities/corrections/:id`，看到受理编号、原始反馈、状态、需补充内容、公开时间线、补充表单。
5. 用户 `POST /opportunities/corrections/:id/supplements`（正文 1—2000、≤5 个 http/https 链接、`dedupeKey`）；状态 `need_supplement → pending_review`，编号与原文不变。
6. 原负责人收到待办/通知；`POST /admin/service-desk/tasks/:id/start-review` 回到 `reviewing`。
7. `POST /admin/service-desk/tasks/:id/resolve-correction`，数据类纠错必须绑定已发布修正版本；用户收到含真实版本号的结果通知。

证据：A01/A02/A05 规则单测；`D08` 用例覆盖通知文案与可继续推进。浏览器与真实通知未验。

### 4.2 漏公告采纳 → 真实发布 → 关联 → 用户查看

1. 用户 `POST /opportunities/announcement-submissions`，返回 `{ id, ticketNo, status: submitted }`。
2. 工作台核对线索后，进入既有采集/人工录入/审核/发布流程，“已采纳”不等于“已收录”。
3. 员工在“结案（公告补录）”检索 `GET /admin/service-desk/published-results?q=`，只能选到 published、未撤回、未取代、`dataset=real` 的版本。
4. 不同链接必须填写 ≥10 字核验依据；后端在事务内复核撤回/取代竞态，保存公告 ID、结案版本 ID、依据、处理人与时间。
5. 用户详情显示“已收录，可查看”，`resolvedUnitId` 存在时给出正式公告入口；通知深链 `...?version=<versionId>`。
6. 后续撤回/更新：保留原结案依据与历史，详情显示最新状态，不再宣称旧版本有效。

证据：B01/B02/B03/B05 单测。真实发布链路与浏览器未验。

### 4.3 超时催办 → 升级 → 备用接手

执行 `node scripts/service-desk-sla-drill.mjs`（需隔离 API+DB+Redis+独立 Worker，`SERVICE_DESK_SCAN_INTERVAL_MS` 已缩短，负责人账号由管理员配置）：

1. 配置日常/备用负责人（两个不同、启用、有权限的现有账号）。
2. 三档时限临时缩短为 1 分钟（仅隔离环境）。
3. 用户提交补录线索，任务默认归属日常负责人。
4. 到期后扫描：任务进入“已超时”，日常负责人收到一次站内催办。
5. 立即重扫：提醒数不增加（去重）。
6. 超过升级宽限再扫：任务进入“已升级”，备用负责人收到一次升级提醒。
7. 旧 `statusVersion` 转交返回 409；当前版本转交成功，负责人原子变为备用负责人。
8. 脚本结束时恢复原时限与负责人配置；演练工单与历史保留。

证据：脚本已通过 `node --check`。**未执行**（本机无 DB/Redis/Docker）。

### 4.4 扫描件与来源告警交接

- 扫描件：`documentParseRun` 待人工 → 派生 `parse_manual` 任务；结案要求 `extractionRun` 与解析快照同源、状态有效、证据说明 ≥ 阈值；任务完成不等于公告已发布。
- 来源告警：同一未恢复告警复用活动任务；恢复类结案要求恢复复查、故障窗口、漏采核对；受限/停用单独 `limited` 结案并保留覆盖缺口与替代入口。

证据：F01/F02/F03 规则单测；真实扫描件与真实来源故障未验。

## 5. S0—S4 阶段报告

| 阶段 | 内容 | 结果 | 进入下一阶段条件 |
|---|---|---|---|
| S0 | 文档、现状、字段、接口、迁移盘点 | 完成：读 PRD/运营手册/验收文档；核对现有纠错、补录、解析、来源、通知代码；`git status` 记录 | 已更新唯一 PRD 第 14 节 |
| S1 | 原工单补充、发布关联、查询恢复、通知跳转 | 完成：后端 DTO/路由/服务、前端固定入口与补充表单、迁移 | 单测与构建通过；真实隔离 API 多角色链路**未验** |
| S2 | 负责人、认领转交、优先级、工作台、其他人工任务 | 完成：配置/策略/审计、工作台 8 分组、派生任务同步与结案门禁 | 权限规则单测通过；真实权限组合**未验** |
| S3 | 计时、暂停恢复、催办、升级、去重 | 完成：SLA 纯函数、扫描 Worker、唯一键去重、advisory lock | fake Prisma 扫描测试通过；真实 Worker 演练**未验** |
| S4 | 迁移、浏览器、故障、回归和手册 | 部分完成：迁移静态测试、全量单测、构建、lint、手册与脚本 | 真实迁移与浏览器验收**未执行** |

## 6. 本轮实际执行的命令与结果（2026-11-08）

| 检查 | 命令 | 结果 |
|---|---|---|
| 后端类型 | `npx tsc --noEmit -p tsconfig.build.json` | 通过，0 输出 |
| 后端构建 | `npm run build`（nest build） | 通过 |
| 后端单测 | `npx vitest run` | 121 files / 1479 passed，1 expected fail，2 skipped |
| 新增服务台单测 | `npx vitest run src/service-desk src/opportunities/opportunities.service.spec.ts` | 3 files / 82 passed |
| 迁移静态测试 | `npx vitest run test/prisma-migrations.spec.ts` | 3 passed |
| 后端 lint | `npm run lint`（oxlint） | 0 error / 37 warning（既有测试 unbound-method 等） |
| Prisma schema | `npx prisma validate` | schema valid |
| 前端类型 | `npx tsc --noEmit` | 通过 |
| 前端构建 | `npm run build` | 通过（含国内外部依赖检查） |
| 前端单测 | `npx vitest run` | 74 files / 796 passed |
| 前端 lint | `npm run lint` | 2 error，均来自既有未跟踪脚本 `scripts/probe-zhengzhou-dom.cjs` 的 `require()`；另有 13 warning，其中 `src/app/page.tsx` 未用变量属既有代码；本次新增/修改文件无 error |
| 演练脚本语法 | `node --check scripts/service-desk-sla-drill.mjs` | 通过 |

说明：`1 expected fail` 为仓库既有的“保存后下一步服务端目标”预留项，与本轮功能无关。lint 的 2 个 error 不属于本轮改动，未修改他人脚本。

## 7. 迁移、部署准备与回退（不自动执行）

- 迁移为增量：新增列/表/索引均 `IF NOT EXISTS`；不删除、不重建、不清空业务表。
- 唯一的数据改写：`announcement_submissions` 中 `status='resolved'` 且无 `resolved_announcement_id` 的历史记录置 `history_pending_verification=true`，属标记而非伪造关联；重复执行幂等。
- 隔离环境执行顺序：备份 → `npx prisma migrate deploy` → `npx prisma validate` → 启动 API 与独立 `node dist/worker.js` → 跑 E08 脚本与四角色浏览器验收。
- 回退：应用回退到上一镜像即可；新增表/列保留不影响旧代码读写；**不要**为回退编写删除列/表的破坏性 down 迁移。历史待核验标记可保留，后台核验列表继续有效。
- 环境变量：`SERVICE_DESK_SCAN_INTERVAL_MS` 仅用于隔离演练，生产保持默认 5 分钟。
- 生产部署与生产迁移需单独审批；本报告不构成生产验收。

## 8. 待运营配置与待生产验证

| 事项 | 现状 | 责任 |
|---|---|---|
| 日常负责人/备用负责人真实账号 | 入口与校验已实现，**未配置真实账号** | 管理员选择现有账号 |
| 值守时间与交接方式 | 未确认 | 运营负责人 |
| Worker 生产实例 Redis/监控 | 代码支持心跳与健康上报，生产实例状态未知 | 运维 |
| E08 隔离演练 | 脚本就绪，环境缺失未执行 | 运维/开发 |
| 真实迁移与回退演练 | 未执行 | 运维 |
| 四角色浏览器与响应式 | 未执行 | 测试 |

结论：代码已实现并完成本地单测、类型、构建与静态迁移检查；**隔离环境未验收、运营未配置、生产未验证**。不得将本报告表述为生产已验收。
