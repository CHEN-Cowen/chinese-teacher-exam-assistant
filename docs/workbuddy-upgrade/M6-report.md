# M6 报告：真实指标、复用与离线交付

> 状态：已实现最小计量/指标/离线包纯函数 + 空白待填写模板。真实材料（S1/S2 真实样本、真实会话/调用 ID、真实计时）未导入，标为待填写；不填虚构成绩。

## 1. 当前提交 / 工作区状态

- 基线提交：`aa0a37ac`（M4），工作区另含 M5 未提交改动（engine/types/opportunities 等，本轮保留不覆盖）。
- 本轮新增/修改文件（未提交，等待用户确认后 commit）：
  - 修改：`backend/src/announcements/export.ts`（`TimingMetrics.reviewDurationMs` 语义正名 + 新增 `computeTimeTracking` / `computeAccuracy` 纯函数 + formulaNotes 澄清）
  - 新增：`backend/src/announcements/offline-package.ts`（manifest / S1-S2 复用校验 / 成果摘要纯函数）
  - 新增：`backend/src/announcements/m6-metrics-offline.spec.ts`（15 项行为测试）
  - 新增：`docs/workbuddy-upgrade/M6-experiment-template.md`（空白待填写实验记录模板）
- 保留用户既有未提交改动：`DEPLOYMENT.md`、根 `package.json`、M5 的 9 个源文件（未触碰）。

## 2. 前置条件与实际核对

- 已读 AGENTS.md、M1–M5 报告、`contracts.md`、`docs/specs/workbuddy-pipeline/`、WB6 导出实现（`export.ts`/`export.service.ts`）。
- 核对结论（与提示词一致的现状）：
  - WB6 已实现：JSON/CSV 导出、`computeExportMetrics`（scopes/ratios/timing/fixedDenominator）、`ratio`（分子/分母/公式/null）、脱敏、公式注入防护、「采用率不是准确率」声明。
  - M6 增量断点：
    1. `TimingMetrics.reviewDurationMs` 注释写「人工审核耗时」，实为「首末审核时间差」——语义误导，需正名为「审核事件跨度」；
    2. 缺少「人工投入/等待/返工/暂停/重试」的自报式最小计量（M6-A2/A3）；
    3. 缺少「独立核验正确率」的显式建模（M6-B6：分子/分母/核验人/方式）；
    4. 缺少离线包 manifest、S1/S2 复用校验、成果摘要（M6-C）。

## 3. 改动与原因

### 3.1 时间口径（export.ts，M6-A）

- `TimingMetrics.reviewDurationMs` 注释改为「审核事件跨度」，`formulaNotes` 同步：「这是事件跨度，不是人工投入时长」。
- 新增 `computeTimeTracking` 纯函数 + `TimeTrackingInput/Report`：开始/完成/人工投入/等待/返工/暂停/重试全部**自报**；未结束（有开始无完成）→ `notFinished=true`；负时间 → null；无记录 → null 不填 0；note 声明「墙钟/人工投入/等待可能并行，不做相加」。

### 3.2 独立核验正确率（export.ts，M6-B6）

- 新增 `computeAccuracy` + `IndependentVerification/AccuracyReport`：仅在传入核验结果（verifier/method/totalFields/correctFields）时计算正确率；无核验 → `evaluated=false`、`value=null`；分母 0 或 correct>total → `value=null`。不输出召回率/提效百分比。

### 3.3 离线交付包（offline-package.ts，M6-C）

- `buildManifest`：schema 版本、synthetic 标记、datasetMark、inputs（S1/S2）、entries（path/relatedIds/version/contentHash/visibility）、licenseNote。
- `fileContentHash`（复用 domain SHA-256）、`redactEvidenceUrl`（复用 redactUrl）。
- `validateReuse`：S2 复用必须独立输入 + 实际改动/失败；与 S1 输入版本相同或无改动记录 → 判「复制冒充/不构成可核对复用」。
- `buildAchievementSummary`：keyNumbers（带回溯来源）、workbuddyEvidence（真实引用 ID）、unusedCapabilities、pending（证据缺失标待补，不伪造）。

## 4. 接口 / 数据兼容

- 无接口契约变更、无 Prisma 迁移、无前端改动。
- `TimingMetrics.reviewDurationMs` 字段名不变（仅注释语义澄清），既有前端/导出兼容。
- 新增纯函数为增量导出，不改 `computeExportMetrics` 既有签名与行为。
- 新 schema 版本：`wb-offline-package@1.0.0`、`wb-achievement-summary@1.0.0`（独立于 WB6 `wb-export@1.0.0`，互不影响）。

