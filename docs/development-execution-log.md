# 教招有据：分模块开发执行记录

> 依据 `docs/分模块开发提示词-2026-10-26.md` 维护。只记录实际发生的结果：
> 模块状态分为 待开始 / 开发中 / 自检中 / 自检通过 / 已提交 / 已推送 / 受阻。
> 不得把代码完成写成已上线，不得把受阻写成通过。

## 基线（2026-10-26 建立）

- 起点提交：`main` @ `1ba2b69e`（与 `target/main` 一致；`1ba2b69e` 为方案文档提交，前一功能提交 `c053e0a0`）。
- 远端：`origin` → `chinese-teacher-exam-assistant-project.git`（保留不动）；`target` → `https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant.git`（已核验为目标仓库）。
- 开发分支：`codex/modular-development`（新建，已推送并与 `target/codex/modular-development` 建立跟踪）。
- 既有未提交修改（保留，不并入模块提交，除模块明确归属）：
  - `backend/src/document-processing/header-hints.ts`（表头排除「岗位职责」）
  - `backend/src/document-processing/parsers/spreadsheet-document.parser.ts`（Excel 实际有值单元格收紧范围；M04 在此基础上继续）
  - `backend/src/sourcing/testing/crawl-testing.ts`（测试替身补充来源关系）
  - `src/app/onboarding/page.tsx`（仅演示模式追加学位与就业状态）
  - `package.json` / `DEPLOYMENT.md`（仅行尾差异，无内容改动）
- 未跟踪的调试/试用文件（`.qa-harness/`、`scripts/probe-*.mjs`、`test-results/`、试用账号 csv 等）保留在本地，不提交。

## 模块状态

