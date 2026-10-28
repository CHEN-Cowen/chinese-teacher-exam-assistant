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
| D04 结果解释、无结果与影响预览 | U03、U04 | 已完成 | `6d192ba` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 与浏览器两场景验证通过；远端 CI 待 D10 核对 |
| D05 定向补充与保存后反馈 | U05 | 已完成 | `341a3dc`、`dda21f1` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 与浏览器全场景验证通过；远端 CI 待 D10 核对 |
| D06 往年参考目录与详情 | U06 | 已完成 | `2644a86` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 与浏览器验证通过；远端 CI 待 D10 核对 |
| D07 关注对象与站内动态 | U07 | 已完成 | `ef35388` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 与浏览器验证通过；远端 CI 待 D10 核对 |
| D08 纠错补录与管理处理 | U08 | 已完成 | `fd61e13` | `target/codex/modular-development`，远端 SHA 一致 | 本地 lint/test/build 与浏览器 10 步验证通过；远端 CI 待 D10 核对 |
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

### D04 结果解释、无结果与影响预览（提交 `6d192ba`）

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

### D05 定向补充与保存后反馈（提交 `341a3dc`，超时修复 `dda21f1`）

实现：

- 账号隔离（PRD 11.6「草稿与私密数据按账号隔离」）：补充页事实按通道分离——
  demo/访客读写本机 `kb_profile_supplement_v61`；受邀登录用户的表单初始值改由
  服务端画像派生（`activeProfile.ts` 新增纯函数 `profileToSupplementFacts`：
  出生日期/户籍省市码/社保与工作经历月数/其他问答），保存后回显服务端合并后的
  画像派生值，全程不读共享 localStorage（可能属于本机其他账号或访客）。
  服务端画像读取 effect 以 `useLocalFacts` 为门卫，demo/访客不产生任何 /api 请求。
- 登录链路重算修复：保存成功后重算画像按通道选择——demo/访客用 `buildActiveProfile()`
  本机草稿；受邀登录用户用 `profileState.profile` 占位画像 + `sendProfile=false`
  （后端忽略请求体、读已持久化画像）。修复前受邀登录用户 `buildActiveProfile()`
  `ready=false`，结论播报与返回按钮根本不出现；409 冲突分支同样修正。
- 补充提示三要素（PRD 11.6「说明原因、影响岗位及不填的后果」）：`SupplementForm`
  各待补字段上方展示「公告要求：<原文>」（`requirementDescription ?? reason`）与
  「补充这项会影响 N 个机会的判断（含本岗位）」；计数来自 `list-view.ts` 新增
  `dimensionImpactCounts`（复用只读 match 响应 `groups.needInfo` 中可行动单元，
  闸门失败单元不计入），请求失败保持 null 不显示，绝不编造数量。
- 保存播报含仍需核实项（PRD 11.6「展示结论变化和仍需核实项」）：重算后统计
  UNKNOWN/MANUAL_REVIEW 剩余数，拼入「信息已保存。机会判断已更新为：X。」/
  「当前判断暂时没有变化。」两条播报（`StatusMessage` 可访问播报）。
- 列表位置保留（PRD 11.6）：origin=opportunities 的返回链接追加 `#unit-<id>` 锚点
  （未重算也带），`ResultsWorkbench` 卡片包裹 div 渲染 `id="unit-<id>"` +
  `scroll-mt-24`，结果页数据就绪后 `scrollIntoView({block:"center"})` 定位原岗位。
