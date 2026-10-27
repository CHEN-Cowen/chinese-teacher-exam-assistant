# 教招有据：整项目端到端验收报告

生成日期：2026-10-27。本报告记录的是对**最终集成版本重新运行**的结果，不是各模块历史验收结果的汇总；凡未实际执行的环境与项目一律标注「待验收 / 未在线上验证」，不以模拟通过替代真实支付，不以本地通过写成线上通过。

## 1. 验收对象与方法

- 仓库：`https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant.git`（远端名 `target`）
- 分支：`codex/modular-development`
- 被测集成提交：`55965c2b`（M01—M12 全部合并后的最终本地版本；本报告与同批验收修复随其后单独提交）
- 起点基线：`main` @ `1ba2b69e`（与 `target/main` 一致）
- 环境：本机 Windows；后端 NestJS 12 + Prisma 6 + PostgreSQL 17 + BullMQ；前端 Next.js 16.3.8 + React 19 + Tailwind 4。本地无生产数据库与线上环境访问权，涉及线上行为的项目在 §6 单列。
- 验收方式：在干净集成版本上实际运行仓库全部检查（后端单测/lint/类型/构建/迁移校验、前端类型/lint/单测/生产构建、两套开关态的浏览器 E2E），并按提示词第五节逐条核对业务链路；对每个「待验」项给出原因。

## 2. 模块清单与状态

| 模块 | 提交 | 状态 |
| --- | --- | --- |
| M01 公开覆盖接口与统一覆盖投影（F1、F2） | `dc321029` | 已推送 |
| M02 运行监测与持续调度（F3） | `b4adc57e` | 已推送 |
| M03 代理协议与会话 Cookie（F5） | `e781a0f3` | 已推送（线上三步验证待部署后执行） |
| M04 Excel 解析资源边界（F6） | `414025e8` | 已推送 |
| M05 注册、登录与账号恢复（F7） | `3776ac87` | 已推送 |
| M06 关键流程测试与发布质量门禁（F4） | `681824e` | 已推送 |
| M07 公告材料、审核、变更与发布闭环 | `7353bab` | 已推送 |
| M08 全国扩源框架与持续运行验收 | `0a23442b` | 已推送（7 天观察窗待持续验收） |
| M09 方案 B 视觉基础与页面壳层 | `979c80cd` | 已推送 |
| M10 2C 页面与个人报考体验 | `eb72ef52` | 已推送 |
| M11 免费权益、限期会员与价格透明 | `78e96b9b` | 已推送 |
| M12 微信支付、退款、对账与上线验收 | `c1cdee9a` | 已推送（真实微信支付受阻，见 §7） |

模块级细节见 `docs/development-execution-log.md` 与 `docs/m08-source-acceptance-report.md`。

## 3. 实际运行的检查与结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端全量单测 | `cd backend && npm test` | **96 个测试文件 / 1153 通过 / 1 expected fail（`it.fails`，见 §7.6）**，0 失败、0 unhandled |
| 后端静态检查 | `npm run lint`（oxlint --type-aware） | 246 文件 **0 warning / 0 error** |
| 后端构建 | `npm run build`（nest build） | 通过 |
| Schema / 迁移 | `npx prisma validate` | schema 有效 |
| 前端类型检查 | `npx tsc --noEmit` | **0 错** |
| 前端静态检查 | `npx eslint src/ e2e/ tests/ scripts/e2e-prebuild.mjs scripts/check-external-deps.mjs next.config.ts playwright.config.ts eslint.config.mjs postcss.config.mjs` | **0 error / 0 warning** |
| 前端单测 | `npm test`（vitest） | **66 个测试文件 / 683 通过**，0 失败 |
| 前端生产构建 | `npm run build` + `postbuild` 外部依赖检查 | 27 条路由全部生成；**阻断项 0**；客户端密钥泄漏检查通过 |
| 浏览器 E2E | `npm run pretest:e2e && npx playwright test --workers=2` | **25/25 passed（2.5m）**，两套开关态均通过 |

说明：`npm run lint` 在仓库根目录做全目录扫描时会命中本地未跟踪的调试产物（`.tmp-probe/` 等，按交接要求保留、不提交、不属于交付物），因此上表前端静态检查以**全部跟踪代码范围**为准；该范围内 0 错 0 警告。

## 4. 全链路验收明细

### 4.1 官方来源调度 → 抓取正文与附件 → 解析与证据 → 人工审核 → 正式发布 → 覆盖投影与用户匹配

