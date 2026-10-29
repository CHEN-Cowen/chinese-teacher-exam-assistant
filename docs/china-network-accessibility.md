# 中国大陆普通网络可访问性基线

更新日期：2026-10-05（模块 9 收口：P0 闭环 E2E、断跨源回归、家庭宽带与手机蜂窝真实网络冒烟均已实测通过；公开备案域名仍未落地，受邀地址实测继续待办）
适用对象：少量受邀用户（5—30 人）使用的 v6.1 试用环境。
本文是**运行时外部依赖的登记册与验收方法**。部署拓扑与环境变量见 [`../DEPLOYMENT.md`](../DEPLOYMENT.md)；本文不提供绕过 ICP 备案或网络限制的方案。

## 1. 硬性要求

1. 受邀用户在中国大陆普通家庭宽带与手机网络（4G/5G）下，**不使用 VPN/代理**即可打开核心页面、登录并调用 API。
2. 字体、图标、脚本、样式、关键图片随应用部署，或来自本文第 4 节明确允许的境内地址；不以 Vercel、Google Fonts、GitHub Raw、unpkg、jsDelivr 等境外地址作为运行依赖。
3. 浏览器只调用同源 `/api/*`；数据库、对象存储、AI/OCR、短信等一律由后端访问，密钥不进入浏览器。
4. 官方公告外链允许保留（它们是用户主动点击的第三方页面），但外链打不开只能提示“暂时无法打开来源”，不得导致产品页面白屏或不可用。
5. AI/OCR 供应商必须在中国大陆可稳定直接访问，并核验数据处理条款；供应商故障时回退为人工录入/审核，核心流程不依赖第三方实时可用性。
6. 面向中国大陆公开域名提供服务前，必须完成 ICP 备案并启用 HTTPS；备案完成前只做本地或内部演示。

## 2. 基线审计结果（2026-10-04，模块 0A 已落地）

> 结论：**代码侧已达到受邀环境网络基线**——干净构建不请求任何境外字体/CDN，浏览器运行时只出现同源请求。**境内部署侧（域名、ICP 备案、云资源）尚未发生**，因此“中国大陆普通网络实测”目前只能登记为待验证，不得宣称“国内可用”，见第 6 节。