| 模块 | 状态 | 提交号 | 验收证据 | 备注 |
|---|---|---|---|---|
| M01 公开覆盖接口与统一覆盖投影 | 已推送 | `dc321029` | 后端 build/lint 过、测试 998 通过（唯一失败为未跟踪 M07 范围 WIP spec，基线即失败）；前端 tsc/eslint(变更文件)/测试 670 全过、build 过 | F1/F2 修复；推送后远端 SHA 已核对一致 |
| M02 运行监测与持续调度 | 已推送 | `b4adc57e` | 后端全量 1019 通过 / 2 skipped（南京丽水打样快照被 Temp 清理，skipIf 守卫待重采）/ 1 expected fail（未跟踪 M07 WIP）；build/lint/prisma validate 过 | F3；持久化告警 sourcing_alerts + 指数退避 + worker 心跳；覆盖投影 2.1.0 按调度周期计算新鲜窗口 |
| M03 代理协议与会话 Cookie | 已推送 | `e781a0f3` | 后端 auth 38 项过、build/lint 过；前端 tsc/变更文件 eslint/反代 4 项测试过 | F5；反代补转 x-forwarded-proto/for；invited 模式明文登录 403；deploy/README 三步线上验证脚本（未在线上执行） |
| M04 Excel 解析资源边界 | 已推送 | `414025e8` | document-processing 87 项全过（含远距离单元格 8.5ms 证据）；后端全量 1035 通过；build/lint 过 | F6；真实单元格驱动迭代、跨度/墙钟/合并预算边界、超限转人工 |
| M05 注册、登录与账号恢复 | 已推送 | `3776ac87` | 后端 auth 89 项全过、build/lint 过；前端 tsc/eslint 过、全量 672 全过 | F7；密码规则/限速/并发注册 409/找回令牌（30 分钟单次，重置撤销全部会话）/防枚举/邮件未配置不伪装成功 |
| M06 关键流程测试与发布质量门禁 | 已推送 | `681824e` | 浏览器 E2E 25/25 全过（修复前 24 失败/1 过）；门禁 continue-on-error 已移除，失败即阻断镜像发布 | F4；两处根因：①3100 被本机常驻演示服务占用 → v72 端口迁 3123；②登录字段 e9d7518d「账号」→「邮箱」→ E2E 同步 |
| M07 公告材料、审核、变更与发布闭环 | 已推送 | `7353bab` | 后端全量 1090 通过 / 1 expected fail / 2 skipped（0 失败、0 unhandled）；lint 0/0；build 过。真实官方附件（宁波 xlsx＋南京核减 xls）重采核验 sha256 一致后全链路走通：材料包→冲突阻断误审→审核补录→real 发布→目录不含 demo | 修复表头行误判（数据行长文本偶然命中关键词被加冕为表头）、employer→unit_name 统一、timeline 截止语义分类、M05 auth spec unhandled rejection；两个 WIP spec 转正 |
| M08 全国扩源框架与持续运行验收 | 已推送 | `0a23442b` | 后端全量 1093 通过（0 失败 0 unhandled）＋前端 672＋E2E 25/25；南京/丽水独立对账 3/3（2026-10-27 官方重采 16/16＋8/8）；docs/m08-source-acceptance-report.md：11 适配器分级矩阵（A 对账×2/B 真实闭环×1/C fixture×8），7 天观察窗诚实标注「待持续验收」＋可重复检查方案 | 台账扩展（地区/负责人/调度/材料/发布计数）；附带 `4cd92c6` 修复 M07 CI 红灯（FakePrisma snapshot.source 未提交） |
| M09 方案 B 视觉基础与页面壳层 | 已推送 | `979c80cd` | 前端 672/672＋构建过＋改动文件 lint 干净＋E2E 25/25（正确预构建产物）；对比度核算全部达标（正文≥4.5:1、控件≥3:1），焦点环 8.5:1 | 方案 B 色板 token 重定值（名不变值变，零类名迁移）；hero 蓝紫渐变→品牌纯色；新增 accent #70816A；状态色与品牌分离；期间清理本轮遗留 stale .next/lock 与测试进程 |
| M10 2C 页面与个人报考体验 | 已推送 | `eb72ef52` | 前端 675/675（新增编号单测 3）＋改动文件 lint 干净＋tsc 0 错＋构建过＋E2E 25/25 回归 | A-G 审计：空态区分/资料复用/保存反馈/优先信息/回访直达/覆盖说明 v7.1-v7.2 已实现；补齐纠错闭环回执编号（JC-xxxxxx 提交回执＋我的纠错对账展示＋不承诺人工即时响应文案） |
| M11 免费权益、限期会员与价格透明 | 已推送 | `78e96b9b` | 后端 membership 20 例全过＋全量 1112 passed / 1 expected fail、lint 0 错、build 过、prisma validate 过；前端 683/683（新增 parity 8 例）、改动文件 lint 干净、tsc 0 错、build 过；E2E 25/25（--workers=2；并行 4 worker 在本机高负载下 dev 冷编译争用 flaky，失败例单跑均过） | F 诚实口径：售卖总开关默认关闭（无已验收可收费增值功能），activeEntitlements 恒空；不把 User.role 当会员状态；issueGrant orderId 幂等＋续购顺延；价格页透明口径由 tests/membership-parity.test.ts 双端锁定（折合价≤实付、90 天省 ¥28 口径）；修复 E2E legacy 端口 3000 被本机无关进程（lark-channel-bridge）占用 → 迁 3001 |
| M12 微信支付、退款、对账与上线验收 | 已提交（待推送核对） | 见备注 | 后端 payments+membership 59 例全过、全量 1153 passed / 1 expected fail（首轮 2 个 sourcing 用例在高负载下 flaky，重跑及单跑 326/326 全过）、lint 0 错、build 过、prisma validate 过；前端 683/683、改动文件 lint 干净、tsc 0 错、build 过；E2E 25/25（--workers=2） | 渠道适配层 + 模拟渠道完成全链路验收；真实微信支付受阻项如实记录，见下行说明 |
| 最终端到端验收 | 待开始 | — | — | 全部模块后执行 |

#### M12 说明（统一交接模板）