- 存量缺陷修复（浏览器验证发现）：`/opportunities/[unitId]/supplement` 路由曾硬编码
  `mode="real"`，demo 构建中已登录演示账号（`isGuest=false`）保存会走受邀式
  `PATCH /api/profile` → 无后端代理恒 503 → 整页「机会详情加载失败 / proxy not
  configured」，刷新后表单重置。路由 mode 改由构建期内联的 `isDemoMode` 决定
  （不读运行时 env），与 `opportunitiesApi` 的 AUTH_MODE 数据通道对齐；
  新增路由页回归测试锁定 demo/受邀两向。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/lib/profile/activeProfile.test.ts src/lib/opportunities/list-view.test.ts src/components/opportunities/SupplementPageView.test.tsx` | 47 通过（含派生函数 3、影响计数 2、播报/提示/锚点等 6 项新用例） |
| `npx vitest run supplement/page.test SupplementPageView.test`（修复后） | 12 通过（含路由通道 2 项、demo 已登录不触服务端 1 项回归锁） |
| `npm test`（全量） | 69 文件 726 通过（首跑 1 失败为 isolation 守护扫描贴 5s 默认超时，显式放宽到 20s 后全绿，断言未动） |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 0 error / 2 warning（scripts 下既有未使用变量，非本轮文件） |
| `npm run build`（demo flags） | 通过（含 postbuild 外部依赖与密钥泄漏检查） |
| 浏览器（localhost:3100，demo 生产构建，已登录演示账号） | 补充页公告要求与影响提示显示；保存后无 proxy not configured，播报含「信息已保存」与仍需核实项；刷新后户籍字段保留（localStorage 330000/330200）；返回详情页与列表正常；锚点滚动验证 scrollY≈1342、卡片入视口、激活标签正确、无 hash 时停留顶部；console 无业务 error，network 无任何 /api 请求 |

边界与未验证：

- origin=opportunities 的 tab+锚点返回链路当前无 UI 入口生成（UI 入口仅 detail/preview
  两个 origin），该分支由 4 项单元测试锁定 href 生成，锚点滚动 effect 已浏览器验证。
- `ff_targeted_supplement` 关闭时的详情页内联回退表单仅写本机 localStorage（受邀登录
  用户重算不含新事实）——已登记回退路径，本模块不修；当前发布构建开关为开。
- 受邀登录链路（ServerProfileAdapter.read/patch、409 恢复）由既有仓储测试与本模块
  单元测试覆盖，浏览器端未做受邀环境复测（本机无后端实例）。
- 用户未提交的 `src/app/onboarding/page.tsx`（+18 行）等修改未纳入本提交。

### D06 往年参考目录与详情（提交 `2644a86`）

实现：

- 历史归属与口径（前端 `src/lib/history/domain.ts` 与后端 `backend/src/opportunities/history.ts`
  双端同口径镜像，纯函数）：报名有效期已结束（registrationEnd 早于北京今日）或
  lifecycle=withdrawn 才进往年参考；报名日期未定的预告不算历史；跨年但报名仍有效的岗位
  留在当前入口。批次年=报名开始年，缺报名开始回退公告发布年，都没有为 null 不猜。
  完整程度=4 项日程有明确日期的数量+材料数+证据最差档；sourceHealth.ok=false 生成
  archiveNote 存档文案。M5 合规：collectHistoricalUnits 内置 isUserVisibleInCatalog，
  test 样本与 ai_reviewed_pending 真实记录被挡，空态如实展示。
- 后端公开端点：`GET /api/opportunities/history`（query 校验非法 400，page/pageSize 分页
  防全量扫描）与 `POST /api/opportunities/history/:unitId/detail`（画像可选，无画像
  comparison=null）；对照维度复用 view.ts 的 toDimensions（改为 export），带公告原文表述
  与证据锚点；闸门维度不进 overall，历史对照 overall 只反映资格条件。
- 前端：`/history` 列表（批次年/地区/学段/用工性质/关键词筛选+分页+样本范围说明+
  真实空状态）与 `/history/[unitId]` 详情（固定「往年已截止，仅供参考」Callout、
  存档 Callout、当年日程/条件/材料/完整程度、对照区、版本与官方来源 Disclosure、
  纠错 Modal）；无任何报名/关注动作；不计入当前可报计数。Header 标题「往年参考」带返回；
  `/opportunities` 加入口卡片。demo 通道 listHistory/historyDetail/submitCorrection
  全走浏览器本地；受邀通道走新建后端端点（`src/lib/opportunities/api.ts`）。
- demo 数据 `src/lib/seed/v61-history.ts`：4 条固定日期示例（绝不随当前日期滚动）——
  2025 杭州市直属（日期完整）、2025 苏州高新区（官方来源 404 演示存档）、
  2024 南京市直属（无面试日期演示完整度 3/4）、2024 宁波鄞州（员额制）。
- 自检中修复：两个 history 页面曾把 `void load()` 直接放进 useEffect（load 同步调
  setState），触发 react-hooks/set-state-in-effect lint 阻断；改为仓库既有的
  cancelled + .then 模式（applying 页面同款），筛选/翻页变化保留旧内容直到新数据就绪，
  顺带修掉关键词输入每击键整页 Loading 夺焦点的缺陷。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/lib/history src/lib/opportunities` | 16 文件 186 通过（含 history/domain 20 项口径用例） |