| 验收点 | 证据（本次实际运行通过） |
| --- | --- |
| 真实官方附件全链路（材料包、冲突阻断、审核补录、real 发布、目录不混 demo） | `s5-real-attachment-closure.spec.ts` 2/2；宁波 xlsx 与南京 xls 以 sha256 逐字节核对的真实文件进入材料包（`s5-real-attachment-probe.spec.ts`） |
| 真实来源解析对账（独立分母，不经过业务抓取器自证） | `source-reconciliation.s5-pilot.spec.ts` 3/3：南京 16/16、丽水 8/8（2026-10-27 官方重采） |
| 11 个官方来源适配器协议解析 | `public-column-s5.spec.ts` 31/31 + 各 adapter.spec |
| 重复执行去重、运行记录、暂停/恢复、重启不丢状态 | `crawl-run-store.spec.ts` 25、`crawl-scheduler.spec.ts` 5、`crawl.worker.spec.ts` 23 |
| 失败退避与五类告警（连续失败/结构漂移/阻断/解析失败/新鲜度超窗） | `sourcing-alert.service.spec.ts` 13、`source-monitoring.spec.ts` 10 |
| 公告改期、撤回、资格条件变化、来源失效恢复 | `replay-changes.spec.ts` 5（逐类输出旧值→新值→影响→下一步，且重复同步不重复通知） |
| 审核发布进入匹配、发布幂等、demo 与 real 隔离 | `publish-catalog.integration.spec.ts` 17、`published-catalog.repository.spec.ts` 10 |
| 结构变化与附件失败 | 解析守卫与材料状态测试（`parse-guard.spec.ts` 11、`document-parse.service.spec.ts` 10）覆盖损坏 PDF、OCR 未启用转人工、超预算文件 |

结论：数据闭环在本地与真实官方材料上成立；**全国持续采集的 7 天线上观察窗未完成**（§7.2）。

### 4.2 匿名首次使用 → 画像 → 三类结果 → 官方依据 → 定向补充重算 → 注册登录及访客资料迁移 → 收藏 → 日程 → 修改资料 → 变更提示 → 纠错状态查询

- E2E（真实浏览器，全绿）：
  - 结果先行首页、首屏唯一主按钮、示例卡明确标注为例（`v72-home` 4 例）
  - 三标签工作台：默认「优先机会」、ARIA 与 roving tabindex、徽标数与卡片数一致、切换互斥并写回 URL、刷新与浏览器前进后退保持（`v72-workbench` 4 例）
  - 访客端与登录端同一套岗位卡 DOM、条件摘要、无用工形式长问卷、修改条件默认第二屏且资料回填、返回原页保留标签、按新偏好重新分类（`v72-unified-results` 6 例）
  - 补充信息绝不再进 `/onboarding`（内联锚点）、访客保存带 return-to 登录后回原岗位、保存后唯一下一步且明确不是报名、连点不升级、刷新可恢复、键盘焦点与 Enter、375px 堆叠（`supplement-flow`、`v72-saved-next-action` 6 例）
  - 五档视口无横向溢出（首页、机会列表：`v72-responsive` 2 例）
- 单测：访客会话与画像 23、预筛引擎 27、return-to 7、下一步选择 34、纠错编号 3、变更/日程视图等均通过。
- 结论：匿名到登录的上下文连续性、资料迁移、纠错回执编号闭环均已验证。

### 4.3 免费权益 → 价格与覆盖 → 创建订单 → 渠道支付/模拟 → 验签与权益到账 → 重复通知与补偿 → 续购 → 到期 → 退款与对账

后端 `payments.service.spec.ts` 37 例 + `membership.service.spec.ts` 22 例（共 59 例，全过），逐项覆盖：

| 验收项 | 结果 |
| --- | --- |
| 免费权益与会员三态（free/active/expired）、不把 `User.role` 当会员 | 通过 |
| 价格透明与售卖开关（默认关闭；年卡不能绕过总开关；折合价口径双端锁定） | 通过 |
| 服务端定价下单（价格版本快照、金额/币种/天数由服务端决定） | 通过 |
| 回调验签失败不落库（401）、时间窗防重放、`timingSafeEqual` | 通过 |
| 商户号/订单/金额/币种不一致一律业务拒绝且不发放 | 通过 |
| 重复通知、乱序通知幂等（eventId + channelTransactionId 唯一约束 + `issueGrant(orderId)` 幂等） | 通过 |
| 关闭订单后仍收到支付成功 → 照常履约（`closed→paid`） | 通过 |
| 支付成功但权益发放失败 → 事务回滚、事件标记 failed、返回 500 触发渠道重推补偿 | 通过 |
| 主动查单补账（回跳不作为凭证，`queryOrder` 合成事件幂等） | 通过 |
| 续购叠加（未到期顺延，不从当前时间重算）与到期回落 | 通过 |
| 全额退款成功 → 订单 refunded、授予 `revokedAt` 回收、会员视图回落 expired；退款失败不动权益 | 通过 |
| 部分退款：明确 400 拒绝（规则未与商业确认，不臆造扣权益算法） | 通过 |
| 对账三类差异（本地缺失/渠道缺失/金额不一致）落库、`dedupeKey` 幂等、处理入口闭环 | 通过 |
| 越权：回调路径匿名可达但首道验签；其余支付/管理接口需登录或管理员 | 通过（`session.guard.spec.ts` 10 例） |

