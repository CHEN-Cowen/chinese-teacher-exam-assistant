---
name: cross-env-deploy-troubleshooting
description: 分层定位跨环境部署故障并给出可复制命令，覆盖 PowerShell 引号转义、SSH 远程执行、Docker 镜像仓库名不一致与容器内 Node 模块解析。用户要求部署排障、远程命令转义失败或容器内脚本无法运行时使用。不适用于纯业务逻辑调试。
---

# 跨环境部署排障

## 何时用

一次操作跨了 3 层以上：本地 Windows Shell → SSH → Linux 主机 → Docker 容器 → 容器内运行时。典型症状是命令"看起来写对了但报语法错"、远端脚本 `Cannot find module`、镜像拉不到、部署后服务不健康。纯应用逻辑 bug 不要用本 skill。

## 第一原则：先确定失败在哪一层

不要从报错文本猜。按层做一次最小探针，把范围砍半：

| 层 | 最小探针 | 失败即说明 |
|---|---|---|
| L0 本地 Shell | `ssh host "echo ok"` | 引号/编码/别名问题 |
| L1 SSH | `ssh host 'hostname && docker --version'` | 网络、host key、权限 |
| L2 主机编排 | `docker compose ps`、`docker images \| grep <app>` | 镜像、配置漂移、容器状态 |
| L3 容器运行 | `docker exec <c> sh -c 'node -v'` | 镜像内工具/权限/路径 |
| L4 应用 | 健康接口、业务 API、日志 | 代码或数据问题 |

只有确定层号后再改命令。跨层混改是最常见的浪费。

## Windows PowerShell 是 L0 的主要故障源

PowerShell 会自行解释 `"`、`'`、`%`、`#`、`\`，还会按本地代码页转中文。以下现象都应判定为 L0，而不是远端故障：

- `psql: warning: extra command-line argument "id," ignored` — 参数被空格拆碎
- `术语 '\' 不会被识别为 cmdlet` — 反斜杠被当成命令
- `column "%宁波%" does not exist` — 双引号在 SQL 里被当成标识符
- `ParserError` 指向你根本没写的位置
- 中文变成 `锟斤拷` / `��`

### 三种可靠传参方式（按优先级）

1. **落文件再传**（多行 SQL、脚本的首选）

```powershell
$sql = @"
SELECT id, publisher FROM sources WHERE publisher LIKE '%宁波%';
"@
[System.IO.File]::WriteAllText("$env:TEMP\q.sql", $sql)
scp "$env:TEMP\q.sql" admin@host:/tmp/q.sql
ssh admin@host 'cat /tmp/q.sql | docker compose -f docker-compose.standalone.yml exec -T db psql -U app -d app'
```

`-T` 必须加，否则 `psql` 会因 tty 缺失而异常；SQL 走 stdin 可彻底绕开引号层。

2. **base64 单行传输**（脚本、含特殊字符的内容）

```powershell
$script = Get-Content .\local.mjs -Raw
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
ssh admin@host "echo '$b64' | base64 -d > /tmp/x.mjs && head -3 /tmp/x.mjs"
```

base64 字符集是 `A-Za-z0-9+/=`，不含任何被 Shell 解释的符号，是最稳的越层通道。

3. **远端 heredoc**（内容里没有变量插值需求时）

在 `ssh` 的单引号内写 heredoc，注意 SSH 传输本身会消耗一层引号，实践上更容易出错，优先用前两种。

### 自检

发命令前先问：这条命令里有几个 `"`？超过 2 层嵌套就改用文件或 base64。

## SSH 层

- 交互式提示会卡死自动化。统一加 `-o StrictHostKeyChecking=no`（首次连接）与 `-o BatchMode=yes`（无密码场景）。
- 每次调用都是新 shell：`cd` 不保留。必须写 `cd /dir && ...` 或在 `docker compose` 上用 `-f` 绝对路径。
- 不要用 `ssh host "cd x; cmd"` 依赖分号，改用 `&&`，失败即停。
- 敏感输出（Token、连接串、Cookie、私钥）不得落文档。需要确认时只打印前缀与长度。

## Docker 镜像层

### 镜像仓库名和编排文件不一致

CI 用 `github.repository` 生成镜像名，仓库名带后缀时（例如 `xxx-project`）会得到 `xxx-project-api`，而 compose 常写死 `xxx-api`，于是 `pull` 报 `not found`——**不是镜像没推，是名字对不上**。

判定步骤：

```bash
docker pull <CI 实际镜像名>:<sha>      # 能拉通即证明 CI 已推
docker tag <CI 实际镜像名>:<sha> <compose 期望名>:<sha>
```

