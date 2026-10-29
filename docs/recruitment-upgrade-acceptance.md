# 教招有据：R00—R08 升级验收报告

生成日期：2026-10-29。本文档记录 `codex/modular-development` 分支在 M01—M12 集成完成后，执行 D00—D09（教育经历、分阶段匹配、往年参考、关注与纠错等升级）与 R00—R07（针对性修复与验证）的最终状态。

## 1. 与历史报告的关系

- `docs/final-e2e-acceptance-report.md`：M01—M12 阶段（2026-10-27）的集成验收，基于提交 `55965c2b`。记录后端 1153 通过、前端 683 通过、浏览器 E2E 25/25 通过。本文档不覆盖该阶段内容。
- `docs/recruitment-upgrade-progress.md`：D00—D09 + R00—R07 每步的详细执行记录、命令和证据。本文档为汇总版。
- `docs/m08-source-acceptance-report.md`：11 个来源适配器的逐来源验收矩阵与 S5 独立对账（2026-10-27）。本文档不重复来源适配器细节。
- `docs/source-observation-template.md`：连续 7 天采集观察记录模板。

## 2. 版本与环境

| 项 | 值 |
| --- | --- |
| 仓库 | `https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant.git`（远端名 `target`） |
| 分支 | `codex/modular-development` |
| 被测 HEAD | `cabf2b2`（R07 测试修复：e2e fake + ConsultationPanel），此前 `7b20379`（hookTimeout 补充），业务代码 HEAD `cf519ce` |
| 基线提交 | `1580595f`（R06 完成） |
| 环境 | 本机 Windows；后端 NestJS 12 + Prisma 6；前端 Next.js 16.3.8 + React 19 + Tailwind 4 |
| Node.js | 24 |
| PostgreSQL | 便携版 17.6-2（隔离实例 127.0.0.1:5544，验证后已清理） |
| Redis | 便携版 8.10.3-msys2（隔离实例 127.0.0.1:6379，验证后已清理） |
| 后端运行 | 已在隔离环境实测：`node dist/main`（PORT=3901）+ `node dist/worker.js` 启动，/health 全 up |
| 前端运行 | demo 模式生产构建端口 3100（`NEXT_PUBLIC_APP_ENV=demo`） |

## 3. 基线检查结果（2026-10-29，cf519ce）

### 3.1 后端

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全量单测 | `cd backend && npm test` | **99 文件 / 1265 通过 / 1 expected fail / 2 skipped**（修复前 9 failed 全为超时；hookTimeout 补充后两轮连续稳定全绿） |
| e2e | `cd backend && npm run test:e2e` | **2 文件 / 9 通过**（修复前 4 failed：fake Prisma 缺 updateMany、2 个用例期望停留在 R01 之前；修复后 EXIT=0） |
| 静态检查 | `cd backend && npm run lint` | **0 error / 6 warning**（既有 engine.ts unicorn/no-useless-spread 风格警告） |
| 构建 | `cd backend && npx nest build` | 通过 |
| Schema | `cd backend && npx prisma validate` | schema 有效 |
| 迁移文件 | 24 个增量迁移，按时间顺序，全部为新增表或可空列 | 安全 |

### 3.2 前端

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | **0 错误** |
| 静态检查 | `npm run lint` | **0 error / 2 warning**（scripts/ 独立脚本未使用变量） |
| 单测 | `npm test` | **74 文件 / 794 通过 / 0 unhandled error**（ConsultationPanel 卸载清理修复后全量复跑确认） |
| 生产构建 | `npm run build` | **30 页静态生成，通过** |
| postbuild 外部依赖 | 同上 | **阻断项 0 / 客户端密钥泄漏 0** |

## 4. R00—R07 逐项状态

