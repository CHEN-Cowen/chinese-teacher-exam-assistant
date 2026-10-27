# M08 逐来源验收矩阵与持续运行报告

生成日期：2026-10-27。本报告只记录可复核的真实证据；凡未完成的窗口一律标注「待持续验收」，不虚构经过时间。

## 1. 统一适配契约与来源台账

- 统一契约：`OfficialSiteAdapter`（栏目发现 `discover` / 正文定位 `locateArticle` / 官方分页解析 / 来源域名 allowlist），全部官方来源经 `AdapterRegistry` 注册后由 `SourceDiscoverService` 统一调度，禁止来源旁路。
- 来源台账（每来源登记项 → 读取位置）：
  - 地区 `regionCode`、负责人/处理入口 `contactInfo`、调度周期 `pollEveryMinutes`、最近成功 `lastSuccessAt`、健康与连续失败、材料累计 `snapshotCount`、当前有效发布 `publishedVersionCount`：`GET /admin/sources/health`（管理端「来源管理」页直接展示，2026-10-27 M08 扩展字段，含单元测试与页面测试）。
  - 栏目：`Source.listUrls` / `officialUrl`；访问规则：`allowedHosts` + 安全抓取器（同源限制、条件请求缓存）。
- 线上覆盖与缺口展示：公开投影 `GET /api/opportunities/coverage`（M01，地区→来源→新鲜度窗口），缺口以「未覆盖/新鲜度不足」显式呈现，不夸大覆盖。

## 2. 逐来源验收矩阵（11 个官方适配器）

验收层级定义：
- **A 真实快照对账**：以官方站点直接重采的快照为独立分母核对（不经过业务抓取器自证）。
- **B 真实材料闭环**：真实官方材料（逐字节 sha256 核对）走完 材料→解析→审核→发布 全链路。
- **C fixture 级回归**：golden 快照固定输入的解析回归测试。
- **D 待持续验收**：仅具备调度与告警能力，未完成 7 天线上观察。

| 适配器 key | 地区 | 栏目形态 | 证据 | 层级 |
| --- | --- | --- | --- | --- |
| hangzhou-education | 杭州 | DOM 列表（属性分页） | adapter.spec + wp3-html-closure.e2e + public-column-s5 | C |
| ningbo-education | 宁波 | DOM 列表 | adapter.spec + M07 真实附件闭环（xlsx sha256 5edcbe86… 逐字节核对） | B |
| nanjing-education | 南京 | DOM 列表（index_N 分页） | adapter.spec + nanjing-real-replay + S5 独立对账 16/16 | A |
| lishui-education | 丽水 | 同源公开列表接口（jpaas） | adapter.spec（golden JSON）+ S5 独立对账 8/8 | A |
| yinzhou-government | 宁波鄞州 | DOM 列表 | adapter.spec | C |
| shaoxing-education | 绍兴 | 公开栏目（统一解析） | public-column-s5.spec | C |
| jiaxing-education | 嘉兴 | 公开栏目 | public-column-s5.spec | C |
| suzhou-education | 苏州 | 公开栏目 | public-column-s5.spec | C |
| changzhou-education | 常州 | 公开栏目 | public-column-s5.spec | C |
| bengbu-education | 蚌埠 | 公开栏目 | public-column-s5.spec | C |
| xiaoshan-education | 萧山 | 公开栏目 | public-column-s5.spec | C |

全部 11 来源层级 D：调度、指数退避、5 类告警（连续失败/结构漂移/阻断/解析失败/新鲜度超窗）已具备（M02），但**连续 7 天线上观察未完成**。

### 漏采/错采与修复记录