| 检查项 | 整改后现状 | 结论 |
|---|---|---|
| 字体 | 已删除 `layout.tsx` 对 `next/font/google`（Geist / Geist_Mono）的引用与字体变量；`globals.css` 使用跨平台系统字体栈（`-apple-system` / PingFang SC / Microsoft YaHei / Noto Sans CJK SC 等设备自带字体），新增 `--font-mono`；品牌字体须放 `public/` 本地加载 | ✅ 已整改，构建与运行时零网络字体请求 |
| CSP | `img-src` 已去掉 `https:` 通配，收紧为 `'self' data: blob:`；新增 `frame-src 'self'`；`default-src/connect-src/font-src` 全部同源；产品无 `<img>`/`next/image` 外链，官方外链仅 `<a target="_blank">` 用户点击 | ✅ 已在生产响应头实测，见第 6.2 节 |
| 接口 | 浏览器仍只经同源 `/api/*`（`src/app/api/[...path]/route.ts`）访问，服务端注入 `x-internal-token`；冒烟实测网络面板无 `127.0.0.1:3001` 等后端地址，上游对浏览器不可见；无密钥时后端返回 401 | ✅ 已实测 |
| 静态资源 | 删除了 create-next-app 遗留且未引用的 5 个模板 SVG（含 vercel.svg/next.svg）；`public/` 仅 `robots.txt`；favicon 由框架随同源产物提供；Tailwind 为构建期打包 | ✅ 已整改 |
| 外链 | 种子/表单中的政府与示例 URL 只作为数据文本与用户主动点击链接（`rel="noopener noreferrer"`），加载时不自动请求；扫描器将其归类为 external-click 只登记不阻断 | ✅ 保持，失败提示在后续产品模块落地 |
| AI/OCR/存储 SDK | 前端无任何第三方 SDK；“提取”仍为本地 Mock。接入前置条件：后端先定义 Provider 接口、仅配置境内可直连且条款可接受的供应商、故障回退人工录入/审核 | 🚧 未接入，约束见第 4 节 |
| 可重复检查 | 新增 [`scripts/external-deps-scanner.mjs`](../scripts/external-deps-scanner.mjs) 与 CLI `npm run check:external`；`postbuild` 自动扫描构建产物；Vitest 守卫测试 10 个（含报警器自检、客户端密钥泄漏检查） | ✅ 已落地 |
| 运行时断跨源回归（模块 9 新增） | Playwright 脚本 [`../.qa-harness/m9-blocked-runtime.mjs`](../.qa-harness/m9-blocked-runtime.mjs)：在浏览器上下文阻断**全部**跨源请求，遍历首页/登录/机会/日程/备考/管理审核 6 个页面执行核心操作，并断言过程中无任何跨源尝试；P0 闭环脚本 `m9-p0-flow.mjs` 与真实网络冒烟 `m9-cn-smoke.mjs` 同批交付 | ✅ 2026-10-05 已在全栈环境执行：用户侧 7/7、管理侧 2/2、P0 闭环 23/23，真实网络冒烟见第 6.3 节 |
| 后端 | `main.ts` 支持 `HOST`（同机裸进程绑 127.0.0.1）与 `TRUST_PROXY`；Prisma 启动连库失败不再拖垮进程，`/health` 可如实返回 degraded | ✅ 已实测 |
| 演示部署 | Vercel 静态部署（境外平台）仍存在，仅供功能展示 | ⚠️ 非受邀依赖；2026-10-05 在中国移动宽带/蜂窝直连（`curl --noproxy`）实测预览域名 `frontend-lv1m8jp8o-exam-test.vercel.app` 连接超时（8s 无响应），普通大陆网络不可达，不承诺、不用于受邀试用 |
| 邀请环境域名/备案/HTTPS | 尚未配置 | 🚫 前置事项未完成前不对公众开放 |

### 2.1 本次删除的境外运行时依赖

- `next/font/google` 的 Geist、Geist_Mono（构建期拉取 `fonts.googleapis.com` / `fonts.gstatic.com`，在大陆普通网络可能超时阻断构建）；
- 未使用的模板静态资源 `public/{file,globe,next,vercel,window}.svg`（本地文件，但含第三方品牌与无关引用，一并清理）。

### 2.2 本次未发现的依赖（审计结论，持续由扫描器看护）

- 无 Google Fonts 之外的境外字体/脚本/样式 CDN（unpkg、jsDelivr、cdnjs、Skypack、esm.sh、BootstrapCDN、GitHub Raw 等）；
- 浏览器侧无 `fetch`/XHR/WebSocket/第三方 SDK（全仓唯一 `fetch` 位于 Next 服务端反代路由）；
- 无外部图片、追踪脚本、广告与统计 SDK。

## 3. 外部依赖三分类

登记新依赖时必须先归类，再决定是否允许：

| 分类 | 定义 | 审批要求 |
|---|---|---|
| 产品必要运行依赖 | 核心页面加载/登录/接口流程中浏览器或服务端自动请求的资源（字体、脚本、API、存储、AI/OCR） | 必须境内可直连；进入第 4 节允许清单；失败要有降级方案 |
| 用户点击的官方外链 | 公告原文、政府网站、报名入口等用户主动跳转的链接 | 无需同源，但必须新窗口打开、标注离开产品、失败可提示 |
| 开发/构建期依赖 | npm 包、构建工具、类型定义等，只出现在构建环境 | 不进入浏览器运行时即可；构建机网络问题用境内镜像解决，不改变运行时清单 |

## 4. 运行时允许域名清单（受邀环境）

### 4.1 当前实测清单（2026-10-04，本地生产构建冒烟）

扫描范围：`frontend/src`、`frontend/public`、根配置文件、`.next` 构建产物与浏览器网络面板。

