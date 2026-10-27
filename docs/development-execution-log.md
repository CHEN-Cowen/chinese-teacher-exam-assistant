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
| M07 公告材料、审核、变更与发布闭环 | 待开始 | — | — | 依赖 M01—M06 |
| M08 全国扩源框架与持续运行验收 | 待开始 | — | — | 依赖 M07；持续观察窗口可能受阻 |
| M09 方案 B 视觉基础与页面壳层 | 待开始 | — | — | 首阶段+M08 通过后开始 |
| M10 2C 页面与个人报考体验 | 待开始 | — | — | 依赖 M09 |
| M11 免费权益、限期会员与价格透明 | 待开始 | — | — | 依赖 M10 |
| M12 微信支付、退款、对账与上线验收 | 待开始 | — | — | 真实商户资质未配置时如实记录受阻项 |
| 最终端到端验收 | 待开始 | — | — | 全部模块后执行 |

### 推送受阻记录（2026-10-27，已解除）

- M02—M05 的四个提交（`b4adc57e` → `3776ac87`）曾因本机代理上游 TLS 握手失败
  持续无法推送（schannel handshake 失败，直连亦被重置）。
- 后台重试至第 7 次成功（10:45），远端 `target/codex/modular-development` SHA
  已核对为 `3776ac87`，与本地 HEAD 一致。M02—M05 全部同步完成。

## 关键环境事实（开发过程中确认）

- Node/npm 环境为本机 Windows；后端 NestJS 12 + Prisma 6 + PostgreSQL 17；前端 Next.js 16 + React 19 + Tailwind 4。
- 本地无生产数据库/部署环境访问权；涉及线上验证的项目如实标注「未在线上验证」。
