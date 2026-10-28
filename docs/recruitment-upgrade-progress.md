# 教招有据：分模块开发进度（D00—D10）

本文件只记录实际发生的事实：已改代码、已运行命令、结果、提交与推送状态。
需求基线为 `PRD.md`；执行拆解为 `docs/recruitment-upgrade-development.md`。
每个模块完成后再更新本文件，不预填“已完成”。

## 0. 开工核对（2026-10-28）

- 本地仓库：`E:\游戏\考编助手`，分支 `codex/modular-development`。
- 远端：`target` = `https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant.git`；
  `origin` 指向 `...-project.git`，与本任务目标不同，推送只使用 `target`。
- 开工时存在用户未提交修改：`src/app/onboarding/page.tsx`（演示模式补充学位/就业状态，+18 行）。
  该修改保留，不 reset/clean/stash，也不混入本任务提交；本轮优先不改该文件。
- 另有若干文件显示 `M` 但无内容差异（换行/元数据），不纳入提交。

## 1. 基线自检（开工前）

命令与结果：

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 后端 | `cd backend && npm test` | 1 failed / 1150 passed / 1 expected fail / 2 skipped（1154） |
| 前端 | `npm test` | 1 failed / 682 passed（683） |

两个失败均为 Windows 并发下超过 vitest 默认 5 秒的工具/解析超时，断言未被跳过：

1. `backend/src/document-processing/document-parser.service.spec.ts` DOCX 开关用例：
   Mammoth 首次加载超过 5 秒。属测试超时配置，不是解析逻辑回归。
2. `scripts/external-deps-scanner.test.mjs` 源码网络基线：
   扫描 `src` + `public` 在本机并发负载下超过 5 秒。同文件构建产物用例已显式设置 60 秒。

处理：为上述两个用例设置显式超时（保留原断言），作为 D00 自检基线修复，单独提交。
D10 复测时若仍超时，按真实失败记录，不宣称全通过。

## 2. 原案例复现诊断（浙江/江苏/上海 · 硕士 · 2026-06 毕业 · 汉语言文学（师范）· 高中语文教资）

结论：原案例“无结果”不是单一原因，至少四个独立原因叠加：

1. **覆盖缺口**：上海没有已登记来源；浙江/江苏只监测部分城市。
   `backend/src/sourcing/source-catalog.ts` 的台账覆盖杭州、宁波、鄞州、丽水、绍兴、嘉兴、萧山、
   南京、苏州、常州等，不包含上海；省级偏好会让用户以为“全省已覆盖”。
2. **真实目录在报数为 0**：`backend/src/matching/real-catalog.ts` 的 3 条真实记录中，
   2 条报名已截止、1 条报名时间未公布（预告），且均未完成人工复核。
   用户端可见目录为空，匹配必然为空；页面却只显示笼统空态。
3. **专业名带“师范”后缀**：`normalizeMajor` 明确保留“师范”语义，
   `汉语言文学（师范）` 与公告专业 `汉语言文学` 精确比较不相等；
   现有已审核别名只有 `汉语言文学教育`，没有覆盖“师范”写法。
   这不是“相关专业”歧义，当前直接 FAIL，属误判风险。
4. **只有一个专业/学历字段**：用户本科专业与硕士专业不同阶段时无法分别填写，
   引擎用同一个 `majorFullName` 应对所有阶段要求，导致“本科汉语言文学、硕士学科教学（语文）”
   这类真实背景无法解释，也无法说明采用了哪一段教育经历。

此外，教师资格学段“高学段可报低学段”的公告口径未建模，当前一律按学段精确相等处理，
会把部分可报岗位判为 FAIL。该点需按公告原文逐条结构化，不能全量放宽。

以上问题分别由 D01（教育经历）、D02（偏好分离）、D03（逐条件解释与采用经历）、
D04（多原因空态与覆盖）覆盖。

## 3. 模块状态

状态取值：未开始 / 进行中 / 已完成（代码+自检+提交+推送核实）/ 受阻。