| 分类 | origin | 用途 | 状态 |
|---|---|---|---|
| 产品必要（同源） | `http://localhost:3000`（本地） / `https://<已备案产品域名>`（受邀） | 页面、脚本、样式、字体、图片、`/api/*` 接口、favicon | 浏览器侧唯一允许的自动加载来源 |
| 用户点击外链 | `*.gov.cn` 及各地人社/教育部门官网、`*.edu.cn` 等 | 公告原文、报名入口；`<a target="_blank" rel="noopener noreferrer">`，不自动加载 | 允许，扫描器只登记不阻断 |
| 用户点击外链（地图） | `uri.amap.com`（高德 URI API 网页搜索） | v7.1 M5 地图轻量入口「在地图中查看 ↗」；`<a target="_blank" rel="noopener noreferrer">`，点击前零地图资源请求，不内嵌 SDK、不申请定位；不可达不影响页面 | 允许，扫描器只登记不阻断 |
| 用户点击外链（示例数据） | `www.example*.com/.cn/.org`、`pan.example.invalid` 等占位域名 | 演示种子中的占位值 | 仅 demo 数据 |
| AI/OCR | 无 | — | 未接入；见 4.3 接入前置条件 |
| 对象存储 | 无 | — | 未接入；未来浏览器只接受后端签发的短时 URL，桶域名不进 CSP |
| 阻断清单 | `fonts.googleapis.com`、`fonts.gstatic.com`、`ajax.googleapis.com`、`unpkg.com`、`jsdelivr.net`、`cdnjs.cloudflare.com`、`maxcdn.bootstrapcdn.com`、`stackpath.bootstrapcdn.com`、`cdn.skypack.dev`、`esm.sh`、`raw.githubusercontent.com`、`camo/avatars/objects.githubusercontent.com`、`use.fontawesome.com`、`fonts.fontawesome.com` | 浏览器自动加载即判失败（相等或子域后缀匹配） | 由扫描器与测试硬阻断 |

注：SVG 文件中的 `http://www.w3.org/2000/svg` 是 XML 命名空间标识符，浏览器不会发起网络请求；该批模板 SVG 已删除。

### 4.2 CSP 与清单的维护规则

- 生产 CSP 现状（已在响应头实测）：`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`。
- 新增任何浏览器自动加载的境内 origin：先在本节登记“用途、供应商、失败降级”，再在 `next.config.ts` 对应指令中逐项加入；禁止重新使用 `https:` 通配。
- `script-src 'unsafe-inline'` 是 Next 引导脚本的临时让步，后续改 nonce 方案时收紧，不新增大范围通配。

### 4.3 AI/OCR/存储接入前置条件（未发生，先立规则）

1. **接口先行**：后端先定义 Provider 接口（候选字段、证据位置、置信度、错误码、超时与重试），业务代码依赖接口而非供应商 SDK；前端永不直连。
2. **供应商准入**：只配置在中国大陆可直接稳定访问的服务；登记供应商、调用域名（服务端，不写入浏览器 CSP）、数据处理与留存条款；密钥只存在服务端环境变量。
3. **失败降级**：供应商不可用时公告录入回退为人工上传/录入，已发布数据正常展示；核心页面不得白屏，不得把 AI 候选当已审核事实。
4. 对象存储使用境内同地域私有 Bucket，服务端签发短时 URL；管理端口与密钥不对公网暴露。

## 5. 目标拓扑（受邀环境）

```text
浏览器（无代理）── HTTPS 同源 ──► Nginx（境内 ECS，备案域名）
                                   ├─ /        → Next.js
                                   └─ /api/*   → NestJS（内网/回环，公网不可直连）
                                                   ├─ PostgreSQL（内网）
                                                   ├─ 私有对象存储（境内，签名 URL）
                                                   └─ AI/OCR（境内 API，密钥仅服务端）
```

完整部署步骤、端口、安全组、环境变量与回滚见 [`../DEPLOYMENT.md`](../DEPLOYMENT.md) 环境 B。要点：后端、数据库、存储管理端口不对公网开放；管理后台路径在受邀环境也应受限。

## 6. 验收方法与实测记录

### 6.1 可重复执行的检查命令（模块 0A 已交付）

```bash
cd frontend
npm test                 # 含网络基线守卫：源码禁现境外 CDN、产物检查（构建后生效）、报警器自检
npm run build            # 干净构建；postbuild 自动执行下方扫描，失败则构建失败
npm run check:external   # 手动扫描 src/public/配置 + .next/static，并检查客户端密钥泄漏
```