| `cd backend && npx vitest run src/opportunities` | 8 文件 125 通过 + 1 既有 expected fail（history.spec 28 项） |
| `npx tsc --noEmit`（前端） | 通过；后端全量 tsc 红为既有基线（coverage-projection/m5-user-visibility/sourcing/trial 等 spec 类型错，均非本模块文件），生产构建 tsconfig.build.json 排除 spec，本模块新代码零错误 |
| `npm run lint`（前端） | 0 error / 2 warning（scripts 下既有未使用变量，非本轮文件） |
| `cd backend && npm run lint` / `npm run build` | 0 error / 8 warning（既有风格警告）；nest build 通过 |
| `npm run build`（demo flags） | 通过（含 postbuild 外部依赖与密钥泄漏检查） |
| 浏览器（localhost:3100，demo 生产构建） | /opportunities 出现往年参考入口且不影响当前可报计数；/history 4 条+收录范围说明+五维筛选（2024 年→2 条、关键词「鄞州」→1 条、清空恢复，输入焦点不丢）+4 条不分页；苏州详情含存档 Callout、面试「待官方通知」与待定项；南京详情完整度「4 项日程中 3 项」；清空 localStorage 后对照区显示空态引导（/onboarding?from=history）；注入画像后对照区含「计算于」时间、免责声明、「对照结论：初步符合」与逐条件行（公告怎么写/你的情况）；纠错提交出现受理编号播报（demo-correction-*）；两页均无报名/关注按钮；network 无业务 4xx/5xx（仅 RSC 预取与被清理的 @vite/client 旧产物 ERR_ABORTED 噪音，与本轮代码无关） |

边界与未验证：

- 受邀通道两个新端点由后端 history.spec 28 项测试覆盖（含 query 400、分页、无画像
  comparison=null、M5 可见性遮挡）；浏览器端受邀环境未复测（本机无后端实例）。
- 历史录入操作权限与真实数据查询性能：本模块端点为只读公开查询，录入沿用既有审核流水线；
  真实数据量下的分页/索引表现留待 D10 验收记录。
- 主导航四入口整合（「往年参考」进 nav）属 D09，本轮入口在 /opportunities 页与 Header。
- 用户未提交的 `src/app/onboarding/page.tsx`（+18 行）等修改未纳入本提交。

### D07 关注对象与站内动态（提交 `ef35388`）

实现：

- 六态关注状态机：`FollowStatus` 新增 `waiting_exam`（只能从 registered 进、只能去
  closed/abandoned），后端 `follow.domain.ts` 与前端 `domain.ts`/`next-action-selector.ts`
  双端镜像；旧记录状态不动，仅加流转边与文案映射（types/ia labels/FollowControls/
  applications 页均补「等待考试」）。FollowControls 在「已报名」后给「报名已通过，
  等待考试」推进按钮；applications 页 waiting_exam 下一步指向备考。
- 单位关注：身份键 = `normalizePublisherName`（NFKC+折叠空白，不去括号不模糊推断）
  + `@` + 公告级地区码，仅精确匹配；同名不同地区不串联。后端新增 `FollowedOrganization`
  表（Prisma 迁移 `20261028120000_followed_organizations`，本机无 PostgreSQL，迁移验证留
  D10）与 follow/list/unfollow 三端点（publisherName 非空 + regionCode 六位数字校验，
  upsert 幂等）。前端镜像纯函数域 `src/lib/opportunities/organization-follow.ts`。
