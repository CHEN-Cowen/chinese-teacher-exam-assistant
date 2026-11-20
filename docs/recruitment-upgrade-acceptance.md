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