- 阻断主机清单与客户端密钥标记维护在 [`scripts/external-deps-scanner.mjs`](../scripts/external-deps-scanner.mjs)；新增条目必须同步本文第 4 节。
- 守卫测试 [`scripts/external-deps-scanner.test.mjs`](../scripts/external-deps-scanner.test.mjs) 包含“报警器自检”：在临时目录放入 Google Fonts 引用时检查必须退出 1，防止规则自身失效。
- 扫描器不读取 `.env*`，不接触真实密钥；文档与脚本自身因说明需要提到被禁域名，已通过扫描范围（只扫 src/public/配置/产物）排除误报。

### 6.2 本地实测记录（2026-10-04，已验证）

环境：Windows，Next.js 生产构建（`NEXT_PUBLIC_APP_ENV=demo`）:3000 + NestJS `HOST=127.0.0.1:3001`（无数据库，验证降级），浏览器自动化实测。

| 验证项 | 结果 |
|---|---|
| 删除 `.next` 后干净构建 | 通过，编译 46s，全程无 `fonts.googleapis.com`/`gstatic` 请求；`.next/static/media` 仅自托管 favicon |
| 产物全文检索被禁域名 | 0 命中；postbuild 报告“阻断项 0、密钥泄漏 0” |
| 首页/登录/结果/管理页渲染 | 均正常；演示横幅存在；`/admin` 显示公开演示关闭提示 |
| 浏览器网络请求（100 个样本） | 全部 origin 仅 `localhost:3000`；无后端地址、无任何第三方 origin |
| 控制台 | 无 CSP 拦截、无字体加载失败、无 ERR_BLOCKED |
| 同源 API | 浏览器 `fetch('/api/health')` 经服务端反代返回 200 `{status:"degraded",db:"down"}`；直连后端无密钥返回 401 |
| CSP 响应头 | 与第 4.2 节一致；`X-Robots-Tag: none` 已下发 |
| 质量检查 | `npm test` 51/51 通过；`tsc --noEmit` 0 错误；`eslint` 0 错误（1 个既有 warning）；后端 `build`+`test` 通过 |

### 6.3 真实国内网络冒烟（网络层已验证；公开受邀地址待落地）

**状态分层（2026-10-05 实测）：**

- **网络链路层：已验证。** 两种普通大陆接入方式（中国移动家庭宽带、中国移动手机蜂窝热点）下，浏览器均以 `--no-proxy-server` 强制忽略系统代理（curl 侧用 `--noproxy '*'`；本机无 TUN/透明代理，默认路由仅家用网关，已排除代理干扰），产品核心链路全部通过，且产品页面零跨源请求。
- **受邀公开地址层：待验证。** 备案域名、境内 ECS、同地域数据库/对象存储均未落地（见 [`../DEPLOYMENT.md`](../DEPLOYMENT.md) 第 12 节前置事项），不存在可测的公网受邀地址。下列实测针对本地同源全栈（Next :3000 + NestJS :8081 + PostgreSQL 17）执行，验证的是"产品运行时不依赖任何境外/第三方主机、真实大陆网络下零跨源可跑通"；**不等于**"备案域名公开访问已验证"，后者仍须在部署后按本节末尾清单补测。

**实测记录（2026-10-05，操作：自动化脚本 + 人工切网）：**

| 接入方式 | 直连出口证据 | 实测项与结果 |
|---|---|---|
| 中国移动家庭宽带（ZTE 家用路由 Wi-Fi，无 VPN/代理） | IPv4 `223.101.29.15`（AS56044 China Mobile，浙江嘉兴）；IPv6 `2409:8a14:…`（移动） | `m9-cn-smoke.mjs` 5/5；`m9-p0-flow.mjs` 23/23（画像→登录→匹配→关注→准备报名→主目标→任务反馈全程）；`m9-blocked-runtime.mjs` 用户侧 7/7；产品页面跨源请求 0 |
| 中国移动手机蜂窝（手机个人热点「疯普拉斯」，用户确认移动 SIM） | IPv4 `223.104.176.8`（移动蜂窝 APN 段，AS56044，浙江嘉兴）；IPv6 `2409:8914:…`（移动） | 同上：`m9-cn-smoke.mjs` 5/5、`m9-p0-flow.mjs` 23/23、`m9-blocked-runtime.mjs` 用户侧 7/7；产品页面跨源请求 0 |
| 管理审核侧（非 demo 构建，家庭宽带网络） | 同上家庭宽带出口 | `m9-blocked-runtime.mjs admin` 2/2：考情审核队列可读、零跨源（demo 构建按产品设计关闭 `/admin`，故管理侧只能在非 demo 构建验证） |

