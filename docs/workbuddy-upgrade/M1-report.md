# M1 报告：统一真实输入与新提取入口

> 状态：已实现，自动化测试通过。浏览器/真实 DB 未跑，标为待验证。

## 1. 当前提交 / 工作区状态

- 基线提交：`2d4ba0f0`（WB5/WB6 验收修复），分支 `main`。
- 本轮新增/修改文件（未提交，等待用户确认后 commit）：
  - 新增：`backend/src/announcements/manual-extraction.service.ts`
  - 新增：`backend/src/announcements/manual-extraction.service.spec.ts`
  - 新增：`backend/src/announcements/manual-entry.spec.ts`
  - 新增：`src/lib/announcements-pipeline/api.test.ts`
  - 修改：`backend/src/announcements/announcements.service.ts`（手动入口委托新链路 + URL 抓取）
  - 修改：`backend/src/announcements/announcements.controller.ts`（submitSource 接收 attachments）
  - 修改：`backend/src/announcements/announcements.module.ts`（import SourcingCoreModule + DocumentProcessingModule，注册 ManualExtractionService）
  - 修改：`backend/src/document-processing/parsers/spreadsheet-document.parser.ts`（headerRow/column 统一为 1-based，修根因）
  - 修改：`backend/src/sourcing/testing/crawl-testing.ts`（FakePrisma 扩展 M1 所需查询）
  - 修改：`src/app/admin/pipeline/page.tsx`（附件上传 + URL 抓取提示 + 材料包文件状态展示）
  - 修改：`src/lib/announcements-pipeline/api.ts`（submitSource attachments + Run.manualExtraction 类型）
- 保留用户既有未提交改动：`DEPLOYMENT.md`、根 `package.json`（未触碰）。

## 2. 前置条件

- 已读 AGENTS.md、v7.2 文档指针；`docs/specs/workbuddy-pipeline/`（README/spec/checklist）与 `tests/fixtures/workbuddy/README.md`。
- 确认断点（与提示词一致）：`AnnouncementsService.runExtraction` 走旧 `parser.ts`（公告级无 scope）；`submitSource` URL 模式把 URL 字符串当正文。

## 3. 改动与原因

### 3.1 新业务服务 `ManualExtractionService`
手动提交/提取复用新多岗位抽取链路，与队列路径（`AnnouncementExtractService`）共用同一 `extractFields` 纯函数与 `FIELD_EXTRACTOR_VERSION`，消除两套抽取逻辑。

- `submitSource`：正文 + 附件各自落 `SourceSnapshot` + `SourceDocument`，正文为 parent、附件为 child（`parentDocumentId` 关联），建立最小「公告材料包」。附件文本不无位置拼接（各自独立 snapshot/document，业务抽取按 locator 回原文）。
- `runExtraction`：读正文 + 附件字节 → `DocumentParserService.parse`（含安全防护/格式判定/OCR/DOCX 未启用判定）→ 逐文件 `extractFields` 汇总 → 持久化 candidate + 锚点。
- 不可读/不支持/待人工文件明确标 `readStatus` + `reason`，不以空结果伪装成功；全部不可读 → 诚实 `failed(NO_CANDIDATE_FIELDS)`；部分可读 → `partial`。

### 3.2 根因修复：spreadsheet 表头行号/列号基准不一致
`spreadsheet-document.parser.ts` 的 `headerRow`（0-based）与 cell locator 的 `row`（1-based）、`columns[].column`（0-based）与 locator `column`（1-based）不一致，导致**表头行被误抽**、**列语义错位**。统一为 1-based。这是 WB2 多岗位抽取在真实 xlsx 输入下从未被正确触发的隐藏断点（WB2 单测用手工构造的 1-based headers，未暴露）。

### 3.3 手动入口委托 + URL 真正抓取
`AnnouncementsService.submitSource` 检测 URL 模式（`content` 是 http(s) 且 `sourceType=government`）时用 `SafeFetcherFactory` 抓取真实正文；失败抛明确错误引导切换「粘贴正文」人工输入，绝不把 URL 字符串当成功正文。`runExtraction` 委托 `ManualExtractionService`。