- 单位新公告通知：订阅同步时 `planOrganizationNotices` 对关注单位跑目录匹配，触发口径
  = lifecycle active + https + sourceHealth.ok≠false + officialSource.state=official +
  registrationEnd≥北京今日；首同步基线回填 notified=false 不产生通知风暴；dedupKey 前缀
  `org:{identityKey}:` 幂等。仅站内 NotificationRecord，不接外部渠道。
- 「我的关注」页 `/follows`：岗位动态区（active 按截止升序；closed/abandoned 收进折叠
  「已结束 / 不再考虑」归档不自动删除；状态徽章六态着色、公告有更新、待核实 N 项、
  截止 7 天内红色高亮、材料 x/y）；单位与地区动态区（身份键精确匹配 collectUnits 并
  按公告去重；地区订阅摘要链 /opportunities#subscription）；监测范围卡（scopeNote+
  lastCheckedAt+caliber.generatedAt+isFallback 标注）。/me 资料与设置区加入口，Header
  标题与返回路径登记。
- DTO：`UnitMatchDTO.announcement` 双端补必填 `region: RegionRef`（单位匹配前端精确
  匹配所需）；`SubscriptionSyncDTO` 补 `orgNewNotices`/`orgBackfilled`。9 个测试文件
  16 处 announcement 夹具同步补 region。
- demo 通道：orgFollows/orgNoticeKeys/notifications 入 localStorage（旧数据经
  emptyDemoData 展开合并做应用层迁移）；schedule demoApi 通知读取接本地派生；无会话
  只读空数据、写操作抛「请先登录演示账号」。不新增埋点事件（事件类型封闭 union+
  后端白名单，本模块无新事件）。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/lib/opportunities src/lib/schedule src/lib/ia` | 21 文件 218 通过（含 organization-follow 8 项：NFKC/同名不同地区不串联/首同步回填不通知/二次同步单条幂等/新版本再提醒/五类闸门/跨地区不串联） |
| `npx vitest run`（前端全量） | 71 文件 754 通过 |
| `cd backend && npx vitest run` | 96 文件 1205 通过（含 follow/organization-follow/service 用例）；首跑 2 失败为并发 flake，重跑全绿 |
| `npx tsc --noEmit`（前端） | 通过，零错误 |
| `npm run lint`（前端） | 0 error / 2 warning（scripts 下既有未使用变量，非本轮文件） |
| `npx next build`（demo flags） | 通过，/follows 静态产出 |
| 浏览器（localhost:3100，demo 生产构建） | /follows 空态引导正常；详情页「关注该单位的新公告」点击→「已关注该单位 · 取消」+提示；回 /follows 单位与地区动态区出现「江苏省 · 关注于 2026-10-28」+南京公告条目+取消关注；详情页保存岗位后岗位动态区出现「准备报名」徽章，点击推进徽章从「考虑中」流转；控制台无功能错误 |

边界与未验证：

- 单位关注三端点受邀通道由后端 service.spec 覆盖；浏览器端受邀环境未复测（本机无
  后端实例）。
- `FollowedOrganization` 迁移 SQL 已提供但未在真实 PostgreSQL 执行（本机无实例），
  留 D10 统一验收。
- 站内动态仅 NotificationRecord；外部通知渠道（微信/邮件/短信）按 PRD 边界不接。
- 单位更名/合并不做自动推断；身份键不一致即不关联。
- 页面主标题文案为「关注与动态」，Header 标题「我的关注」指同一页。
- 用户未提交的 `src/app/onboarding/page.tsx`（+18 行）等修改未纳入本提交；
  `backend/src/app.module.ts`、`package.json`、`deploy/README.md`、
  `parse-guard.spec.ts` 仅为行尾噪音，未纳入。

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

### D05 差距确认（2026-10-28，实现前已读调用链）

已读调用链：`/opportunities/[unitId]/supplement`（SupplementPageView）+ `/preview/supplement/[unitId]`
共用视图；`supplement-route.ts` origin/bucket 白名单回退；`SupplementForm` 只渲染仍缺失字段；
保存走 `supplementFactsService`（demo/访客）或 `ServerProfileAdapter.patch`（409 乐观锁可恢复）；
保存后重算并播报结论变化；返回按 origin 带 tab。已具备：非法参数回退、闸门失败优先展示、
MANUAL_REVIEW 转官方确认、防重复提交、失败保留输入、演示不真实隔离（demo 不落敏感事实）。

确认的差距（本模块要修）：

- 账号隔离：补充页初始表单对**所有**用户从共享 localStorage `kb_profile_supplement_v61` 预填，
  受邀登录用户会看到本机其他账号/访客的私密补充事实；且登录保存后 `setFacts` 读回的是旧本地值
  而非刚写入服务端的值。PRD 11.6 要求「草稿与私密数据按账号隔离」。
- 登录链路重算缺口：保存成功后重算走 `buildActiveProfile()`（本机草稿），受邀登录用户无本机草稿
  时 `ready=false`，结论变化播报与「返回查看结果」按钮根本不出现——保存重算对登录用户不完整。
- 「影响岗位」缺失：补充提示只说明本岗位还差几项，未说明各项信息的公告要求原文，
  也未说明该项同时影响多少其他机会的判断（PRD 11.6「说明原因、影响岗位及不填的后果」）。
  后端 match 响应 `groups.needInfo` 已按维度分组计数，可直接用真实数据，失败则不显示（不编造）。
- 列表位置不保留：返回 `/opportunities?tab=X` 只恢复标签，不定位到原岗位卡片，
  滚动位置丢失（PRD 11.6「保留筛选、列表位置」）。方案：返回链接加 `#unit-<id>` 锚点，
  结果页数据就绪后 scrollIntoView 聚焦该卡片。