**同期网络旁证：**

- 真实官方站点类目标（产品外链的同类目标）：浏览器直连打开 `https://www.hangzhou.gov.cn/` 成功（标题"杭州市人民政府门户网站"，0.54s，IPv6 移动可达）。种子内 `*.example.gov.cn` 是占位数据，任何网络都不可达，属预期；个别省级/区级站点对裸 curl 超时（站点自身反爬/兼容策略），产品外链是真实浏览器新窗口跳转且不阻塞页面，不构成运行依赖。
- 境内后端可达性：直连阿里云 `http://47.101.32.47:8081/health` 0.13s 返回 401（无内部令牌，预期），证明大陆普通网络到境内云主机链路畅通。
- Vercel 预览地址直连超时（见第 2 节演示部署行），不作为受邀环境。
- 阻断清单域名（Google Fonts、cdnjs、unpkg、jsDelivr、raw.githubusercontent 等）在当前移动网络下部分可被解析/应答（例如 `fonts.googleapis.com` 被解析到移动地址 `120.253.253.161` 并由中间设备应答）。**产品策略不依赖这些域名在网络层被墙**：扫描器硬阻断 + 运行时零跨源双重保证产品从不请求它们，其偶然可达不影响结论，未来被封也不影响产品。

**公开受邀地址上线后仍须补测（继续待办，不得提前宣称）：**

- 备案域名 HTTPS 首页 → 登录 → 机会列表 → 机会详情 → 日程 → 备考任务 →（工作人员）审核页 → `/api/health`，家庭宽带与至少一家运营商 4G/5G 关代理各一次；
- 记录各路径首屏耗时、失败请求、网络面板全部 origin、是否有非清单内请求；结论写"已验证（网络/运营商/时间/操作人）"。

### 6.4 故障降级演练

- AI/OCR 供应商不可达：公告提交页可改人工录入/上传，用户端正常显示已发布数据（当前 AI 未接入，接入时必须先演练）；
- 官方外链 404/超时：仅提示“暂时无法打开来源”，页面其余内容正常（外链失败提示文案随产品模块落地，当前外链均为新窗口跳转，不阻塞页面）；
- 后端不可达：前端反代返回真实失败状态（`{error:"upstream unreachable"}`），不白屏、不静默回退 Mock（demo 模式除外）；
- 数据库不可达：后端进程不崩溃，`/health` 返回 degraded，Prisma 在首次查询时重试（2026-10-04 已实测）。

### 6.5 模块 9 代码侧复核（2026-10-05）

| 验证项 | 结果 |
|---|---|
| 前端全量单测 | 通过：21 个测试文件、157 用例全部通过（含网络基线守卫与模块 9 高风险回归；注意测试与 `next dev` 并发时扫描产物可能读到临时文件误报，停掉 dev server 后复跑即 157/157） |
| 外部依赖静态扫描 | 随 `npm test` 与 `postbuild` 执行：阻断项 0、客户端密钥泄漏 0；v6.1 新增页面/组件未引入任何境外运行时引用 |
| TypeScript / ESLint / 生产构建 | `tsc --noEmit` 0 错误；`eslint` 0 错误（1 个既有 warning，在 `src/app/api/[...path]/route.ts`，与本轮改动无关）；`next build` + postbuild 干净通过 |
| 运行时断跨源回归脚本 | `.qa-harness/m9-blocked-runtime.mjs` 已执行：用户侧（home/画像/登录/机会/日程/备考）7/7；管理侧（非 demo 构建，考情审核队列）2/2 |
| P0 闭环脚本 | `.qa-harness/m9-p0-flow.mjs` 已执行：23/23（画像→机会→登录→逐项依据→关注→日程→准备报名→主目标→开始任务反馈 + 7 个必需 live 事件、`follow_status_changed to=preparing`、live 事件未被误标 seed） |
| 受邀模式（invited）真实联调 | `.qa-harness/m9-invited-flow.mjs` 已执行：29/29（服务端登录、错误密码拒绝、HttpOnly 会话、刷新恢复、画像迁移后服务端匹配、关注→准备报名→主目标→任务反馈、账号间数据隔离、登出失效、全程无 `x-user-*` 伪造头）；修复 5 个受邀链路真实缺陷后全绿，见第 6.6 节 |
| CSP | 与第 4.2 节一致（`next.config.ts`），v6.1 开发期间未放宽 |