| 编号 | 问题 | 修复提交 | 后端单测覆盖 | 浏览器验证 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R00 | 状态核实与台账 | `e4e4767` | — | — | ✅ 已完成 |
| R01-1 | 已登录时访客经历自动替换服务端 | `54262e9`（D01） | profile.service 28 通过 | — | ✅ 已修复 |
| R01-2 | 访客迁移只迁旧单字段、静默覆盖 | 同上 | — | — | ✅ 已修复 |
| R01-3 | 本机草稿/撤销快照不按身份隔离 | 同上 | storageIdentity 10 通过 | — | ✅ 已修复 |
| R01-4 | 教育/偏好整份 PUT 覆盖 + 无版本校验 | 同上 | — | — | ✅ 已修复 |
| R01-5 | 旧客户端 PUT 删除新字段 | 同上 | — | — | ✅ 已修复 |
| R01-6 | 读取失败伪装成无画像 | 同上 | — | — | ✅ 已修复 |
| R02 | 真实发布只生成 majorNames | `1a0671e`（D03） | catalog-payload-assembler 28 通过 | — | ✅ 已修复 |
| R03-1 | any 模式任一命中仍因他阶段缺失返回 UNKNOWN | 同上 | engine 35 通过 | — | ✅ 已修复 |
| R03-2 | 学位判断不区分取得状态 | 同上 | — | — | ✅ 已修复 |
| R03-3 | 未明确阶段时按最高学历直接判 FAIL | 同上 | — | — | ✅ 已修复 |
| R04-1 | 以"历史键为空"判首次同步 → 永久漏报 | `6d192ba`（D04）+ `341a3dc`（D05） | organization-follow.domain 9 通过 | — | ✅ 已修复 |
| R04-2 | 先发通知后记去重、无事务 → 重复/漏发 | 同上 | opportunities.service 53 通过 | — | ✅ 已修复 |
| R05-1 | 无修正版本也可结案并称"已更正" | `2644a86`（D06）+ `ef35388`（D07） | corrections.domain 6 通过 | — | ✅ 已修复 |
| R05-2 | 只校验同公告，不校验版本有效性与修正内容 | 同上 | opportunities.service 53 通过 | — | ✅ 已修复 |
| R06 | 历史详情无"关注单位"、筛选缺学历/专业、四入口与 D09 | `1580595f` | history.spec 33 通过 | ✅ demo 场景 3 | ✅ 已修复 |
| R07 | 超时用例、迁移、浏览器 | `cf519ce` + `7b20379` + `cabf2b2` | 后端单测全绿 + e2e 9/9 | ✅ demo 6 场景 | ✅ 已收口（边界见下） |

**R07 边界（2026-10-29 补充）**：迁移真实验证与后端启动健康检查已在隔离便携环境（PostgreSQL 17.6-2 + Redis 8.10.3，127.0.0.1 独立端口）实测通过——空库 24/24 迁移顺序初始化、二次 deploy 幂等、旧库（前 21 迁移 + 校验和 + 代表性数据）升级只应用剩余 3 个且数据保留、新表/新列/唯一索引核验通过、schema diff 仅 1 处索引命名漂移（旧版 camelCase 默认名，零功能影响）；API + Worker 真实启动后 /health 全 up（含 Worker 心跳），种子用户 GET/PATCH 200、正确 expectedUpdatedAt 推进版本、过期版本 409 VERSION_CONFLICT、无身份头 401、非管理员访问 /admin/sources/health 403。剩余仅 B/D/E 完整多角色浏览器编排需真实部署。

## 5. 浏览器端到端场景（demo 模式，2026-10-29）

| # | 场景 | 覆盖需求 | 结果 | 真实后端可覆盖？ |
| --- | --- | --- | --- | --- |
| 1 | 桌面 1440px 四入口导航 | U09 | ✅ PASS | —（纯前端路由） |
| 2 | 移动 375px 底部导航 | U09 | ✅ PASS | — |
| 3 | 往年参考筛选/详情/关注 | U06 | ✅ PASS | — |
| 4 | 资料填写→匹配解释 | U03 | ✅ PASS | 需真实公告发布链路进入匹配 |
| 5 | 无结果面板（上海覆盖缺口） | U04 | ✅ PASS | — |
| 6 | 我的关注入口可达 | U07 | ✅ PASS | 需服务端事务一致性验证 |

**demo 模式不可覆盖**：
- 服务端资料隔离（PATCH + expectedUpdatedAt + 409 乐观锁 + 双标签页并发）— R01 后端单测覆盖
- 规则从真实公告结构化→审核→发布进入匹配— R02/R03 后端单测覆盖
- 关注与通知（事务 + 幂等去重 + 首次同步基线）— R04 后端单测覆盖
- 纠错与补录（权限 + 修正版本有效性）— R05 后端单测覆盖
- /admin/pipeline 真实采集汇总接口— 后端单测覆盖
- 真实 SMTP/Session/Cookie 安全— M03 阶段覆盖

## 6. 采集能力验收边界

来源采集的调度、退避、去重、故障恢复能力已具备（M02/M08），但**连续 7 天真实观察未执行**：

- 11 个官方来源适配器：全部具备；层级 A 真实快照对账 2（南京、丽水）、层级 B 真实附件闭环 1（宁波）、层级 C fixture 回归 7、层级 D 待持续验收 11（调度能力有，7 天窗口未填）
- `docs/source-observation-template.md` 为每日记录表，需真实部署环境执行

