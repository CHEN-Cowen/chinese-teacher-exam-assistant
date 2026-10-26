# 官方来源黄金样本

首批官方教师招聘来源的最小样本，用于 `backend/src/sourcing/adapters/*.adapter.ts`
的解析测试输入与离线回放。

南京、杭州、宁波、鄞州四个来源的样本在 S4 建立；S5 追加绍兴、嘉兴、苏州、常州、丽水，
并为全部 9 个 ready 来源补齐 `public-*` 真实快照（外壳页 / 列表 / 分页 / 正文 + manifest）。
S5 遗留任务 1 补源再追加蚌埠、萧山（对应 `public-*` 快照 + manifest），
当前 ready 来源共 11 个。

## 脱敏与使用规则

- 南京样本的 `list.html`、`detail.html`、`gw1.pdf`、`gw2.pdf` 来自南京市教育局公开历史页面，供离线回放；
- 杭州、宁波、鄞州 HTML 样本经过人工最小化与脱敏：删除真实人员姓名、联系方式、附件二进制链接，
  只保留 Adapter 定位所需的 DOM 骨架与一条代表性公告条目；
- 杭州、宁波、鄞州样本中的 URL 虽使用真实官方域名，但路径和内容为测试样本，
  不作为真实抓取目标或真实验收结果；
- S5 新增来源的 `public-*` 快照是**真实抓取**结果，manifest 记录了原始 URL、抓取时间
  与每个文件的 sha256，用于复算校验；正文与附件链接指向真实官方地址，
  但样本内容仅供离线回放，不得作为生产目录的数据来源；
- 样本会过期：官网改版后必须重新取样并同步更新对应 Adapter 测试；
- 本目录只服务测试，不得被 `src/` 或 `backend/src/` 生产代码引用，
  也不得作为生产目录的数据来源（隔离由 `tests/fixtures/isolation.test.ts` 守护）。

## 目录结构

| 来源 | 目录 | 文件 | 对应真实入口（核对用，非抓取指令） |
|---|---|---|---|
| 杭州 | `hangzhou/` | `list.html` 列表页 + `detail.html` 公告正文页 | 杭州市教育局教师招聘栏目 |
| 宁波 | `ningbo/` | `list.html` + `detail.html` | 宁波市教育局通知公告栏目 |
| 鄞州 | `yinzhou/` | `list.html` + `detail.html` | 鄞州区教育局/人社局招聘栏目 |
| 南京 | `nanjing/` | `list.html` + `detail.html` + `gw1.pdf` + `gw2.pdf` | 南京市教育局教师招聘栏目 |
| 绍兴 | `shaoxing/` | `public-*` 真实快照 | 绍兴市教育局「教师招聘」专栏 |
| 嘉兴 | `jiaxing/` | `public-*` 真实快照 | 嘉兴市教育局「人才招聘」专栏 |
| 苏州 | `suzhou/` | `public-*` 真实快照 | 苏州市教育局人事信息公示 |
| 常州 | `changzhou/` | `public-*` 真实快照 | 常州市教育局教师招聘栏目 |
| 丽水 | `lishui/` | `public-*` 真实快照 | 丽水市教育局「人事招聘」专栏 |
| 蚌埠 | `bengbu/` | `public-*` 真实快照 | 蚌埠市教育局「教师招聘」专栏 |
| 萧山 | `xiaoshan/` | `public-*` 真实快照 | 杭州市萧山区人民政府「教师招考」专栏（jpaas 公开接口） |

## `public-*` 真实快照说明（S5）

| 文件 | 内容 |
|---|---|
| `public-shell.html` | 栏目外壳页（含 jpaas 公开接口的 queryData，或服务端渲染静态列表） |
| `public-list.json` / `public-list.html` | 首屏列表真实响应 |
| `public-page2.json` / `public-page2.html` | 第 2 页真实响应（验证分页协议） |
| `public-detail.html` | 公告正文真实页面 |
| `public-manifest.json` | 列表侧快照清单：抓取时间、原始 URL、每个文件 sha256 |
| `public-detail-manifest.json` | 正文侧快照清单 |

manifest 顶层字段：

- `capturedAt`：真实抓取时间（ISO 8601），各来源不同；
- `sourceKind`：`official-live-snapshot`；
- `scope`：快照覆盖范围（如 `first-page-discovery-only`），不夸大覆盖；
- `stableMonitoringVerified`：快照文件本身只证明「那一次抓到了什么」，
  **不**等于来源已在持续监测。来源能不能声称正常监测，只看
  `backend/src/sourcing/source-monitoring.ts` 从检查记录推导的状态。
  2026-10-26 第二次真实采样之后，11 个 ready 来源的检查记录已达连续成功阈值。

## Adapter 开发约定（WP4 实施时阅读）

1. 每个 Adapter 必须先用本目录样本通过离线解析测试，再允许访问真实官网；
2. 列表页解析目标：标题、发布时间、详情页 URL（相对路径必须能正确解析为绝对 URL）；
3. 正文页解析目标：正文文本、发布时间、附件链接（文件名 + URL）；
4. 选择器失配必须抛出明确错误（Adapter DOM 变化明确失败，PRD 8.2），
   不允许静默返回 0 条——静默 0 条视为故障（PRD 7.13）。
