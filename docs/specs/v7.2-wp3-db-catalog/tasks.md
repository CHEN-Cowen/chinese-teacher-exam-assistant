# WP3 实施任务（按序执行；每步完成即勾选）

> 前置：spec.md 已批准（D1/D2/D3 全部按推荐执行）。禁止提交/推送；不改本地保护文件。

## T0. 建目录与骨架
- [x] 新建 `backend/src/catalog/`（feature-flag.ts、publication-projector.ts、published-catalog.repository.ts、catalog.module.ts）
- [x] 新建 `backend/src/sourcing/`（official-site-adapter.ts、fetch/safe-fetcher.ts、adapters/hangzhou-education.adapter.ts、sourcing.module.ts）

## T1. Feature Flag（D1）
- [x] 实现 `isDbCatalogEnabled(env)`：显式 on/off 优先；缺省 `NODE_ENV==='production'` 为 true。

## T2. Projector（D3）
- [x] `ProjectionError`（含 fieldPath）
- [x] `projectCatalogVersion(row, now)`：严格结构校验，lifecycle 由行状态派生，失败抛错。
- [x] `publication-projector.spec.ts`：合法样例（用 fixtures 的 payload 结构复刻，不 import fixtures）→ 断言映射字段；缺字段/类型错→ProjectionError；withdrawn→lifecycle。

## T3. Repository（D2）
- [x] `listPublished(now)`：`findMany({where:{status:{in:[...]}}, orderBy})`；按 announcementId 分组、versionNumber 降序、首个可投影者为 current；失败跳过并 warn；全失败跳过公告。
- [x] `getUnit(unitId, now)`：遍历 published 结果的 current version units。
- [x] `published-catalog.repository.spec.ts`：发布可见、草稿（空）不可见、withdrawn 标记/排除、投影失败回退上一版、flag 开不读静态、只调用 findMany。

## T4. SafeFetcher（R-WP3-03）
- [x] 实现 §5 安全策略全表；全部依赖可注入（resolveDns/fetchImpl/sleep）。
- [x] `safe-fetcher.spec.ts`：allowlist / 协议 / 凭据 / localhost / 环回 / 私网 / 链路本地 / 元数据 / DNS 复查 / 逐跳重定向 + 次数上限 / 私网与跨域重定向 / 连接+总超时 / 超大 / 错误 MIME+magic bytes / 301,302,304,429 / 重试与不重试 / 相同哈希 / 日志脱敏。（56 用例）

## T5. Adapter（R-WP3-04 输入侧）
- [x] `hangzhou-education.adapter.ts`：`listItems`/`parseDetail`；相对→绝对 URL；附件（名+URL）；DOM 失配抛 `AdapterParseError('DOM_MISMATCH')`。
- [x] `hangzhou-education.adapter.spec.ts`：读 `tests/fixtures/golden-sources/hangzhou/{list,detail}.html`（fs 路径，非 import）；正常解析断言；删改关键节点→断言抛错。

## T6. 服务接入 + Flag
- [x] `PublishedCatalogRepository` 注册进 `CatalogModule`；`OpportunitiesModule` imports `CatalogModule`。
- [x] `OpportunitiesService` 构造加可选第 4 参；`loadCatalog(now)`；catalog 参数下传给 `findCatalogUnit/…Meta/initialMaterialStatuses/buildCatalogSnapshot/fromRow/toDTO/toCorrectionDTO`；所有公开方法首行加载。
- [x] flag 开只读 DB（不 merge 静态）；flag 关=现状。

## T7. 端到端 HTML 闭环
- [x] `wp3-html-closure.e2e.spec.ts`：golden list→detail → SafeFetcher（注入 fetch/dns，无真实网络）→ 快照 → 杭州 Adapter → 目录载荷 → 写 published 行（内存 prisma）→ repository → `service.match` 命中该 unit；断言未读取静态目录。

## T8. 回归反转
- [x] `v72-chain-regression.spec.ts` 链路③：保留 flag 关的现状用例；把 `it.fails` 目标用例改为普通 `it` 并在其中 `process.env.FF_DB_CATALOG='on'`（结束还原），断言 DB 单元出现 + dbReads>0。
- [x] 链路④ 保持原样（WP5 未做）。

## T9. 验证与报告
- [x] `backend`: `npm test` / `npm run lint` / `npm run build` 全绿。
- [x] 确认 `tests/fixtures/isolation.test.ts`（根 `npm test`）仍通过；后端 spec 未 import fixtures。
- [x] 输出报告：真实链路 / 静态目录范围 / 安全策略 / 模型 / 测试 / 无需重部署验证；停止，不提交不推送。

## 完成门（对应 PRD 8.1 WP3）
- [x] 新公告发布后无需改代码或重部署即可匹配；
- [x] 生产不读静态目录；
- [x] SafeFetcher 通过 SSRF 测试；
- [x] 结构异常不静默；
- [x] 高影响事实保留证据；
- [x] 失败不覆盖上一版。