**真实微信支付未验证**：商户号、APIv3 密钥、平台证书、已备案回调域名均未获批。配置真实渠道标识时服务端明确抛错，不静默回退模拟渠道。详见 §7.1。

### 4.4 桌面与手机、键盘、对比度、空态/加载/错误恢复、上下文连续性、国内网络基线

- 响应式：首页与机会列表五档视口无横向溢出（E2E），375px/1440px 卡片按钮布局与同高（E2E），320px 主按钮约整行（E2E）。
- 键盘：保存后焦点落主动作、Enter 执行、状态区可播报；工作台 ArrowLeft/Right 切换并跟随焦点（E2E）。
- 对比度：M09 已核算方案 B 色板，正文 ≥ 4.5:1、控件 ≥ 3:1、焦点环 8.5:1（记录见执行日志）。
- 空态/加载/错误恢复：空态区分、无结果说明、覆盖回退标注（含时间与非实时说明）由单测与页面测试覆盖。
- 登录/支付后连续性：return-to 回原岗位、支付成功链回 `/me`、401/403 引导登录。
- 国内网络基线：`postbuild` 外部依赖检查阻断项 0，浏览器静态产物密钥泄漏检查通过；未新增境外字体/CDN。
- 结论：桌面与移动关键任务均通过；真机与真实网络下的人眼验收未单独组织（属人工项）。

### 4.5 越权、会话安全、输入资源限制、迁移兼容、发布门禁与回退

- 越权：`admin.guard.spec.ts` 14、`session.guard.spec.ts` 10（公开路径精确匹配、支付回调专用路径、私人接口拦截）、`m5-user-visibility.spec.ts` 4。
- 会话安全：`auth.controller.spec.ts` 31、`auth.service.spec.ts` 6、`auth-rate-limiter.spec.ts` 7、`validation.spec.ts` 19、`runtime-security.spec.ts` 3（invited 模式明文登录拒绝、Secure/HttpOnly/SameSite、伪造转发头不信任、找回令牌单次且重置撤销全部会话、防枚举）。
- 输入资源限制：`spreadsheet-document.parser.spec.ts` 20（含远距离真实单元格 7.1ms、超 10 万行跨度 25.4ms 转人工）、`parse-guard.spec.ts` 11。
- 迁移兼容：`test/prisma-migrations.spec.ts` 2 通过；本迭代迁移均为新增表或可空列。
- 发布门禁：`.github/workflows/docker-publish.yml` 的 `continue-on-error` 已移除，后端与前端检查或 E2E 失败即阻断镜像发布。
- 回退：见 §8。

## 5. 数据库与配置步骤

### 5.1 本迭代新增迁移（按执行顺序）

1. `20261026100000_sourcing_alerts` — 来源告警表（M02）
2. `20261027000000_password_reset_tokens` — 密码找回令牌（M05）
3. `20261027090000_membership_grants` — 会员授予（M11）
4. `20261027160000_payment_core` — 支付六表 + `membership_grants.revoked_at`（M12）

全部为新增表或可空列，向后兼容；无破坏性变更、无数据重写。

### 5.2 新增环境变量（模板已更新到 `backend/.env.example`，仅占位符）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MEMBERSHIP_SALES_ENABLED` | 关 | 售卖总开关；无已验收可收费权益时保持关闭 |
| `MEMBERSHIP_ANNUAL_SALES_ENABLED` | 关 | 年卡单独开关，不能绕过总开关 |
| `PAYMENT_CHANNEL` | `wechat_mock` | 真实微信渠道标识在资质未获批前会明确抛错 |
| `PAYMENT_MCH_ID` | `mock-mch-001` | 商户号 |
| `PAYMENT_MOCK_ENABLED` | 关 | 模拟渠道总开关；生产严禁开启 |
| `PAYMENT_MOCK_SECRET` | 无 | 模拟渠道验签密钥，仅服务端保存，不得提交或进浏览器产物 |

前端开关（`NEXT_PUBLIC_FF_*`）在构建期内联，改值必须重新构建；不含任何密钥。

### 5.3 部署顺序

1. 备份数据库并记录当前迁移版本。
2. 执行 `npx prisma migrate deploy`（先迁移，后上线代码）。
3. 部署后端（API 与 Worker 分别启动），配置上述环境变量。
4. 重新构建并部署前端（`NEXT_PUBLIC_*` 必须在构建期注入）。
5. 冒烟：`/health`、`/api/opportunities/coverage`、登录、价格页、管理员来源健康页。

## 6. 真实运行证据与「未在线上验证」分项