**未完成即不宣称**：来源覆盖范围、发布延迟、持续运行稳定性保持待验。

## 7. 剩余风险与待验项

| 类别 | 项 | 原因 | 阻塞解除条件 |
| --- | --- | --- | --- |
| 后端链路浏览器 | B/D/E 完整多角色编排（关注事务、纠错版本校验等） | 需真实部署 | 部署后编排复验（A 组 PATCH 409/401/403 已在隔离环境实测通过） |
| 连续 7 天采集观察 | 11 个来源每日健康/覆盖/异常记录 | 需真实部署 | 部署后每日记录，7 天填满 |
| 线上 CI | 远端 GitHub Actions 的 verify workflow | 未触发本轮（手动推送） | 后续触发 |
| 真实支付 | 微信商户资质、APIv3 | 外部资质 | PRD 2 明确关闭售卖 |
| 线上 HTTPS + ICP | 域名备案、TLS | 外部资质 | PRD 2 明确前置 |

## 8. 提交与 CI

| 提交 | SHA | 分支 | 推送目的地 |
| --- | --- | --- | --- |
| R00 台账建立 | `04fe01fc` | codex/modular-development | target（已推送） |
| R01 资料隔离 | `54262e9` | 同上 | target（已推送） |
| R03 阶段匹配 | `1a0671e` | 同上 | target（已推送） |
| R04 无结果与预览 | `6d192ba` | 同上 | target（已推送） |
| R05 定向补充 | `341a3dc`、`dda21f1` | 同上 | target（已推送） |
| R06 往年参考 | `2644a86` | 同上 | target（已推送） |
| R07 关注与通知 | `ef35388` | 同上 | target（已推送） |
| R08 纠错补录 | `fd61e13` | 同上 | target（已推送） |
| D09 导航 + R06 收口 | `1580595f` | 同上 | target（已推送） |
| **R07 超时修复** | `cf519ce` | 同上 | target（已推送，已验证远端存在） |
| **R07 hookTimeout 补充** | `7b20379` | 同上 | target（已推送，连续两轮后端全量稳定全绿） |
| **进度文档更新** | `62d4b90` | 同上 | target（已推送，已验证远端存在） |
| **R07/R08 验收文档** | `766efb44` | 同上 | target（已推送，已验证远端存在） |
| **R07 测试修复** | `cabf2b2` | 同上 | target（已推送，远端 SHA 已核对一致） |

远端目标仓库：`https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant.git`，分支 `codex/modular-development` 最新代码 HEAD 为 `cabf2b2`（其后仅本文档提交）。

CI：未手动触发远端 GitHub Actions，结果待后续核对。本地全部 lint/test/build 通过不自动等同于 CI 通过。

## 9. 结论

**代码与本地集成验收完成（R00—R07）**：
- 后端 99 文件 / 1265 通过 / 1 expected fail / 2 skipped（hookTimeout 补充后两轮连续稳定全绿）；e2e 2 文件 / 9 通过
- 前端 74 文件 / 794 通过 / 0 unhandled error（ConsultationPanel 修复后全量复跑确认）；tsc 0 错；lint 0 error；build + postbuild 通过
- 浏览器 demo 模式 6 场景全部 PASS
- Prisma 迁移真实验证已在隔离便携环境实跑通过：空库 24/24 初始化、二次 deploy 幂等、旧库升级只应用剩余 3 个迁移且数据保留、结构核验通过、schema diff 仅 1 处索引命名漂移
- 后端 API + Worker 真实启动健康检查通过：/health 全 up（含 Worker 心跳），PATCH 正确版本 200 / 过期版本 409 / 无身份 401 / 非管理员 403 实测符合预期
- 后端 9 个 Windows 高并发 flaky 用例已最小修复：vitest 并发控制 + 全局 hookTimeout=15s + 7 个重初始化用例针对性 60s timeout（不改断言）
- 工作区中用户未提交的 `src/app/onboarding/page.tsx`（演示模式补充学位/就业状态，+18 行）及 CRLF 噪音文件均未纳入 R07/R08 提交

**不能宣称的**：
- B/D/E 完整多角色浏览器编排已验证 —— 需真实部署
- 连续 7 天采集观察已完成 —— 需真实部署
- 远端 CI 已验证 —— 本轮手动推送，未触发 GitHub Actions
- 商业可上线 —— 需真实微信支付/备案域名等外部条件

**当前可陈述的状态**：R00—R07 代码修复、本地验证与隔离环境验证完成并推送至指定仓库分支；R08 交付文档完成。剩余外部条件见 §7（B/D/E 编排、7 天观察、CI、支付/备案），上线前必须解除。