- 保存后播报只有结论变化，未含「仍需核实项」数量（PRD 11.6「展示结论变化和仍需核实项」）。

边界（不在本模块改）：`ff_targeted_supplement` 关闭时的详情页内联回退表单仅写本机 localStorage，
  对受邀登录用户重算不含新事实——属已登记回退路径，本模块记录不修；当前发布构建开关为开。
  `/preview` 演示链路不加锚点聚焦（保持既有行为）。

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

### D06 差距确认（2026-10-28，实现前已读调用链）

已读调用链：前端演示通道 `demoOpportunitiesApi`（`src/lib/opportunities/demoApi.ts`）只消费
`getRollingDemoAnnouncements()`（`src/lib/seed/demoTimeline.ts` 把 7 条示例滚动到当前日期），
**没有固定日期的往年数据**；后端 `OpportunitiesService.loadCatalog()`（ff_db_catalog 关时）
返回滚动演示目录 + `REAL_ANNOUNCEMENTS`（3 条真实台账：鄞州预告未报名、杭州 2026-04 已截止、
宁波 2026-07 已截止），已截止记录只能混在当前列表 closed 组，无往年视角。
领域模型 `RecruitmentAnnouncement`（版本链、timeline、证据锚点、sourceHealth）与匹配引擎
`buildCandidates(announcements, profile, now)`（前后端同口径）可直接复用于历史对照。
现有详情视图含关注/报名动作，往年详情必须无可报名按钮，需独立视图。

确认的差距（本模块要实现）：

- 无 `/history` 路由与历史查询 API：`opportunitiesApi`、demoApi、`OpportunitiesController` 均无
  历史目录/历史详情入口。
- 无「公告发布年 / 招聘批次年 / 报名有效期」分类函数：历史归属不能靠标题年份，
  须按报名有效期（registrationEnd < 当前）或 lifecycle=withdrawn 判定；
  跨年但报名仍有效的岗位必须留在当前入口，不进入历史。
- 无完整程度汇总（日期项完整度、材料数、证据审核状态）与「当年条件 × 当前资料」对照视图
  （须注明计算时间、不等同当年身份或今年资格）。
- demo 无往年示例数据；真实台账的已截止记录未以「往年参考」形态呈现
  （人数、公告/报名/考试日期、条件、官方正文附件、完整程度、存档状态）。
- 主导航四入口整合属 D09，本模块只在 `/opportunities` 加「往年参考」入口链接。

