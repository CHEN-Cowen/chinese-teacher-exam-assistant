# WP3 完成检查表（逐项核对并勾选）

## A. 目录读取（PublishedCatalogRepository）
- [x] `listPublished(now)` 从 `PublishedAnnouncementVersion` 读取：published 为唯一事实源；superseded 仅版本链/回退；withdrawn 仅审计标记（D2，已批准）
- [x] 映射为现有匹配领域对象（`RecruitmentAnnouncement`），未新建第二套事实目录
- [x] `getUnit(unitId, now)` 从目录当前版本取单元，不读静态目录
- [x] 投影失败跳过并告警；整条公告无可投影版本时整体跳过（失败不覆盖上一版）
- [x] 仅调用 `prisma.publishedAnnouncementVersion.findMany`

## B. 生产/静态隔离
- [x] `OpportunitiesModule` imports `CatalogModule`，DI 可注入 repository
- [x] flag 开：`loadCatalog` 只返回 DB 目录，静态目录（catalog/rolling/real）不参与合并
- [x] flag 关：沿用现状静态目录（仅 Demo/测试）
- [x] 生产机会服务不依赖静态目录即可工作

## C. SafeFetcher 安全策略（SSRF）
- [x] host allowlist / 协议 / 凭据 URL 校验
- [x] 阻止 localhost / 环回 / 私网 / 链路本地 / 元数据地址
- [x] DNS 解析后复查；逐跳重定向复查；重定向次数上限
- [x] 连接与总超时；响应体大小上限；Content-Type + magic bytes
- [x] 明确 User-Agent；记录 status/ETag/Last-Modified/哈希/耗时/跳数/字节
- [x] 日志脱敏（不写 query/凭据）
- [x] 429/408/502/503/504 重试（尊重 Retry-After）；普通 4xx 不重试

## D. 单来源 Adapter
- [x] 只接收安全下载快照，不联网、不写库、不抽资格结论
- [x] 输出规范化绝对 URL + 最小元数据
- [x] DOM 失配抛 `AdapterParseError('DOM_MISMATCH')`，绝不静默返回 0 条
- [x] 黄金样本（杭州 list/detail）离线解析通过

## E. 测试矩阵
- [x] 发布 / 草稿 / 撤回
- [x] 发布后无需重启即可匹配（flag 开路径）
- [x] 静态目录不进入生产
- [x] allowlist / 私网 / 跨域重定向
- [x] 超时 / 超大响应 / 错误 MIME
- [x] 301 / 302 / 304 / 429
- [x] 相同哈希
- [x] Adapter 正常与 DOM 变化
- [x] 投影失败保留上一版
- [x] 一个真实端到端数据闭环（样本→快照→Adapter→载荷→published 行→repository→match）

## F. 回归与构建
- [x] `v72-chain-regression.spec.ts` 链路③ 目标用例转绿（去掉 it.fails），现状用例保留
- [x] 链路④ 保持原样
- [x] `npm test`（370 passed / 1 expected fail） / `npm run lint`（0 error） / `npm run build` 全绿（backend）
- [x] 根 `tests/fixtures/isolation.test.ts` 仍通过（后端 spec 未 import fixtures）

## G. 完成门
- [x] 新公告发布后无需改代码或重部署即可匹配
- [x] 生产不读静态目录
- [x] SafeFetcher 通过 SSRF 测试
- [x] 结构异常不静默
- [x] 高影响事实保留证据
- [x] 失败不覆盖上一版