- 南京 S5 对账：栏目发现 100% 命中冻结分母（16 目标），33 条排除项均有处置理由（非 2026 窗口/非目标栏目），未发现错采。
- 2026-10-26/27 真实宁波岗位表暴露并修复「数据行被误判为表头行」缺陷（M07）：此前数据行长文本偶然命中关键词即被判表头，导致同单位数据行被整批误杀；修复后重采快照解析零告警。
- M07 还修复：报名截止语义单日期分类（不臆造开始日）；表头建议字段统一为 `unit_name`。
- 2026-10-27 修复 CI 红灯：FakePrisma `extractionRun.include.snapshot` 未内嵌 `source`，M07 闭环 spec 在干净 checkout 必挂（`4cd92c6`）。

## 3. 南京/丽水独立对账（S5 打样，2026-10-27 重采）

- 方法：独立分母 = 冻结的 ExpectedChecklist（南京 16 目标 + 13 排除；丽水 8 目标 + 20 排除），发现端直接从官方栏目分页重采（南京 index.html+index_1..6.html；丽水公开列表接口 1..13 页），与业务抓取器输出完全解耦，再按 discovered→downloaded→parsed→approved→published 五段位核对。
- 执行：2026-10-27 本地重采（原 2026-10-26 仓库外快照被系统 Temp 清理后从官方 URL 重新抓取），`source-reconciliation.s5-pilot.spec.ts` 3/3 通过。
- 边界（如实声明）：官方快照不入仓库（官方内容版权与体积考虑），spec 带 skipIf 守卫——本地具备快照时可复跑，CI 环境自动跳过，不属于「测试通过」。
- 结论：栏目发现闭环成立；材料完整率依 S5 纪律不输出（南京真实材料闭环尚未运行期打通，宁波已打通 B 级）。

## 4. 持续运行验收：待持续验收（不伪造窗口）

已具备的持续运行能力：
- 调度：`CrawlScheduler.tick` 周期投递 + 失败指数退避（周期×2^(n-1) 封顶 8 倍，不计入来源失败告警）。
- 监测与告警：sourcing_alerts 五类告警 + `GET /admin/sources/health`（来源健康、worker 状态、队列积压、活跃告警）。
- 发布门禁：`docker-publish.yml` verify（lint/test/build + 真实启动冒烟：PostgreSQL/Redis/迁移/api/worker//health）+ frontend-verify（lint/test/build + 浏览器 E2E 25/25，失败阻断镜像发布）。

可重复检查方案（连续 7 天，每日一次，结果写入下表）：
1. `npm run test:e2e`（前端仓根目录）→ 25 用例全绿。
2. `cd backend && npm test` → 0 失败、0 unhandled。
3. 线上 `GET /health`、`GET /admin/sources/health` → 无 blocked/structure_changed 来源；活跃告警为 0 或均有处置记录。
4. 抽 1 个来源跑「立即检查」→ 运行记录 succeeded/unchanged，无新增告警。
5. `GET /api/opportunities/coverage` → 覆盖投影新鲜度窗口内来源数不下降。

| 日期 | e2e | 后端测试 | health 告警 | 立即检查 | 覆盖投影 | 记录人 |
| --- | --- | --- | --- | --- | --- | --- |
| （待填） | | | | | | |

7 行填满且全绿后，本节状态升级为「持续运行验收通过」；在此之前保持「待持续验收」。

## 5. 阶段汇总（F1—F7 与数据闭环）

- F1/F2 公开覆盖与统一投影：M01 完成。
- F3 运行监测与持续调度：M02 完成（7 天线上观察待持续验收）。
- F4 关键流程测试与发布质量门禁：M06 完成（E2E 25/25，门禁恢复阻断）。
- F5 代理协议与会话 Cookie 安全：M03 完成（线上三步验证脚本待部署后执行）。
- F6 Excel 解析资源边界：M04 完成。
- F7 注册、登录与账号恢复：M05 完成。
- 数据闭环（发现→快照→解析→审核→发布→匹配→变更提示）：M07 以宁波真实官方附件打通 B 级闭环；发布幂等、审核退回、撤回/延期变更链路为既有回放测试覆盖。