实现边界：历史数据只读；无报名/关注动作；不计入当前可报计数；无数据时真实空状态，
不制造历史资料；日期保留原文与 Asia/Shanghai 口径，缺日期显示「待官方通知」不臆造。
后端历史列表/详情公开可读（与 match 同口径），详情对照可携带访客画像；
分页 page/pageSize 防全量扫描。

### D07 差距确认（2026-10-28，实现前已读调用链）

已读调用链：后端 `follow.domain.ts` FollowStatus=considering/preparing/registered/
abandoned/closed（状态机+乐观锁+材料/咨询，`FollowedOpportunity` 表 @@unique(userId,unitId)）；
`subscription.domain.ts` 地区+学科+用工偏好订阅，新公告提醒幂等（dedupKey=公告:版本，
首同步基线回填不通知）；`schedule.service.ts` 关注公告版本/生命周期/来源健康 diff →
NotificationRecord（versionChangeBody 含旧值新值），提醒基线 lastNotifiedState 幂等；
日程事件跨版本按 code 对齐同步。前端 NotificationCenter 已挂载 Header/DesktopNav/Sidebar；
/applications 报考中心需登录；guestFollows 存本机、登录合并；订阅卡 SubscriptionCard 在
/opportunities。保存历史公告不订阅地区：D06 历史页无任何关注动作，已满足。

确认的差距（本模块要实现）：

- 关注对象只有岗位（unitId）：无单位关注；地区+学科仅以画像派生订阅存在，未作为关注
  对象呈现。PRD 11.8 要求岗位/单位/地区+学科三种关注并存且分别可见。
- 状态缺「等待考试」：PRD 六态 已关注/准备报名/已报名/等待考试/已结束/不再考虑，
  现有五态缺 waiting_exam（registered→waiting_exam→closed/abandoned）；旧记录状态不动，
  仅加流转边与文案映射（兼容，不丢旧状态）。
- 无「我的关注」页：/applications 需登录，demo/访客关注仅存本机无展示。需新页面分
  「岗位动态」与「单位/地区动态」，突出截止临近/重要变更/待核实/新公告/待办，
  已结束可归档不自动删除；demo/访客本地闭环，受邀用户走服务端。
- 单位身份：匹配目录无 organization 实体。单位关注以「发布主体规范化名+地区码」为身份键，
  仅精确匹配关联新公告；不一致不自动关联（符合「同名不串联、关联不确定不自动发布关系」）。
- 监测透明度：我的关注页需展示监测范围、最近检查（订阅 sync 时间）、通知开关
  （remindersMuted 已有）与来源异常状态。

实现边界：不接外部通知渠道（仅站内 NotificationRecord，不伪造微信/邮件）；单位更名/合并
不做自动推断；单位关注新增 `FollowedOrganization` 表（Prisma 迁移 SQL 提供，本机无
PostgreSQL，迁移验证留 D10）；旧跟进状态与个人待办保留。

### D08 纠错补录与管理处理（U08，提交 `fd61e13`）

实现：

- 状态机扩展（`corrections.domain.ts`）：新增 `need_supplement`（需补充）档，
  迁移 submitted→reviewing→resolved/rejected 四档为五档
  （submitted→reviewing/need_supplement/resolved/rejected；
  need_supplement 可回 reviewing 或推进终态）；rejected 与 need_supplement 必须附
  处理说明（本次未写时沿用记录上已有说明）；`FIELD_PATH_LABELS` 补齐 matching
  （匹配结论）、dead_link（失效链接）、duplicate（重复收录），与 PRD 11.9 问题类型对齐；
  DTO 新增 `resolvedVersionId`。
- 纠错提交治理（`opportunities.service.ts submitCorrection`）：同一用户 24h 滚动窗口
  限流 20 条；同用户同单元同字段同内容 24h 内重复提交 409（提示可在「我的」页查进度）。
- 修正版本落点：`reviewCorrection` 支持 `resolvedVersionId`（处理人登记已发布版本 id，
  服务端校验属于该公告版本链，防误登记）；resolved 通知包含「更正版本：<id>」，
  用户侧「我的纠错」可见并可回详情核对。
