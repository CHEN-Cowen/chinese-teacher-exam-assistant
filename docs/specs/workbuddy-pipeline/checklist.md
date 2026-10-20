# WorkBuddy 完成清单（WB1–WB6）

> 状态：WB0 已完成（规格 + 黄金样本 + 隔离测试）。WB1、WB2、WB3 已完成，WB4–WB6 未实现。
> 本文把后续工作拆成六个模块，每个模块标注前置条件、完成门、非目标。

## 总前置条件（所有模块共用）

- 已读 `docs/specs/workbuddy-pipeline/spec-workbuddy.md`、`field-catalog.md`、`checklist.md`；
- 已读 `tests/fixtures/workbuddy/golden-sample.json` 与 `README.md`；
- 遵守 `AGENTS.md`：涉及领域模型改动前读 v7.2/v7.1/v7.0 文档；
- 不修改 `src/` / `backend/src/` 生产逻辑之外的契约（除非该模块明确允许）。

## 模块拆分

### WB1：候选字段契约落地（scope/status/jobKey/ruleVersion）

- **目标**：把 `backend/src/announcements/domain.ts` 的 `CandidateField` 扩展为规格 §3 契约，
  补齐 `status`（extracted/unknown/conflict）、`scope`、`jobKey`、`ruleVersion`、`alternatives`。
- **前置条件**：WB0 规格与黄金样本就绪（已完成）。
- **完成门**：
  - `CandidateField` 具备规格 §3 全部字段，且向后兼容旧字段；
  - 三种状态语义与规格 §4 一致（unknown ≠ 不符合；conflict 不静默覆盖）；
  - 单测覆盖状态机与 `alternatives` 保留规则；
  - 黄金样本 `golden-sample.test.ts` 仍通过。
- **非目标**：不做抽取器改造、不做审核界面、不做发布转换。

### WB2：多行岗位表抽取（消除“只取首行”）

- **目标**：改造 `field-extractor.ts`，让表格抽取支持多行岗位，
  每行独立产出 `scope=job` + `jobKey` 的字段，消除“只取首数据行”的缺口。
- **前置条件**：WB1 契约落地。
- **完成门**：
  - 同一工作表的多行岗位各自产生字段，jobKey 互不相同；
  - 岗位字段值不跨行混用（用黄金样本跨岗位混值断言守护）；
  - 无官方岗位编号时生成位置键并标记“待人工固化”；
  - 单测覆盖 2+ 行岗位表、跨岗位不同专业/学历。
- **非目标**：不建稳定岗位持久化（那是 WB3）、不做审核界面。

### WB3：高风险字段与质量门禁（已完成）

- **目标**：让未知、冲突、语义保真和证据要求成为可执行规则。建立单一字段注册表，
  语义保真标准化纯函数，完整性与冲突报告 + 门禁纯函数；不实现 UI、正式发布或导出。
- **前置条件**：WB1、WB2 完成。
- **完成门**：
  - 字段清单只有一个代码事实源（`field-registry.ts`，`HIGH_IMPACT_FIELDS` 从它派生）；
  - 语义保真标准化只做 Unicode/空白/全半角/首尾清理，保留「师范」、不合并学历、
    编制不猜测、年龄基准日/例外不推断、报名 URL 不猜测（`normalization.ts`）；
  - 完整性与冲突报告为纯函数：逐岗位 expected/extracted/unknown/conflict 计数、
    缺证据高影响字段、未确认 AI/OCR 字段、冲突替代值数量、阻塞审核/发布原因（均带 scope+field）；
  - 门禁：pending/unknown/conflict/高影响缺证据不静默进入可发布状态；
    可选字段 unknown 可进人工审核但结果可见；AI/OCR 门禁继续有效；
  - 不声称字段正确率，只报告完整性/采用率/修改率等可复算指标；
  - 旧公告级候选兼容（「必需字段缺失」不作硬发布门禁）。
- **非目标**：不做候选→目录两阶段转换与稳定 jobId 持久化（那是后续 WB 的目录转换职责）、
  不做审核 UI、不做发布/导出行为。

### WB4：三种状态与四种处理结果的审核语义

- **目标**：实现人工审核动作 `adopt / edit / reject / pending` 与
  状态 `extracted / unknown / conflict` 的完整流转与留痕。
- **前置条件**：WB1 完成（状态字段落地）。
- **完成门**：
  - `conflict` 必须人工裁决（edit 选定并保留 alternatives）；
  - `unknown` 可 pending 补充，不自动判不符合；
  - `reject` 记录原因且字段不进发布；
  - `ReviewRecord` 留痕完整（前后值、动作、原因）；
  - AI/OCR 候选 `needsHumanConfirm` 前不得发布（沿用 `domain.ts` 现有规则）。
- **非目标**：不做审核 UI 细节（后台页面已存在，本模块只补语义与域逻辑）。

### WB5：字段标准化与证据链完善

- **目标**：落实 `field-catalog.md` 的标准化边界（学段/学科/学历/用工性质枚举，
  “师范”保留、年龄基准日/例外独立、报名批次绑定等），完善证据锚点回溯。
- **前置条件**：WB1、WB2 完成。
- **完成门**：
  - 专业标准化保留“（师范）”等限定词；
  - 年龄基准日/例外为独立字段，缺失置 unknown；
  - 报名时间/材料/入口绑定明确批次；
  - 每条字段证据可回溯到 worksheet/cell、段落或 URL 锚点。
- **非目标**：不引入真实学科/专业目录数据库（可先用枚举/映射表）。

### WB6：端到端回归与验收

- **目标**：把 WB1–WB5 串成端到端链路（抽取 → 审核 → 发布 → 目录 → 匹配），
  跑通全量回归与隔离测试，更新 v7.2 追踪表。
- **前置条件**：WB1–WB5 全部完成。
- **完成门**：
  - 黄金样本全链路可复算（抽取结果与 `expectedReview` 一致）；
  - `tests/fixtures/isolation.test.ts` 与全部 fixture 测试通过；
  - 无生产代码被 fixture 污染；
  - 更新 `docs/v7.2-implementation-tracking.md`，标记 WB 各模块完成状态。
- **非目标**：不做 OCR 精度提升（WP5-03 独立评估）、不做多岗位比较（后续版本）。

## 依赖顺序

```text
WB0（本清单，已完成）
 └─► WB1（契约） ─► WB2（多行抽取） ─► WB3（高风险字段+质量门禁，已完成）
        │              │                    │
        └─► WB4（审核语义）  WB5（标准化）  └─► WB6（回归）
```

> 注：WB3 按用户最新要求重定义为「高风险字段与质量门禁」，原「稳定岗位标识与
> 发布载荷转换」职责顺延至后续目录转换模块，不在 WB 系列编号内单独占位。

## 非目标（全模块共通）

- 不重建抓取器、队列、对象存储（v7.2 WP4 已存在）；
- 不重建后台管理页面（`/admin/sources`、`/admin/pipeline` 已存在）；
- 不新增依赖、migration、页面、API（除非模块完成门明确要求）；
- 不在 WB6 之前宣称任何 WB1–WB5 已完成。