## 5. 完成标准（通过 / 失败 / 阻塞）

| ID | 验收 | 结果 |
|---|---|---|
| M6-01 | 缺时间戳/未结束/重复开始/异常时间分别处理，未记录不补 0，人工投入与事件跨度不混 | ✅ `computeTimeTracking` 6 项测试（缺时间戳→null、未结束→null、负时间→null、正常区间、负值→null、跨度≠投入） |
| M6-02 | 固定小样本人工复算与 API/UI/导出一致，零分母 null | ✅ 复用 WB6 已有 `ratio`（分母 0→null）；`computeAccuracy` 分母 0→null；口径单一由 `computeExportMetrics`/`computeAccuracy` 产出 |
| M6-03 | 无独立答案/可信对照不生成准确率/召回率/提效百分比 | ✅ `computeAccuracy` 无核验→evaluated=false 不输出；不实现召回率/提效百分比 |
| M6-04 | 同一 run 原始值/修订/导出/指标可关联；不同清单版本不偷换分母 | ✅ 复用 WB6（JSON 导出含 decision/alternatives + M2 清单 version）；manifest relatedIds 关联 run/sample/清单版本 |
| M6-05 | S2 独立输入及实际改动/重试，不用 S1 复制冒充 | ✅ `validateReuse` 3 项测试（合法复用 / 同输入判冒充 / 无改动不构成复用） |
| M6-06 | 包解压可打开、哈希可复算 | ⚠️ 部分：`fileContentHash` 纯函数 + manifest 结构就绪；真实包打包脚本与解压验证未跑（无真实材料） |
| M6-07 | 敏感扫描 + 标识检查；导出失败不生成空文件 | ✅ 脱敏复用 redactUrl + 既有 WB6「无 candidate→400 不生成空文件」；真实包敏感扫描未跑（无真实材料） |
| M6-08 | WorkBuddy 证据存在才计为已提供，缺失标待补 | ✅ `buildAchievementSummary` 无证据→pending 标「证据缺失」 |

## 6. 实际验证命令与结果

- `cd backend && npm test -- src/announcements/m6-metrics-offline.spec.ts` → 15 passed。
- `cd backend && npm test -- src/announcements` → 261 passed（20 文件，无回归）。
- `cd backend && npm run lint` → 0 warnings 0 errors。
- `cd backend && npx tsc --noEmit -p tsconfig.build.json` → 无错误。
- `cd backend && npm run build`（nest build）→ 成功。

## 7. 未验证项（需真实材料 / 离线打包脚本 / 浏览器）

- **真实材料未导入**：S1/S2 真实样本、真实会话/录屏/调用 ID、真实计时均未提供。`M6-experiment-template.md` 为空白待填写模板，`synthetic` 应标记 true 直到真实数据回填。
- **离线打包脚本**：本轮交付 manifest 纯函数 + 模板，未写实际「收集文件→算哈希→生成 manifest→打目录」的脚本（无真实文件可打）。可执行步骤：收集 WB6 导出产物 → 对每文件 `fileContentHash` → `buildManifest` → 落 `manifest.json` → 整目录交付。
- **浏览器端到端**：M6 不涉及前端页面（复用 WB6 导出），无需浏览器；但「包解压到新目录后 CSV/JSON 可打开」需真实包才能实测。
- **敏感数据扫描**：真实包未生成，无法跑扫描；脱敏规则（redactUrl + sanitizeFieldForExport）已由 WB6 既有测试覆盖。

## 8. 下模块可复用内容

- `computeTimeTracking`（自报式时间计量，事件跨度≠人工投入）是后续任何「提效」评估的唯一时间口径，勿再从旧日志猜分钟。
- `computeAccuracy`（独立核验才算正确率）是后续任何「准确率」展示的唯一入口，勿输出无对照的召回率/提效百分比。
- `offline-package.ts` 的 `buildManifest`/`validateReuse`/`buildAchievementSummary` 是离线交付与 S1/S2 复用的单一事实源。
- `M6-experiment-template.md` 可直接作为最终验收的填写底表，回填后替换 `synthetic=false`。

> 自动判断边界：时间跨度/正确率/复用校验是结构化规则自动完成；人工投入、核验人/方式、WorkBuddy 证据、能力使用与否一律由真实记录人工填写，缺失标「未记录/待补」，不填 0、不伪造。