- 公告补录通道（新 `announcement-submission.domain.ts` + Prisma `AnnouncementSubmission`
  表 + 迁移 `20261028140000_announcement_submissions`）：官方链接安全校验
  （拒非 http(s)、localhost/.local、私网/内网/保留 IPv4+IPv6 含映射形式、凭据 URL；
  规范化小写主机/去 hash/去结尾斜杠/默认端口）；SHA-256 urlHash 去重键；
  本人同链接重复 409、全库已收录（resolved）链接 409、按用户 24h 限流 10 条；
  提交只进运营队列，不直接进入采集与发布。处理与纠错共用状态机，
  状态推进发站内通知（需补充/未采纳必附说明），普通用户只能查本人提交。
- API 端点（`opportunities.controller.ts`）：`POST /opportunities/announcement-submissions`
  （UserGuard）、`GET /opportunities/announcement-submissions/mine`（UserGuard）、
  `GET /opportunities/admin/announcement-submissions`（AdminGuard，状态过滤），
  `PATCH /opportunities/admin/announcement-submissions/:id`（ReviewGuard）。
- 前端补录入口：列表页 `CoverageBanner` 覆盖说明内与 `NoResultFeedback` 无结果面板
  各提供「提交补录」入口（共享 `AnnouncementSubmissionModal`：链接/单位/省市区/
  可选说明，前端同口径校验即时反馈，服务端再校验）；提交成功展示受理编号
  （与纠错共用 JC- 编码格式）且不自动消失。
- 前端纠错入口扩展：详情页逐条件解释行新增「判断有误？」入口（region 行除外），
  打开 `CorrectionModal` 并预选「匹配结论」问题位置；`CorrectionModal` 问题位置
  补齐 8 类；`ConditionRows` 新增可选 `onCorrectCondition`。
- 我的页（/me）：新增「我的公告补录」卡（受理编号、状态徽章、链接、单位、处理说明、
  提交/处理时间）；「我的纠错」卡状态映射补 need_supplement（需补充），
  resolved 记录显示更正版本提示。
- 管理端（/admin/feedback）：新增「公告补录」标签页（`AnnouncementSubmissionPanel`，
  六状态队列 + 详情处理 + need_supplement/rejected 说明必填 + 终态留痕展示；
  resource_reviewer 只读提示保留）；「机会纠错」面板补 need_supplement 操作、
  修正版本号输入（仅 resolved 时提交）与终态版本展示。
- demo 通道（`demoApi.ts`）：补录提交/查询走 localStorage 按用户隔离（`submissions`
  数组），同口径链接校验与重复识别；旧本地数据应用层迁移补 `resolvedVersionId` 默认值。

命令与结果：

| 命令 | 结果 |
| --- | --- |
| `cd backend && npx vitest run src/opportunities` | 10 文件 156 通过 + 1 expected fail（既有基线：保存响应下一步未落地目标） |
| `cd backend && npx tsc -p tsconfig.build.json` | 通过（全量 `tsc --noEmit` 的 announcements spec 类型错为既有基线，生产构建排除 spec） |
| `cd backend && npm run lint` | 0 error / 8 warning（既有风格警告） |
| `cd backend && npm test` | 99 文件 1223 通过 / 1 expected fail / 2 skipped（D00 超时修复后本轮无失败） |
| `npx vitest run src/lib/opportunities/announcement-submission.test.ts` | 5 通过（URL 校验/表单校验/状态文案） |
| `npx vitest run src/app/me src/app/admin src/components/admin` | 4 文件 33 通过 |
| `npx vitest run src/app/opportunities src/components/opportunities` | 9 文件 72 通过 |
| `npm test` | 72 文件 759 通过（较 D07 新增 5） |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 0 error / 2 warning（scripts 既有） |
| `npm run build`（demo flags） | 通过（postbuild 外部依赖与密钥泄漏检查通过） |
| 浏览器（localhost:3100 生产构建） | 10 步全 PASS：覆盖说明/无结果面板补录入口；内网链接即时拒绝；公网提交成功（受理编号 JC-919527）；同链接重复提交被拒；/me「我的公告补录」回显编号/状态/链接/单位；详情页「判断有误？」预选匹配结论并提交成功（JC-113663）；/me「我的纠错」2 条记录待核对；console 无业务 error、无 4xx/5xx |

