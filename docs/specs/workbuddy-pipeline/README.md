# WorkBuddy 规格与黄金样本（WB0）

> 本目录是后续 WorkBuddy 模块（WB1–WB6）唯一使用的规格事实来源。
> 原则：**先固定“什么算正确”，再写功能。**

## 背景与缺口

当前 `backend/src/announcements/` 已具备三层事实分离（公告事实 / 机器候选 / 人工结论）与字段抽取器，
但存在三个关键缺口，本规格在 WB0 先行定义契约，后续模块据此补齐：

1. **表格业务抽取只取首数据行**：`field-extractor.ts` 抽取表格时只取表头下的首个数据行，
   多行岗位表会丢弃其余岗位（代码已用 warning 标注“行级拆分需人工处理”）。
2. **候选字段没有稳定岗位归属**：`CandidateField` 只有 `field/value/anchor/confidence/origin`，
   没有 `scope`（公共 / 岗位）与岗位标识，无法把字段归属到具体岗位。
3. **发布候选载荷与目录载荷不是同一契约**：`ExtractionCandidate`（`{fields, parserVersion, rawJson}`）
   与前端匹配消费的 `RecruitmentAnnouncement` / `AnnouncementVersion` / `ApplicationUnit`
   结构完全不同，发布时缺少显式、可校验的两阶段转换。

## 目录内容

| 文件 | 内容 |
|---|---|
| `README.md` | 本文件：背景、缺口、目录索引 |
| `spec-workbuddy.md` | 核心规格：范围、岗位标识、候选字段契约、状态机、处理结果、两阶段载荷 |
| `field-catalog.md` | 应有字段清单：范围 / 高影响 / 必需 / 允许未知 / 证据 / 标准化边界 |
| `checklist.md` | 完成清单：WB1–WB6 的前置条件、完成门、非目标 |

## 黄金样本位置

黄金样本不放在本目录，而放在 `tests/fixtures/workbuddy/`（遵守测试隔离规则），
由 `tests/fixtures/workbuddy/*.test.ts` 消费，确保：

- fixture 不进入 `src/` / `backend/src/` 生产目录（`tests/fixtures/isolation.test.ts` 守护）；
- 预期结果可人工复算，公共字段与岗位字段显式区分；
- 未知与冲突是结构化预期状态，而非空白备注。

## 阅读顺序

实现任何 WorkBuddy 功能前，按顺序读：

1. 本 README；
2. `spec-workbuddy.md`（契约与不变量）；
3. `field-catalog.md`（字段口径）；
4. `checklist.md`（模块拆分与完成门）；
5. `tests/fixtures/workbuddy/README.md`（黄金样本语义）。
