# 全国教师招聘公告采集专项：来源账本与分批接入计划

生成日期：2026-11-05。本文件是 PRD 第 13 节的可审查执行清单，不是新的产品需求基线。所有状态均区分“目录已登记”“已接入”“样本通过”“持续运行通过”，未完成项不标记通过。

## 1. 口径与边界

- **全国目录完整性**：是否知道官方入口在哪里、是否已登记到账本。省级按 31 个大陆省级行政区统计；市级、区县级分母随批次建立。
- **来源实际接入状态**：是否具备可运行的适配器并按调度抓取。四档为：
  1. **已接入**：来源已登记、适配器存在、入口与分页结构已核验，可按调度运行；
  2. **样本通过**：真实官方样本能自动发现公告，正文、岗位附件与解析证据完整，并通过独立清单对账；
  3. **持续运行通过**：真实调度连续运行达到观察窗口，每日健康、失败恢复与告警处置有真实时间记录；
  4. **未覆盖**：无已接入来源，或仅有目录登记、候选入口、政策来源。
- 省级政策来源不计入招聘来源覆盖；地区选择能力、候选入口登记不计入覆盖；第三方转载不替代官方来源。
- 受限来源记录原因与替代官方入口，不绕过登录、验证码或封禁。
- 本文件中的“目录登记”仅表示收录了官方入口线索，**不代表已完成入口核验、栏目核验或持续监测**。

## 2. 全国概览（2026-11-06）

| 指标 | 当前值 | 说明 |
|---|---|---|
| 省级行政区目录登记 | 31 / 31 | 已建立省级目录行；多数入口仍待逐站核验 |
| 有本地招聘适配器的省级行政区 | 15 / 31 | 浙江、江苏、安徽、山东、江西、山西、河南、福建、广东、河北、湖北、湖南、贵州、北京、重庆；其余 16 个省级行政区待接入 |
| 有招聘来源已登记到生产数据库的省级行政区 | 13 / 31 | 2026-11-20 登记了原有 28 个招聘来源；北京和重庆尚未发布或登记，存量首采也尚未逐站验收 |
| 已登记来源总数 | 34 | 30 个教师招聘 ready + 1 个政策 ready + 2 个省级候选 + 1 个受阻 |
| 本地已有招聘适配器的来源 | 30 | 浙江 8、江苏 4、安徽 3、山东 4、江西 1、山西 1、河南 1、福建 1、广东 1、河北 1、湖北 1、湖南 1、贵州 1、北京 1、重庆 1 |
| 样本通过来源 | 3 | 宁波（B 级真实材料闭环）、南京与丽水（A 级独立清单发现对账）；其余 27 个为 fixture 级（含 N1/N2/N3/N4 真实样本回放） |
| 持续运行通过来源 | 0 | 连续 7 天观察 0/7，不能声称持续运行通过 |
| 市级/区县级目录分母 | 待建立 | 现有账本覆盖 28 个地市/区县地区（30 个招聘来源），不能据此计算全国缺口 |
| 全国完整召回 | 未验证 | 无全国独立清单，不能声称完整召回 |

口径说明：`docs/m08-source-acceptance-report.md` 中的 A/B/C 是**证据档位**，D 是**持续运行档位**。当前 30 个招聘来源按持续运行口径全部为 D（待持续验收），因此本账本不把任何来源标记为“持续运行通过”；“样本通过 3”仅表示宁波（B）、南京与丽水（A）具备真实官方样本与材料/对账证据。N1 新增的湖州、泰州、亳州、阜阳，N2 新增的济南、烟台、泰安、潍坊，N3 新增的南昌、太原、郑州、福州、广州、石家庄、武汉、长沙、贵阳，以及 N4 新增的北京、重庆已完成真实样本采集与离线回放，但尚未做独立清单对账，故记为 fixture 级。

### 2.1 2026-11-20 线上批次核验（部署版本未升级）

- 运行环境：`https://kbzs.al.qich.top`；运行镜像 revision `a3c881a91c7733c7d0c82e05677d92efb7328b20`（2026-11-08 启动）。部署目录 `.env` 的 `IMAGE_TAG` 已写 `sha-2a7fb10f…`，与实际运行容器不一致，属于待排查的发布漂移；本次未重启或升级。
- 目录差异：当前仓库目录 32 项（29 ready：28 招聘 + 1 政策；2 候选；1 受阻；13 个省级行政区）。线上镜像内目录仅 15 项、11 个 ready，不含 N1—N3 新增适配器；线上登记 11 个可执行来源 + 4 个人工来源。
- 本轮实际投递 11 个线上可执行招聘来源（南京、杭州、宁波、鄞州、绍兴、嘉兴、苏州、常州、蚌埠、丽水、萧山）。汇总：发现 563 条、下载/新增 311 条、未变 711 条、失败 65 条；`pending_review` 由 56 增至 378（+322，含 3 条人工补录），快照 +595。
- 结果分层：partial 3（南京、杭州、绍兴）；结构/解析异常 8（常州、嘉兴、丽水、蚌埠、萧山主要为“公开正文附件缺少名称”，其中丽水、萧山同时有跨域附件被拦截；苏州线上失败，详见下方分页与回放核验）。失败 0 个基础设施整体中断。
- 宁波/鄞州复核（2026-11-20，服务器侧实测）：DNS 与网络正常——宿主 systemd-resolved 上游 100.100.2.136/138，两站均解析到 CDN `203.107.60.182`（AAAA `2405:e000:1003::f015:3c8a`），容器内 `dns.lookup` 正常，`index.html` 拉取 200、约 0.1–0.4 秒，连续 5 次无超时。此前的“DNS/网关超时”判断不成立。逐小时 `structure_changed` 的真实原因是这两个栏目页为 jpaas JS 壳（`AuthorizedRead/unitbuild.js` + `queryData` 指向 `/api-gateway/jpaas-publish-server/front/page/build/unit`），原始 HTML 无任何 `/art/` 链接；`listUrls` 为空时回退到首页，适配器按 `table.news-table`/`ul#announcement-list` 解析首页必然失配。补齐 `listUrls` 后即时检查已可发现宁波 34 条、鄞州 74 条（经 publish/unit 接口返回的 `data.html`）。
- 宁波附件拦截：即时检查中 10 个失败均为 `api-gateway/jpaas-web-server/front/document/download?fileUrl=<密文>`。服务器侧复现：带 Cookie、Referer 与浏览器 UA 仍返回 200 + 60 字节 `禁止访问！`（同域 `document/file-download?fileUrl=/cms_files/...` 形式则正常 302 下载）。属于官方附件端点的反爬/会话校验，需浏览器会话或官方接口凭据，不能靠放宽 allowlist 解决。鄞州 2 个失败为“公开正文附件缺少名称”，已由本轮 `attachmentNameFromLink` 兜底修复，待部署生效。
- 苏州复核（2026-11-20）：对官方「人事信息」栏目做 live 回放，`xxgk_list.shtml` / `_2` / `_3` 均 200，共 34 条（15/15/4），最新 2025-03-12、最旧 2013-05-16，`createPageHTML` 声明 3 页与适配器派生一致。适配器与分页未漂移，线上失败属登记/抓取期问题，待部署后复查 `listUrls`。
- 附件名兜底（2026-11-20）：官方正文存在空锚点（常州 `…/114583.html` 实测 `<a href="…xlsx"></a>`），原逻辑直接抛 `DOM_MISMATCH`，导致整篇公告连同其余附件失败。现改为「锚点文本 → title/aria-label → 下载地址 fileName 参数 → 带扩展名的 URL 末段」，全部取不到名称才失败，不静默丢弃附件。
- 新公告人工补录：上海松江（2026-11-18—11-25）、福建大田（2026-11-12—11-26）、湖北黄石（2026-11-11—11-18，已截止）均进入 `pending_review`；大田入库附件 2 个，黄石 1 个，松江正文附件为图片未入库。
- 分页实测：广州分页序列为 `index.html`、`index_2.html`…`index_20.html`，`index_1.html` 为 404、不属于分页序列（此前“第 2 页 7 字节缺口”系探测脚本页码命名错误，已更正）；6 页窗口实测第 6 页 20 条、最早 2025-12-11；武汉 6 页覆盖至 2025-10-22；福州 6 页 90 条覆盖至 2026-07-01；潍坊 6 页 120 条覆盖至 2025-09-11；贵阳第 1 页最新 2026-10-17（本周期无新增）；郑州新政务列表 4 页 35 条、最新 2026-10-12，原适配器只匹配老站 DOM，已补充 `.jhtml` 列表与 `index_N.jhtml` 分页解析。
- 持续运行观察：自 2026-11-20 14:35（北京时间）起算，线上真实调度尚需连续 7 天；截至本批次结束仍为 0/7，不标记任何来源“持续运行通过”。


## 3. 省级行政区目录账本（31 行）

说明：