| 模块 | 覆盖需求 | 状态 | 提交 | 推送 | CI |
| --- | --- | --- | --- | --- | --- |
| D00 基线、诊断、进度机制 | U10 前置 | 已完成 | `e4e4767` | `target/codex/modular-development`，远端 SHA 一致 | 本地自检通过，待 D10 统一核对远端 CI |
| D01 教育经历模型与兼容迁移 | U01 | 已完成 | `54262e9` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 通过；远端 CI 待 D10 核对 |
| D02 我的资料与分阶段填写 | U01、U05 | 已完成 | `54262e9` | 同上 | 浏览器核心路径通过；375px 响应式未在浏览器工具内验证 |
| D03 资格与偏好、阶段匹配 | U02、U03 | 已完成 | `1a0671e` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 与浏览器详情验证通过；远端 CI 待 D10 核对 |
| D04 结果解释、无结果与影响预览 | U03、U04 | 进行中 | | | |
| D05 定向补充与保存后反馈 | U05 | 未开始 | | | |
| D06 往年参考目录与详情 | U06 | 未开始 | | | |
| D07 关注对象与站内动态 | U07 | 未开始 | | | |
| D08 纠错补录与管理处理 | U08 | 未开始 | | | |
| D09 导航整合与采集可观察性 | U09、U10 | 未开始 | | | |
| D10 全项目验收与交付 | U01—U10 | 未开始 | | | |

## 4. 模块执行记录

### D01/D02 教育经历模型、迁移与分阶段填写（提交 `54262e9`）

实现：

- 新增 `src/lib/profile/education.ts`：阶段枚举、规整、校验、旧值迁移、阶段确认、
  教育事实解析（最高阶段/专业/学位/毕业时间），以及“新增空白经历”“下一阶段”等编辑辅助。
- 新增 `backend/src/matching/education.ts`：服务端同口径规整/校验/解析，专业候选按阶段返回。
- `backend/src/matching/engine.ts`：学历、学位、专业、应届判断改用分阶段事实；
  专业命中返回采用的阶段与专业原文；迁移记录阶段未确认且未命中时返回 UNKNOWN 而非 FAIL。
- `backend/src/profile/profile.service.ts`：保存画像时规整并校验 `educationExperiences`，
  结构或业务不合法返回 400；旧单一字段原值不改写，不含该字段的旧画像原样保存。
- 新增 `/me/education` 页面：按阶段编辑学校/专业原文/毕业时间/学位/学习形式/师范背景；
  旧资料迁移卡片要求确认阶段归属；demo/访客保存到本机，登录用户保存到服务端画像；
  保存失败保留输入，空专业等校验就地提示。