注意 Docker 镜像名必须全小写，`CHEN-Cowen/...` 会以 `invalid reference format: repository name must be lowercase` 直接拒绝。

长期修法是统一 compose 的镜像名与 CI 输出，`docker tag` 只作临时绕行，必须在交付记录里写明这是绕行。

### 部署前必备份

```bash
docker compose -f <file> exec -T db pg_dump -U <user> -d <db> > ~/db-backup-$(date +%F-%H%M%S).sql
cp .env ".env.bak-$(date +%F-%H%M%S)"
```

迁移（`prisma migrate deploy`）幂等但不可回滚，没有备份不得继续。

### 重建后必须验活

```bash
docker inspect --format '{{.Image}}' <container>          # 与预期镜像 ID 对齐
docker compose -f <file> ps                                # health 状态
curl -sS http://127.0.0.1:<port>/<health>                  # 依赖全 up
docker compose -f <file> logs --tail=20 migrate            # 迁移退出码 0
```

健康探针本身也可能被鉴权拦截（全局 token guard 会拦 `/health`），探针要带正确 header，否则你会误判服务挂了。

## 容器内执行

镜像内没有 `bash` 时一切 `bash -c` 都会报 `executable file not found`，统一用 `sh -c`。

镜像的 `/app` 通常属 root，`node` 以非 root 运行，`echo > /app/x.js` 会 `Permission denied`。用 `docker cp` 从主机灌入：

```bash
docker cp /tmp/x.cjs <container>:/app/dist/x.cjs
```

### 模块解析规则（最容易踩）

| 写法 | 结果 |
|---|---|
| `/tmp/x.cjs` 里 `require('@nestjs/core')` | 从 `/tmp` 向上找 `node_modules`，失败 |
| 加 `process.chdir('/app')` | **无效**，require 按脚本文件位置解析，不按 cwd |
| `docker exec -w /app node /tmp/x.cjs` | **无效**，同上 |
| `NODE_PATH=/app/node_modules` + 脚本内用**裸包名** | 成功 |
| 脚本放在 `/app/dist/`，用 `require('./app.module.js')` 相对导入 | 成功 |

结论：

```bash
docker cp x.cjs <c>:/app/dist/x.cjs
docker exec -e NODE_PATH=/app/node_modules <c> node /app/dist/x.cjs <arg>
```

`.mjs` / ESM 从 `/tmp` 运行会走 ESM 解析器，报 `ERR_MODULE_NOT_FOUND`，且不受 `NODE_PATH` 影响；容器内一次性脚本优先写 CJS。

## 无会话时触发后台任务

管理接口普遍依赖真实登录态（session cookie）。临时 session 过期时不要硬造 token，改为在容器内直接取服务实例：

```js
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./app.module.js");
const { XxxOrchestrator } = require("./xxx/xxx-orchestrator.js");
const app = await NestFactory.createApplicationContext(AppModule);
await app.get(XxxOrchestrator).doSomething(id);
await app.close();
```

用完删除容器内脚本，避免残留。

任务入队不等于完成。必须回库查真实结果（状态、计数、错误摘要），并注意区分"本轮 run"和"历史 run"——`ORDER BY started_at DESC` 后再取第一条，否则会拿旧数据下结论。

## 失败归因要按状态字段拆开看

一条 run 的 `failed_count` 可能和你看到的 URL 状态不一致，因为部分状态不计入失败。统计口径必须显式分组：

```sql
SELECT e.value->>'status' AS status, COUNT(*)
FROM crawl_runs r, jsonb_each(r.fetch_audit->'urls') e
WHERE r.source_id = '<id>' AND r.started_at > '<本轮时间>'
GROUP BY 1 ORDER BY 2 DESC;
```

先分组求和，再解释 `failed_count`，不要用单条 URL 的现象推断整体结论。

## 网络类问题必须在目标容器内直连

本地请求会经过本机代理，产生假阳性：本地超时不代表远端超时。判定网络问题一律在容器内发起（`docker exec <c> sh -c 'wget/curl ...'`），并把 DNS、TCP、HTTP 三层结果分开记录。

## 交付记录要求

部署类任务收尾必须写清：实际运行的镜像 SHA 与镜像 ID、迁移退出码、备份文件路径、被验证的具体来源与前后对比数据、以及所有临时绕行（`docker tag`、手工改 `.env`）——后者要标明"未修复根因"。没有真实运行记录不得写"已验证"。

## 收尾清理

- 删除本地临时脚本、远端 `/tmp/*.sql`、容器内 `/app/dist/*.cjs`。
- `git status` 确认只有本轮相关变更；他人在途的修改不要动。
- 服务端数据库备份文件保留，不删。