- “省级教育主管单位”为行政区划对应的教育行政部门。
- “目录入口”来自 [中国教师资格网·各省份认定工作联系方式](https://www.jszg.edu.cn/consult.html?type=gsgz)（访问日期 2026-11-05）；部分省份该页给出的是教师资格/教师业务入口而非教育厅门户，已注明。
- 本轮只完成目录登记，**未逐站核验招聘栏目、正文、附件与分页**；入口可达性、HTTPS、栏目路径和招聘范围在 N1—N5 批次验证。
- “已接入招聘来源”只统计可运行的招聘适配器，不含省级政策来源与候选/受阻入口。

| # | 省级行政区 | 区划代码 | 省级教育主管单位 | 目录入口（目录登记） | 入口类型/待核验项 | 已接入招聘来源 | 覆盖状态 | 主要缺口 |
|---|---|---|---|---|---|---|---|---|
| 1 | 北京市 | 110000 | 北京市教育委员会 | http://www.bjtcc.org.cn | 教师资格业务入口；**市人社局「事业单位公开招聘」已核验并接入** | 1 | 部分接入 | 北京市人社局综合栏目已接入（只监测最新 3 页 / 约 60 条）；市教委、各区教委独立招聘栏目仍待接入 |
| 2 | 天津市 | 120000 | 天津市教育委员会 | http://www.tjgspx.cn | 高校师资培训入口；教委门户与招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 3 | 河北省 | 130000 | 河北省教育厅 | http://jszg.hee.gov.cn/ | 教师资格入口；招聘栏目待核验 | 1 | 部分接入 | 石家庄已接入（官网整站仅 HTTP）；省级统一招聘与其余地市入口待接入 |
| 4 | 山西省 | 140000 | 山西省教育厅 | http://jyt.shanxi.gov.cn/ | 教育厅门户；招聘栏目待核验 | 1 | 部分接入 | 太原已接入；其余地市与区县待补齐 |
| 5 | 内蒙古自治区 | 150000 | 内蒙古自治区教育厅 | http://www.nmgov.edu.cn | 教育门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 6 | 辽宁省 | 160000 | 辽宁省教育厅 | http://www.lnie.ln.cn/jsjlfw/jszgrd.htm | 教师交流服务入口；教育厅门户待补 | 0 | 未覆盖 | 同上 |
| 7 | 吉林省 | 170000 | 吉林省教育厅 | http://jyt.jl.gov.cn/ | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 8 | 黑龙江省 | 180000 | 黑龙江省教育厅 | http://jyt.hlj.gov.cn | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 9 | 上海市 | 310000 | 上海市教育委员会 | https://shehr.shec.edu.cn/ | 上海教育人才网；招聘栏目待核验 | 0 | 未覆盖 | 省级/区级招聘入口待接入 |
| 10 | 江苏省 | 320000 | 江苏省教育厅 | https://jyt.jiangsu.gov.cn/（教育厅）；http://www.jste.net.cn（江苏教师教育网） | 教育厅入口已登记；省级不发布市县招聘，候选 | 4 | 部分接入 | 南京、苏州、常州、泰州已接入；其余地市与区县待补齐 |
| 11 | 浙江省 | 330000 | 浙江省教育厅 | https://jyt.zj.gov.cn/（教育厅）；http://www.zjzs.net（教育考试网） | 省级候选；“公告公示”为聚合页，无独立教师招聘栏目 | 8 | 部分接入 | 杭州、宁波、鄞州、丽水、绍兴、嘉兴、萧山、湖州已接入；其余地市与区县待补齐 |
| 12 | 安徽省 | 340000 | 安徽省教育厅 | http://jyt.ah.gov.cn/ | 教育厅门户；省级政策源已接入，招聘栏目待核验 | 3 | 部分接入 | 蚌埠、亳州、阜阳已接入；其余地市与区县待补齐；省级政策不计招聘覆盖 |
| 13 | 福建省 | 350000 | 福建省教育厅 | http://www.fjjszg.com | 教师资格入口；教育厅门户待补 | 1 | 部分接入 | 福州已接入；其余地市与区县待补齐 |
| 14 | 江西省 | 360000 | 江西省教育厅 | http://jyt.jiangxi.gov.cn | 教育厅门户；招聘栏目待核验 | 1 | 部分接入 | 南昌已接入；其余地市与区县待补齐 |
| 15 | 山东省 | 370000 | 山东省教育厅 | http://edu.shandong.gov.cn | 教育厅门户；招聘栏目待核验 | 4 | 部分接入 | 济南、烟台、泰安、潍坊已接入；其余地市与区县待补齐 |
| 16 | 河南省 | 380000 | 河南省教育厅 | http://jyt.henan.gov.cn/ | 教育厅门户；招聘栏目待核验 | 1 | 部分接入 | 郑州已接入；其余地市与区县待补齐 |
| 17 | 湖北省 | 420000 | 湖北省教育厅 | http://www.hbies.cn/ | 教师资格业务入口；教育厅门户待补 | 1 | 部分接入 | 武汉已接入；其余地市与区县待补齐 |
| 18 | 湖南省 | 430000 | 湖南省教育厅 | http://jsc.gov.hnedu.cn | 教师工作入口；教育厅门户待补 | 1 | 部分接入 | 长沙已接入；其余地市与区县待补齐 |
| 19 | 广东省 | 440000 | 广东省教育厅 | http://edu.gd.gov.cn | 教育厅门户；招聘栏目待核验 | 1 | 部分接入 | 广州已接入；省级与其余地市待补齐 |
| 20 | 广西壮族自治区 | 450000 | 广西壮族自治区教育厅 | http://jyt.gxzf.gov.cn/ | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 21 | 海南省 | 460000 | 海南省教育厅 | http://edu.hainan.gov.cn | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 22 | 重庆市 | 500000 | 重庆市教育委员会 | https://www.cque.edu.cn/tdc/ | 教师发展中心入口；**市人社局「事业单位公开招聘」已核验并接入** | 1 | 部分接入 | 重庆市人社局综合栏目已接入（年度子目录需按年滚动）；区县教育事业单位独立栏目仍待补齐 |
| 23 | 四川省 | 510000 | 四川省教育厅 | http://edu.sc.gov.cn/ | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 24 | 贵州省 | 520000 | 贵州省教育厅 | http://jyt.guizhou.gov.cn/ | 教育厅门户；招聘栏目待核验 | 1 | 部分接入 | 贵阳已接入；其余地市与区县待补齐 |
| 25 | 云南省 | 530000 | 云南省教育厅 | https://jyt.yn.gov.cn | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 26 | 西藏自治区 | 540000 | 西藏自治区教育厅 | http://www.xzedu.com.cn | 教育门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 27 | 陕西省 | 610000 | 陕西省教育厅 | http://jyt.shaanxi.gov.cn/ | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 28 | 甘肃省 | 620000 | 甘肃省教育厅 | http://jyt.gansu.gov.cn/ | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 29 | 青海省 | 630000 | 青海省教育厅 | http://jyt.qinghai.gov.cn/ | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 30 | 宁夏回族自治区 | 640000 | 宁夏回族自治区教育厅 | http://jyt.nx.gov.cn/index.html | 教育厅门户；招聘栏目待核验 | 0 | 未覆盖 | 同上 |
| 31 | 新疆维吾尔自治区 | 650000 | 新疆维吾尔自治区教育厅 | https://jszg.xjnu.edu.cn（教师资格认定指导中心） | 教师资格入口；教育厅门户待补 | 0 | 未覆盖 | 同上 |

新疆生产建设兵团不在 31 个省级行政区口径内，另行登记，不并入新疆覆盖率。

## 4. 已登记来源明细（市级/区县级与省级政策）

| sourceKey | 发布单位 | 区划代码 | 层级 | 内容类型 | 台账状态 | 核验日期 | 证据档位 | 持续运行 | 缺口/备注 |
|---|---|---|---|---|---|---|---|---|---|
| hangzhou-education | 杭州市教育局 | 330100 | 市 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 真实样本回放；7 天观察未完成 |
| ningbo-education | 宁波市教育局 | 330200 | 市 | 招聘 | ready | 2026-10-24 | B 级真实材料闭环 | 未通过 | 真实 xlsx 逐字节核对；7 天观察未完成 |
| yinzhou-government | 宁波市鄞州区人民政府 | 330212 | 区县 | 招聘 | ready | 2026-10-24 | fixture 级 | 未通过 | 同上 |
| lishui-education | 丽水市教育局 | 331100 | 市 | 招聘 | ready | 2026-10-26 | A 级独立清单发现对账 | 未通过 | 8/8 目标命中；材料闭环未完整运行 |
| shaoxing-education | 绍兴市教育局 | 330600 | 市 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 同上 |
| jiaxing-education | 嘉兴市教育局 | 330400 | 市 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 同上 |
| xiaoshan-education | 杭州市萧山区教育局 | 330109 | 区县 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 同上 |
| nanjing-education | 南京市教育局 | 320100 | 市 | 招聘 | ready | 2026-10-21 | A 级独立清单发现对账 | 未通过 | 16/16 目标命中；材料闭环未完整运行 |
| suzhou-education | 苏州市教育局 | 320500 | 市 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 公开招聘更新频率低，不按活跃源展示 |
| changzhou-education | 常州市教育局 | 320400 | 市 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 附件需同源 Referer |
| bengbu-education | 蚌埠市教育局 | 340300 | 市 | 招聘 | ready | 2026-10-26 | fixture 级 | 未通过 | 实测 18 页 / 267 条 |
| huzhou-education | 湖州市教育局 | 330500 | 市 | 招聘 | ready | 2026-11-05 | fixture 级（真实样本） | 未通过 | 「公示公告」混合栏目；jpaas 表格行 + initJpage 3 页；正文与 xlsx 附件回放通过；7 天观察未完成 |
| taizhou-education | 泰州市教育局 | 321200 | 市 | 招聘 | ready | 2026-11-05 | fixture 级（真实样本） | 未通过 | 「最新文件」混合栏目；jpaas li + DOM 属性分页 2 页；正文与 xls 附件回放通过；7 天观察未完成 |
| bozhou-education | 亳州市人民政府 | 341600 | 市 | 招聘 | ready | 2026-11-05 | fixture 级（真实样本） | 未通过 | 「教师管理」栏目；静态列表 + pagination 13 页 / 191 条；正文与 /upload_bz/download 附件回放通过；7 天观察未完成 |
| fuyang-education | 阜阳市教育局 | 341200 | 市 | 招聘 | ready | 2026-11-05 | fixture 级（真实样本） | 未通过 | 「师资建设」栏目；静态列表 + pagination 12 页 / 175 条；正文与 /download?siteId= 附件回放通过；跨站转载按路径过滤；7 天观察未完成 |
| jinan-education | 济南市教育局 | 370100 | 市 | 招聘 | ready | 2026-11-05 | fixture 级（真实样本） | 未通过 | 「教师招聘专栏」；jpaas 表格行 + DOM 属性分页 6 页 / 79 条；正文与 4 个 jpaas 附件回放通过；7 天观察未完成 |
| yantai-education | 烟台市教育局 | 370600 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「通知公告」混合栏目；jpaas li.cf + span.fr；官方 1365 条 / 91 页，按单来源窗口只监测最新 6 页（90 条）；列表直链 PDF 不按正文抓取；正文与 xls 附件回放通过；7 天观察未完成 |
| taian-education | 泰安市教育局 | 370900 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「公示公告」混合栏目；首屏内嵌 datastore 45 条，后续 POST jpage dataproxy（227 条 / 16 页 / 每页 15 条）补齐；正文 ContentStart/ContentEnd、附件 downfile.jsp 回放通过；7 天观察未完成 |
| weifang-education | 潍坊市教育局 | 370700 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「公告公示」混合栏目（trs1308521）；列表页 JS 壳，POST els-service JSON 接口（官方 49 页 / 每页 20 条），按单来源窗口只监测最新 6 页（约 120 条）；正文 meta + td#Content、附件 /upload-service/ 回放通过；7 天观察未完成 |
| nanchang-education | 南昌市教育局 | 360100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「教师科发文」混合栏目；服务端渲染静态列表（ul.item li > a[title] + 同级 span）+ createPageHTML 分页（2 页 / 34 条）；含跨栏目 /ncjyj/jszgrd/ 链接按详情路径放行；正文 meta + #zoom、相对路径 <文章ID>/files/ 附件（xlsx/pdf/doc）回放通过；7 天观察未完成 |
| taiyuan-education | 太原市教育局 | 140100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「通知公告」混合栏目；服务端渲染静态列表（ul.List_list li > span.fr 日期 + a[title]）+ JS 跳转式分页（onclick location.href，官方 93 条 / 5 页 / 每页 20 条）；正文 meta + #zoom、/u/cms/site28/ 下 xlsx 附件回放通过；7 天观察未完成 |
| zhengzhou-education | 郑州市教育局 | 410100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「通知公告」混合栏目（**河南首个来源**）；老站 http news.zzedu.net.cn/tz/ 静态列表（ul#pageCont a.new_link + M月D日 短日期）；JS 按钮"加载更多"分页（pageTotal=7，首版只抓首屏 20 条）；**双域名详情**——老站 .shtml（SourceTitle meta + div#article）、新政务 https://zzjy.zhengzhou.gov.cn/.jhtml（ArticleTitle + div.news_content_content + xlsx 附件下载）；含 10 条教师招聘/事业单位拟聘用公示；7 天观察未完成 |
| fuzhou-education | 福州市教育局 | 350100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「通知公告」混合栏目（**福建首个来源**）；列表页 JS 壳，POST /fjdzapp/search 表单接口（官方 178 页 / 2658 条 / 每页 15 条），必须携带同源 Referer，doctitle 检索参数不生效按栏目全量翻页；按单来源窗口只监测最新 6 页（90 条）；正文 meta + div.article_content、div.article_attachment 相对路径附件（P0…xlsx/pdf）回放通过；含招聘全周期公告；7 天观察未完成 |
| guangzhou-education | 广州市教育局 | 440100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「网上公示」栏目（**广东首个来源**）；NFCMS 服务端渲染列表（div.news_list li > a[title] + 方括号日期 [YYYY-MM-DD]，首屏 20 条）+ 静态锚点 index_N.html 分页（官方 20 页 / 400 条，页内 createPageHTML 声明已注释失效），按单来源窗口只监测最新 6 页（120 条）；正文 meta + div#zoomcon、/attachment/…xlsx 附件回放通过；首屏与第 2 页无重叠、招聘密度 14/20；7 天观察未完成 |
| shijiazhuang-education | 石家庄市教育局 | 130100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「通知公告」混合栏目（**河北首个来源**，官方整站仅 HTTP，已登记 HTTP_ONLY_HOSTS）；服务端渲染列表 li.clearF > div.ul_zi > a（文章绝对地址 /a/YYYY/MM/DD/<id>.html）+ div.ul_ziriqi 日期，首屏 20 条；PageFront 表单 POST 分页（form[name=pageForm] → /dynamic/PageFront.jsp，parseId/categoryId/keyword/pageNo），官方 6 页 / 120 条全量监测（窗口已登记），POST 无 Referer 要求；微信公众号站外转载条目按详情路径过滤；正文 meta ArticleTitle（内嵌 <br> 清洗）/PubDate + div.content_fenye2、/resources/43/*.zip|docx 附件（nbsp 前缀剥离）与零附件条目回放通过；含公开招募银龄讲学教师公告；7 天观察未完成 |
| changsha-education | 长沙市教育局 | 430100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「教师招聘」栏目（**湖南首个来源**，官方整站仅 HTTP，已登记 HTTP_ONLY_HOSTS）；服务端渲染列表 div.xxgk-item li，嵌套 `<a>` 经 parse5 扁平化后须取带 title 的内层锚点 + span 日期 YYYY-MM-DD，首屏 15 条；官方脚本 `createPageHTML5("8","0","index","html")` 派生 index_1..index_7.html（官方 8 页 / 约 120 条全量监测，窗口已登记 WCM5_PAGE_WINDOWS）；第 2 页 1 条长沙市人社局 rsj.changsha.gov.cn 跨站招考条目按同源过滤剔除、保留 14 条，与首屏重叠 1 条置顶公告；正文 meta ArticleTitle/Pubdate（meta 名带空格须 trim）+ div.content-main，附件（1 pdf / 3 附件 xlsx+2 docx / 7 附件 5 pdf+2 docx）与零附件条目回放通过；7 天观察未完成 |
| wuhan-education | 武汉市教育局 | 420100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「通知公告」混合栏目（**湖北首个来源**）；目录形态栏目 /zwdt/tsgg/ 服务端渲染列表（li.box-sizing > a.item-li-a[title] + div.other 时间：YYYY-MM-DD，首屏 10 条）+ div#navbox 静态锚点 index_N.shtml 分页（pagenav_tail 尾页给出官方 50 页 / 约 500 条 / 每页 10 条），按单来源窗口只监测最新 6 页（60 条），GET 无 Referer 要求；正文 meta ArticleTitle/PubDate/ContentSource + div#article-box（TRS_UEDITOR）、./P0…pdf 附件（1 个 / 4 个多附件）与零附件条目回放通过；含直属单位公开招聘拟聘用公示与公费师范生专项招聘成绩公告；7 天观察未完成 |
| guiyang-education | 贵阳市教育局 | 520100 | 市 | 招聘 | ready | 2026-11-06 | fixture 级（真实样本） | 未通过 | 「教师工作」栏目（**贵州首个来源**）；目录形态栏目 /newsite/zwgk/zdlyxxgk/jsgz/ 服务端渲染列表（ul.right-cont_list li > a[href][title]，锚点内 p 标题 + span 日期 YYYY-MM-DD，首屏 15 条）；官方脚本 createPage(19,0,"index","html")（WCM 4 参裸调用）派生 index_1..index_18.html（官方 19 页 / 277 条全量监测，窗口已登记 WCM5_PAGE_WINDOWS），GET 无 Referer 要求；第 2 页 15 条与首屏 0 重叠；正文 meta ArticleTitle/PubDate（标准名无空格，值带时分）/ContentSource + div.TRS_UEDITOR，./P0…pdf|xls|xlsx|doc|docx 附件（1 pdf / 4 附件 / 2 附件）与零附件条目回放通过；7 天观察未完成 |
| beijing-rsj-recruitment | 北京市人力资源和社会保障局 | 110000 | 市 | 招聘 | ready | 2026-11-20 | fixture 级（真实样本） | 未通过 | 「事业单位公开招聘」综合栏目（**北京首个来源**）；服务端渲染列表 ul.list li > a[title] + span 日期，首屏 12 条，其中 6 条教育/学校/大学/教委相关；同目录静态锚点 index_N.html 分页，按单来源窗口只监测最新 3 页（约 60 条）；正文 meta ArticleTitle/PubDate + div.view（TRS CMS）、同域 xlsx/doc/pdf 附件回放通过；医院/广电/剧院/科学院等非教师条目按标题过滤；直辖市市级综合栏目不能替代各区独立渠道；真实运行与 7 天观察未完成 |
| chongqing-rsj-recruitment | 重庆市人力资源和社会保障局 | 500000 | 市 | 招聘 | ready | 2026-11-20 | fixture 级（真实样本） | 未通过 | 「事业单位公开招聘」综合栏目（**重庆首个来源**）；服务端渲染列表 ul li > a[title] + span 日期，首屏 20 条中 9 条教育/学校/高校/党校相关；createPage(N,0,"index","html") 派生 index_N.html，按单来源窗口只监测最新 3 页（约 60 条）；正文 meta ArticleTitle/PubDate + div.xl-article；附件在正文外脚本变量 hasFJ 中，已解析并补全岗位一览表/专业参考目录 xlsx；年度子目录 sydwgkzp<YYYY> 需按年滚动；卫健/科学院等非教师条目按标题过滤；真实运行与 7 天观察未完成 |
| anhui-education-policy | 安徽省教育厅 | 340000 | 省 | 政策 | ready | 2026-11-05 | fixture 级 | 未通过 | 只服务政策检索，不计招聘覆盖 |
| jiangsu-education-candidate | 江苏省教育厅 | 320000 | 省 | 招聘候选 | candidate | 未核验 | 无 | 未接入 | 省级不发布市县招聘，不能替代市县覆盖 |
| zhejiang-education-candidate | 浙江省教育厅 | 330000 | 省 | 招聘候选 | candidate | 未核验 | 无 | 未接入 | 公告公示为聚合页，无独立教师招聘栏目 |
| wuxi-education-candidate | 无锡市教育局 | 320200 | 市 | 招聘候选 | blocked | 2026-10-26 | 无 | 未接入 | 入口 DNS 解析失败；替代入口待核验，恢复后重试 |

## 5. 分批接入计划

| 批次 | 范围 | 目标 | 必须完成的验证 | 预计外部依赖 |
|---|---|---|---|---|
| N0 盘点与账本 | 全国 31 省 | 本文件、PRD 第 13 节、能力四档盘点、目录分母 | 目录与实际接入分开；不伪造核验 | 官方入口目录来源；人工审查 |
| N1 现有三省补缺 | 浙江、江苏、安徽 | 补齐已接入省份的市级/区县缺口；确认省级入口边界 | 自动发现、正文、岗位附件、去重、补充通知、重试、告警、审核发布、用户可见性 | 各市教育局/区县政府官网可达性；人工审核 |
| N2 公开接口族 | jpaas / AuthorizedRead 公开列表类站点，跨省选取 | 复用公开栏目请求、分页、正文定位能力 | 独立清单对账；正文与附件；受限来源替代入口 | 同源公开接口稳定性；接口参数变化 |
| N3 静态列表族 | `.shtml` / `.listContent` 静态列表类站点，跨省选取 | 复用静态列表与 `_N.shtml` 分页 | 岗位附件完整性；补充通知关联；更新延迟 | 静态页面改版；附件防盗链 |
| N4 表格与服务端渲染族 | 表格列表、`FX_PageDiv`、`pageCount/pageIndex`、`ul.list`/`createPage` 静态列表类站点 | 复用表格/服务端渲染列表、Referer、分页、`.view`/`.xl-article` 正文、`hasFJ` 脚本附件 | 失败重试与恢复；结构漂移告警；发布门禁 | 分页参数变化；站点限速；年度子目录滚动 |
| N5 剩余与受限来源 | 未覆盖行政区、受限站点 | 继续接入可用官方入口；建立替代入口 | 全国缺口清单；受限原因与替代入口；专项验收报告 | 登录/验证码/封禁站点的人工处置 |

## 6. 每批验收指标

| 指标 | 计算口径 | 批次门槛 |
|---|---|---|
| 目录完整率 | 已登记省级行政区 / 31；市级、区县级按该批目标分母单独统计 | 如实报告，不以省级登记替代市县分母 |
| 实际接入率 | 已接入来源 / 已登记来源 | 每批新增来源全部有适配器与入口核验证据 |
| 样本通过率 | 样本通过来源 / 已接入来源 | 每来源有真实官方样本、正文、岗位附件与独立对账 |
| 持续运行通过率 | 持续运行通过来源 / 样本通过来源 | 连续观察窗口内每日有真实时间记录 |
| 独立召回率 | 系统发现命中的目标条目 / 独立清单目标条目 | 先冻结清单再加抓取；漏采逐条记录原因 |
| 材料完整率 | 正文、岗位表、补充通知齐全的目标条目 / 目标条目 | 缺失或解析失败必须说明原因 |
| 更新延迟 | 发布/审核时间 − 官方发布时间 | 记录中位数与最大值，不用平均值掩盖长尾 |
| 失败恢复时间 | 失败发生到恢复成功的时间 | 退避、重试、告警与恢复均有记录 |
| 用户侧准确率 | 抽查地区正确显示未覆盖/检查异常/暂无已发布公告的比例 | 不得把未收录表述为当地没有招聘 |

## 7. 外部依赖与风险

- 官方站点可达性、DNS、HTTPS、限速、反爬与地区网络差异；不可达不等于当地无招聘。
- 列表分页、正文容器、附件链接与元数据格式差异；结构变化必须告警并转人工。
- PDF/Excel/Word/压缩包、防盗链 Referer、扫描件与超大文件；扫描件转人工。
- 人工审核与受限来源处置能力；无审核证据不得发布为正式数据。
- 不新增付费依赖，不引入第三方转载源替代官方来源；单来源失败按来源隔离。

## 8. N1/N2 接入记录与 7 天观察（进行中）

### 8.1 已接入跨省来源（2026-11-05 至 2026-11-06）

| sourceKey | 省份 | 页面形态 | 列表解析 | 分页 | 正文容器 | 附件 | 真实样本 |
|---|---|---|---|---|---|---|---|
| huzhou-education | 浙江湖州 | jpaas 公开接口 + 表格行 | `.page-content tr`，`a[title]` + `td.yd_no` | `initJpage` rows=15/count=41 → 3 页 | `#zoom` + meta | jpaas `front/document/download`（xlsx） | `tests/fixtures/golden-sources/huzhou` |
| taizhou-education | 江苏泰州 | jpaas 公开接口 + li | `.page-content li`，`a[href]` + `span`，title 占位符回退链接文本 | DOM 属性 rows=15/count=30 → 2 页 | `.content` + meta | jpaas `front/document/download`（xls） | `tests/fixtures/golden-sources/taizhou` |
| bozhou-education | 安徽亳州 | 服务端渲染静态列表 | `section.m-tglist li`，`a[title]` + `span` | `<pagination>` pagecount=13 → 13 页 / 191 条 | `#zoom` + meta | `/upload_bz/download?siteId=&id=`（doc/et） | `tests/fixtures/golden-sources/bozhou` |
| fuyang-education | 安徽阜阳 | 服务端渲染静态列表 | `div.m-cglist.m-liststyle1 li`，`span` + `a[title]`（跨站按详情路径过滤） | `<pagination>` pagecount=12 → 12 页 / 175 条 | `#zoom` + meta | `/download?siteId=28&id=`（xlsx/docx） | `tests/fixtures/golden-sources/fuyang` |
| jinan-education | 山东济南 | jpaas 公开接口 + 表格行 | `.page-content tr`，`a[title]` + `td.bt_time span`（部分历史条目为 http 链接） | DOM 属性 rows=15/count=79 → 6 页 | `#zoom` + meta | jpaas `front/document/download`（pdf/doc/docx） | `tests/fixtures/golden-sources/jinan` |
| yantai-education | 山东烟台 | jpaas 公开接口 + li | `.page-content li.cf`，`a[title]` + `span.fr`；列表直链 PDF 按文章路径过滤 | DOM 属性 rows=15/count=1365 → 官方 91 页；单来源窗口只取最新 6 页 | `#zoom` + meta | jpaas `front/document/download`（xls） | `tests/fixtures/golden-sources/yantai` |
| taian-education | 山东泰安 | 首屏内嵌 datastore + jpage POST | `<record><![CDATA[<li>a[title] + span.bt-right]]>`，首屏 45 条 | jpage `perPage:15` / totalRecord:227 → 13 个后续 POST dataproxy 页 | meta（ArticleTitle/pubdate）+ ContentStart/ContentEnd | `/module/download/downfile.jsp`（pdf） | `tests/fixtures/golden-sources/taian` |
| weifang-education | 山东潍坊 | 列表页 JS 壳 + els-service JSON POST | `{"success":true,"data":{"totalPages":49,"contents":[…]}}`，subject 剥离内嵌 HTML，首屏 20 条 | POST `/els-service/article/{page}/{size}`（body 固定模板 dq/dwid/catas），官方 49 页；单来源窗口只取最新 6 页 | meta（ArticleTitle/PubDate）+ `td#Content` | `/upload-service/…`（xls/docx/xlsx，td.art > div.appendix） | `tests/fixtures/golden-sources/weifang` |
| nanchang-education | 江西南昌 | 服务端渲染静态列表 | `ul.item li`，`a[title]` + 同级 `span`（YYYY-MM-DD）；含跨栏目 `/ncjyj/jszgrd/` 链接按详情路径放行，首屏 25 条 | 官方 `createPageHTML('page_div',2,1,'nav_list','shtml',34)` → `nav_list_2.shtml`，共 2 页 / 34 条 | 官方 meta（ArticleTitle/PubDate）+ `#zoom` | 相对路径 `<文章ID>/files/`（xlsx/pdf/doc） | `tests/fixtures/golden-sources/nanchang` |
| taiyuan-education | 山西太原 | 服务端渲染静态列表 | `ul.List_list li`，同级 `span.fr`（YYYY-MM-DD）+ `a[title]`，首屏 20 条 | JS 跳转式：页码锚点 `href="#"` + `onclick=location.href='tzgg_<n>.html'`，官方 93 条 / 5 页 / 每页 20 条 | 官方 meta（ArticleTitle/PubDate）+ `#zoom` | `/u/cms/site28/…`（xlsx；另有零附件条目） | `tests/fixtures/golden-sources/taiyuan` |
| zhengzhou-education | 河南郑州 | 老站静态列表（JS 加载更多） | `ul#pageCont a.new_link[title]` + `p` 内 `M月D日`（补当年年份），首屏 20 条 | JS 按钮"加载更多"（bfreeTools.js），首版只抓首屏 | 老站 .shtml：SourceTitle meta + `div#article`；新政务 .jhtml：ArticleTitle/PubDate meta + `div.news_content_content` | 新政务 `.news_content_attachments` a（xlsx 等） | `tests/fixtures/golden-sources/zhengzhou-education` |
| fuzhou-education | 福建福州 | 列表页 JS 壳 + fjdzapp 表单 POST | `{"error":false,"pageCount":178,"recordCount":2658,"data":[…]}`，chnldocurl/doctitle/docreltime，首屏 15 条 | POST `/fjdzapp/search`（body 固定模板 channelid/classsql=chnlid=/sortfield/classcol/classsort/page/prepage，必须携带同源 Referer），官方 178 页；单来源窗口只取最新 6 页 | 官方 meta（ArticleTitle/PubDate）+ `div.article_content` | `div.article_attachment` li>a 相对路径 `./P0YYYYMMDD….xlsx|pdf`（展开为详情同目录绝对 URL） | `tests/fixtures/golden-sources/fuzhou-education` |
| guangzhou-education | 广东广州 | NFCMS 集约化平台静态锚点列表 | `div.news_list li`，`a[title]` + 同级 `span` 方括号日期（`[YYYY-MM-DD]`），首屏 20 条 | 静态锚点 `index_<n>.html`（`a.last` 指向 `index_20.html`），官方 20 页 / 400 条；页内 `createPageHTML` 声明已被注释失效；单来源窗口只取最新 6 页 | 官方 meta（ArticleTitle/PubDate）+ `div#zoomcon` | `/attachment/<…>/<id>.xlsx|pdf`（锚点文本即附件名） | `tests/fixtures/golden-sources/guangzhou-education` |
| shijiazhuang-education | 河北石家庄 | 服务端渲染列表（官方整站仅 HTTP） | `li.clearF > div.ul_zi > a[栏目] + a[文章绝对地址]` + 同级 `div.ul_ziriqi`（YYYY-MM-DD），首屏 20 条；微信公众号站外转载条目按详情路径过滤 | `form[name=pageForm]` POST `/dynamic/PageFront.jsp`（parseId/categoryId/keyword/pageNo，无 Referer 要求），官方 6 页 / 120 条全量监测（窗口已登记 `PAGEFRONT_PAGE_WINDOWS`） | 官方 meta（ArticleTitle 内嵌 `<br>` 清洗 / PubDate）+ `div.content_fenye2` | `/resources/<siteId>/<id>.zip|docx` 相对路径（锚点文本即附件名，nbsp 前缀剥离）；另有零附件条目 | `tests/fixtures/golden-sources/shijiazhuang-education` |
| wuhan-education | 湖北武汉 | 服务端渲染列表（目录形态栏目 /zwdt/tsgg/） | `li.box-sizing > a.item-li-a[title]`（`./YYYYMM/tYYYYMMDD_<id>.shtml`）+ `h2.text-ellipsis` + `div.other`（时间：YYYY-MM-DD），首屏 10 条 | `div#navbox` 静态锚点 `index_N.shtml`（数字页码 + `pagenav_tail` 尾页直接给出官方总页数 50 页 / 约 500 条 / 每页 10 条；目录为第 1 页，`index_1.shtml` 为第 2 页），GET 无 Referer 要求；单来源窗口只取最新 6 页（60 条，窗口已登记 `WHSNAV_PAGE_WINDOWS`） | 官方 meta（ArticleTitle / PubDate YYYY-MM-DD HH:mm:ss / ContentSource）+ `div#article-box`（TRS_UEDITOR） | 正文内 `./P0<数字>.pdf` 相对路径（TRS WCM 命名，锚点文本即附件名；1 个 / 4 个多附件）；另有零附件条目 | `tests/fixtures/golden-sources/wuhan-education` |
| changsha-education | 湖南长沙 | 服务端渲染列表（WCM 栏目页，官方整站仅 HTTP） | `div.xxgk-item li`，锚点为嵌套 `<a>`（parse5 扁平化后外层锚点无标题，须取带 title 的内层锚点）+ 同级 `span`（YYYY-MM-DD），首屏 15 条；跨站条目按同源过滤（第 2 页剔除 1 条 rsj.changsha.gov.cn 人社招考链接） | 官方脚本 `createPageHTML5("8","0","index","html")` → 同目录 `index_<n>.html`（`index.html` 为第 1 页，派生 `index_1..index_7`，官方 8 页 / 约 120 条全量监测，窗口已登记 `WCM5_PAGE_WINDOWS`），GET 无 Referer 要求 | 官方 meta（` ArticleTitle `/` Pubdate `，meta 名带前后空格须 trim + 大小写不敏感）+ `div.content-main` | 正文内 `./P0<数字>.pdf\|xlsx\|docx` 相对路径（锚点文本即附件名；1 pdf / 3 附件 xlsx+2 docx / 7 附件 5 pdf+2 docx）；另有零附件条目 | `tests/fixtures/golden-sources/changsha-education` |
| guiyang-education | 贵州贵阳 | 服务端渲染列表（WCM 栏目页，目录形态 /newsite/zwgk/zdlyxxgk/jsgz/） | `ul.right-cont_list li > a[href][title][target=_blank]`，锚点内 `<p>` 标题 + `<span>` 日期（YYYY-MM-DD），首屏 15 条 | 官方脚本 `createPage(19,0,"index","html")`（WCM 4 参裸调用，无 wcmUtil. 前缀、数字无引号）→ 同目录 `index_<n>.html`（目录为第 1 页，派生 `index_1..index_18`，官方 19 页 / 277 条全量监测，窗口已登记 `WCM5_PAGE_WINDOWS`），GET 无 Referer 要求 | 官方 meta（ArticleTitle / PubDate 值带时分 YYYY-MM-DD HH:mm / ContentSource，标准名无空格）+ `div.TRS_UEDITOR` | 正文内 `./P0<数字>.pdf\|xls\|xlsx\|doc\|docx` 相对路径（锚点文本即附件名；1 pdf / 4 附件 xlsx+xls+docx+xlsx / 2 附件 xls+doc）；另有零附件条目（名单在正文表格内） | `tests/fixtures/golden-sources/guiyang-education` |

新增能力（复用而非单点硬编码）：

- `PublicColumnKind` 增加 `huzhou`、`taizhou`、`jinan`、`yantai`，列表行/标题/日期分支随 kind 复用；
- 新增 `PUBLIC_COLUMN_PAGE_WINDOWS` 单来源分页窗口（烟台 6 页），窗口值、官方总量与原因同步登记在本账本与来源目录 `coverageNote`，未登记来源超预算仍显式失败；
- `ARTICLE_BODY_SELECTORS` 增加 `.content`（泰州），附件正则增加 `/download?`（亳州）；
- 新增 `discoverGovInfoList` / `govInfoListPages`，覆盖 `section.m-tglist` + `<pagination>` 静态分页族；
- 新增 `jpage-list.ts`：解析首屏 `<datastore>` 与 jpage 配置（totalRecord/perPage），生成 dataproxy POST 页 URL 与 form 请求体；
- 新增 `els-list.ts`：解析 els-service JSON 列表（totalPages/contents），由分页 URL query 确定性派生 JSON 请求体，生成后续页 URL 与按 host 登记的分页窗口（`ELS_PAGE_WINDOWS`，潍坊 6 页）；
- `SafeFetcher` 新增 POST 边界（仅 form-urlencoded 或固定模板 JSON 对象、≤4KB、重定向降级 GET、仍走完整 allowlist/DNS 校验；JSON 通道拒绝数组/标量/非法 JSON）；
- 正文附件收集增加 `.m-filbox` / `.m-file-download` / `.m-dtdownload` 容器，避免岗位表在正文容器外被漏采；潍坊附件在同表 `td.art > div.appendix`，按文章表格定位收集。
- 新增 `discoverStaticAnchorList`（`public-column.ts`）：覆盖 `ul.item li > a[title] + 同级 span` 静态锚点列表族（南昌教师科），分页复用 `staticListPages`（createPageHTML → `_<n>.shtml`），跨栏目详情按路径正则放行。
- 新增 `jsPaginationPages`（`public-column.ts`）：覆盖 JS 跳转式静态分页（太原通知公告，`onclick=location.href='基名_<n>.html'`），只接受同源后续页，页码超出预算显式失败；适配器通过可选 `listSelector` 复用同一锚点列表解析（`ul.List_list li`）。
- 修复 `staticListPages` 末页重复派生：原实现对 `nav_list_2.shtml` 再次拼接会生成不存在的 `nav_list_2_2.shtml`（N3 南昌运行链路联调暴露，导致整轮被记为 partial）；现按 `createPageHTML` 的当前页码只生成后续页，末页返回空。
- 新增 `nfcms-list.ts`：解析 NFCMS 集约化平台（广东政务站点）静态锚点分页——页面 `createPageHTML` 声明可能已被注释失效，改由 `a.last`（最后一页）与数字页码锚点派生同目录 `index_<n>.html`，并按 host 登记分页窗口（`NFCMS_PAGE_WINDOWS`，广州 6 页）；`discoverStaticAnchorList` 日期校验放宽为接受方括号 `[YYYY-MM-DD]`（南昌等裸日期不受影响）。
- 新增 `fz-list.ts`：解析福建 fjdzapp/search 表单 POST 列表（error/pageCount/recordCount/data），由分页 URL query（channelid/chnlid/page）确定性派生表单请求体（classsql=chnlid=、sortfield 等固定模板），生成后续页 URL 并按 host 登记分页窗口（`FJ_PAGE_WINDOWS`，福州 6 页）；发现服务为该通道携带同源 Referer（缺 Referer 站点返回"获取站点配置失败"）。
- 新增 `pagefront-list.ts`：解析石家庄 PageFront 表单 POST 分页族——`form[name=pageForm]` POST `/dynamic/PageFront.jsp`（parseId/categoryId/keyword/pageNo），响应为完整 HTML 列表（`li > div.ul_zi` + `div.ul_ziriqi`），无 Referer 要求；由分页 URL query 确定性派生表单请求体，并按 host 登记分页窗口（`PAGEFRONT_PAGE_WINDOWS`，石家庄 6 页 = 官方全量）；混合栏目微信公众号站外转载条目按详情路径过滤；`validateSourceCatalog` 新增 `HTTP_ONLY_HOSTS` 显式登记集合，仅对已实测无 HTTPS 服务的宿主放行 http 入口（石家庄整站 HTTP，HTTPS 实测超时）。
- 新增 `whsnav-list.ts`：解析武汉 navbox 静态锚点分页族——栏目为目录形态 URL（`/zwdt/tsgg/`），服务端渲染 `li.box-sizing > a.item-li-a[title]` 列表（标题取 title 属性、日期取 `div.other`「时间：YYYY-MM-DD」），分页控件 `div#navbox` 为静态锚点 `index_N.shtml`（数字页码文本校验 + `pagenav_tail` 尾页直接给出官方总页数），目录为第 1 页、`index_1.shtml` 为第 2 页；分页页/详情页不重复派生，非本族页面返回空，超预算未登记 host 显式失败，按 host 登记分页窗口（`WHSNAV_PAGE_WINDOWS`，武汉 6 页）。
- 新增 `wcm5-list.ts`：解析 WCM `createPageHTML5("总页数","当前页","前缀","后缀")` 静态分页族——官方脚本声明总页数/前缀/后缀，派生同目录 `index_<n>.<ext>` 后续页（`index.html` 为第 1 页），前缀必须 `index`、后缀必须 `html|shtml`，分页页/详情页返回空；按 host 登记分页窗口（`WCM5_PAGE_WINDOWS`，长沙 8 页 = 官方全量），未登记 host 超预算显式失败；列表解析要求取带 title 的内层锚点（嵌套 `<a>` 被 parse5 扁平化）并按同源过滤跨站条目。
- `wcm5-list.ts` 扩展贵阳变体：分页脚本另支持 WCM 4 参裸调用 `createPage(19,0,"index","html")`（无 `wcmUtil.` 前缀、数字不带引号；同页 `function createPage(_nPageCount,…)` 定义首参非数字不误匹配），`WCM5_PAGE_WINDOWS` 登记贵阳 19 页 = 官方全量（277 条）；贵阳列表结构（`ul.right-cont_list li > a[title]` 内嵌 `<p>` 标题 + `<span>` 日期）与详情（meta 标准名无空格、PubDate 带时分、`div.TRS_UEDITOR`、`./P0…` 附件）由 `guiyang-education.adapter.ts` 自解析，族模块只共用分页派生。

### 8.2 逐来源验证状态

| 验证项 | 湖州 | 泰州 | 亳州 | 阜阳 | 济南 | 烟台 | 泰安 | 潍坊 | 南昌 | 太原 | 郑州 | 福州 | 广州 | 石家庄 | 武汉 | 长沙 | 贵阳 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 自动发现公告 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 真实列表首屏 15/15/15/10/15/12/45/20/25/20/20/15/20/20/10/15/15 条，`public-column-s5.spec.ts`、`jpage-list.spec.ts`、`els-list.spec.ts`、`fz-list.spec.ts`、`nfcms-list.spec.ts`、`pagefront-list.spec.ts`、`whsnav-list.spec.ts` 与 `wcm5-list.spec.ts` 回放 |
| 正文抓取 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 真实正文快照，标题/日期/正文非空 |
| 岗位/附件抓取 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 真实附件链接（xlsx / xls / doc、et / xlsx / pdf、doc、docx / pdf、xls+docx / xlsx / xlsx+pdf+doc / xlsx / xlsx（新政务）/ P0…xlsx+4×pdf+2×pdf / /attachment/…xlsx / /resources/…3×zip+2×docx / ./P0…pdf 1 个+4 个多附件 / ./P0…1 pdf+3 附件+7 附件 / ./P0…1 pdf+4 附件+2 附件；太原、石家庄、武汉、长沙、贵阳另验证零附件条目） |
| 去重 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 第一页与第二页 URL 无交集断言；泰安首屏 45 条与 POST 第 4 页 46 条无重叠；潍坊首屏与第 3 页无重叠；南昌首屏 25 条与第 2 页 9 条无重叠；太原首屏 20 条与第 2 页 20 条无重叠；福州首屏 15 条与第 2 页 15 条无重叠；广州首屏 20 条与第 2 页 20 条无重叠；石家庄首屏 20 条与 POST 第 2 页 18 条（2 条微信站外转载按详情路径过滤）无重叠；武汉首屏 10 条与第 2 页 10 条无重叠；长沙首屏 15 条与第 2 页 14 条（1 条人社跨站过滤）重叠 1 条置顶公告；贵阳首屏 15 条与第 2 页 15 条无重叠 |
| 补充通知关联 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 需审核发布链路真实运行后确认 |
| 失败重试 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 离线链路已注入 503 验证（见 8.2.1）；真实 PostgreSQL/Redis 调度待验证 |
| 告警 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 离线链路已注入结构漂移/连续失败验证（见 8.2.1）；真实调度告警持久化待验证 |
| 审核发布 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 通用链路已有离线集成证据；逐来源真实运行待验证 |
| 用户侧可见性 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 待验证 | 通用链路已有离线集成证据；逐来源真实运行待验证 |

说明：自动发现、正文、附件、去重已有真实样本证据；补充通知、重试、告警、审核发布与用户可见性属于**运行链路**验证，尚未在真实 PostgreSQL/Redis 调度下执行，因此不标记通过。

### 8.2.1 离线运行链路联调（2026-11-06）

本机无可用 PostgreSQL/Redis/Docker（`docker` 不可用，本地无 postgres/redis 服务），因此本轮不伪造“真实调度已跑通”，改用真实组件 + 内存基础设施做链路联调，验证代码在故障注入下的行为：

| 验证 | 方式 | 结果 |
|---|---|---|
| 调度投递 | 真实 `CrawlScheduler.tick` → `CrawlOrchestrator.checkSource` → 内存队列 | 到期来源投递 1 个 `source.discover`；同窗口重复检查返回 `already_running`，不重复投递 |
| Worker 发现 | 真实 `CrawlProcessor` → `SourceDiscoverService` → 南昌适配器 + 真实夹具 | 25 + 9 = 34 条公告，投递 34 个 `document.fetch`；运行保持 `running`（下载未完成不提前记成功） |
| 失败重试 | 注入 503（首次处理内 `SafeFetcher` 3 次重试仍失败） | 第 1 次尝试记 `retrying` 并抛错交重投，来源连续失败 1、退避 60 分钟；第 2 次尝试成功恢复 34 条 |
| 连续失败告警 | 连续 3 轮 503（不再重投） | 来源降级 `degraded`，告警 `consecutive_failures`（occurrences=1）写入；退避 60 → 120 → 240 分钟；恢复成功后告警自动解除、来源回到 `healthy` |
| 结构漂移告警 | 列表页替换为无 `ul.item li` 的改版页面 | 结果 `structure_changed`，来源 `structure_changed`，告警未解除；换回真实样本后下一轮成功且告警解除 |
| 分页回归 | 南昌末页 `nav_list_2.shtml` 再次解析 | 修复前会派生 `nav_list_2_2.shtml`（404 使整轮 partial）；修复后末页返回空，整轮 `succeeded` |

证据：`backend/src/sourcing/runtime-chain.spec.ts`（4 项）、`backend/src/sourcing/public-column-s5.spec.ts`（南昌末页分页断言）。

审核发布与用户侧可见性的通用链路已有离线集成证据：`backend/src/announcements/publish-catalog.integration.spec.ts`（真实审核人、门禁、事务、撤回、`buildCandidates` 用户匹配）与 `backend/src/sourcing/wp3-html-closure.e2e.spec.ts`（已发布单元出现在匹配结果）。CI `smoke-runtime.mjs` 覆盖真实 PostgreSQL/Redis 下的 API/Worker 启动与健康冒烟，但不逐来源执行调度检查。

仍未完成（保持待验证）：真实 PostgreSQL/Redis 下的定时调度、运行记录持久化、告警落库与通知处置、逐来源审核发布与用户侧抽查、7 天观察窗口。

### 8.3 7 天观察窗口

- 窗口开始：2026-11-05（首日）。
- 当前进度：**0 / 7 天**。首日两次真实采样（约间隔 9.5 分钟）均为 HTTP 200 且条目与首采一致，已记入 `SOURCE_MONITORING_RECORDS`；N2 济南另完成首日两次真实采样（16:17 与 16:20），烟台完成首日两次真实采样（2026-11-06 01:08 与 01:09 UTC，两次指纹一致，第 2 页与首屏无重叠），泰安完成首日两次真实采样（2026-11-06T01:53:26.910Z 与 01:54:34.111Z UTC，两次均 45 条，第 2 次指纹 `09cdc350…`），潍坊完成首日两次真实采样（2026-11-06T02:57:47.297Z 与 02:58:18.037Z UTC，两次均 20 条，第 2 次指纹 `1ea4bb4e…`），南昌完成首日两次真实采样（2026-11-06T03:59:14.704Z 与 04:07:36.596Z UTC，两次均 25 条，第 2 次指纹 `6a661c54…`），太原完成首日两次真实采样（2026-11-06T05:55:17.588Z 与 05:56:40.153Z UTC，两次均 20 条，第 2 次指纹 `be53f87e…`），郑州完成首次真实采样（2026-11-06T06:30Z，首屏 20 条），福州完成首次真实采样（2026-11-06T09:18Z，首屏 15 条），广州完成首次真实采样（2026-11-06T10:26Z，首屏 20 条、第 2 页 20 条无重叠），石家庄完成首次真实采样（2026-11-06T11:20Z，首屏 20 条；POST 第 2 页 20 行中 2 条微信公众号站外转载过滤后 18 条、与首屏无重叠），武汉完成首次真实采样（2026-11-06T12:05Z，首屏 10 条；第 2 页 index_1.shtml 10 条与首屏无重叠），长沙完成首次真实采样（2026-11-06T13:10Z，首屏 15 条；官方 8 页 createPageHTML5 全量窗口，第 2 页过滤 1 条人社跨站条目后 14 条、与首屏重叠 1 条置顶公告），贵阳完成首次真实采样（2026-11-06T14:40Z，首屏 15 条；官方 19 页 createPage 4 参全量窗口，第 2 页 15 条与首屏无重叠），同样条目一致；按连续 2 次成功阈值，机器状态为 `monitoring`（只代表“到最近一次检查为止正常”），不代表 7 天窗口完成。
- 规则：每日至少一次真实调度记录；连续 2 次成功才从 `verifying` 进入监测状态；窗口未满不得宣称“持续运行通过”。
- 未完成前，用户侧与验收报告一律按“样本通过、持续运行未验证”表述。

### 8.4 本轮探查但未纳入的来源（2026-11-05 至 2026-11-06）

| 候选 | 入口 | 结论 | 原因 / 替代入口 |
|---|---|---|---|
| 合肥市教育局 | https://jyj.hefei.gov.cn/ | 受限，未纳入 | HTTP 521（站点防护），不绕过；待站点恢复后重试 |
| 金华市教育局 | https://jyj.jinhua.gov.cn/ | 受限，未纳入 | TLS 证书不受信任（SEC_E_UNTRUSTED_ROOT），不绕过证书校验 |
| 温州市教育局 | https://edu.wenzhou.gov.cn/ | 未发现招聘栏目 | 访问 24 页无“教师+招聘”严格命中；不以混合通知公告冒充覆盖 |
| 宣城市教育体育局 | https://edu.xuancheng.gov.cn/Content/showList/3791/ | 不作为招聘来源 | 栏目名为「教师资格和招聘考试」，4 页 66 条以教师资格考试为主，首屏无招聘岗位公告 |
| 铜陵市教育和体育局 | https://www.tl.gov.cn/openness/OpennessContent/showList/684/0/page_1.html | 未纳入 | 政府信息公开总目录，混合全部公开事项，首屏无招聘条目 |
| 台州市教育局 | https://jyj.zjtz.gov.cn/col/col1229047544/ | 未纳入 | 「公示公告」混合栏目，首屏含资格认定、决算、招标，无独立招聘公告 |
| 无锡市 / 舟山市 | — | 受限，未纳入 | 入口 DNS 解析失败；替代官方入口待核验 |
| 南通市 / 徐州市 | — | 受限，未纳入 | 南通「人事信息」仅任免；徐州动态加载/403；不绕过反爬 |
| 盐城、淮安、连云港、宿迁、扬州、镇江 | — | 未发现招聘栏目 | 沿用 2026-11 前期盘点：首页无招聘入口 |
| 青岛市教育局 | https://edu.qingdao.gov.cn/ | 受限，未纳入 | HTTP 403（站点防护），不绕过；替代官方入口待核验 |
| 厦门市教育局 | https://edu.xm.gov.cn/xxgk/jszk/ | 受限，未纳入 | 「教师招考」首屏 15 条静态可读，但 `?page=N` 翻页请求被 WAF 拦截；不绕过 WAF，记录原因待站点策略调整后重试 |
| 潍坊市教育局 | https://jyj.weifang.gov.cn/ | 已接入（2026-11-06） | 「公告公示」为 JS 壳 + `POST /els-service/article/{page}/{size}` JSON 接口；已完成 els-service JSON 通道适配（固定模板 body、≤4KB、重定向降级 GET）并登记单来源 6 页窗口，见 8.1 |
| 泉州、东莞等 | — | 未纳入 | 首页无招聘栏目、入口不可达或栏目为混合公开事项；不以目录登记冒充覆盖 |
| 郑州、太原、福州、广州 | 各市教育局官网 | 已接入（2026-11-06） | 郑州「通知公告」（老站静态列表 + JS 加载更多，双域名 .shtml/.jhtml 详情）、福州「通知公告」（TRS `.htm` 详情 + `POST /fjdzapp/search` 表单接口、同源 Referer）与广州「网上公示」（NFCMS 静态锚点 `index_N.html` + `div#zoomcon` 详情）已接入，见 8.1；太原「通知公告」已于早前批次接入 |
| 石家庄市教育局 | http://sjzjyj.sjz.gov.cn/ | 已接入（2026-11-06） | 「通知公告」混合栏目：PageFront 表单 POST 分页族（`/dynamic/PageFront.jsp`，官方 6 页 / 120 条全量监测，无 Referer 要求），官方整站仅 HTTP（HTTPS 实测超时，已登记 `HTTP_ONLY_HOSTS`），含公开招募银龄讲学教师公告；早前"首页无招聘栏目"结论作废（通知公告栏目承载招募类公告），见 8.1 |
| 武汉市教育局 | https://jyj.wuhan.gov.cn/ | 已接入（2026-11-06） | 「通知公告」混合栏目：navbox 静态锚点分页族（目录形态栏目 /zwdt/tsgg/ + `div#navbox` 锚点 `index_N.shtml`，pagenav_tail 尾页给出官方 50 页 / 约 500 条，按窗口监测最新 6 页 / 60 条，GET 无 Referer 要求），正文 `div#article-box`（TRS_UEDITOR）+ `./P0…pdf` 附件，含直属单位公开招聘拟聘用公示与公费师范生专项招聘成绩公告，见 8.1 |
| 长沙市教育局 | http://jyj.changsha.gov.cn/ | 已接入（2026-11-06） | 「教师招聘」栏目：WCM `createPageHTML5` 静态分页族（官方 8 页 / 约 120 条全量监测），嵌套 `<a>` 须取带 title 的内层锚点；官方整站仅 HTTP（HTTPS 实测握手失败 SSL alert 40，已登记 `HTTP_ONLY_HOSTS`）；第 2 页含 1 条长沙市人社局 rsj.changsha.gov.cn 跨站招考链接，已按同源过滤（该人社栏目本身可作为后续独立候选），见 8.1 |
| 成都市教育局 | https://edu.chengdu.gov.cn/ | 受限，未纳入 | HTTP 412（站点防护/WAF），不绕过；待站点策略调整后重试 |
| 南宁市教育局 | https://jyj.nanning.gov.cn/ | 受限，未纳入 | 入口连接失败（fetch failed），不绕过；待网络或站点恢复后重试 |
| 西安市教育局 | https://edu.xa.gov.cn/ | 未发现招聘栏目 | 首页导航仅「教师资格认定」类栏目，/xxgk/jszp/ 等教师招聘路径 404；不以资格认定冒充招聘覆盖 |
| 昆明市教育体育局 | https://jtj.km.gov.cn/ | 未发现招聘栏目 | 首页「教师」命中均为教师资格考试/职称评审类通知，无独立教师招聘栏目 |
| 沈阳市教育局 | https://jyj.shenyang.gov.cn/ | 不作为招聘来源 | 仅见教师资格类栏目，无教师招聘公告栏目 |
| 贵阳市教育局 | https://jyj.guiyang.gov.cn/ | 已接入（2026-11-06） | 「教师工作」栏目（**贵州首个来源**）：WCM `createPage` 4 参裸调用静态分页族（官方 19 页 / 277 条全量监测），列表 `ul.right-cont_list li > a[title]` 内嵌 `<p>` 标题 + `<span>` 日期；正文 meta 标准名（PubDate 带时分）+ `div.TRS_UEDITOR` + `./P0…` 附件（1 pdf / 4 附件 / 2 附件 / 零附件回放通过），见 8.1 |

### 8.5 N4 首批（北京 / 重庆）真实样本核验（2026-11-20）

| 来源 | 官方栏目 | 真实样本 | 适配能力 | 证据 | 当前状态 |
|---|---|---|---|---|---|
| 北京市人社局「事业单位公开招聘」 | https://rsj.beijing.gov.cn/xxgk/gkzp/ | 首屏 12 条，6 条教育/学校/大学/教委相关；详情 meta + `div.view`；同域 xlsx 附件 | `ul.list li` 静态列表、`index_N.html` 分页、组织标题过滤（医院/广电/剧院/科学院排除）、`.view` 正文回退 | `backend/src/sourcing/adapters/beijing-rsj.adapter.spec.ts`、`tests/fixtures/golden-sources/beijing-rsj/` | 已实现并通过离线测试；待镜像发布、来源登记、真实首采与 7 天观察 |
| 重庆市人社局「事业单位公开招聘」 | https://rlsbj.cq.gov.cn/zwxx_182/sydw/ | 首屏 20 条，9 条教育/学校/高校/党校相关；详情 meta + `div.xl-article`；`hasFJ` 脚本含 2 个岗位附件 | `ul li` 静态列表、`createPage` `index_N.html` 分页、标题过滤、`.xl-article` 正文、`hasFJ` 附件解析 | `backend/src/sourcing/adapters/chongqing-rsj.adapter.spec.ts`、`tests/fixtures/golden-sources/chongqing-rsj/` | 已实现并通过离线测试；待镜像发布、来源登记、真实首采与 7 天观察 |

边界说明：两个来源均为直辖市**市级综合事业单位**栏目，只能证明其实际发布范围，不能替代市教委、区教委/区县独立招聘栏目；真实首采与持续运行未完成前，不把北京、重庆计入“持续运行通过”。

## 9. 当前结论与缺口

1. 省级目录登记 31/31，15 个省级行政区已有本地招聘适配器，其中 13 个有来源已登记到生产数据库。生产登记后仍需逐站核验采集结果。
2. 本地已有 30 个招聘来源适配配置，其中 28 个已登记到生产数据库；北京和重庆待上线。独立对账或真实材料闭环证据较充分的来源有 3 个，持续运行通过 0 个。
3. N1 新增湖州、泰州、亳州、阜阳 4 个跨省市级来源；N2 新增山东济南、烟台、泰安、潍坊 4 个公开接口族来源；N3 新增江西南昌（静态锚点列表族）、山西太原（JS 跳转分页族）、河南郑州（老站静态列表 + 双域名详情）、福建福州（fjdzapp 表单 POST 列表族）、广东广州（NFCMS 静态锚点分页族）、河北石家庄（PageFront 表单 POST 分页族，官方整站仅 HTTP 已显式登记）、湖北武汉（navbox 静态锚点 index_N.shtml 分页族）、湖南长沙（WCM createPageHTML5 静态分页族，官方整站仅 HTTP 已显式登记）与贵州贵阳（WCM createPage 4 参静态分页族）9 个来源；N4 新增北京（直辖市人社局综合事业单位栏目，`ul.list` + `index_N.html` + `.view`）与重庆（直辖市人社局综合事业单位栏目，`createPage` + `.xl-article` + `hasFJ` 脚本附件）2 个来源；均完成真实样本回放；烟台/潍坊/福州/广州/武汉按单来源分页窗口分别只监测最新 6 页（官方 91 页 / 49 页 / 178 页 / 20 页 / 50 页），石家庄官方仅 6 页、长沙官方仅 8 页、贵阳官方仅 19 页全量监测，北京/重庆按单来源窗口只监测最新 3 页，窗口均已登记；运行链路验证与 7 天观察尚未完成。
4. 市级、区县级全国分母尚未建立，现有 28 个地市/区县地区（30 个招聘来源）不能代表全国。
5. 全国完整召回未验证；本文件不宣称全部覆盖或完整召回。
6. 下一步：继续 N1 补齐浙江、江苏、安徽其余市级/区县缺口，同时推进 N2 公开接口族扩省与 7 天真实观察；随后按网站类型推进 N3—N5。

## 10. 变更记录

| 日期 | 变更 | 证据 |
|---|---|---|
| 2026-11-05 | 建立 31 省目录账本、现有来源四档盘点、分批计划与验收指标 | 本文件；PRD 第 13 节；`backend/src/sourcing/source-catalog.ts`；`docs/m08-source-acceptance-report.md` |
| 2026-11-05 | N1 首批接入湖州、泰州、亳州 3 个市级来源；新增静态 `section.m-tglist` 分页族能力；启动 7 天观察首日记录 | `backend/src/sourcing/adapters/{huzhou,taizhou,bozhou}-education.adapter.ts`；`backend/src/sourcing/public-column.ts`；`tests/fixtures/golden-sources/{huzhou,taizhou,bozhou}`；`backend/src/sourcing/public-column-s5.spec.ts` |
| 2026-11-05 | N1 第二批接入阜阳「师资建设」来源；静态列表解析扩展 `div.m-cglist.m-liststyle1` 与正文外附件容器 `.m-dtdownload`，跨站转载按详情路径过滤 | `backend/src/sourcing/adapters/fuyang-education.adapter.ts`；`tests/fixtures/golden-sources/fuyang`；`backend/src/sourcing/public-column-s5.spec.ts` |
| 2026-11-05 | N2 首批接入山东济南「教师招聘专栏」；jpaas 表格行 + `td.bt_time` 日期 + DOM 属性分页 6 页 / 79 条，正文 4 个 jpaas 附件回放通过 | `backend/src/sourcing/adapters/jinan-education.adapter.ts`；`tests/fixtures/golden-sources/jinan`；`backend/src/sourcing/public-column-s5.spec.ts` |
| 2026-11-06 | N2 扩源接入山东烟台「通知公告」；jpaas `li.cf` + `span.fr`，官方 1365 条 / 91 页，按 `PUBLIC_COLUMN_PAGE_WINDOWS` 只监测最新 6 页（90 条），列表直链 PDF 按文章路径过滤，正文与 xls 附件回放通过；登记青岛/厦门受限原因与泰安候选 | `backend/src/sourcing/adapters/yantai-education.adapter.ts`；`tests/fixtures/golden-sources/yantai`；`backend/src/sourcing/public-column.ts`；`backend/src/sourcing/public-column-s5.spec.ts` |
| 2026-11-06 | N2 扩源接入山东泰安「公示公告」；首屏内嵌 datastore 45 条 + 13 个后续 jpage dataproxy POST 页（227 条 / 16 页），新增 `SafeFetcher` 受限 POST form 能力（≤4KB、仅 form-urlencoded、重定向降级 GET），正文 ContentStart/ContentEnd 与 `downfile.jsp` pdf 附件回放通过；首日两次真实采样已记录 | `backend/src/sourcing/adapters/taian-education.adapter.ts`；`backend/src/sourcing/jpage-list.ts`；`backend/src/sourcing/jpage-list.spec.ts`；`backend/src/sourcing/fetch/safe-fetcher.ts`；`tests/fixtures/golden-sources/taian` |
| 2026-11-06 | N2 扩源接入山东潍坊「公告公示」；列表页为 JS 壳，新增 `els-list.ts` 解析 els-service JSON 列表（官方 49 页 / 每页 20 条，单来源窗口 6 页），`SafeFetcher` POST 边界扩展固定模板 JSON（对象校验、≤4KB、重定向降级 GET），详情 URL 前缀由 dwid 派生，正文 meta + `td#Content` 与 `/upload-service/` 附件回放通过；首日两次真实采样已记录 | `backend/src/sourcing/adapters/weifang-education.adapter.ts`；`backend/src/sourcing/els-list.ts`；`backend/src/sourcing/els-list.spec.ts`；`backend/src/sourcing/fetch/safe-fetcher.ts`；`tests/fixtures/golden-sources/weifang` |
| 2026-11-06 | N3 扩源接入江西南昌「教师科发文」；服务端渲染静态锚点列表（`ul.item li > a[title]` + 同级 span），新增 `discoverStaticAnchorList`，分页复用 `staticListPages`（官方 `createPageHTML` 声明 2 页 / 34 条），跨栏目 `/ncjyj/jszgrd/` 详情按路径放行；正文官方 meta + `#zoom` 与相对路径 `<文章ID>/files/` 附件（xlsx/pdf/doc）回放通过；首日两次真实采样已记录；江西成为第 5 个有接入省份 | `backend/src/sourcing/adapters/nanchang-education.adapter.ts`；`backend/src/sourcing/public-column.ts`；`backend/src/sourcing/public-column-s5.spec.ts`；`tests/fixtures/golden-sources/nanchang` |
| 2026-11-06 | N3 扩源接入山西太原「通知公告」；服务端渲染静态列表（`ul.List_list li > span.fr` + `a[title]`），新增 `jsPaginationPages` 解析 JS 跳转式分页（`onclick=location.href='tzgg_<n>.html'`，官方 93 条 / 5 页 / 每页 20 条），发现服务接入该分页通道；正文官方 meta + `#zoom` 与 `/u/cms/site28/` xlsx 附件、零附件条目回放通过；首日两次真实采样已记录；山西成为第 6 个有接入省份 | `backend/src/sourcing/adapters/taiyuan-education.adapter.ts`；`backend/src/sourcing/public-column.ts`；`backend/src/sourcing/jobs/source-discover.service.ts`；`backend/src/sourcing/public-column-s5.spec.ts`；`tests/fixtures/golden-sources/taiyuan` |
| 2026-11-06 | N3 扩源接入河南郑州「通知公告」（**河南首个来源**）；老站 http news.zzedu.net.cn/tz/ 静态列表（`ul#pageCont a.new_link` + M月D日 短日期补当年年份），JS 按钮"加载更多"分页（pageTotal=7）首版只抓首屏；双域名详情——老站 .shtml（SourceTitle meta + `div#article`）与新政务 .jhtml（ArticleTitle/PubDate meta + `div.news_content_content` + xlsx 附件）；含 10 条教师招聘/事业单位拟聘用公示；首日首次真实采样已记录 | `backend/src/sourcing/adapters/zhengzhou-education.adapter.ts`；`backend/src/sourcing/adapters/zhengzhou-education.adapter.spec.ts`；`tests/fixtures/golden-sources/zhengzhou-education` |
| 2026-11-06 | N3 扩源接入福建福州「通知公告」（**福建首个来源**，福建成为第 8 个有接入省份）；列表页 JS 壳，新增 `fz-list.ts` 解析 `POST /fjdzapp/search` 表单接口（官方 178 页 / 2658 条 / 每页 15 条，body 固定模板 channelid/classsql=chnlid=/sortfield/classcol/classsort/page/prepage），`SafeFetcher` 为该通道携带同源 Referer（缺 Referer 返回"获取站点配置失败"），按 `FJ_PAGE_WINDOWS` 只监测最新 6 页（90 条），doctitle 检索参数不生效按栏目全量翻页；正文 meta ArticleTitle/PubDate + `div.article_content` 与 `div.article_attachment` 相对路径附件（P0…xlsx/pdf）回放通过；首日首次真实采样已记录 | `backend/src/sourcing/adapters/fuzhou-education.adapter.ts`；`backend/src/sourcing/fz-list.ts`；`backend/src/sourcing/fz-list.spec.ts`；`backend/src/sourcing/jobs/source-discover.service.ts`；`tests/fixtures/golden-sources/fuzhou-education` |
| 2026-11-20 | N4 首批接入北京、重庆两个直辖市人社局「事业单位公开招聘」综合栏目；新增 `.view`/`.xl-article` 正文回退与重庆 `hasFJ` 脚本附件解析；真实首屏/详情样本离线回放通过 | `backend/src/sourcing/adapters/{beijing-rsj,chongqing-rsj}.adapter.ts`；`backend/src/sourcing/public-column.ts`；`tests/fixtures/golden-sources/{beijing-rsj,chongqing-rsj}`；`backend/src/sourcing/source-catalog.spec.ts` |
| 2026-11-06 | N3 扩源接入广东广州「网上公示」（**广东首个来源**，广东成为第 9 个有接入省份）；NFCMS 集约化平台服务端渲染列表（`div.news_list li > a[title]` + 方括号日期 `[YYYY-MM-DD]`），新增 `nfcms-list.ts` 从 `a.last`/数字页码锚点派生静态分页 `index_N.html`（官方 20 页 / 400 条，页内 `createPageHTML` 声明已被注释失效、`staticListPages` 返回空），按 `NFCMS_PAGE_WINDOWS` 只监测最新 6 页（120 条）；正文 meta ArticleTitle/PubDate + `div#zoomcon` 与 `/attachment/…xlsx` 附件回放通过；首屏 20 条、第 2 页 20 条无重叠且招聘密度 14/20；首日首次真实采样已记录 | `backend/src/sourcing/adapters/guangzhou-education.adapter.ts`；`backend/src/sourcing/nfcms-list.ts`；`backend/src/sourcing/nfcms-list.spec.ts`；`backend/src/sourcing/jobs/source-discover.service.ts`；`backend/src/sourcing/public-column.ts`；`tests/fixtures/golden-sources/guangzhou-education` |
| 2026-11-06 | N3 扩源接入河北石家庄「通知公告」（**河北首个来源**，河北成为第 10 个有接入省份）；服务端渲染列表（`li.clearF > div.ul_zi > a` 文章绝对地址 + `div.ul_ziriqi` 日期，首屏 20 条），新增 `pagefront-list.ts` 解析 `form[name=pageForm]` POST `/dynamic/PageFront.jsp` 表单分页（parseId/categoryId/keyword/pageNo 由 URL query 确定性派生，无 Referer 要求），官方 6 页 / 120 条全量监测（`PAGEFRONT_PAGE_WINDOWS` 已登记）；官方整站仅 HTTP（HTTPS 实测超时），`validateSourceCatalog` 新增 `HTTP_ONLY_HOSTS` 显式放行登记；微信公众号站外转载条目按详情路径过滤；正文 meta ArticleTitle（内嵌 `<br>` 清洗）/PubDate + `div.content_fenye2` 与 `/resources/43/*.zip\|docx` 附件（3 zip / 2 docx / 零附件三类回放通过）；首日首次真实采样已记录（POST 第 2 页过滤后 18 条与首屏无重叠）；广州批漏登的 4.x 明细行本批补登 | `backend/src/sourcing/adapters/shijiazhuang-education.adapter.ts`；`backend/src/sourcing/pagefront-list.ts`；`backend/src/sourcing/pagefront-list.spec.ts`；`backend/src/sourcing/source-catalog.ts`；`backend/src/sourcing/jobs/source-discover.service.ts`；`tests/fixtures/golden-sources/shijiazhuang-education` |
| 2026-11-06 | 新增离线运行链路联调（调度→投递→Worker→发现→失败重试→告警→恢复），暴露并修复 `staticListPages` 末页重复派生 `nav_list_2_2.shtml` 的真实缺陷；真实 PostgreSQL/Redis 调度与逐来源发布可见性仍待验证 | `backend/src/sourcing/runtime-chain.spec.ts`；`backend/src/sourcing/public-column.ts`；`backend/src/sourcing/public-column-s5.spec.ts`；`backend/src/sourcing/testing/crawl-testing.ts` |
| 2026-11-06 | N3 扩源接入湖北武汉「通知公告」（**湖北首个来源**，湖北成为第 11 个有接入省份）；目录形态栏目 `/zwdt/tsgg/` 服务端渲染列表（`li.box-sizing > a.item-li-a[title]` + `div.other` 时间：YYYY-MM-DD，首屏 10 条），新增 `whsnav-list.ts` 解析 `div#navbox` 静态锚点分页 `index_N.shtml`（数字页码文本校验 + `pagenav_tail` 尾页给出官方 50 页 / 约 500 条 / 每页 10 条，目录为第 1 页），按 `WHSNAV_PAGE_WINDOWS` 只监测最新 6 页（60 条），GET 无 Referer 要求；正文 meta ArticleTitle/PubDate/ContentSource + `div#article-box`（TRS_UEDITOR）与 `./P0…pdf` 附件（1 个 / 4 个多附件）、零附件条目回放通过；首日首次真实采样已记录（第 2 页 10 条与首屏无重叠，含直属单位公开招聘拟聘用公示与公费师范生专项招聘成绩公告） | `backend/src/sourcing/adapters/wuhan-education.adapter.ts`；`backend/src/sourcing/whsnav-list.ts`；`backend/src/sourcing/whsnav-list.spec.ts`；`backend/src/sourcing/source-catalog.ts`；`backend/src/sourcing/jobs/source-discover.service.ts`；`tests/fixtures/golden-sources/wuhan-education` |
| 2026-11-06 | N3 扩源接入湖南长沙「教师招聘」（**湖南首个来源**，湖南成为第 12 个有接入省份）；服务端渲染列表（`div.xxgk-item li`，嵌套 `<a>` 经 parse5 扁平化后须取带 title 的内层锚点 + 同级 span 日期），新增 `wcm5-list.ts` 解析官方脚本 `createPageHTML5("8","0","index","html")` 并派生同目录 `index_1..index_7.html`（官方 8 页 / 约 120 条全量监测，`WCM5_PAGE_WINDOWS` 已登记）；跨站条目按同源过滤（第 2 页剔除 1 条长沙市人社局 rsj 招考链接，保留 14 条，与首屏重叠 1 条置顶公告）；官方整站仅 HTTP（HTTPS 实测握手失败 SSL alert 40），`HTTP_ONLY_HOSTS` 追加 `jyj.changsha.gov.cn`；正文 meta ArticleTitle/Pubdate（meta 名带前后空格须 trim + 大小写不敏感）+ `div.content-main` 与 `./P0…pdf|xlsx|docx` 附件（1 pdf / 3 附件 / 7 附件）、零附件条目回放通过；首日首次真实采样已记录；来源目录上限 60 已留出扩源余量 | `backend/src/sourcing/adapters/changsha-education.adapter.ts`；`backend/src/sourcing/wcm5-list.ts`；`backend/src/sourcing/wcm5-list.spec.ts`；`backend/src/sourcing/source-catalog.ts`；`backend/src/sourcing/adapter-registry.ts`；`backend/src/sourcing/sourcing-core.module.ts`；`backend/src/sourcing/jobs/source-discover.service.ts`；`tests/fixtures/golden-sources/changsha-education` |
| 2026-11-06 | N3 扩源接入贵州贵阳「教师工作」（**贵州首个来源**，贵州成为第 13 个有接入省份）；目录形态栏目 `/newsite/zwgk/zdlyxxgk/jsgz/` 服务端渲染列表（`ul.right-cont_list li > a[href][title]`，锚点内 `<p>` 标题 + `<span>` 日期 YYYY-MM-DD，首屏 15 条），`wcm5-list.ts` 扩展支持 WCM `createPage(19,0,"index","html")` 4 参裸调用分页声明（无 `wcmUtil.` 前缀、数字无引号），派生同目录 `index_1..index_18.html`（官方 19 页 / 277 条全量监测，`WCM5_PAGE_WINDOWS` 已登记），GET 无 Referer 要求；第 2 页 15 条与首屏 0 重叠；正文 meta ArticleTitle/PubDate（标准名无空格，值带时分）/ContentSource + `div.TRS_UEDITOR` 与 `./P0…pdf\|xls\|xlsx\|doc\|docx` 附件（1 pdf / 4 附件 / 2 附件 / 零附件回放通过）；首日首次真实采样已记录；候选排除登记：成都 412 防护、南宁连接失败、西安/昆明/沈阳无独立教师招聘栏目 | `backend/src/sourcing/adapters/guiyang-education.adapter.ts`；`backend/src/sourcing/wcm5-list.ts`；`backend/src/sourcing/wcm5-list.spec.ts`；`backend/src/sourcing/source-catalog.ts`；`backend/src/sourcing/adapter-registry.ts`；`backend/src/sourcing/sourcing-core.module.ts`；`tests/fixtures/golden-sources/guiyang-education` |
| 2026-11-21 | 28 个生产招聘来源逐站对账与离线验收复查；修复「附件 URL 返回 200 HTML 限流页被当作成功附件入库」缺陷并补回归；北京/重庆仅本地验证，未发布未登记 | `backend/src/sourcing/jobs/document-fetch.service.ts`；`backend/src/sourcing/jobs/task-queue.ts`；`backend/src/sourcing/jobs/document-fetch.spec.ts`；本文件第 11 节；`docs/recruitment-upgrade-acceptance.md` 第 10 节 |

## 11. 2026-11-21 28 来源逐站对账与离线验收（复查）

本节是对 2026-11-20 交接基线的独立复查，不是新的接入批次。生产环境只执行有界、低负载只读查询；未执行生产写入、复跑、发布或扩源。

### 11.1 环境、代码版本与证据口径

- 仓库：`E:\游戏\考编助手`，分支 `codex/all-subject-rag`，提交 `dc4cce3`。工作区存在其他开发者未提交改动，本轮未回滚、未覆盖；本轮新增修改仅为 3 个采集代码/测试文件和 2 个文档（见 11.5）。
- 生产：`https://kbzs.al.qich.top`，运行镜像 `sha-3fb504a`，容器 `jiaozhao-standalone-{backend,worker,db,redis,frontend}-1`。数据库时间字段按 UTC 存储，本节引用运行时间时同时标注北京时间（UTC+8）。
- 只读核查方式：`ssh -o BatchMode=yes admin@47.101.32.47` 进入部署目录后，用 `docker compose -f docker-compose.standalone.yml exec -T db psql -U jiaozhao -d jiaozhao` 执行带 `LIMIT` 的逐来源/小批量查询；未做全库大范围聚合。
- 官方站点核验与离线回放均在本地执行，使用 2026-11-21 的公开页面/接口样本；样本只包含公开栏目、公告与附件信息。
- 口径区分：`succeeded`/`partial` 只表示该 run 的技术状态，不等于材料完整；附件快照数不等于可读文件数，`text/html` 快照可能是限流页。持续运行通过仍为 0。

### 11.2 A. 逐站对账总表（28 行）

用同一 `sourceKey` 关联 11.2.1（配置对账）与 11.2.2（运行与材料验收）。生产 `sourceId` 均为 2026-11-20 登记值；`登记/暂停` 为查询时快照。

#### 11.2.1 配置对账

| # | 地区 | sourceKey / adapterKey | 官方主站与招聘栏目 | 生产 sourceId | 登记/健康 | 配置差异 | 分页与例行扫描 |
|---|---|---|---|---|---|---|---|
| 1 | 河北·石家庄 | `shijiazhuang-education` | http://sjzjyj.sjz.gov.cn/ 「通知公告」`/a/zwgk/tzgg/index.html` | `10782ab8-eaba-4913-840c-f469136d00d0` | enabled / structure_changed | 无；官方整站仅 HTTP，已登记 `HTTP_ONLY_HOSTS` | `PageFront.jsp` POST 分页，官方 6 页 / 120 条，全量监测（窗口 6） |
| 2 | 山西·太原 | `taiyuan-education` | https://jyj.taiyuan.gov.cn/ 「通知公告」`/tzgg.html` | `5ef33c15-4d93-4d65-91c1-e9453e1ef2fa` | enabled / healthy | 无 | JS 跳转分页 `tzgg_<n>.html`，官方 5 页 / 93 条 |
| 3 | 江苏·南京 | `nanjing-education` | https://edu.nanjing.gov.cn/ 「招聘招考」`/bsfw/zpzk/index.html` | `f0a42c15-603d-4fd8-9219-9fad7a8b2534` | enabled / healthy | `listUrls` 显式为首页 + `index_1.html`（第 2 页），与代码一致 | 固定两页入口；跨站 `rsj.nanjing.gov.cn` 受白名单限制 |
| 4 | 江苏·苏州 | `suzhou-education` | https://jyj.suzhou.gov.cn/ 「人事信息」`/szjyj/rsxx/xxgk_list.shtml` | `6c405096-1e02-447e-92b0-4e5ca82580ed` | enabled / healthy | **配置性缺口**：登记栏目最新 2025-03-12 已停更；2026 活跃公告在市人社局 `hrss.suzhou.gov.cn/jsszhrss/gsgg/` | `createPageHTML` 3 页 / 34 条（15/15/4） |
| 5 | 江苏·常州 | `changzhou-education` | https://jyj.changzhou.gov.cn/ 「教育要闻/公示」`/class/QFJEPCBL` | `9281c407-00e0-4abd-8221-c010d4425317` | enabled / healthy | 无 | 静态列表，通用预算 ≤20 页 |
| 6 | 江苏·泰州 | `taizhou-education` | https://jyj.taizhou.gov.cn/ 「最新文件」`/zxwj/index.html` | `42d78c49-e1f1-4331-a39b-9a7673ac483d` | enabled / healthy | 无；混合栏目 | jpaas `li` + DOM 属性分页，2 页 |
| 7 | 浙江·杭州 | `hangzhou-education` | https://edu.hangzhou.gov.cn/ 「公示公告」`/col/col1228921906/index.html` | `20fddc8d-ffcf-4444-8802-ac59622e06f2` | enabled / healthy | 无 | jpaas 公共栏目 API，通用预算 ≤20 页 |
| 8 | 浙江·宁波 | `ningbo-education` | https://jyj.ningbo.gov.cn/ 「通知公告」`/col/col1229166692/index.html` | `5943c9b0-7309-44e1-8707-0be5e43820e1` | enabled / healthy | 生产 `listUrls` 保留手工修正的 `?number=`，与代码目录一致 | jpaas 公共栏目 API，通用预算 ≤20 页 |
| 9 | 浙江·鄞州 | `yinzhou-government` | https://www.nbyz.gov.cn/ 「教师招聘」`/col/col1229108032/jszp/index.html` | `5a186329-e353-48d2-af96-3f8964ade027` | enabled / healthy | 无 | jpaas 公共栏目 API |
| 10 | 浙江·嘉兴 | `jiaxing-education` | https://jyj.jiaxing.gov.cn/ 「公示公告」`/col/col1569769/index.html` | `2bdd6488-063d-4d06-a507-6d1ee5549101` | enabled / structure_changed | 无；2026-11-21 live 复核 `data.html` 未解析出条目，与生产异常一致 | jpaas 公共栏目 API |
| 11 | 浙江·湖州 | `huzhou-education` | https://huedu.huzhou.gov.cn/ 「公示公告」`/col/col1229210603/index.html` | `75de9be1-db37-482b-bff8-f682100e65d0` | enabled / healthy | 无 | jpaas 表格行 + `initJpage`，3 页 |
| 12 | 浙江·绍兴 | `shaoxing-education` | https://jyj.sx.gov.cn/ 「公示公告」`/col/col1489173/index.html` | `988e7e45-ac2d-4f5d-a6c0-59854662a959` | enabled / healthy | 无 | jpaas 公共栏目 API |
| 13 | 浙江·丽水 | `lishui-education` | https://jyj.lishui.gov.cn/ 「公示公告」`/col/col1229223905/index.html` | `879a60f8-1437-4855-8035-271d1246a550` | enabled / structure_changed | 无 | jpaas 公共栏目 API |
| 14 | 浙江·萧山 | `xiaoshan-education` | https://www.xiaoshan.gov.cn/ 「公示公告」`/col/col1228964830/index.html` | `af40206a-c07b-4950-b942-c02e3d6b3e84` | enabled / structure_changed | 无 | jpaas 公共栏目 API |
| 15 | 安徽·蚌埠 | `bengbu-education` | https://jyj.bengbu.gov.cn/ 「考试招聘」`/xwdt/kszp/` | `3a4b82e2-1550-47ab-8346-ef2965dc8eda` | enabled / healthy | 无 | 静态列表，官方 18 页 / 267 条 |
| 16 | 安徽·亳州 | `bozhou-education` | https://www.bozhou.gov.cn/ 「教师管理」`/XxgkContent/showList/295/65767/page_1.html` | `fdf1f4ca-417c-4865-bc30-7562150ac75e` | enabled / structure_changed | 无 | 静态 `pagination`，13 页 / 191 条 |
| 17 | 安徽·阜阳 | `fuyang-education` | https://edu.fy.gov.cn/ 「师资建设」`/Content/showList/843/page_1.html` | `3751655f-855d-4915-8773-d31a3738599c` | enabled / healthy | 无；跨站条目按路径过滤 | 静态列表，12 页 / 175 条 |
| 18 | 福建·福州 | `fuzhou-education` | https://jyj.fuzhou.gov.cn/ 「通知公告」`/fjdzapp/search` | `0206b611-7a2e-4380-b8ce-fbf07d853e74` | enabled / structure_changed | 生产 `listUrls` 为 GET 展示 URL；适配器实际 `POST /fjdzapp/search` 且需同源 Referer，配置未变 | 官方 178 页 / 2,659 条 / 每页 15，窗口 6 页 |
| 19 | 江西·南昌 | `nanchang-education` | https://edu.nc.gov.cn/ 「教师科发文」`/ncjyj/jskfw/nav_list.shtml` | `4931b6c8-b63f-47cf-99a8-28a54db62b1f` | enabled / healthy | 无 | `createPageHTML` 2 页 / 34 条 |
| 20 | 山东·济南 | `jinan-education` | https://jnedu.jinan.gov.cn/ 「教师招聘专栏」`/col/col19032/index.html` | `42803fa3-10ce-4892-882b-35425a94a9ab` | enabled / structure_changed | 无 | jpaas 表格行 + DOM 属性分页，6 页 / 79 条 |
| 21 | 山东·烟台 | `yantai-education` | https://jyj.yantai.gov.cn/ 「通知公告」`/col/col17078/index.html` | `4d47b4d0-40d6-4163-8494-8bf34e13bac6` | enabled / healthy | 无；混合栏目 | 官方 91 页 / 1,365 条，窗口 6 页 |
| 22 | 山东·潍坊 | `weifang-education` | https://jyj.weifang.gov.cn/ 「公告公示」`/els-service/article/1/20?...` | `8b80858d-9928-4f70-a736-336e3d2e2870` | enabled / structure_changed | 生产 `listUrls` 为 JSON 接口 URL，适配器 POST，配置未变 | 官方 49 页 / 每页 20，窗口 6 页 |
| 23 | 山东·泰安 | `taian-education` | https://jyj.taian.gov.cn/ 「公示公告」`/col/col45480/index.html` | `7e334d49-ce28-4be5-9a14-d802b4641261` | enabled / blocked | 无 | datastore 每页 45，官方 16 页 / 227 条 |
| 24 | 河南·郑州 | `zhengzhou-education` | https://zzjy.zhengzhou.gov.cn/ 「通知公告」`/tzgg/index.jhtml` | `c18b5d52-079d-4706-8233-517ef51af195` | enabled / healthy | 已切新版 `.jhtml`；`allowedHosts` 同时保留旧站 `news.zzedu.net.cn` | `.jhtml` 4 页 / 35 条 |
| 25 | 湖北·武汉 | `wuhan-education` | https://jyj.wuhan.gov.cn/ 「通知公告」`/zwdt/tsgg/` | `1c472c8e-b80f-48f2-a49c-73bddbbc6b43` | enabled / blocked | 无 | navbox `index_N.shtml`，官方 50 页，窗口 6 页 |
| 26 | 湖南·长沙 | `changsha-education` | http://jyj.changsha.gov.cn/ 「教师招聘」`/zfxxgk/fdzdgk/jszp/index.html` | `de7c6a83-4bae-4dae-9928-f515604a379f` | enabled / structure_changed | 整站仅 HTTP，已登记 `HTTP_ONLY_HOSTS` | `createPageHTML5` 8 页 / 约 120 条，全量 |
| 27 | 广东·广州 | `guangzhou-education` | https://jyj.gz.gov.cn/ 「网上公示」`/yw/wsgs/index.html` | `9e4158a6-4add-4923-bdaa-de98d81dbf0b` | enabled / healthy | 无 | NFCMS `index_N.html`，官方 20 页 / 400 条，窗口 6 页 |
| 28 | 贵州·贵阳 | `guiyang-education` | https://jyj.guiyang.gov.cn/ 「教师工作」`/newsite/zwgk/zdlyxxgk/jsgz/` | `5aadc730-26eb-40ff-8de9-511e1511fe3d` | enabled / structure_changed | 无 | `createPage` 19 页 / 277 条，全量 |

#### 11.2.2 运行与材料验收

运行时间为北京时间；`发现/下载/未变/失败` 取自各来源最新一条 run 的计数。`官方首屏样本` 为 2026-11-21 本地核验的列表首屏日期范围（仅证明该页内容，不等于该 run 的完整日期覆盖）。

| # | sourceKey | 最新 runId（北京时间） | 状态 | 发现/下载/未变/失败 | 官方首屏样本（2026-11-21） | 正文/岗位表缺口 | 待审 | 离线回放 | 逐站结论与下一步 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | shijiazhuang | `8fefc0e9-e157-49bf-8d01-159615471533`（11-20 17:44–17:53） | structure_changed | 111/154/0/14 | 静态首屏解析 0（列表需 POST `PageFront.jsp`） | `div.content_fenye2` 空 10 篇；附件 57、快照 53、4 无快照 | 62 | fixture 通过 | 列表与附件可采，正文容器失配；用 2026-11 详情样本更新选择器后复跑 |
| 2 | taiyuan | `e94b4339-84db-441c-b057-1baa8bceb0de`（11-20 17:44–17:53） | partial | 93/146/3/1 | 2026-05-22～2026-11-10（21 条） | 1 篇 `TOO_LARGE`；附件 57、快照 56 | 64 | fixture 通过 | 基本可用；单篇超大正文需上限核验 |
| 3 | nanjing | `48209b63-2f0a-4e08-b774-dc4b002ff488`（11-20 17:36–17:36） | partial | 30/0/78/1 | 2026-03-26～2026-09-14（15 条） | 1 条 `HOST_NOT_ALLOWED`（`rsj.nanjing.gov.cn`）；附件 49/49 | 55 | fixture 通过 | 主栏目稳定；跨站公告按规则不采，需人工渠道兜底 |
| 4 | changzhou | `6b53f2c4-e9aa-4730-bb1d-13eb173ebcdc`（11-20 17:53–11-21 08:06） | succeeded | 20/20/21/0 | 2026-05-11～2026-10-22（20 条） | 附件 21/21，无缺口 | 30 | fixture 通过 | 通过；附件名兜底已生效，保持观察 |
| 5 | suzhou | `9dd3b2db-8e59-45a0-b26b-b887b23cf250`（11-20 17:48–11-21 08:04） | succeeded | 34/42/0/0 | 仅 2 条可确认：2024-10-10、2025-03-12 | 栏目停更；附件 8/8 | 17 | 3 页 34 条回放通过 | **配置性缺口**：运行成功但栏目已停更；需新增/迁移市人社局 `hrss.suzhou.gov.cn/jsszhrss/gsgg/` 来源 |
| 6 | taizhou | `72869c52-5cdf-4bab-8159-8ff6e74a11fc`（11-20 17:44–17:50） | succeeded | 30/31/0/0 | 2025-05-27～2026-10-15（15 条） | 附件 29、快照仅 1，28 个无快照 | 18 | fixture 通过 | 运行成功但岗位表材料大面积缺失；需按附件端点补采或转人工 |
| 7 | hangzhou | `a682253b-8841-4af7-bea7-c0f3e6fbb3e9`（11-20 17:36–17:36） | succeeded | 20/0/32/0 | 2025-05-08～2026-05-28（15 条） | 附件 18 个快照均为约 102B 限流 HTML，非真实文件 | 10 | fixture 通过 | 运行成功但附件不可读；新版代码会把该情形记失败，需复跑替换坏快照 |
| 8 | xiaoshan | `f779049d-e0eb-4ff3-a765-bb1c2e7893fc`（11-20 17:37–17:39） | structure_changed | 173/0/368/20 | 2026-05-19～2026-08-20（15 条） | 附件 274、快照 254（多为限流 HTML）；`skipped` 59；另有 HTTP 404 | 147 | fixture 通过 | 正文与附件双重缺口；优先核对详情选择器与 `document/file-download` 端点 |
| 9 | ningbo | `14083880-2ace-459b-a8a3-f6034ca82272`（11-20 17:00–17:00，admin） | succeeded | 34/0/50/0 | 2025-09-10～2026-08-03（15 条） | **岗位表 8/8 快照均为 102B「访问过于频繁」HTML；`skipped` 17** | 28 | fixture 通过 | **运行成功但岗位表缺失**；官方 URL 已定位，下载被 `blocked_endpoint:path` 拦截，需人工补录或授权会话 |
| 10 | yinzhou | `6e210473-d243-424b-8dcd-b92b584b527a`（11-20 17:02–17:03） | succeeded | 74/2/82/0 | 2026-06-23～2026-11-05（15 条） | 附件 56、快照 52；4 个岗位表快照为限流 HTML；`skipped` 46 | 44 | fixture 通过 | 运行成功但岗位表缺失；处理同上 |
| 11 | jiaxing | `f7613a0a-64bd-4b60-8180-2ddb476e98e1`（11-20 17:48–11-21 08:04） | structure_changed | 138/0/202/14 | jpaas `data.html` 解析 0 条，与生产异常一致 | 附件 152、快照 137（限流 HTML）；`skipped` 135 | 82 | fixture 通过 | 上游 API 结构/响应变化；需用 2026-11 样本重定列表与附件解析 |
| 12 | huzhou | `096d3d29-0ebd-4031-aad7-ca63fdc0bc83`（11-20 17:44–17:50） | partial | 41/41/0/31 | 2025-07-21～2026-11-16（14 条） | **附件 56、快照 0；岗位表 9、快照 0**；31 个 `HOST_NOT_ALLOWED` | 17 | fixture 通过 | 正文成功、附件全缺；核对附件域名白名单与官方替代入口 |
| 13 | shaoxing | `c94a82c5-0ad3-453c-ad49-4c485daad779`（11-20 17:48–11-21 08:03） | succeeded | 9/0/9/0 | 2026-03-13～2026-07-06（9 条） | 附件 1/1 | 5 | fixture 通过 | 通过（低频来源），继续观察 |
| 14 | lishui | `2d330940-a4a2-4394-8753-96cf076c7442`（11-20 17:38–17:39） | structure_changed | 130/0/158/38 | 2026-07-30～2026-09-23（10 条） | 附件 99、快照 70（限流 HTML）；`skipped` 33；跨域 `rsj.lishui.gov.cn` 48 次失败 | 56 | fixture 通过 | 附件跨域/白名单拒绝；区分官方同源替代与人工补录 |
| 15 | bengbu | `3f6a2dd3-9504-4849-a309-9e539f522e6b`（11-20 17:37–17:37） | succeeded | 9/2/16/0 | 2026-07-24～2026-10-13（15 条） | 附件 9/9 | 8 | fixture 通过 | 通过；前次「附件缺少名称」已由兜底修复覆盖 |
| 16 | fuyang | `819e5f81-4510-4def-8c05-b94fbd6e5959`（11-20 17:44–17:52） | partial | 155/252/10/1 | 2026-05-11～2026-11-11（15 条） | 1 条 `HOST_NOT_ALLOWED`（`rsj.fy.gov.cn`）；附件 108/108 | 84 | fixture 通过 | 基本可用；1 条跨站公告需人工兜底 |
| 17 | bozhou | `c032357e-df9e-4a0b-9f26-de2ca7c34581`（11-20 17:44–21:56） | structure_changed | 193/367/14/6 | 2026-08-05～2026-11-12（15 条） | 5 篇正文缺标题/日期/正文；1 条 `HOST_NOT_ALLOWED`（`www.sxx.gov.cn`）；附件 194/193 | 108 | fixture 通过 | 主体可采，少量详情异常；按 5 条失败 URL 逐条修样本 |
| 18 | fuzhou | `a14b3ceb-fba4-48ea-b73e-987843212782`（11-20 17:44–17:45） | structure_changed | 0/0/0/0 | **11-21 live POST 通过：15 条/页，178 页，2,659 条；2026-10-21～11-19；详情 docx 200** | 生产 0 文档 | 0 | 实时回放 4/4 通过 | 生产 run 早于本轮 live 验证；需在暂停解除后单来源复跑，并核对 `data.html` 为空时的 Referer/参数分支 |
| 19 | nanchang | `b64167cc-67f7-4f58-863a-a9107f0356bb`（11-20 17:44–17:53） | partial | 39/123/2/1 | 2025-11-17～2026-11-17（25 条） | 1 篇 `TOO_LARGE`；附件 87/86 | 20 | fixture 通过 | 基本可用 |
| 20 | jinan | `b1d95c1a-2a9a-419f-bf4b-64ac6f22f7ca`（11-20 17:44–17:52） | structure_changed | 80/113/0/1 | 2026-04-16～2026-11-10（15 条） | 1 篇相对地址来自提示文本导致失败；附件 80/34；岗位表 7/0；`skipped` 46 | 42 | fixture 通过 | 附件大面积缺失 + 1 条正文解析异常；先修提示文本被当作 URL 的分支 |
| 21 | yantai | `c005708b-63fe-4018-9375-90c93df39529`（11-20 17:44–17:50） | succeeded | 85/85/0/0 | 2024-03-19～2026-11-20（15 条） | **附件 128、快照 0；岗位表 12、快照 0**；`skipped` 128 | 6 | fixture 通过 | 运行成功但材料全缺；需核对 jpaas 附件端点与白名单 |
| 22 | weifang | `6b76d72e-2586-4609-8355-18d364c094ff`（11-20 17:44–17:44） | structure_changed | 0/0/0/0 | **11-21 live POST 通过：20 条/页，49 页；2026-09-30～11-16；详情 xlsx 200** | 生产 0 文档 | 0 | 实时回放 4/4 通过 | 同福州：需单来源复跑并核对接口响应判定 |
| 23 | taian | `355e482d-f4e5-4adc-8062-bce38f279522`（11-20 17:44–17:51） | blocked | 227/380/7/8 | 首屏 45 条（datastore 总 227），列表无日期字段 | 6 次 `captcha_challenge` + 2 次 `HOST_NOT_ALLOWED`；附件 168/167 但下载被验证码拦截 | 97 | fixture 通过 | 人工介入；不绕过验证码，保留 blocked 与人工补录入口 |
| 24 | zhengzhou | `4820cd85-6cb1-47b5-ab86-e7bae6862441`（11-20 17:44–17:53） | partial | 35/84/0/1 | 2026-10-12（首屏 10 条；4 页共 35） | 1 篇 `TOO_LARGE`；附件 50/49；岗位表 10/10 | 15 | 实时回放 4/4 通过 | 新版 `.jhtml` 列表/详情有效；补超大正文上限 |
| 25 | wuhan | `0dd620f0-59c7-4171-b805-95bb8f82181a`（11-20 17:44–17:45） | blocked | 0/0/0/0（`forbidden`） | **11-21 live GET 200：10 条；2026-09-15～11-19；详情 PDF 200** | 生产 0 文档 | 0 | 实时回放通过 | 生产 blocked 早于本轮验证；需单来源复跑确认反爬是否已解除 |
| 26 | changsha | `3610fe95-0602-4496-acad-aeb9c4fb03cc`（11-20 17:44–17:55） | structure_changed | 118/225/11/2 | 2025-03-30～2026-11-16（15 条） | 1 篇 `div.content-main` 空；1 篇 `TOO_LARGE`；附件 120/119 | 64 | fixture 通过 | 少量正文失败；按 2 条失败 URL 修样本 |
| 27 | guangzhou | `5d55745a-b71e-420e-a47e-c1234a4346ac`（11-20 17:44–17:53） | succeeded | 120/192/0/0 | 2026-10-08～2026-11-19（20 条） | 附件 72/72 | 49 | fixture 通过 | 通过 |
| 28 | guiyang | `c00560d5-0cf3-4c42-b75c-6db85c2e56ff`（11-20 17:44–17:56） | structure_changed | 277/505/9/18 | 2026-08-18～2026-10-17（15 条） | 多篇 `div.TRS_UEDITOR` 空/缺 A；附件 255/251 | 115 | fixture 通过 | 主体可采，详情失败 18 需按样本修复 |

汇总：28 个招聘来源最新运行 10 `succeeded`、6 `partial`、10 `structure_changed`、2 `blocked`；0 条 `published` 审核记录。生产累计 4,537 文档、2,248 公告、4,010 快照；28 个招聘来源 `pending_review` 合计 1,243（加上政策来源 14、人工来源 4，共 1,261）。

### 11.3 B. 重点异常报告

每项按「复现证据 → 影响范围 → 原因/假设 → 本地修复与测试 → 仍需线上验证」记录。

**福州（fuzhou-education）**
- 复现：生产 run `a14b3ceb…` 于 11-20 17:44 开始、17:45 结束，`0/0/0/0`，错误 `公开栏目接口未返回有效 data.html`。11-21 本地按适配器同一路径 `POST https://jyj.fuzhou.gov.cn/fjdzapp/search`（`channelid=229105&chnlid=47610&page=1`，同源 Referer）返回 15 条；接口声明 `pageCount=178`、`recordCount=2659`；首屏日期 2026-10-21～2026-11-19；抽查详情 `docx` 返回 200。
- 影响：生产该来源 0 文档、0 公告。
- 原因：生产失败发生在适配器部署/生效窗口之前或接口响应判定分支未命中；本轮 live 已证明当前公开入口可用，但不能据此认定生产配置已正确。
- 修复与测试：现有 `fz-list` 与适配器离线 fixture 通过；实时回放 4/4（福州/潍坊/苏州/郑州）通过。
- 待线上：暂停解除后单来源复跑，记录新 `runId`；若仍返回空 `data.html`，核对 Referer、`classsql` 与响应 JSON 结构。

**潍坊（weifang-education）**
- 复现：生产 run `6b76d72e…` 于 11-20 17:44 开始并立即结束，`0/0/0/0`，错误同上。11-21 本地 `POST https://jyj.weifang.gov.cn/els-service/article/1/20?catas=trs1308521&dwid=55332&dq=162` 返回 20 条、`totalPages=49`；首屏 2026-09-30～2026-11-16；详情 `xlsx` 200。GET 仍为 405，与“栏目只接受 POST”一致。
- 影响：生产该来源 0 文档。
- 原因：适配器 POST 通道可用；生产失败更像部署前状态或响应判定过严，而非上游结构变化。
- 修复与测试：`els-list` fixture 通过；实时回放通过。
- 待线上：单来源复跑；确认 GET 405 不会被误判为结构变化。

**苏州（suzhou-education）**
- 复现：11-20 回放 `xxgk_list.shtml` / `_2` / `_3` 均 200，34 条（15/15/4），最新 2025-03-12、最旧 2013-05-16；11-21 复核同一栏目仅 2 条可确认日期，仍为停更状态。生产最新 run `9dd3b2db…` 已 `succeeded`，34 发现、42 下载。
- 影响：运行技术成功，但 2026 年活跃教师招聘公告不在该栏目。11-21 核验到 `hrss.suzhou.gov.cn/jsszhrss/gsgg/` 存在 2026-04-22 教师 26 名、2026-05 高层次毕业生 20 名、2026-03 常熟教师公告，岗位表 PDF 可访问。
- 原因：**配置性缺口**，不是适配器解析缺陷。
- 修复与测试：本轮不迁移来源；建议新增市人社局来源或把 `listUrls` 指向活跃栏目，并重新做分页/详情/附件回放。
- 待线上：确认新栏目 `sourceId`、`allowedHosts`、分页窗口后再登记；旧来源保留历史但不计入活跃覆盖。

**宁波 / 鄞州（ningbo-education / yinzhou-government）**
- 复现：两来源最新 run 均 `succeeded`（宁波 34 发现、鄞州 74 发现）。附件计数宁波 33/33、鄞州 56/52，但岗位表 URL 在运行审计中为 `skipped`，原因 `blocked_endpoint:path`（`api-gateway/jpaas-web-server/front/document/download`）；已入库快照为约 102 字节 `访问过于频繁，请稍后再试` HTML。11-21 直接请求同一 URL 可返回真实 `xlsx`（`PK` 头），但内容哈希与快照不同。
- 影响：**运行成功但岗位表缺失**；宁波 8/8 岗位表、鄞州 4/4 岗位表均不可读。
- 原因：官方附件端点反爬/会话校验；旧代码把 200 HTML 限流页当作成功附件入库。
- 修复与测试：已修改 `document-fetch.service.ts`：附件扩展名为二进制但 magic bytes 判定为 `html` 时返回 `failed` + `ATTACHMENT_HTML:rate_limited_or_antibot`，不建快照；`task-queue.ts` 将该错误纳入瞬时可重试；新增回归测试断言 `snapshots=0`、`objectStore.writes=0`、`document.parse=0`，专项 16/16 通过。
- 待线上：复跑后坏快照需人工清理或由新逻辑重采；官方端点仍需授权会话/人工补录，不能靠放宽 allowlist。

**武汉 / 泰安（wuhan-education / taian-education）**
- 武汉：生产 run `0dd620f0…` 于 11-20 17:44 立即 `blocked`（`forbidden`）；11-21 live `GET https://jyj.wuhan.gov.cn/zwdt/tsgg/` 200、首屏 10 条、2026-09-15～11-19，详情 PDF 200。结论：生产 blocked 早于本轮验证，需单来源复跑。
- 泰安：生产 run `355e482d…` 为 `blocked`，227 发现、380 下载、8 失败；6 次 `captcha_challenge`。11-21 官方 datastore 仍为 227 条、首屏 45 条，最新 2026-11-19；附件下载触发验证码。结论：保持 blocked，不绕过；附件缺口记录为材料不完整，寻找同机构公开替代渠道或人工补录。

**嘉兴 / 丽水 / 萧山 / 亳州 / 石家庄 / 阜阳**
- 嘉兴：11-21 jpaas `data.html` 未解析出条目，与生产 `structure_changed` 一致；附件 152、快照 137（限流 HTML）、`skipped` 135；附件事项失败 34。属上游结构/响应变化，需用最新样本重定解析。
- 丽水：`HOST_NOT_ALLOWED` 38（含 `rsj.lishui.gov.cn` 48 次、`mp.weixin.qq.com` 8 次），附件 99、快照 70、`skipped` 33；属跨域/白名单与附件不可读叠加。
- 萧山：`structure_changed`，173 发现、0 下载、失败 20（含 HTTP 404 与白名单），附件 274、快照 254（多为限流 HTML）、`skipped` 59；正文与附件双重缺口。
- 亳州：`structure_changed`，5 篇“正文缺少标题、日期或正文”，1 条跨站 `www.sxx.gov.cn` 被拒；附件 194/193。
- 石家庄：`structure_changed`，10 篇 `div.content_fenye2` 空；附件 57/53、4 无快照；列表需 POST 才能取到首屏，因此 11-21 静态探测为 0 条。
- 阜阳：`partial`，仅 1 条 `HOST_NOT_ALLOWED`（`rsj.fy.gov.cn`）；附件 108/108，主体可用。

**郑州（zhengzhou-education）**
- 复现：生产已登记 `https://zzjy.zhengzhou.gov.cn/tzgg/index.jhtml`，最新 run `4820cd85…` 为 `partial`（35 发现、84 下载、1 `TOO_LARGE`）。11-21 live 复核 `.jhtml` 首屏 10 条、4 页共 35 条、最新 2026-10-12；详情 `xlsx` 200；旧站 `news.zzedu.net.cn` 仍在 `allowedHosts`。
- 结论：新版入口与分页/详情解析对应一致；只需处理超大正文上限，不存在入口漂移。

**北京 / 重庆（本地扩源，不计入生产 28）**
- 北京：`https://rsj.beijing.gov.cn/xxgk/gkzp/` 三页各 12 条，页间重叠 0；第 1 页 2026-11-18 起，第 2/3 页日期递降；适配器 spec 5 项通过。
- 重庆：`https://rlsbj.cq.gov.cn/zwxx_182/sydw/` 使用 `sydwgkzp2026` 年度子目录；详情 `hasFJ` 含 2 个 `xlsx`（岗位一览表、专业目录），下载 200 `PK`；适配器 spec 5 项通过。
- 二者均未发布镜像、未登记生产、无真实首采 `runId`；市级综合栏目只按实际发布范围记录，不替代市/区教委独立栏目。

### 11.4 C. 覆盖结论与后续清单

| 指标 | 结果 | 说明 |
|---|---|---|
| 省级行政区目录登记 | 31 / 31 | 目录行齐全，不等于招聘栏目已核验 |
| 有本地招聘适配器的省级行政区 | 15 / 31 | 浙江、江苏、安徽、山东、江西、山西、河南、福建、广东、河北、湖北、湖南、贵州、北京、重庆 |
| 生产已登记招聘来源 | 28 | 覆盖 13 个省级行政区；另有 1 个政策来源、4 条人工补录 |
| 生产已登记来源总数 | 33 | 28 招聘 + 1 政策 + 4 人工（松江、大田、黄石、玄武，均 disabled/degraded） |
| 真实采集已核验 | 28 / 28 | 均有 2026-11-20 补跑窗口的 run 记录；10 succeeded、6 partial、10 structure_changed、2 blocked |
| 材料完整可读 | 未达标 | 2,225 个附件文档中 340 个无快照，572 个最新快照为 `text/html`（萧山 254、嘉兴 137、丽水 70、鄞州 52、宁波 33、杭州 18） |
| 持续运行通过 | 0 / 28 | 7 天观察未完成；本轮不标记任何来源持续通过 |
| 无生产招聘来源的省级行政区 | 16 | 天津、内蒙古、辽宁、吉林、黑龙江、上海（仅人工松江）、广西、海南、四川、云南、西藏、陕西、甘肃、青海、宁夏、新疆 |

已登记但验收未完成的来源：28 个招聘来源全部尚未达到“材料完整 + 持续运行通过”；其中福州、潍坊、武汉需复跑，苏州需迁移活跃栏目，宁波/鄞州需解决岗位表，湖州/丽水/烟台/济南/泰州/杭州/萧山/嘉兴需补附件，泰安需人工介入，亳州/石家庄/长沙/贵阳需修详情选择器。

后续优先级（恢复生产后按此顺序，单来源、小批次、可回滚）：
1. 福州、潍坊、武汉：单来源复跑，记录新 `runId` 与日期覆盖；每站只跑最新窗口。
2. 苏州：新增/迁移市人社局活跃栏目，完成分页、详情、岗位表回放后再登记。
3. 宁波、鄞州：用授权会话或人工补录修复岗位表；复跑时确认不再写 102B HTML 快照。
4. 湖州、丽水、烟台、济南、泰州：核对附件端点与白名单，优先同源官方替代；无法自动获取的转人工。
5. 嘉兴、萧山：用 2026-11 样本重定列表/正文/附件解析。
6. 石家庄、亳州、长沙、贵阳：按失败 URL 逐条修正文选择器。
7. 泰安：保持 blocked，人工补录或等待官方取消验证码。
8. 北京、重庆：发布镜像、登记来源、单来源首采，再做 7 天观察。
9. 人工来源：松江补岗位表（若有独立链接）、大田补 3 个附件与三部门发布单位、黄石补岗位表并核对已截止报名时间、玄武去重/停用。

### 11.5 D. 文档、代码与测试记录

- 代码修改（仅 3 个文件）：
  - `backend/src/sourcing/jobs/document-fetch.service.ts`：附件按 magic bytes 识别格式；二进制扩展名却返回 HTML 时判失败，避免限流页入库。
  - `backend/src/sourcing/jobs/task-queue.ts`：`ATTACHMENT_HTML` 纳入瞬时错误，允许退避重试。
  - `backend/src/sourcing/jobs/document-fetch.spec.ts`：新增“附件 URL 返回 200 HTML 限流页”回归，断言不建快照、不写对象存储、不投递解析。
- 测试命令与结果：
  - `npm --prefix backend test -- src/sourcing/jobs/document-fetch.spec.ts` → 16/16 通过。
  - `npm --prefix backend test -- src/sourcing` → 39 个测试文件通过，458 项通过，2 项跳过（修复前基线为 457 通过）。
  - 2026-11-21 实时回放：福州、潍坊、苏州、郑州 4/4 通过；北京 5/5、重庆 5/5（均为本地隔离样本/公开页面）。
- 证据位置：生产只读查询结果与 live 样本为本轮临时证据，关键数值已写入本节；临时目录不随仓库交付。官方 URL、页码、样本标题/日期与响应类别见 11.2.2、11.3。
- 生产状态：容器内 `CRAWL_SCHEDULER_ENABLED=false`、`CRAWL_WORKER_PAUSED=false`；查询时队列 `waiting/active/delayed=0`、`failed=8`。需特别说明：9.4 节记录的积压 waiting=2,753 已在恢复后被 Worker 消费，多条长任务于 11-21 08:03–08:06（北京时间）完成；因此本轮**不能声称“积压队列保持不变”**。本轮未恢复调度、未清空队列、未删除历史公告/快照；建议在下一次操作前重新确认暂停状态并查明 Worker 恢复消费的原因。
- 未执行：生产复跑、生产登记变更、镜像发布、北京/重庆首采、7 天持续观察。