### 6.6 本轮 E2E 发现并修复的真实缺陷（2026-10-05）

demo 链路（第 1—2 项）：

1. **demo 模式登录后业务接口全部 401**：后端身份解析要求 `x-user-id` 与 `x-user-role` 同时存在，而前端 `src/lib/schedule/api.ts` 与 `src/lib/opportunities/api.ts` 仅发送 `x-user-id`。两处已补齐为按会话角色发送双头（invited 模式维持不带身份头）。修复前 P0 闭环在关注/日程/计划环节必断。
2. **详情页首屏主行动"标记为准备报名"漏埋点**：该按钮原来直接调 `transition("preparing")`，绕过了统一的 `handleTransition`，导致 P0 漏斗事件 `follow_status_changed` 缺失。已改为共用统一流转处理。

invited 链路（第 3—7 项，首次真实运行 exposed）：

3. **invited 登录永远失败**：`validateCredentials` 按邮箱查 `credential.userId`，但 `User.id` 为 uuid（`createUser` 未传 id），凭证外键永远不等于邮箱。已改为按 users.email 唯一约束定位用户并 include credential，保持等耗时的防时序比较。
4. **invited 模式模块循环依赖（TDZ 崩溃）**：`HttpAuthProvider → profileApi → @/lib/auth → instance → HttpAuthProvider`，页面渲染即 `Cannot access 'HttpAuthProvider' before initialization`。已让 `profileApi` 不再反向依赖 auth 模块（模式判断移至唯一调用方 HttpAuthProvider）。
5. **invited 下浏览器仍发送 `x-user-*` 身份头**：`schedule/api.ts` 与 `announcements-pipeline/api.ts` 的 `authHeaders` 未按模式分流，违反"身份只由 HttpOnly cookie 承载"的 invited 约束。已统一为 invited 模式返回空头。
6. **会话恢复接口永远 401**：全局 `SessionAuthGuard` 命中公开路径 `/auth/session` 提前放行且不挂载 `req.user`，控制器上的同名校验同样短路，刷新后必然被登出。已改为"有有效会话即挂载用户，公开路径无会话时才匿名放行"。
7. **全新数据库任务反馈 500**：Prisma schema `TaskFeedback.errorTypes` 漏写 `@map("error_types")`，客户端按驼峰列名查询而迁移建的是蛇形列（此前开发库靠 db push 掩盖）。已补 `@map` 并重新生成客户端。
8. **登录后画像迁移与首屏匹配竞态**：`HttpAuthProvider.login` 以 fire-and-forget 触发画像迁移，机会页首屏 `match` 可能读到空服务端画像。已改为登录时 `await` 迁移（失败不阻塞登录）。

## 7. 合规前置提醒

- 公开服务前完成 ICP 备案，首页底部展示备案编号；是否涉及教育类前置审批、经营性许可、算法备案或生成式 AI 相关义务，按实际业务形态向主管部门与合规人员核验（历史研究笔记可从 Git 历史追溯，当前边界以 PRD 为准）。
- AI 生成/辅助内容须显式标识并展示依据；公告事实、AI 候选、人工审核结论三种状态不得混用。
- 本文不包含、也不接受任何绕过备案、域名或网络访问限制的“临时方案”。
