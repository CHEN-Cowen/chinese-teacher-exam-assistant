# M5 报告：同一审核成果进入用户用途

> 状态：已实现核心合规可见性修复 + 可追溯映射证据。真实 PostgreSQL 落库、浏览器端到端、真实 S1 导入未跑（无 DB/浏览器环境），标为待验证。

## 1. 当前提交 / 工作区状态

- 基线提交：`aa0a37ac`（M4 审核工作台效率优化），分支 `main`。
- 本轮新增/修改文件（未提交，等待用户确认后 commit）：
  - 修改：`backend/src/matching/types.ts`（`RecruitmentAnnouncement.dataset` 增加 `'test'`，M5-05 一等建模）
  - 修改：`backend/src/matching/engine.ts`（新增 `isUserVisibleInCatalog` 纯函数）
  - 修改：`backend/src/opportunities/view.ts`（`buildMatchResponse`/`buildUnitDetail` 过滤改为统一语义 + DTO dataset 类型）
  - 修改：`backend/src/opportunities/opportunities.service.ts`（`buildCatalogSnapshot`/`findCatalogUnit`/`initialMaterialStatuses` 过滤改为统一语义）
  - 修改：`backend/src/opportunities/subscription.domain.ts`（提醒口径对齐统一函数）
  - 修改：`backend/src/trial/trial.service.ts`（静态目录索引的 test 值收窄处理）
  - 修改：`backend/src/opportunities/v72-chain-regression.spec.ts`（DB fixture 由 `dataset='test'` 改为 `real + human_reviewed`，纠正「test 进用户端」的错误语义）
  - 修改：`backend/src/matching/engine.spec.ts`（+3 项 M5 纯函数测试）
  - 新增：`backend/src/opportunities/m5-user-visibility.spec.ts`（4 项 M5 服务级测试）
- 保留用户既有未提交改动：`DEPLOYMENT.md`、根 `package.json`（未触碰）。

## 2. 前置条件与实际核对

- 已读 AGENTS.md、M1–M4 报告、`contracts.md`、`docs/specs/workbuddy-pipeline/`。
- **数据流追踪结论**（可追溯映射，已存在，无需重建）：
  ```
  material bundle/snapshot/run → submitReview(fieldDecisions) → publish
    → buildCatalogPayload（catalog-payload-assembler.ts）
    → PublishedAnnouncementVersion.payload（含 dataset/reviewStatus）
    → PublishedCatalogRepository.listPublished（DB 唯一事实源）
    → projectCatalogVersion → RecruitmentAnnouncement
    → OpportunitiesService.loadCatalog（ff_db_catalog 开关）
    → match/unitDetail/follow → 用户页面
  ```
- **核心断点（与提示词「先确认当前页面消费哪条路径」一致）**：用户端目录来源由 `ff_db_catalog` 控制（开=DB，关=静态 demo+real 台账）。但**合规过滤逻辑把「dataset==='real'」错误等同于「AI 初核待复核」**，在 `view.ts`（2 处）与 `opportunities.service.ts`（3 处）用 `dataset === 'real'` 直接过滤，导致**已人工复核（human_reviewed）的真实岗位也被挡在用户端之外**——机会列表与关注/详情/材料初始化口径不一致（列表能看到 real 数据，但关注/查材料报「未找到该报考单元」）。
- 对照发现 `subscription.domain.ts` 已有正确语义（`dataset !== 'demo' && reviewStatus !== 'human_reviewed'`），进一步印证其余 5 处是历史遗留的错误口径。

## 3. 改动与原因

### 3.1 统一合规可见性纯函数（engine.ts）

新增 `isUserVisibleInCatalog(announcement)`，单一事实源：
- `dataset='test'` → 永不进入用户端（自动化样本，M5-05）；
- `dataset='real'` 且 `reviewStatus !== 'human_reviewed'` → 不进入（AI 初核待复核，M5-03）；
- 其余（demo 或缺省）→ 进入。

### 3.2 统一 5+1 处过滤口径

- `view.ts` `buildMatchResponse`/`buildUnitDetail`：`dataset !== 'real'` → `isUserVisibleInCatalog`；
- `opportunities.service.ts` `buildCatalogSnapshot`/`findCatalogUnit`/`initialMaterialStatuses`：`dataset === 'real'` → `!isUserVisibleInCatalog`；
- `subscription.domain.ts`：`dataset !== 'demo' && reviewStatus !== 'human_reviewed'` → `!isUserVisibleInCatalog`（顺带补上 test 缺口）。

效果：已人工复核的真实岗位（WB5 发布产物）现在能进机会列表、详情、关注、材料初始化、备考目标、订阅提醒——同一批已审核数据被用户端一致读取。

### 3.3 dataset 类型补全（types.ts + view.ts + trial.service.ts）

- `RecruitmentAnnouncement.dataset` 由 `'demo' | 'real'` 扩展为 `'demo' | 'real' | 'test'`，与 WB5 `CatalogDataset`（test/demo/real）和 projector 的 `payload.dataset` 枚举对齐，让 test 成为一等建模、可在过滤层显式隔离；
- `view.ts` DTO dataset 类型同步；`trial.service.ts` 静态目录索引对 test 值收窄（静态 demo/real 台账本不含 test）。

### 3.4 纠正测试 fixture 的错误语义

`v72-chain-regression.spec.ts` 的 DB fixture 原用 `dataset='test'` 验证「DB 读回进用户端」，这本身与 M5-05（test 不进用户端）矛盾。改为 `dataset='real' + reviewStatus='human_reviewed'`，既保留 WP3「DB 读回进用户端」验证目标，又符合正确隔离语义。