- 模块与当前提交：M12 微信支付、退款、对账与上线验收（提交号见 git log 本模块提交）。
- 已完成：支付领域模型与迁移（payment_orders/payment_attempts/channel_transactions/payment_callback_events/refunds/reconciliation_records + membership_grants.revoked_at）；渠道适配层 PaymentChannel 接口；模拟微信渠道（HMAC 验签+时间窗防重放、预支付、主动查单、退款、日账单）；服务端定价下单；回调验签→商户/订单/金额/币种核对→事务内幂等记账与发放（复用 M11 issueGrant orderId 幂等 + tx）；重复/乱序通知幂等；closed 订单超时成功照常履约；发放失败事务回滚→500→重推补偿；主动查单补账（合成事件幂等）；关闭订单；全额退款（成功回收授予 revokedAt，会员视图回落 expired；渠道拒绝/失败回调均不权益不动）；部分退款一律 400（规则未确认前不臆造扣权益算法）；日账单对账（missing_local/missing_channel/amount_mismatch 三类差异落库 dedupeKey 幂等）与处理入口（resolve 闭环）；管理员订单全要素排查接口；价格页购买面板（模拟支付明确标识、关闭订单、查单刷新、登录引导）。
- 关键设计选择与兼容影响：回调路径 /payments/callbacks/:channel 匿名可达但首道即渠道验签（失败 401 不落库），其余支付接口全鉴权；验签失败不落库（报文不可信）；回跳不作为支付凭证；模拟渠道退款「即时送达回调」仍走完整验签链路；全额退款回收授予是确定性逆向操作，部分退款不开放；MembershipService 查询排除/标识 revokedAt（M11 语义扩展：全部回收→expired 而非 free）。
- 变更文件：backend/prisma/schema.prisma + migrations/20261027160000_payment_core；backend/src/payments/（payment-channel/mock-wechat.channel/payment.config/payments.service/.spec/三个 controller/module）；backend/src/membership/（plans.ts 价格版本、service tx+revokedAt、spec 补 2 例）；backend/src/auth/session.guard.ts+spec（回调路径）；backend/src/app.module.ts、module-graph.spec.ts；前端 src/lib/payments/api.ts、src/app/pricing/page.tsx。
- 检查命令/结果：backend vitest run（1153 passed/1 expected fail）、oxlint 0 错、nest build 过、prisma validate 过；前端 tsc 0 错、eslint 变更文件 0 错、vitest 683/683、next build 过（含国内网络与密钥泄漏检查）；playwright 25/25（--workers=2）。
- 数据库迁移、配置与部署顺序：migration 20261027160000_payment_core（纯新增表+membership_grants 加可空列，向后兼容，回退=删新表/删列）；部署顺序：先迁移后上线代码；新 env：PAYMENT_CHANNEL（默认 wechat_mock）/PAYMENT_MOCK_ENABLED（默认关，生产不可开）/PAYMENT_MOCK_SECRET/PAYMENT_MCH_ID。
- 未验证或受阻项及原因：**真实微信支付未接入**——商户号/APIv3 密钥/平台证书/已备案回调域名均未获批，配置真实渠道标识会明确抛错（不静默回退模拟渠道）；真实渠道小额验证须另获授权；模拟通过≠商业可上线。退款规则：部分退款权益处置待商业确认。对账目前为手动触发（admin 接口），定时对账任务未建（渠道未真实接入前无意义）。
- 是否达到本模块验收：模拟渠道全链路验收通过；真实支付明确标注受阻。上线门槛（High+持续采集+权益+支付+售后全过）未达成，不宣称商业可上线。
- 下一模块需要知道的接口：MembershipService.issueGrant 支持 tx；支付履约入口 fulfillPaid/fulfillFromQuery；对账入口 POST /admin/payments/reconciliation/run。

### 推送受阻记录（2026-10-27，已解除）

- M02—M05 的四个提交（`b4adc57e` → `3776ac87`）曾因本机代理上游 TLS 握手失败
  持续无法推送（schannel handshake 失败，直连亦被重置）。
- 后台重试至第 7 次成功（10:45），远端 `target/codex/modular-development` SHA
  已核对为 `3776ac87`，与本地 HEAD 一致。M02—M05 全部同步完成。

## 关键环境事实（开发过程中确认）

- Node/npm 环境为本机 Windows；后端 NestJS 12 + Prisma 6 + PostgreSQL 17；前端 Next.js 16 + React 19 + Tailwind 4。
- 本地无生产数据库/部署环境访问权；涉及线上验证的项目如实标注「未在线上验证」。
