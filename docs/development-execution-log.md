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
| M02 运行监测与持续调度 | 待开始 | — | — | F3 |
| M03 代理协议与会话 Cookie | 待开始 | — | — | F5 |
| M04 Excel 解析资源边界 | 待开始 | — | — | F6；保留既有未提交解析改进 |
| M05 注册、登录与账号恢复 | 待开始 | — | — | F7 |
| M06 关键流程测试与发布质量门禁 | 待开始 | — | — | F4 |
| M07 公告材料、审核、变更与发布闭环 | 待开始 | — | — | 依赖 M01—M06 |
| M08 全国扩源框架与持续运行验收 | 待开始 | — | — | 依赖 M07；持续观察窗口可能受阻 |
| M09 方案 B 视觉基础与页面壳层 | 待开始 | — | — | 首阶段+M08 通过后开始 |
| M10 2C 页面与个人报考体验 | 待开始 | — | — | 依赖 M09 |
| M11 免费权益、限期会员与价格透明 | 待开始 | — | — | 依赖 M10 |
| M12 微信支付、退款、对账与上线验收 | 待开始 | — | — | 真实商户资质未配置时如实记录受阻项 |
| 最终端到端验收 | 待开始 | — | — | 全部模块后执行 |

## 关键环境事实（开发过程中确认）

- Node/npm 环境为本机 Windows；后端 NestJS 12 + Prisma 6 + PostgreSQL 17；前端 Next.js 16 + React 19 + Tailwind 4。
- 本地无生产数据库/部署环境访问权；涉及线上验证的项目如实标注「未在线上验证」。