## 4. 接口 / 数据兼容

- 无接口契约变更、无 Prisma 迁移。
- `RecruitmentAnnouncement.dataset` 类型扩展向后兼容（只增枚举值，旧 demo/real 不受影响）；投影层 `dataset as RecruitmentAnnouncement['dataset']` 强转现为合法（test 已入枚举）。
- 行为变化：**已人工复核的 real 岗位从「被过滤」变为「进入用户端」**——这是 M5 的目标行为，不是回归。AI 初核待复核 real 与 test 仍被正确过滤。
- 静态目录（`ff_db_catalog` 关）下，`real-catalog.ts` 3 条 `ai_reviewed_pending` 台账仍被过滤（reviewStatus 未复核），7 条 demo 照常，行为不变。

## 5. 完成标准（通过 / 失败 / 阻塞）

| ID | 验收 | 结果 |
|---|---|---|
| M5-01 | 正式服务方法发布两岗位，隔离真实 DB 读回；事务失败回滚无半发布 | ⚠️ 阻塞：本机 PostgreSQL 未运行（`localhost:5432` P1001）。发布/回滚链路已由 WB5 `publish-catalog.integration.spec.ts`（FakePrisma 事务）覆盖，但真实 DB 读回未跑，标待验证 |
| M5-02 | UI/API 读取与同一 run/版本映射一致，不是静态 JSON | ✅ 部分：`m5-user-visibility.spec.ts`「M5-02」证明 DB 已发布 human_reviewed 岗位经正式 match 被读到（PublishedCatalogRepository 读回）；浏览器端 UI 实测未跑 |
| M5-03 | 未知/缺证据/冲突未解决时阻塞或待确认，不误导为已符合 | ✅ 过滤层（ai_reviewed_pending 不进入）+ 既有 gate `evidence_not_reviewed`/`no_official_source`；「M5-03」测试证明 ai_reviewed_pending 不进用户端 |
| M5-04 | 两个画像得到可解释条件结果，每项证据可回原文 | ⚠️ 部分：匹配引擎四值判定 + 证据锚点已由既有 engine.spec/opportunities.service.spec 覆盖；M5 未新增专门双画像用例（既有测试已含多画像），浏览器端条件展示未跑 |
| M5-05 | 历史/demo/test 不计入当前真实可报；无岗原因表述准确 | ✅「M5-05」测试证明 test 不进用户端；`countOpenRealUnits` 按 dataset=real + 报名窗口计在报数；历史公告由 gate `registration_closed` 降级 |
| M5-06 | 官方入口和材料对应正确批次；点击不显示报名完成 | ⚠️ 部分：`catalog-payload-assembler` 从已采纳 official_entry/materials 构造，不猜链接；浏览器端「点击入口」实操未跑（前端从不显示「报名完成」，见既有语义） |
| M5-07 | 修订/撤回后读到正确有效版本，关注关联稳定，不复活过期 | ✅ 既有：`currentVersion` 取最高版本 + `PublishedCatalogRepository` 按 status 处理 withdrawn/superseded + follow `newerVersion` 标记；未新增专项测试但被 v72-chain-regression/real-catalog 覆盖 |

## 6. 实际验证命令与结果

- `cd backend && npm test -- src/matching src/opportunities src/catalog src/trial` → **198 passed + 1 expected fail**（18 文件；expected fail 为 WP5 既有 it.fails）。
- `cd backend && npm test -- src/opportunities/m5-user-visibility.spec.ts src/matching/engine.spec.ts` → 26 passed（M5 专属 7 项）。
- `cd backend && npm run lint` → 0 warnings 0 errors。
- `cd backend && npx tsc --noEmit -p tsconfig.build.json` → 无错误。
- `cd backend && npm run build`（nest build）→ 成功。

## 7. 未验证项（需 DB / 浏览器 / 真实原件）

- **真实 PostgreSQL**（M5-01）：本机 DB 未运行（`localhost:5432` P1001）。真实发布两岗位 → 读回、事务失败回滚无法实测。可执行步骤：启动 PG → `prisma migrate dev` → `FF_DB_CATALOG=on` 起服务 → 走「提交→提取→审核→发布→match」全链路。
- **浏览器端到端**（M5-02/M5-06）：无浏览器工具，「选定地区→查看岗位→核对条件→材料准备→官方入口」实操未跑。组件/服务测试不等价于整页实操。
- **真实 S1 导入**：未导入真实 gov.cn 公告（无原件+DB）。静态 `real-catalog.ts` 3 条台账为 AI 初核态，M5 修复后它们仍被正确过滤（未人工复核），不会误进用户端。

## 8. 下模块可复用内容

- `isUserVisibleInCatalog` 是「数据集合 × 复核状态」可见性的单一事实源，后续任何用户端读取点（列表/详情/关注/目标/订阅/纠错）统一引用，勿再散落 `dataset === 'real'` 判断。
- `RecruitmentAnnouncement.dataset` 已含 `test`，与 WB5 `CatalogDataset` 对齐，后续 test 隔离可直接按类型判断。
- 可追溯映射链路（bundle→run→version→unit→API→页面）已在本报告 §2 固化，后续模块引用本链路定位，不再重复追踪。

> 自动判断边界：数据集合/复核状态的可见性过滤是结构化规则自动完成；资格条件判定仍由匹配引擎四值（PASS/FAIL/UNKNOWN/MANUAL_REVIEW）产出，语义取舍（冲突选值、更正确认）一律人工裁决留痕。