实际执行并取得输出的：后端全量单测、oxlint、nest build、prisma validate、前端 tsc、eslint、vitest、next build（含外部依赖与密钥检查）、Playwright 25 例（3001 回退态 + 3123 全开关态，真实浏览器起服务后运行）。以上均为**本机集成版本**证据。

未在线上验证（不做替代性宣称）：

- 生产 PostgreSQL 上的迁移执行与回滚演练（本地无生产库权限）。
- 线上 HTTPS→Caddy→Next.js→后端 的 Set-Cookie 与会话失效三步验证（脚本见 `deploy/README.md`，未执行）。
- 真实邮件投递（SMTP 未配置；未配置时接口返回统一文案且绝不伪装成功）。
- 真实微信支付全链路（资质未获批）。
- 连续 7 天来源采集观察窗（M08 已给出可重复检查表，尚未填满）。
- 镜像发布流水线的真实 CI 执行（门禁配置已在仓库内，未在本轮触发）。

## 7. 遗留风险与待验项

1. **真实微信支付受阻**：缺商户号、APIv3 密钥、平台证书、已备案回调域名。模拟渠道通过 ≠ 商业可上线；不得对外宣称真实支付验收通过。
2. **持续运行观察窗未完成**：11 个官方来源的调度、退避与告警已具备，7 天线上观察仍未完成，按 M08 报告保持「待持续验收」。
3. **线上代理与 Cookie 未实测**：仅本地与单元级验证，需部署后按三步脚本执行。
4. **部分退款策略未确认**：当前一律 400 拒绝，规则确认后需补权益处置算法与验收。
5. **定时对账未建**：目前为管理员手动触发，真实渠道接入前无意义。
6. **v7.2 WP5 后端目标行为未落地**：`v72-chain-regression.spec.ts` 保留 1 个 `it.fails`（保存响应应携带恰好一个下一步，取值属于五类）。这是工作包 0 按设计预留的目标行为标记，不是缺陷，也不允许删除或放宽断言；前端已由下一步选择器实现用户可见的唯一下一步。该标记使后端出现「1 expected fail」，需在 WP5 落地后反转为通过。
7. **本机 E2E 端口依赖**：legacy 用 3001、v7.2 用 3123，脚本已避开本机常驻服务；CI 为空闲端口不受影响。
8. **高负载下的 flaky 风险**：sourcing 与 E2E 在本机极高负载、多 worker 并发时偶发超时；单跑与 2 worker 均稳定通过，已如实记录，未通过放宽断言掩盖。

## 8. 上线与回退清单

### 上线前置（人工/外部条件）

- 微信支付商户资质、APIv3 密钥、平台证书、已备案的 HTTPS 回调域名。
- 备案域名与 TLS 证书、`TRUST_PROXY` 与 `INTERNAL_TOKEN`、`AUTH_MODE=invited`。
- SMTP 与 `PUBLIC_BASE_URL`（密码找回真实投递）。
- 生产库备份与迁移窗口；监控与告警接收人。

### 上线步骤

1. 备份 → `prisma migrate deploy` → 部署后端 API/Worker → 构建并部署前端。
2. 逐项冒烟 §5.3，再验证登录注册、覆盖投影、价格页与支付面板（模拟渠道仍须明确标识）。
3. 打开 `MEMBERSHIP_SALES_ENABLED` 之前，确认已上线可收费增值功能且有对应验收；否则保持关闭。

### 回退步骤

1. 前端回退到上一构建产物（`NEXT_PUBLIC_*` 随产物回退）。
2. 后端回退到上一镜像；本迭代迁移为新增表/可空列，旧代码可继续运行。
3. 如需回退迁移：先停写支付相关入口，再删除 `20261027160000_payment_core` 新增表与 `membership_grants.revoked_at` 列（会丢失该期间支付/退款/对账记录，须先导出留档）；其余三个迁移同理按新增对象删除。
4. 关闭 `PAYMENT_MOCK_ENABLED` 与售卖开关，避免在异常状态下产生订单。
5. 回退后重跑后端全量单测与 E2E 25 例，确认基线行为。

## 9. 结论

- **代码与本地集成验收完成**：M01—M12 全部提交并推送，最终集成版本的后端 1153 通过、前端 683 通过、浏览器 E2E 25/25 通过，构建、静态检查、迁移校验均通过。
- **模拟支付链路验收通过**：订单、验签、幂等、补偿、查单、续购、到期、全额退款与对账在本模块测试内闭环。
- **真实支付、线上部署、持续运行观察未完成**：受商户资质、备案域名、生产环境与时间窗限制，保持「待验收」。
- 因此当前可陈述的状态是「代码完成 + 模拟链路通过 + 本地集成验收通过」，**不是「商业可上线」，也不是「全部开发与验收完成」**。需完成 §7 的 1—5 项并由人工确认后，才可对外宣称上线就绪。
