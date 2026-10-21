# 验收发现（按影响排序，修订版）

> 每条含：复现、预期/实际、源码定位、证据、建议归属模块、最小修复方向。
> 修订：首版 ISSUE-1「前端源码缺失」为误判（前端在根 `src/`），已删除；ISSUE-2「日期脆弱测试」更正为「M5 可见性规则与旧测试断言冲突」，已修复。

---

## ISSUE-1（P1）真实业务 S1/S2 未导入，真实价值层无法验收

- **复现**：`docs/workbuddy-upgrade/M6-report.md` 明示「真实材料（S1/S2 真实样本、真实会话/调用 ID、真实计时）未导入」。
- **预期/实际**：方案 §7 要求「M6 真实记录与导出」「S1/S2 真实结果」；实际仅完成纯函数 + 空白模板，未填真实数据。
- **源码定位**：`backend/src/announcements/offline-package.ts`、`docs/workbuddy-upgrade/M6-experiment-template.md`（空白待填）。
- **证据**：M6-report 第 1 节「真实材料未导入，标为待填写」。
- **建议归属**：M6。
- **最小修复方向**：导入一份真实公告（正文+附件，含来源/哈希/下载时间），跑 S1 全流程并记录计时，填写 `M6-experiment-template.md`；S2 复用验证。**（本轮暂标待补，需作者提供真实材料）**

---

## ISSUE-2（已修复）M5 可见性规则使 wp3-html-closure 测试断言失效

- **状态**：✅ 已修复（2026-10-21）。
- **复现**：后端全量测试 2 失败，均在 `src/sourcing/wp3-html-closure.e2e.spec.ts`。
- **预期/实际**：断言 `JSON.stringify(res)` 应含 `hz-closure-unit-01`；实际该单元 `dataset:'test'`，而 M5 修复后 `isUserVisibleInCatalog` 明确 `dataset==='test' → return false`（test 样本不进用户端），故该单元被合规过滤，响应 `groups` 全空。
- **根因**：不是「日期脆弱」，而是 **M5 新增的 test 样本不可见规则**与该测试的旧断言冲突。测试样本用了 `dataset:'test'`，M5 之后 test 样本不再对用户可见。
- **源码定位**：`backend/src/sourcing/wp3-html-closure.e2e.spec.ts:194`（`dataset:'test'`）；`backend/src/matching/engine.ts:113`（`if (dataset === 'test') return false`）。
- **修复**：测试样本 `dataset` 由 `'test'` 改为 `'demo'`（demo 样本用户可见），使测试继续验证 DB 目录闭环（其核心目的），同时不破坏 M5 的 test 过滤规则（test 过滤已有 `m5-user-visibility.spec.ts` 专门覆盖）。
- **验证**：修复后该测试 3 用例全绿；后端全量 815 通过 + 1 expected fail（0 失败）。

---

## ISSUE-3（P2）无真实 DB/Redis/Worker/浏览器环境，隔离集成与浏览器层未验证

- **复现**：无 postgres/redis/worker 运行；无浏览器工具。
- **预期/实际**：方案 §9 要求「隔离数据库集成」「浏览器完整操作」分层验收；实际测试为内存 prisma/构造数据，M4/M5 报告自陈「浏览器端到端未跑」。
- **源码定位**：`backend/src/**/*.integration.spec.ts` 用内存 prisma；无真实连接。
- **证据**：M4-report / M5-report「浏览器端到端未跑」。
- **建议归属**：M1–M6 整体验收。
- **最小修复方向**：搭隔离 PostgreSQL + 至少一次浏览器实操（脱敏截图）。

---

## ISSUE-4（P3）前端与后端 `fieldIdentity`/`groupByScope` 双份实现漂移风险

- **复现**：前端 `src/lib/announcements-pipeline/api.ts` 有 `fieldIdentity`/`groupByScope` 镜像；后端 `backend/src/announcements/domain.ts` 是单一事实源。
- **预期/实际**：前端镜像一旦落后后端契约，审核工作台分组与后端裁决口径不一致。
- **源码定位**：后端 `domain.ts`；前端 `api.ts`。
- **证据**：contracts.md 标注单一事实源在后端 `domain.ts`。
- **建议归属**：M3/M4 前端契约。
- **最小修复方向**：抽公共契约或加契约对齐测试，消除双份漂移。