## 4. 接口 / 数据兼容

- `POST /api/announcements/sources` 新增可选 `attachments: Array<{name, mimeType?, base64}>`；旧调用不传则向后兼容。
- `POST /runs/:id/extract` 响应新增 `manualExtraction`（材料包文件状态）；`GET /runs/:id` 从 `candidate.rawJson.files` 恢复该字段（刷新可读）。
- 无新增 Prisma migration（复用既有 `SourceSnapshot`/`SourceDocument`/`DocumentParseRun`/`ExtractionRun`/`EvidenceAnchor`）。
- 旧 `parser.ts` 未删除，仅作为无 `manualExtraction` 注入时的兜底（生产恒注入）；不破坏既有单测。

## 5. 完成标准（通过 / 失败 / 阻塞）

| ID | 验收 | 结果 |
|---|---|---|
| M1-01 | 后台真实入口提交两行语文岗位表与正文 → 两个不同 job scope | ✅ `manual-extraction.service.spec.ts` M1-01 |
| M1-02 | URL 获取失败/附件不可读 → 明确失败/部分完成 | ✅ M1-02/02b + `manual-entry.spec.ts` URL 抓取失败 |
| M1-03 | 同快照同版本重复触发 → 幂等、不覆盖人工决定 | ✅ M1-03 |
| M1-04 | 刷新/重进 → 读取已保存数据，run 与文件对应 | ✅ M1-04（rawJson.files 关联 document/snapshot id） |
| M1-05 | 无权限调用新入口拒绝 | ✅ 复用既有 `StrictAdminGuard`/`AdminGuard`（controller 未改 guard） |
| M1-06 | Worker/新服务真实启动/隔离集成 | ✅ `manual-entry.spec.ts` Nest 模块编译 + 依赖注入；`npm run build` 通过 |

## 6. 实际验证命令与结果

- `cd backend && npm test -- src/announcements src/document-processing src/sourcing` → 457 tests，1 失败为**既有** `pdf-document.parser.spec.ts` 并行超时抖动（单跑通过，与 M1 无关）。
- `cd backend && npm test -- src/document-processing/parsers/pdf-document.parser.spec.ts` → 6 passed（确认非回归）。
- `cd backend && npm run lint` → 0 warnings 0 errors。
- `cd backend && npm run build` → 通过。
- `cd . && npx tsc --noEmit`（前端）→ 我改文件无类型错误。
- `cd . && npx eslint src/app/admin/pipeline/page.tsx src/lib/announcements-pipeline/api.ts` → 无错误。
- `cd . && npm test -- src/app/admin/pipeline src/lib/announcements-pipeline` → 18 passed。

## 7. 未验证项（需浏览器 / DB / 真实原件）

- 浏览器端到端点击「提交附件 → 提取 → 审核」未跑（无浏览器环境）。
- 真实 PostgreSQL 落库未跑（测试用内存 FakePrisma）；`ManualExtractionService` 的持久化查询基于 Prisma schema 语义，未对真实 DB 实跑。
- 真实官方样本（真实 gov.cn 公告 + 岗位表附件）未抓取验证；URL 抓取用离线 `OfflineFetcherFactory` 验证了安全约束与失败路径。
- 对象存储（OSS）路径未跑，测试用 `FakeObjectStore` + 本地 `.data` 兜底。

## 8. 下模块（M2/M3）可复用内容

- `ManualExtractionService` 的「正文 + 附件材料包」关联（`SourceDocument.parentDocumentId`）与 `MaterialFileStatus` 契约，M3 跨文件裁决可直接消费，无需重建关联。
- `rawJson.files` 已记录每文件 document/snapshot id + readStatus + reason，M3 裁决与 M2 固定分母可读。
- `spreadsheet` 解析器 headerRow/column 1-based 修复，是后续所有多岗位表格抽取的正确基准。
- 测试替身 `FakePrisma` 扩展了 `sourceDocument.findFirst(latestSnapshotId)` / `findMany(parentDocumentId, kind)` / `extractionRun.findUnique(include.snapshot)`，后续模块测试可复用。