- “我的资料”展示最高阶段与专业摘要，并在阶段归属未确认时标注。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/lib/profile/education.test.ts` | 14 通过（迁移幂等、旧值保留、确认只改归属、规整/校验、事实解析） |
| `cd backend && npx vitest run src/profile/profile.service.spec.ts src/matching/engine.spec.ts` | 通过（含多阶段专业命中、迁移未确认返回 UNKNOWN、400 校验、账号隔离） |
| `npx tsc --noEmit` | 通过 |
| `npx eslint <改动文件>` | 通过 |
| `cd backend && npm run lint` | 0 error / 0 warning |
| `npm run build` | 通过（含 postbuild 外部依赖检查） |
| 浏览器（localhost:3100，生产构建） | `/me` 入口可达；新增本科经历、保存“已保存”、刷新保留、清空专业校验均通过 |

边界与未验证：

- 本机无 Docker、无可用的临时 PostgreSQL，未执行“真实 PostgreSQL 迁移”验证。
  本轮画像以 JSON 字段存储，无表结构迁移；迁移为应用层幂等函数，已由单元/接口测试覆盖。
  D10 若仍无本地数据库，将如实记录为未验证项。
- 浏览器工具无法调整到 375px 视口，移动端布局仅由 CSS 栅格与构建检查覆盖，未做真机截图。
- `src/app/onboarding/page.tsx` 的用户未提交修改未纳入本提交。

### D03 资格与偏好、阶段匹配与逐条件解释

实现：

- 资格与偏好分离（前后端 `matching` 同口径）：地区维度仅 `required` 构成范围限制，
  `preferred/consider` 只影响排序且 `hard:false`；新增 `preferenceOutOfScope` 标记
  （地区 FAIL 且无硬性资格 FAIL 时），`isValidOpportunity` 将其排除出有效机会，
  列表/IA 视图归入“偏好范围外”分组，不计入“明确不符合”；旧数据 region-only
  not_eligible 仍兼容归入范围外。
- 分阶段专业匹配：`major` 条件支持未指定阶段（取最高阶段）、指定阶段、
  `stageMode:any/all`；命中返回 `adoptedEducation`（经历 id/阶段/专业原文）；
  迁移未确认阶段归属的经历参与匹配但结果受限为 UNKNOWN，不判 FAIL。
- 逐条件解释：每个维度返回 `userFact`（你的情况）、`adoptedEducation`（采用经历）、
  `nextStep`（下一步动作）；详情页条件行分“公告怎么写（官方事实）/根据你填写的报考
  信息判断”两栏，地区行明确“偏好不是公告条件”；`teacher_cert` 仅在公告
  `acceptHigherStage` 时按高学段放宽。
- 画像教育事实补充 `graduationDate`（最高阶段毕业时间，旧字段兜底），应届判断改用
  分阶段事实。
- `.gitignore`/`eslint.config.mjs` 补充忽略 `.tmp-probe/`、`.workbuddy/`、`outputs/`
  本地临时产物（既有非源码目录导致 lint 误报，属工具链修正）。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `cd backend && npx vitest run src/matching` | 58 通过（含阶段匹配三口径、偏好分离、nextStep、迁移未确认 UNKNOWN） |
| `npx vitest run src/lib/matching src/lib/opportunities src/lib/ia src/lib/guest` | 25 文件 302 通过（domain.test 28 含 D03 两组新用例） |
| `npx tsc --noEmit` | 通过（修复 stages 类型与 EducationFacts.graduationDate 两处错误后） |
| `npm run lint` | 0 error / 2 warning（scripts 下既有未使用变量，非本轮文件） |
| `cd backend && npm run lint` | 0 error / 8 warning（unicorn/no-useless-spread 风格警告，非阻断） |
| `npm run build` | 通过（28 页静态生成 + postbuild 外部依赖检查通过） |
| 浏览器（localhost:3100，生产构建，注入完整访客画像） | /opportunities 列表可达；unit-hangzhou-01 详情含“公告怎么写（官方事实）/根据你填写的报考信息判断”两栏、“你的情况：/下一步：”解释、地区行偏好说明；console 无业务 error，无 4xx/5xx |

边界与未验证：

- 移动端 375px 视口浏览器工具不支持，仅 CSS 栅格与构建覆盖。
- 真实 PostgreSQL 迁移验证本机无 Docker，仍未执行（本轮无表结构变更）。
- 用户未提交的 `src/app/onboarding/page.tsx` 等既有修改未纳入本提交。

### D04 结果解释、无结果与影响预览

实现：

- 多原因无结果（`no-result.ts` 新增 `buildNoResultReasons/buildNoResultPanel`，纯函数）：
  覆盖有限 / 偏好限制 / 明确资格不符 / 资料不足 / 已截止 / 尚未报名（时间待定）/
  材料待审核 / 更新异常 / 当前无在招九类原因可并存，按稳定优先级取主原因；
  面板同时展示当前筛选（画像条件摘要）、统计范围（监测城市/来源/在报数、
  按报考单元去重口径）、分阶段数量、最近成功检查与统计生成两个时间、非实时回退说明。
  「请求失败」仍由页面 ErrorState 区分，不显示业务零结果。旧三态
  `buildNoResultState` 保留（埋点 reasonCode 与既有测试沿用），面板携带 legacyKind 映射。
- `list-view.ts` 新增 `pendingReviewCount`：真实目录 AI 初核待人工复核记录按报考单元
  去重后只计数（不展示内容，不泄露受限材料）；同时修复 D03 遗留缺口——
  `preferenceOutOfScope` 单元此前未进入 workbench 分桶输入，导致「偏好范围外」标签
  在新版三标签下丢失这类单元（classify 规则 3 依赖该标记），现已补入分桶输入。
- `NoResultFeedback` 改为渲染多原因面板；`CoverageBanner` 页脚补充「最近成功检查 /
  统计生成」两个时间与「检查正常无新增不算故障」说明。
- 偏好影响预览（新 `preference-preview.ts` 纯函数 + `PreferencePreviewCard` 组件，
  挂载于 /opportunities）：地区级别与用工偏好调整 → 预览影响（复用后端只读
  `POST /match`，显式携带草稿画像、不落库）→ 确认应用才持久化（访客/demo 写本机
  guestSessionService，受邀登录走 profileApi.saveProfile）→ 撤销条恢复原偏好。
  计数前后均来自 workbench 三标签分桶，与实际列表同一数据源；过期响应保护 =
  请求序号丢弃旧响应 + 目录版本（catalogVersion/realCatalogVersion）不一致丢弃预览；
  预览失败明确提示、不编造数量。撤销快照存 localStorage（30 分钟有效，内存态优先，
  存储不可用不阻断本会话撤销）。
- 不改 `src/app/onboarding/page.tsx`（保留用户未提交修改）；增删地区仍走
  「修改报考信息」流程，预览卡片只调整级别与用工偏好。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/lib/opportunities src/lib/matching src/lib/ia src/lib/results` | 23 文件 267 通过（含 no-result 新增 6 项多原因用例、preference-preview 5 项） |
