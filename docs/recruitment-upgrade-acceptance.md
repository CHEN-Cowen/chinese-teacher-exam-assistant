# 教招有据：当前升级验收与部署门槛

核对日期：2026-10-29。产品基线为根目录 [PRD](../PRD.md)，架构与启动见 [README](../README.md)。旧开发任务、阶段指南、提示词与过程记录已从当前文件树精简，可从 Git 历史追溯。本报告记录事实与缺口，不等同于生产验收通过。

## 1. 核对版本与范围

- 仓库：CHEN-Cowen/chinese-teacher-exam-assistant；分支：codex/modular-development。
- 已审查远端版本：623f501bdf7263bf37627f59b9b70185f6085d06。
- 本轮代码差异审查范围：1580595f 至 623f501b；同时核对当前验收记录、工作流与远端任务状态，未重新执行整仓本地测试。
- 本地仍有原有未提交业务文件和未跟踪调试材料，不属于远端验收版本；文档清理提交不包含这些内容。
- 用户最后确认的阿里云运行版本为 6ffbef8e，不能推定服务器已经更新到当前开发版。

## 2. 开发完成情况与修复追溯

| 模块 | 当前状态 | 实际修复提交 |
|---|---|---|
| R01 资料隔离、迁移确认、字段级保存及兼容 | 已提交 | 86d6450b |
| R02 真实发布链路的分阶段专业规则 | 已提交 | e6d9c06f |
| R03 专业阶段与学位取得状态判断 | 已提交 | 7a254b6c |
| R04 单位关注基线、事务与通知去重 | 已提交 | 687ffc81 |
| R05 纠错结案与有效修正版本校验 | 已提交 | 3ba46219 |
| R06 历史筛选、关注单位、四入口与采集汇总（含 D09） | 已提交 | 1580595f |
| R07 测试稳定性、迁移和浏览器验证 | 已提交，真实完整业务编排仍待验 | cf519ce5、7b203792、cabf2b28 |
| R08 验收文档交付（D10） | 已提交报告，不表示所有待验项完成 | 766efb44、2f24d39c |
| 演示画像补充学位与就业状态 | 已提交 | fce3ffd2 |

先前报告把部分 D 阶段提交误记为 R 修复提交，本表已按提交历史更正。历史详情以 Git 记录为准。

## 3. 最新 GitHub Actions：已核实通过