边界与未验证：

- `AnnouncementSubmission` 迁移未在真实 PostgreSQL 执行（本机无 Docker），留 D10。
- 补录/纠错管理端处理链路（/admin/feedback 状态推进）未做浏览器复测
  （D07 已验证同类面板交互与权限边界；本轮以服务端测试覆盖 409/终态/说明必填），
  留 D10 全流程验收。
- 补录提交成功暂未新增独立埋点事件（复用既有 correction 事件族；
  PRD 11.9 未强制要求补录埋点，如需区分可后续在双端登记）。
- 用户未提交的 `src/app/onboarding/page.tsx` 等既有修改未纳入本提交。

### D08 差距确认（2026-10-28，实现前已读调用链）

已读调用链：后端纠错链路已有 `POST /opportunities/units/:unitId/corrections`（UserGuard，
绑定 userId/unitId/announcementId/versionId/fieldPath/content/contact）、`GET corrections/mine`
（仅本人）、`GET admin/corrections`（AdminGuard=STAFF_ROLES）、`PATCH admin/corrections/:id`
（ReviewGuard=exam_reviewer/admin）；状态机 `corrections.domain.ts`
（submitted→reviewing→resolved/rejected，终态不可改、rejected 必填说明）+ 终态站内通知
（NotificationRecord，仅结论与说明）。前端详情页 VerificationSection「提交纠错」→
CorrectionModal（fieldPath 5 选 + 说明 + 联系方式）→ 受理编号 correctionTicketCode（JC-xxx）；
/me「我的纠错」卡展示状态与处理说明；/admin/corrections 队列面板可认领/采纳/不采纳。
demo 通道 demoApi.submitCorrection/listMyCorrections（localStorage 按用户隔离）。
版本发布重算与关注联动已有机制：announcements 管线 publish 新版本 → 目录 → 匹配即重算；
单位关注 sync 按 versionId 幂等（新版本视为新信息每版本一次提醒）。

确认的差距（本模块要实现）：

- 问题类型不全：PRD 11.9 要求遗漏、学历专业提取、匹配、日期、失效链接、重复、其他。
  现有 fieldPath 仅 major/timeline/headcount/evidence/other；缺 matching（匹配结论）、
  dead_link（失效链接）、duplicate（重复收录）；遗漏公告（补录）为无岗位绑定的新形态。
- 缺「需补充」状态：PRD 状态五档 已提交/处理中/已处理/需补充/暂未采纳，现有四档缺
  need_supplement（须附处理说明向用户说明需补什么），需扩展状态机与展示映射。
- 补录通道不存在：用户报告未收录官方公告（官方链接/单位/地区/可选说明）无入口与模型。
  新增 AnnouncementSubmission 表：URL 安全校验（拒非 http(s)、localhost、内网/私网 IP、
  带凭据 URL）；按用户限流；去重可识别（本人重复 409 带原受理编号、已收录链接 409）；
  只进运营队列，不直接进采集与发布。
- 纠错提交无限流与去重：同一用户同单元同字段同内容 24h 内重复提交应 409；
  按用户 24h 限流。
- 反馈入口不全：仅详情有纠错入口；列表页与无结果面板缺补录入口，详情逐条件解释
  缺按条件预选问题位置的纠错入口。
- 纠错与版本无落点关联：resolved 通知称“已在新版本中更正”但未记录版本号。新增
  OpportunityCorrection.resolvedVersionId（可空，处理人填已发布版本 id），
  用户侧可见并可跳转详情核对。

实现边界：补录与纠错都不物理删除；普通用户不可读他人提交（服务端 userId 过滤 +
守卫）；resource_reviewer 只读队列；真实 PostgreSQL 迁移验证留 D10（本机无 Docker）；
不接外部通知渠道；匹配重算与关注联动复用既有版本发布机制，本模块补齐受理侧证据。

## 6. 恢复点

当前：D00—D07 已完成并推送。下一步：D08 纠错补录与管理处理。
任何中断后从“模块状态”中第一个非“已完成”模块继续，不重复已验收模块。