| `npx vitest run src/lib/guest src/app/opportunities` | 6 文件 78 通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 0 error / 2 warning（scripts 下既有未使用变量，非本轮文件） |
| `npm run build` | 通过（含 postbuild 外部依赖检查、客户端密钥泄漏检查） |
| 浏览器（localhost:3100 生产构建，注入访客画像） | 场景一：上海（未覆盖）无结果面板含 coverage_limited 等多原因、当前筛选/统计范围/分阶段数量/最近成功检查齐全，未出现「当地没有招聘」表述；场景二：杭州级别 只考虑→也可以考虑 → 预览影响出结果 → 确认应用 → 撤销条出现且整页刷新后保留 → 撤销后级别恢复；console 无业务 error |

边界与未验证：

- 浏览器验证为 demo/访客链路（本机画像 + 生产构建）；受邀登录用户的
  `profileApi.saveProfile` 持久化路径由既有画像测试覆盖，本轮未做浏览器端登录态复测。
- 预览卡片增删地区不支持（属画像编辑主流程，非偏好快速调整）；PRD「新增待核实数量」
  以待补充桶计数变化与新增岗位点名表达。
- 修复过的两处实现问题：React 渲染期状态调整替代 effect 内 setState（lint 阻断）；
  撤销快照由 sessionStorage 改 localStorage（sessionStorage 按标签页隔离导致跨标签丢失）。

## 5. 需求到验收点映射（开始实现前写清）

### D04 差距确认（2026-10-28，实现前已读调用链）

- `src/lib/opportunities/no-result.ts` 只有三态单原因（region_uncovered / no_open_recruitment /
  qualification_gap），不满足 PRD 11.5「多原因并存」；缺当前筛选、统计范围、分阶段数量、
  最近成功检查的结构化展示。页面已有 ErrorState 区分「请求失败」，保留不并入无结果面板。
- 覆盖投影与 CoverageBanner 已有省份/来源状态、`lastCheckedAt`、fallback 透传；
  缺「统计生成时间」与「检查正常无新增不算故障」的明示。
- 真实目录中 AI 初核待人工复核记录被前端整体过滤（list-view `realMonitored` 恒空），
  无结果归因需要其汇总数量（只计数，不展示内容，不泄露受限材料）。
- 筛选调整影响预览：无现实现。地区偏好原本只在 onboarding 第二屏编辑，保存前无预览、无撤销。
  已确认后端 `POST /opportunities/match` 只读（`resolveProfile` 请求体优先、不落库），
  复用同一接口做预览计算；`MetaDTO.catalogVersion/realCatalogVersion` 做过期响应保护；
  快速切换以请求序号丢弃旧响应。用户未提交的 `src/app/onboarding/page.tsx` 修改保留，
  本模块不改该文件；预览入口放 `/opportunities` 页（符合 PRD「快速切换、保留上下文」）。
- 预览持久化：访客/demo 写本机 `guestSessionService.save({draft:{regions}})`；
  受邀登录用户走 `profileApi.saveProfile`（带服务端校验）；确认前不落库。
- 撤销：确认应用后保留原偏好快照（sessionStorage），页面重载后仍可撤销回原偏好。

验收点见本节下文 D04（U04）条目，另补：调整前后计数与列表实际分桶一致（workbench 单一数据源）；
目录版本不一致时预览响应被丢弃并提示刷新；无真实统计（预览请求失败）时明确提示，不编造数值。

### D01（U01）