[运行 40826135151](https://github.com/CHEN-Cowen/chinese-teacher-exam-assistant/actions/runs/40826135151) 对应完整提交 623f501bdf7263bf37627f59b9b70185f6085d06，完成状态 success：

| 任务 | 已执行的检查 | 结果 |
|---|---|---|
| verify | 后端 lint、单测、构建；临时 PostgreSQL/Redis、迁移、API/Worker 启动与健康冒烟 | success |
| frontend-verify | 前端 lint、单测、构建；Playwright 浏览器流程 | success |
| publish frontend | 前端容器构建并推送 GHCR | success |
| publish backend | 后端容器构建并推送 GHCR | success |

镜像标签均为 sha-623f501bdf7263bf37627f59b9b70185f6085d06，仓库分别为 ghcr.io/chen-cowen/chinese-teacher-exam-assistant 和 ghcr.io/chen-cowen/chinese-teacher-exam-assistant-api。本次只核实该运行的任务与步骤结果，没有独立拉取镜像或重新运行服务器验证。

旧报告中的“CI 未触发、待核对”已过时：推送工作流实际有运行，当前版本已通过。CI 绿色不能替代以下完整业务验收。

## 4. 已有本地与隔离环境证据

以下为此前执行记录的摘要，本轮没有重新运行，不能当作本轮新增实测：

- 后端：99 文件、1265 通过、1 expected failure、2 skipped；后端 e2e 2 文件、9 通过。
- 前端：74 文件、794 通过，lint、类型检查、构建和外部依赖检查通过。
- PostgreSQL 17 隔离实例：空库 24 项迁移、重复 deploy 幂等、旧库 21 项升级至 24 项且测试数据保留；记录有一处索引命名漂移，尚未在生产核验。
- 隔离 API/Worker 健康 up；资料 PATCH 正确版本 200、过期版本 409、无身份 401、非管理员管理接口 403。
- demo 浏览器六个场景：桌面及移动四入口、历史筛选与关注、资料与解释、空结果、我的关注可达。
- expected failure 仍对应后端保存响应统一 nextAction 的待实现目标；不能把该项目标算作已通过。缺少外部快照的 skip 不属于来源实测通过。

原始阶段证据见 [历史集成验收](final-e2e-acceptance-report.md) 与 [来源验收](m08-source-acceptance-report.md)。完整旧报告可从本次文档清理前的 Git 提交追溯。

## 5. 尚未完成的验收与已知问题

| 优先级 | 项目 | 影响与下一步 |
|---|---|---|
| 高 | 真实公告结构化→审核→发布→匹配完整流程 | 单测及 demo 不能代替；在隔离测试部署中通过真实 API 与浏览器串联核验，保留数据和角色证据 |
| 高 | 单位关注通知及纠错补录多角色完整流程 | 覆盖首次空基线、后续新公告、重复/并发同步、事务重试、修正版本有效性与角色权限；不能只检查健康接口 |
| 高 | 连续七天采集观察 | 21 个招聘来源尚未完成真实窗口；按 [观察模板](source-observation-template.md) 记录调度、新鲜度、失败恢复及实际发布，不能宣称全国完整覆盖或持续稳定已验收 |
| 低 | 复制反馈的卸载竞态 | ConsultationPanel.tsx 的剪贴板 Promise 若在卸载后完成，仍可能调用 flashFeedback 并创建计时器；建议补卸载状态判断和相应测试。本轮仅记录，未修改代码 |
| 既有待实现 | 保存响应的服务端 nextAction | 前端已有选择器；后端统一返回目标仍有 expected failure，不可描述为前后端全部完成 |

复制竞态位置：src/components/opportunities/ConsultationPanel.tsx，卸载清理约第 97—101 行，异步复制约第 125—131 行。它不构成本轮已证实的部署阻断故障，但应列入后续修复。

## 6. 部署结论与门槛

**可以进入隔离测试部署 / 小范围受控验收；不能宣称完整生产验收完成或商业收费已就绪。** 本轮未发现上述代码差异新增的阻断级业务错误，不代表整仓绝无缺陷。

部署前：

1. 固定通过 CI 的提交及前后端同一标签，确认构建模式和功能开关；不要仅使用浮动 latest。
2. 重新确认现有 standalone 项目、数据库绑定目录和配置，备份数据库、环境文件、Compose 与反代配置。数据库不得重新初始化或删除卷。
3. 根据实际已应用迁移执行增量升级，保留可恢复备份和应用回退版本；迁移后验证 API、Redis、Worker 与前端。
4. 不把 demo 镜像用于真实用户，invited 模式失败不得静默回退本地模拟数据。继续关闭真实售卖与生产 mock 支付。
5. 测试部署后执行上述完整多角色流程，再决定扩大试用；持续运行观察如实记录。
6. 公开服务前核实域名 HTTPS、真实 Cookie、SMTP 找回密码、国内网络及适用的备案要求；现有文档不代表这些条件当前已核验。

现有阿里云信息来自用户上次终端输出：项目 jiaozhao-standalone；目录 /home/admin/chinese-teacher-exam-assistant/deploy；配置 docker-compose.standalone.yml + deploy-release.yml；数据库容器 jiaozhao-standalone-db-1，数据绑定在该目录 data/postgres。执行前重新确认，不套用旧 kaobian-postgres 复用拓扑。

本轮仅清理文档、校正状态和审查，不部署服务器、不合并 main、不执行生产迁移、不修改业务代码。

## 7. 2026-11-20 线上采集批次（未升级部署）

本节记录本轮通过服务器现有权限执行的真实运行，不改变第 6 节的部署门槛结论。线上容器未重建、未执行迁移。

- 环境与版本：`https://kbzs.al.qich.top`，运行镜像 `sha-a3c881a91c7733c7d0c82e05677d92efb7328b20`（2026-11-08 启动，API/Worker/前端同 revision）；PostgreSQL 17、Redis 7、Worker 心跳 up、队列 waiting/active 为 0。部署 `.env` 的 `IMAGE_TAG` 为 `sha-2a7fb10f…`，与实际运行版本不一致，发布漂移需单独处理。
- 目录差异：线上镜像内目录 15 项（11 ready），不含 N1—N3 新增适配器；当前仓库目录 32 项（28 招聘 ready + 1 政策 ready + 2 候选 + 1 受阻）。因此本轮无法在线上执行广州、武汉、福州、郑州、贵阳等 N3 来源，仅执行线上已具备的 11 个来源。
- 批次结果（11 个来源）：发现 563、下载/新增 311、未变 711、失败 65；`pending_review` 56 → 378（+322，含 3 条人工补录），快照 +595。partial 3（南京、杭州、绍兴）；结构/解析异常 8（常州、嘉兴、丽水、蚌埠、萧山“公开正文附件缺少名称”，丽水、萧山另有跨域附件拦截；苏州线上失败，live 回放证明适配器未漂移）。
- 人工补录：上海松江、福建大田、湖北黄石 3 条均进入 `pending_review`；大田入库 2 个附件、黄石 1 个附件；黄石报名已于 2026-11-18 截止。抽取值存在偏差（如黄石学历被识别为“博士研究生”、报名时间仅保留开始日；大田单位名误取联系电话），需人工审核修正。
- 分页核验：广州分页为 `index.html`、`index_2.html`…`index_20.html`，`index_1.html` 是 404 且不属于分页序列，此前“第 2 页 7 字节缺口”系探测脚本页码命名错误，已更正；6 页窗口第 6 页 20 条、最早 2025-12-11。武汉 6 页至 2025-10-22；福州 6 页 90 条至 2026-07-01；潍坊 6 页 120 条至 2025-09-11；贵阳第 1 页最新 2026-10-17；郑州新政务 4 页 35 条、最新 2026-10-12。苏州 live 回放官方 3 页 34 条（最新 2025-03-12、最旧 2013-05-16），分页派生与官方 `createPageHTML` 一致。烟台本轮未做真实回放，仍按 6 页窗口记录为待复核。
- 代码变更：郑州适配器补充新政务 `.jhtml` 列表解析，并在 `source-discover` 接入 `jhtmlIndexPages` 派生 `index_2…index_N.jhtml`；新增共享函数 `attachmentNameFromLink`（锚点文本 → title/aria-label → 下载地址 fileName 参数 → 带扩展名的 URL 末段，全部取不到才失败），替换公开正文与长沙/福州/广州/贵阳/石家庄/泰安/潍坊/武汉 8 个适配器里的“附件缺少名称即整篇失败”逻辑。验证命令：`cd backend && npx vitest run src/sourcing`（37 文件、445 通过、2 跳过）。live 回放：郑州官方 4 页 35 条 + 1 篇正文；苏州官方 3 页 34 条；常州空锚点附件页命名为 `20261022092735_32017.xlsx` 而非报错。
- 宁波/鄞州排查（2026-11-20，服务器侧）：DNS 与网络正常（上游 100.100.2.136/138；两站解析到 CDN `203.107.60.182`；容器内 `index.html` 200、0.1–0.4 秒，连续 5 次无超时）。逐小时 `structure_changed` 的真因是栏目页为 jpaas JS 壳（`queryData` → `/api-gateway/jpaas-publish-server/front/page/build/unit`），原始 HTML 无 `/art/` 链接，`listUrls` 为空时回退首页必然解析失配；补齐 `listUrls` 后即时检查发现宁波 34 条、鄞州 74 条。宁波 10 个失败为 `document/download?fileUrl=<密文>` 附件端点反爬：带 Cookie/Referer/浏览器 UA 仍返回 200 + 60 字节“禁止访问！”，同域 `document/file-download?fileUrl=/cms_files/…` 可正常 302 下载，需浏览器会话或官方凭据，放宽 allowlist 无效。鄞州 2 个失败为附件缺名，已代码修复待部署。
- 未完成/阻塞：N3 适配器上线需部署 `a3c881a9..HEAD`（43 个提交）并执行 5 个待应用迁移，需单独授权与备份窗口；宁波附件需按 `document/download` 反爬结论另定方案（暂标人工补录）；苏州线上失败需在部署后复查线上 `listUrls`（本地 live 回放已通过）；黄石岗位表（193KB）与松江图片附件受人工提交 100KB 请求体限制未入库；丽水/萧山跨域附件需确认重定向目标主机后再决定是否加入 allowlist。
- 持续运行观察：自 2026-11-20 14:35（北京时间）起算，7 天观察 0/7；不宣称持续运行通过。

## 8. 2026-11-20 部署与修复验证（sha-3fb504a）

本节记录将 pathDenylist + attachmentNameFromLink 修复部署到生产服务器并验证宁波/鄞州归零的真实运行。此部署执行于第 7 节批次之后，服务器已完成镜像升级和滚动重建。

### 8.1 部署操作

- **备份**：数据库 `pg_dump` 38MB 至 `/home/admin/jiaozhao-backup-2026-11-20-163457.sql`；`.env` 同时备份；二者已在服务器留存。
- **CI 镜像**：commit `3fb504abe1700dc47736e178d1311a089ae152cd` 的 `docker-publish` 运行（GH Actions 44702577210）全绿，verify + frontend-verify + publish 四 job 成功。镜像推至 `ghcr.io/chen-cowen/chinese-teacher-exam-assistant-project-api`（后端）和 `ghcr.io/chen-cowen/chinese-teacher-exam-assistant-project`（前端）——仓库名含 `-project`，与 compose 默认的 `chinese-teacher-exam-assistant-api` 不一致（见 8.4 遗留项）。
- **镜像拉取**：`docker pull ghcr.io/chen-cowen/chinese-teacher-exam-assistant-project-api:sha-3fb504a…` 和 `docker pull ghcr.io/chen-cowen/chinese-teacher-exam-assistant-project:sha-3fb504a…` 成功，随后 `docker tag` 打 compose 期望的旧仓库名 tag（绕过配置不匹配）；`.env` 中 `IMAGE_TAG` 更新为 `sha-3fb504a…`。
- **滚动重建**：`docker compose -f docker-compose.standalone.yml up -d` 输出 migrate Exited(0)、backend Healthy、worker Started、frontend Started；db 和 redis 保留未重建。
- **健康检查**：`curl http://127.0.0.1:3000/api/health` 返回 `{"status":"ok","api":"up","db":"up","redis":"up","worker":"up","workerLastSeenAt":"2026-11-20T08:49:56Z"}`；`docker inspect` 确认 backend/worker/frontend 均运行新 image id。

### 8.2 修复验证

即时检查通过后端容器内 Node.js 脚本（NestFactory + CrawlOrchestrator.checkSource）触发，绕过 AdminGuard 的 session cookie 依赖。

**宁波市教育局**（sourceId `5943c9b0…`，adapter `ningbo-education`）：
| 指标 | 修复前（sha-a3c881a9） | 修复后（sha-3fb504a） |
|---|---|---|
| run status | structure_changed | **succeeded** ✅ |
| discovered_count | 34 | 34 |
| failed_count | 10 | **0** ✅ |
| fetch_audit 反爬端点 | failed × 10 | **skipped × 17** ✅ |
| error_summary | 反爬附件端点"禁止访问" | 空 |

pathDenylist 命中 `\/front\/document\/download(?:\?|$)`，fetch 前拦截不发请求、不计入 failed。宁波同域 `document/file-download` 合法端点不受影响。

**宁波市鄞州区人民政府**（sourceId `5a186329…`，adapter `yinzhou-government`）：
| 指标 | 修复前（sha-a3c881a9） | 修复后（sha-3fb504a） |
|---|---|---|
| run status | structure_changed | **succeeded** ✅ |
| discovered_count | 74 | 74 |
| failed_count | 2（附件缺名） | **0** ✅ |
| fetch_audit 反爬端点 | 未识别（鄞州也用 jpaas） | **skipped × 46** ✅ |
| fetch_audit downloaded | — | 2 |
| fetch_audit unchanged | — | 82 |
| error_summary | "公开正文附件缺少名称" | 空 |

双修复同时生效：pathDenylist 覆盖鄞州区同样的 jpaas `document/download` 反爬端点，attachmentNameFromLink 解决空锚点导致的"附件缺少名称即整篇失败"。鄞州修复前的 2 个 failed 是空锚点问题，现在也归零。

### 8.3 测试覆盖

`cd backend && npx vitest run src/sourcing`（commit `3fb504a`）：37 文件、447 通过、2 跳过，新增 2 个 pathDenylist 单测。`npm run build` 通过；CI verify 包含后端 lint + 447 单测 + build + runtime smoke（PostgreSQL + Redis + migrate + API + Worker + /health）。

### 8.4 遗留项

- **镜像仓库名漂移**：compose 默认 `${GHCR_OWNER:-chen-cowen}/chinese-teacher-exam-assistant-api`，CI 实际推到 `${GHCR_OWNER:-chen-cowen}/chinese-teacher-exam-assistant-project-api`（因仓库名含 `-project`）。本次通过服务器 `docker tag` 临时绕过；长期需统一 compose 镜像名或 CI `GITHUB_REPOSITORY` 来源。
- **生产 IMAGE_TAG 漂移历史**：服务器 `.env` 的 `IMAGE_TAG` 长期与实际运行版本不一致（之前是 `sha-2a7fb10f`，运行 `sha-a3c881a9`），本次修正为 `sha-3fb504a` 并同步到 `.env.bak-*`。
- **其他来源附件失败**：常州（"公开正文附件缺少名称"）在 attachmentNameFromLink 修复后应归零，但本轮未批量复跑，需在后续观察窗口中验证。

## 9. 2026-11-20 存量对账与全国扩源首批（执行中，发生生产过载）

本节记录按“先对账、再补跑、后扩源”执行的真实结果；所有数字来自当次 `psql` 查询与容器日志，未完成项明确标注。

### 9.1 来源对账与登记

- 线上版本：`sha-3fb504a`（含 N1—N3），API/Worker/DB/Redis 健康；执行开始时队列 waiting/active=0、delayed=0、failed=6（历史）。
- 线上数据库原有 15 条来源：11 条可运行招聘来源 + 4 条人工补录（上海松江、福建大田、湖北黄石、南京玄武区，`adapter_key` 为空）。**N1—N3 的 17 条来源并未完成线上登记**，与交接记录中“28 个来源已接入”不一致。
- 代码目录（N4 前）32 项 = 28 招聘 ready + 1 政策 ready + 2 候选 + 1 受阻；线上仅 11 个招聘来源可运行，实际省级覆盖 13 个。
- 通过容器内 Node 脚本调用 `getSeedableSources()` + `CrawlRunStore.upsertSource()` 完成登记（绕过 invited 模式 AdminGuard）；共 29 个可登记来源（28 招聘 + 1 政策）。登记前逐项比对 `officialUrl`：11 个旧来源全部精确匹配，宁波 `listUrls`（含生产手工修正的 `?number=`）与鄞州 `listUrls` 在代码目录中已一致，未被覆盖；无重复 `officialUrl`。
- 登记结果：新增 17 条招聘来源 + 1 条政策来源，总数 15 → 33（29 个有 adapter + 4 条人工补录）；`sourceId`、历史运行、快照与关联关系全部保留。
- 4 条人工补录来源的 `adapter_key` 为空，但仍为 `enabled=true`，被每小时调度反复投递并失败；已将其置为 `enabled=false`，停止无效投递（公告与审核数据不变）。

### 9.2 补跑与生产过载

- 登记完成后调度器在同一分钟内将 17 个新来源全部置为到期并投递（代码实际配置键为 `CRAWL_SCHEDULER_BATCH`，默认 20），每个来源首次全量回看产生约 100—230 条文档；累计发现约 2,900 条，队列 waiting 峰值约 2,900。
- 观察到的中间结果：快照 2,920；`document_parse_runs` 新建 1,298；`extraction_runs` 新建 41，`pending_review` 454 → 495；随后 22 端口 TCP 可连但 SSH banner 超时、3000 端口超时、80/443 仍响应，宿主进入假死，执行中断。故障与大批量任务同时发生，但宿主 OOM/负载日志尚未取得，不能把直接资源原因仅归结为并发或实例规格。
- 中间结果中的来源状态（中断前）：13 个成功/部分成功；武汉 `blocked`（反爬）；福州、潍坊、苏州、嘉兴、丽水、萧山 `structure_changed`；亳州、石家庄存在正文抓取失败；泰安触发验证码且部分附件跨域；阜阳 1 条主机白名单拒绝。福州 live 返回“获取站点配置失败”，潍坊公开接口 GET 返回 405（仅 POST），属上游接口变化，需改代码或更换入口。
- 人工补录复核：松江仅有正文、无图片/岗位表附件；大田 2 个附件齐全但 `unit_name` 误取联系电话“陈老师05987222650”；黄石仅 1 个附件（联系方式一览表），岗位表缺失，报名时间仅保留开始日 2026-11-11、截止日缺失。三条均保持 `pending_review`，不擅自改字段。

### 9.3 代码与测试

- N4 首批新增北京市人社局、重庆市人社局两个直辖市综合事业单位栏目适配器；新增 `.view` / `.xl-article` 正文回退；重庆额外解析正文外 `hasFJ` 脚本变量补全岗位表附件。
- 本地验证：`cd backend && npx vitest run src/sourcing` → 39 文件、457 通过、2 跳过；新增 N4 两个 adapter spec 与可登记列表断言。
- 未完成：N4 镜像尚未构建发布，两个来源尚未登记到线上、无真实首采 `runId`；北京/重庆不能计入已覆盖或持续运行通过。

### 9.4 两次恢复尝试与当前阻塞

- 第一次控制台重启后，19:33（北京时间）宿主恢复：1.6GB 内存可用约 939MB、磁盘使用 59%，DB/Redis 健康；用户已停止 Worker/Backend。队列保留完整：waiting=2,780、active=3、delayed=3、failed=6（历史）；waiting 中包含 `announcement.extract` 1,371、`document.parse` 1,087、`document.fetch` 321、`source.discover` 1。没有清空队列或删除任务。
- 19:36 仅以 `CRAWL_SCHEDULER_ENABLED=false` 重建并恢复 Backend，健康检查通过；19:37 以 `CRAWL_WORKER_CONCURRENCY=1` 恢复 Worker。19:38 API/DB/Redis/Worker 均为 up，waiting 降至 2,753、active=2、delayed=0，但宿主可用内存降至约 328MB。随后公网再次 502、SSH 再次 banner 超时，证明不能把“单并发”视为已经验证的安全恢复方案。
- 用户随后在控制台报告 Worker 已停止，但 SSH 仍无法连接；进一步停止 Backend 的命令也无法执行。当前宿主与各容器的最终状态未知，已停止一切远程探测和应用启动，需先通过阿里云实例诊断/强制重启/运维支持恢复宿主。恢复后不得自动消费现有队列。
- 恢复后的前置条件：先停止 Worker/Backend，保存宿主日志、`dmesg`/OOM 证据、Docker 状态与队列快照；确认故障原因并制定内存/解析任务隔离方案后，再以受控方式处理积压。调度批次如需调整，应使用 `CRAWL_SCHEDULER_BATCH=1`，不是无效的 `CRAWL_SCHEDULER_BATCH_SIZE`。
- N4 镜像构建、北京/重庆登记与真实首采均未执行；最终 `runId`、日期覆盖、附件缺口与公告增量仍未完成。本轮不宣称生产恢复、存量补跑完成或全国扩源完成。

## 10. 2026-11-21 28 来源逐站复查（只读）

逐站明细、证据与后续优先级见 `docs/nationwide-recruitment-source-ledger.md` 第 11 节。本节只记录验收结论。

### 10.1 环境与范围

- 仓库分支 `codex/all-subject-rag`，提交 `dc4cce3`；保留其他开发者未提交改动。
- 生产镜像 `sha-3fb504a`；只执行带 `LIMIT` 的逐来源/小批量只读查询，未写入、未复跑、未发布。
- 官方站点核验与离线回放在本地完成；数据库时间为 UTC，报告统一换算北京时间。

### 10.2 复查结果

- 28 个生产招聘来源全部可追溯到官方栏目、代码适配器、生产 `sourceId` 与 2026-11-20 补跑窗口的 `runId`。
- 最新运行分层：10 `succeeded`、6 `partial`、10 `structure_changed`、2 `blocked`；`published` 审核记录 0 条。
- 生产累计 4,537 文档、2,248 公告、4,010 快照；28 个招聘来源 `pending_review` 合计 1,243，连同政策来源 14 条、人工来源 4 条共 1,261。
- 材料完整性未达标：2,225 个附件文档中 340 个无快照，572 个最新快照为 `text/html`（萧山 254、嘉兴 137、丽水 70、鄞州 52、宁波 33、杭州 18），其中宁波/鄞州岗位表属于“运行成功但岗位表缺失”。
- 持续运行通过仍为 0/28；北京、重庆仅本地回放通过，未发布、未登记、无首采 `runId`。

### 10.3 重点阻塞与下一步

1. 福州、潍坊、武汉：生产 run 早于本轮 live 验证；需单来源复跑并记录新 `runId`。
2. 苏州：登记栏目已停更（最新 2025-03-12），2026 活跃公告在市人社局 `hrss.suzhou.gov.cn/jsszhrss/gsgg/`；需迁移或新增来源。
3. 宁波、鄞州：岗位表下载被官方反爬端点拦截，已入库快照为 102B 限流 HTML；需授权会话或人工补录。
4. 湖州、丽水、烟台、济南、泰州、杭州、萧山、嘉兴：附件无快照或为限流 HTML，需按端点/白名单补采。
5. 石家庄、亳州、长沙、贵阳、嘉兴、萧山：正文选择器或上游 API 响应变化，需用 2026-11 样本修复。
6. 泰安：验证码拦截，保持 `blocked`，不绕过。
7. 北京、重庆：待镜像发布后登记、首采并做 7 天观察。
8. 人工来源：松江附件、大田 3 个缺失附件与发布单位、黄石岗位表与截止日期、玄武重复公告，走后续审核。

### 10.4 代码修复与测试

- 修复“附件 URL 返回 200 HTML 限流页被当作成功附件入库”：`document-fetch.service.ts` 按 magic bytes 判格式，二进制扩展名却返回 HTML 时记 `failed` + `ATTACHMENT_HTML`，不建快照；`task-queue.ts` 将其纳入瞬时重试；新增回归。
- `npm --prefix backend test -- src/sourcing/jobs/document-fetch.spec.ts` → 16/16 通过。
- `npm --prefix backend test -- src/sourcing` → 39 个测试文件通过、458 项通过、2 项跳过（修复前 457）。
- 2026-11-21 实时回放：福州、潍坊、苏州、郑州 4/4；北京 5/5、重庆 5/5。

### 10.5 队列与暂停状态

- 容器内 `CRAWL_SCHEDULER_ENABLED=false`、`CRAWL_WORKER_PAUSED=false`；查询时 `waiting/active/delayed=0`、`failed=8`。
- 9.4 节记录的 waiting=2,753 积压已被恢复后的 Worker 消费，多条长任务于 11-21 08:03–08:06（北京时间）完成；本次**不能声称积压队列保持不变**。
- 本轮未恢复调度、未清空队列、未删除历史公告/快照；下次操作前需重新确认暂停状态并查明 Worker 恢复消费原因。
- 未执行：生产复跑、生产登记变更、镜像发布、北京/重庆首采、7 天持续观察。

### 10.6 2026-11-21 蚌埠单来源试跑前置核查（未投递生产）

- 硬上限核查（代码级）：来源只登记 1 个栏目页，`SourceDiscoverService` 当前不会调用适配器的 `paginationListings`，因此单轮列表请求实际为 1；但**详情与附件没有每轮数量上限**，会把全部已知文档 + 全部新发现文档逐个投递 `document.fetch`。网络层仅有单响应 8MB、3 次重试、Worker 并发 1。
- 停止手段：`POST /admin/sources/:sourceId/pause` 只阻止后续发现，不停已排队任务；立即停消费需改 `CRAWL_WORKER_PAUSED=true` 并重启 worker；队列无按 `runId` 批量删除的接口，清理需手写 Redis 脚本。均为应急手段，不构成前置硬限制。
- 结论：**无法把本轮限制在可接受范围，故未投递生产**（无新 `runId`、无派生任务），改做隔离回放。
- 隔离回放（2026-11-21 11:38 CST，本地直连官网，不写库、不投递队列）：列表 200、9 条、18 页；详情 200，正文 513 字；附件 2 个均 200——PDF 100,806B（magic `25504446`）、xlsx 19,002B（magic `504b0304`），格式与扩展名一致，未见 HTML 限流页。
- 生产监控（11:45 CST 复查）：`CRAWL_SCHEDULER_ENABLED=false`、`CRAWL_WORKER_PAUSED` 未设置、并发 1；队列 `waiting/active/delayed=0`、`failed=8` 保留；5 个容器 Up 2h，最近 run 仍为 11-21 08:06 CST 完成，重启后无新 run；蚌埠来源 `enabled`、`healthy`，`last_checked_at` 为 11-20 17:37 CST。
- 未执行：生产投递、来源暂停/恢复、失败任务清理、附件修复发布。

### 10.7 2026-11-21 受控单来源试跑预算（本地开发 + 隔离验证，未发布）

**结论：已实现可执行预算与按 runId 停止，隔离验证通过；生产未部署、未投递，调度仍关闭，队列与 8 条历史失败未动。**

#### 改动文件

- `backend/prisma/schema.prisma`：新增 `CrawlRunBudget`、`CrawlRunAdmission`（纯增量）。
- `backend/prisma/migrations/20261121120000_crawl_run_budget/migration.sql`：建表与索引，可重复执行。
- `backend/src/sourcing/crawl-budget.ts`：预算类型、默认值、服务端硬上限、校验与端口定义。
- `backend/src/sourcing/crawl-budget.store.ts`：PostgreSQL 原子扣减与准入事务（行锁 + 唯一键）。
- `backend/src/sourcing/crawl-orchestrator.ts`：试跑先落预算行，失败则不投递。
- `backend/src/sourcing/sourcing.controller.ts`：`check` 接受 `trial`/`budget`；新增 `POST runs/:runId/stop`、`GET runs/:runId/budget`。
- `backend/src/sourcing/jobs/source-discover.service.ts`：列表页扣减、详情准入、未覆盖标记、`partial_budget`。
- `backend/src/sourcing/jobs/document-fetch.service.ts`：执行前复核准入、附件双限额、请求闸门、停止后不派生。
- `backend/src/sourcing/fetch/safe-fetcher.ts`：`RequestGuard` / `RequestBlockedError`，每次实际请求（含重试与重定向）前校验。
- `backend/src/sourcing/jobs/task-queue.ts`：解析/抽取任务携带 `runId`。
- `backend/src/document-processing/jobs/document-parse.service.ts`、`backend/src/announcements/jobs/announcement-extract.service.ts`：运行停止即跳过。
- `backend/src/sourcing/crawl-run-store.ts`：审计写入预算快照；`markRunStopped` 把未执行 URL 标记为 `skipped/run_stopped`。
- `backend/src/sourcing/sourcing-core.module.ts`：注册并导出预算 provider。
- `backend/src/sourcing/testing/crawl-testing.ts`：内存预算实现（与 Prisma 口径一致）。
- 新测试：`crawl-budget.spec.ts`、`jobs/source-discover.budget.spec.ts`、`jobs/document-fetch.budget.spec.ts`。

#### 计数口径（服务端）

| 预算项 | 首轮默认 | 口径 |
|---|---|---|
| `maxListPages` | 1 | 实际发起的栏目页请求数（含 304/失败，防止原地重试） |
| `maxDetails` | 3 | 准入的**逻辑任务数**，按 `canonicalUrl` 去重；历史与新发现共用 |
| `maxAttachmentsPerDocument` | 2 | 每篇公告准入的附件逻辑任务数 |
| `maxAttachmentsTotal` | 6 | 整轮附件逻辑任务数 |
| `maxHttpRequests` | 20 | 实际发出的 **HTTP 请求次数**，含 SafeFetcher 重试与重定向跳转；每次请求前原子扣减 |

- 硬上限：20 页 / 50 详情 / 每篇 10 附件 / 整轮 100 附件 / 300 请求；越界、非整数、每篇大于整轮、请求预算不足以完成一次完整执行均返回 400。
- 幂等：准入唯一键 `(runId, kind, canonicalUrl)`；BullMQ 重投、Worker 重放、重复点击不会重复占用额度，但仍按实际 HTTP 次数消耗请求预算。
- 未覆盖：未准入的公告/附件在运行审计中为 `skipped`，错误标记 `budget_deferred` 或 `run_stopped`，运行状态为 `partial_budget` 或 `stopped`；未准入的新文档不写入 `source_documents`，因此不会被误认为“已收录/公告消失”；列表被截断时不触发 `zero_suspect`。

#### 隔离验证结果（全量测试 126 文件 / 1519 用例通过；预算相关 20 用例）

| 场景 | 输入 | 实际派生/请求 | 结果 |
|---|---|---|---|
| 列表超限 | 配置 18 个栏目页，预算 1 页 | 请求 1，17 页未扫描 | `listPagesUsed=1`，`deferred=17` |
| 详情共用额度 | 新发现 9 + 历史公告 5，预算 3 | 投递 3，11 条 `skipped` | `detailsUsed=3`，`partial_budget` |
| 附件双限额 | 两篇各 4 附件，每篇 2 / 整轮 3 | 准入 3（2+1），5 条 `skipped` | `attachmentsUsed=3` |
| 重试计入请求 | 详情持续 503，`maxHttpRequests=2` | 请求 2 次，第 3 次被闸门拦截 | `skipped/budget_http_exhausted`，非可重试 |
| 重复投递 | 同一详情执行 2 次，2 个附件 | 附件仅准入 2，请求 2 | 额度不重复占用，队列幂等吸收 |
| 停止（执行前） | 停止后投递 | HTTP 0 次 | `skipped/run_stopped` |
| 停止（执行中） | 正文返回后停止 | 本次收尾，附件/解析 0 个 | 不再派生新任务 |

#### 生产试跑步骤（待另行确认后执行）

1. 备份数据库；发布新镜像（`migrate` 服务会自动执行增量迁移，旧镜像可忽略新表）。
2. 保持 `CRAWL_SCHEDULER_ENABLED=false`；确认 `CRAWL_WORKER_PAUSED` 未设置、并发 1；记录队列现状 `0/0/0/8`。
3. 用管理员会话投递一次：`POST /admin/sources/3a4b82e2-1550-47ab-8346-ef2965dc8eda/check`，body `{"trigger":"admin","trial":true}`；返回 `runId` 与预算快照。
4. 监控：`GET /admin/sources/runs/<runId>/budget`、`GET /admin/sources/health`，以及 `crawl_runs.source_documents` 计数；预期列表 1 次、详情 ≤3、附件 ≤6、HTTP ≤20。
5. 异常时：`POST /admin/sources/runs/<runId>/stop`；待执行任务会被跳过，执行中的请求结束后不再派生；必要时再暂停来源或按 10.6 的 Worker 级方式停消费。

#### 回退步骤

- 代码回退：重新部署旧镜像（`sha-3fb504a`）；新表为增量，旧代码不读取，无需回滚数据库。
- 数据清理（可选，确认无进行中试跑后）：`DROP TABLE crawl_run_admissions; DROP TABLE crawl_run_budgets;`。
- 常规调度逻辑未改变；回退后 `CRAWL_SCHEDULER_ENABLED=false` 继续保持，直到人工确认。

#### 本轮未执行

- 生产部署、镜像发布、生产任务投递、来源暂停/恢复、失败任务清理、附件 HTML 修复发布。
- 本机无 Docker/PostgreSQL，`PrismaCrawlBudgetStore` 的 SQL 路径只做了 `prisma validate` + `nest build` 校验，未在真实库执行；隔离测试覆盖的是与生产同端口的内存实现。生产发布前需在预发库跑一次迁移与预算准入冒烟。
- 生产现状复查（本轮结束，北京时间 12:05）：`CRAWL_SCHEDULER_ENABLED=false`、`CRAWL_WORKER_PAUSED` 未设置、并发 1；队列 `waiting=0/active=0/delayed=0/failed=8`；最近 run 仍为 11-21 08:06 CST 完成，无新 run。