- 数据：`educationExperiences[]`，逐阶段保存学校、专业全称、专业代码/目录版本、
  毕业状态与预计/实际毕业时间、学位及取得状态、学习形式、师范背景归属、
  专业原文确认状态。
- 迁移：旧 `educationLevel/degree/majorFullName/graduationDate` 原值完整保留；
  生成一条 `source=legacy` 经历并标记阶段归属待确认；绝不把单一专业复制成多阶段。
- 校验：阶段/状态枚举、日期、空专业、重复阶段、id 唯一；服务端校验并持久化。
- 并发与隔离：沿用画像 `updatedAt` 乐观锁；仅当前登录用户可读写。
- 验收：迁移幂等；旧值不被覆盖；确认后只改归属；账号 A/B 隔离；409 冲突可恢复。

### D02（U02）

- 必须满足的报考条件与求职偏好分离：
  - 地区 `required` 才构成范围限制；`preferred/consider` 只影响排序与提示；
  - 用工偏好 `public_only/official_open/undecided` 只影响展示，不进入资格判定；
  - 偏好筛除的岗位进入“偏好范围外”，不计入“明确不符合”，可撤销筛选恢复。
- 验收：偏好变化不改变任何资格维度值；范围外岗位可见、可解释、可恢复。

### D03（U03）

- 逐条件解释：每个条件返回公告原文、证据锚点（状态/定位/摘录/核对时间）、
  用户事实、四档判断与理由；地区维度明确是偏好约束而非公告条件。
- 专业条件支持：未指定阶段、指定阶段、任一阶段、多阶段同时满足；
  返回采用的教育经历 id、阶段、专业名。
- UNKNOWN 不当 FAIL；歧义不当符合；高学段教资口径只在公告明确时放宽。
- 验收：同一岗位能回答“为什么符合/不符合/需补什么/需确认什么”。

### D04（U04）

- 无结果：按“覆盖未达 / 条件明确不符合 / 信息不足 / 偏好范围外 / 时间窗口关闭”
  多原因归因，每条可展开。
- 覆盖：显示真实监测地区、来源状态、最后核对时间、在报数；
  未覆盖 ≠ 没有招聘；部分覆盖不称全国完整。
- 筛选调整前预览影响数量与岗位，可取消；调整后可撤销回原筛选。
- 更新状态：目录/规则/画像版本与更新时间可见。

### D05（U05）

- 补充页按岗位只问缺失字段；保存后重新计算并返回结果；
- 返回原岗位时展示结论变化（如“补充后：需补信息 → 初步符合”）；
- 保存失败/冲突可恢复，不丢草稿。

### D06（U06）

- 往年参考独立入口与数据，不与在招混排；展示年份、批次、报名/考试时间、
  当年有效范围、历史条件、官方证据；
- 明确“历史信息，不在招”；不因跨年而当作本年可报；
- 与用户当前条件做历史对照，UNKNOWN/歧义按历史原文处理。

### D07（U07）

- 关注岗位、单位、地区/学科；新公告与新版本关联到关注对象；
- 站内动态说明“为什么提醒、关联哪个关注、何时发现”；
- 提醒可静音/关闭，历史保留；透明说明监测范围与延迟。

### D08（U08）

- 用户纠错补录（含教育经历相关字段）、本人查询处理状态；
- 后台受理/采纳/驳回留痕；采纳后发布修正版本并重新计算；
- 用户收到结论通知；不物理删除纠错记录。

### D09（U09）

- 四个主入口：当年招聘 / 往年参考 / 我的关注 / 我的资料；
- 旧路由兼容（重定向或等价页），不 404、不丢失查询参数；
- 导航在桌面与移动端一致；入口可按开关渐进显示，生产构建可达。

### D10（U10）

- 完整 lint/test/build（前端+后端）、浏览器端到端、真实迁移与冒烟、
  国内外部依赖、权限隔离、旧资料/旧路由、跨年与历史隔离、无数据/异常恢复；
- 生成 `docs/recruitment-upgrade-acceptance.md`，逐项核对 U01—U10；
- 测试、模拟、线上证据分开记录。

## 6. 恢复点

当前：D00—D03 已完成并推送。下一步：D04 结果解释、无结果与影响预览。
任何中断后从“模块状态”中第一个非“已完成”模块继续，不重复已验收模块。
