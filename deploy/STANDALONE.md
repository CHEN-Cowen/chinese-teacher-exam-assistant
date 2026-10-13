# 教招有据：自包含单机部署（standalone）

本文档对应 [`docker-compose.standalone.yml`](./docker-compose.standalone.yml)：一个文件跑起 **PostgreSQL + 数据库迁移 + NestJS 后端 + 抓取 Worker + Redis + Next.js 前端**，不依赖任何既有容器或外部网络。镜像全部从 GHCR 拉取，服务器上不需要源码、不需要构建。

- 适用：干净的服务器 / 本地 Docker Desktop / 快速搭建受邀模式（invited）验收环境
- 不适用：现有阿里云服务器复用 `kaobian-postgres` 的部署（那套用 `docker-compose.ghcr.yml`，见 [README.md](./README.md)）
- 运行模式：受邀模式（服务端预建账号 + HttpOnly 会话 + PostgreSQL 持久化），**不是** Vercel 上的浏览器本机 demo

> 数据提醒：本模式的数据库是**全新空库**——没有账号、没有机会数据。首次使用必须按第 4 节引导管理员，公告数据需登录后台走流水线录入。

---

## 1. 前置条件

| 项 | 要求 |
|---|---|
| Docker | 20.10+，含 Compose v2 插件（`docker compose version` 能跑即可） |
| 内存 | 建议空闲 ≥ 1 GiB（PostgreSQL + 后端 + 前端合计）；低于此请关旧容器 |
| 端口 | 默认占用 `3000`（前端对外入口）；数据库与后端不暴露任何主机端口 |
| 网络 | 能拉取 `ghcr.io` 镜像；境内拉不动见第 6 节 |

架构（请求链路）：

```text
浏览器 → http://主机:3000 (frontend, Next.js)
           ↓ /api/* 服务端反代，自动注入 x-internal-token
         backend:3000 (NestJS，容器内网，不暴露)
           ↓ 投递抓取任务                    worker (同一镜像 node dist/worker.js)
         db:5432 (PostgreSQL，容器内网) ←──→ redis:6379 (BullMQ 队列，容器内网，均不暴露)
```

---

## 2. 准备部署目录

服务器上只需要这一个 compose 文件（例如放在 `/opt/jiaozhao/`）：

```bash
mkdir -p /opt/jiaozhao && cd /opt/jiaozhao
# 从仓库取出文件（二选一）：
#   git clone 后复制 deploy/docker-compose.standalone.yml
#   或直接从本地上传：scp deploy/docker-compose.standalone.yml user@server:/opt/jiaozhao/
```

仓库已备好现成配置 `deploy/standalone.env`（含生成的随机引导口令，文件名已被 git 忽略），一并上传后重命名为 `.env` 即可：

```bash
scp deploy/docker-compose.standalone.yml deploy/standalone.env user@server:/opt/jiaozhao/
ssh user@server 'cd /opt/jiaozhao && mv standalone.env .env && chmod 600 .env'
```

这个拓扑下 **backend 与 db 没有任何主机端口映射，只在 compose 内网可达**，所以数据库口令和前后端 `INTERNAL_TOKEN` 不构成攻击面——compose 文件里已固定默认值，不需要当作密钥管理。`.env` 是**完全可选**的，只有想覆盖默认值时才创建：

```bash
cd /opt/jiaozhao
touch .env && chmod 600 .env   # 放了 ADMIN_BOOTSTRAP_TOKEN 时保持 600
```

`.env` 全部可用项（不写就用 compose 内默认值）：

```dotenv
# 前后端镜像标签，生产建议固定为同一次构建的 sha-<完整提交SHA>，避免 latest 漂移
IMAGE_TAG=sha-替换为成功构建的完整提交SHA

# 对外端口（默认 3000）
# WEB_PORT=3000

# 应用镜像默认从南京大学 GHCR 镜像站（ghcr.nju.edu.cn）拉取，无需设置；
# Package 为私有或镜像站不稳时改回官方源（需 docker login ghcr.io）：
# REGISTRY=ghcr.io
# postgres 默认用 Docker Hub 官方镜像，境内拉不动时：
# DB_IMAGE=docker.nju.edu.cn/postgres:17-alpine
# redis 默认用 Docker Hub 官方镜像，境内拉不动时：
# REDIS_IMAGE=docker.nju.edu.cn/redis:7-alpine

# 抓取 Worker 并发（默认 2）；置 true 可单独暂停抓取消费而不下线进程
# CRAWL_WORKER_CONCURRENCY=2
# CRAWL_WORKER_PAUSED=false

# 唯一需要保密的值：首个管理员的引导口令（默认 jiaozhao-bootstrap-change-me）。
# 该接口经公网可达，直到首个管理员创建成功后自动永久关闭——启动后立即引导即可；
# 公网开放前来不及引导的话，在这里自设强随机值（openssl rand -hex 32）：
# ADMIN_BOOTSTRAP_TOKEN=替换为强随机值
```

> 注意：如果哪天手动给 backend / db 加了 `ports` 映射，内网凭据就暴露到主机了——那时必须把 `INTERNAL_TOKEN`、`POSTGRES_PASSWORD` 改成强随机值（改 PG 口令见第 8 节"首次初始化才生效"的坑）。

---

## 3. 启动

```bash
cd /opt/jiaozhao
# Linux 主机必需：backend 以 node（uid 1000）运行，快照目录属主必须先给对；
# Windows/macOS 的 Docker Desktop 可跳过这一行
mkdir -p data/snapshots data/redis && chown 1000:1000 data/snapshots && chown 999:999 data/redis
docker compose -f docker-compose.standalone.yml pull
docker compose -f docker-compose.standalone.yml up -d
docker compose -f docker-compose.standalone.yml ps
```

启动链是自动编排好的：`db`（健康检查通过）→ `migrate`（执行 `prisma migrate deploy`，跑完退出）→ `backend`（等迁移成功）与 `worker`（等迁移成功、等 `redis` 健康）并行启动；`frontend` 等 `backend` 健康。首次启动给迁移留 1—2 分钟，观察：

```bash
docker compose -f docker-compose.standalone.yml logs --tail=100 migrate backend worker
```

`migrate` 容器显示 `Exited (0)` 是正常状态（一次性任务），不要当成故障。

验证健康：

```bash
curl http://localhost:3000/api/health
# 期望：{"status":"ok","api":"up","db":"up","redis":"up","worker":"up",...}
# （"db":"down" 说明后端连不上库看第 7 节；"redis"/"worker":"down" 说明抓取队列或 Worker 未就绪，
#  不影响 API 与前端存活，按需重启 worker/redis）
```

浏览器访问 `http://localhost:3000`（或 `http://服务器IP:3000`），能看到首页和 `/login` 即部署成功——但此时**还没有任何账号**，继续下一节。

---

## 4. 首次初始化（只做一次）

受邀模式不开放注册，账号全部由管理员在服务端创建。

### 4.1 引导首个管理员

`bootstrap-admin` 接口只在**系统中尚无任何管理员**时可用，创建成功后永久关闭：

```bash
curl -X POST http://localhost:3000/api/admin/bootstrap-admin \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "至少8位的强密码",
    "token": "<ADMIN_BOOTSTRAP_TOKEN；未在 .env 设置时为默认值 jiaozhao-bootstrap-change-me>"
  }'
# 成功返回 {"user":{...}}；返回"引导令牌无效"说明 .env 里改过 token，以 .env 为准
```

### 4.2 创建试用账号

前端没有用户管理页面，用管理员会话调 API（先登录拿 cookie，再建用户）：

```bash
# 管理员登录，保存会话 cookie
curl -c /tmp/jz-cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<上一步的管理员密码>"}'

# 创建备考用户（密码至少 6 位）
curl -b /tmp/jz-cookies.txt -X POST http://localhost:3000/api/admin/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"student01@example.com","name":"试用用户01","password":"至少6位","role":"user"}'
```

`role` 四种取值：

| role | 用途 |
|---|---|
| `user` | 备考用户（默认），用户端全部功能，禁入后台 |
| `exam_reviewer` | 考情审核员 |
| `resource_reviewer` | 资源审核员 |
| `admin` | 管理员（也可再用本命令创建更多管理员，不受 bootstrap 限制） |

建好的账号即可在 `/login` 登录。demo 模式的内置账号（`student@demo.app` 等）**在本模式不存在**，不要拿它们尝试。

### 4.3 录入机会数据

空库里机会列表为空是正常状态。管理员登录后进入 `/admin/pipeline`，走公告流水线：提交公告来源（URL 或粘贴正文）→ 确定性解析提取 → 人工审核 → 发布。发布后机会才对用户可见。当前解析器是确定性规则，未接 AI/OCR。

---

## 5. 验收清单

部署完成后逐项过一遍：

- [ ] `curl http://localhost:3000/api/health` 返回 `"status":"ok","db":"up"`
- [ ] 浏览器打开首页 → 跳登录页，用第 4 节创建的账号登录成功
- [ ] 登录后能进 `/opportunities`、`/schedule`、`/study`（数据空态正常）
- [ ] 管理员能进 `/admin`；`user` 角色进 `/admin` 被拒绝
- [ ] 退出登录后访问 `/opportunities` 被拉回 `/login`
- [ ] 用第二个账号登录，看不到第一个账号的关注与日程（账号隔离）
- [ ] 手机蜂窝网络（无代理）打开站点可登录可用

---

## 6. 镜像拉取（境内网络）

本文件的默认拉取路径已经面向境内网络：

- **前端 / 后端 / 迁移镜像**：默认走南京大学 GHCR 缓存镜像站 `ghcr.nju.edu.cn`（镜像内容仍发布在 `ghcr.io`，镜像站只是缓存）。仅适用于**公开可匿名拉取**的 Package；不要向镜像站发送任何 GitHub 令牌，稳定性需实测。
- **postgres**：默认 Docker Hub 官方 `postgres:17-alpine`。境内拉不动时在 `.env` 设 `DB_IMAGE=docker.nju.edu.cn/postgres:17-alpine`（同一镜像站的 Docker Hub 缓存）。

两种需要改回官方源的情况，在 `.env` 设：

```dotenv
REGISTRY=ghcr.io
```

- **Package 为私有**（镜像站无法匿名拉取）——同时在服务器上登录官方 GHCR：

```bash
echo "<GitHub PAT（read:packages 权限）>" | docker login ghcr.io -u <GitHub用户名> --password-stdin
```

- **镜像站本身不稳或同步滞后**——官方源为准。

---

## 7. 日常运维

所有命令都在部署目录执行，`-f docker-compose.standalone.yml` 不能省（为简洁以下用变量 `COMPOSE="docker compose -f docker-compose.standalone.yml"` 代指）。

### 升级版本

```bash
# 1. 改 .env 里 IMAGE_TAG 为新的 sha-<完整提交SHA>
# 2. 拉取并滚动重建（migrate 会随新镜像自动重跑；prisma migrate deploy 幂等，只应用新迁移）
docker compose -f docker-compose.standalone.yml pull
docker compose -f docker-compose.standalone.yml up -d
# 3. 确认迁移成功
docker compose -f docker-compose.standalone.yml logs --tail=50 migrate
```

### 日志与状态

```bash
docker compose -f docker-compose.standalone.yml ps
docker compose -f docker-compose.standalone.yml logs -f backend        # 跟随后端日志
docker compose -f docker-compose.standalone.yml logs --tail=200 db     # 数据库日志
```

### 停止与重启

```bash
docker compose -f docker-compose.standalone.yml restart backend   # 重启单个服务
docker compose -f docker-compose.standalone.yml stop              # 全部停止（数据保留）
docker compose -f docker-compose.standalone.yml up -d             # 再启动
docker compose -f docker-compose.standalone.yml down              # 停止并删除容器（./data 数据保留）
# 彻底清空数据（数据库与快照全丢）：先 down，再删除整个数据目录
rm -rf ./data
```

### 备份与恢复

所有数据都在部署目录的 `./data/` 下（`postgres/` 库文件 + `snapshots/` 公告快照），不经过 Docker 卷。两种备份方式：

```bash
# 方式一：数据库逻辑备份（推荐，一致性有保证；用户名/库名与 POSTGRES_USER/POSTGRES_DB 一致）
docker compose -f docker-compose.standalone.yml exec db \
  pg_dump -U jiaozhao -d jiaozhao > backup-$(date +%F).sql

# 恢复（先确认库可连；会覆盖同名对象，谨慎操作）
cat backup-2026-01-01.sql | docker compose -f docker-compose.standalone.yml exec -T db \
  psql -U jiaozhao -d jiaozhao

# 方式二：整目录物理备份（先 stop 保证库文件一致；公告快照也一并带走）
docker compose -f docker-compose.standalone.yml stop
tar czf jiaozhao-data-$(date +%F).tgz data/
docker compose -f docker-compose.standalone.yml up -d
```

升级版本前建议先备份。

---

## 8. 故障排查

| 现象 | 排查 |
|---|---|
| `pull` 卡住 / 超时 | 境内网络问题，按第 6 节换镜像站或登录 GHCR |
| 启动后浏览器打不开 | `ps` 看 frontend 是否 Up；`3000` 被占用就在 `.env` 改 `WEB_PORT` |
| `migrate` 反复重启或 Exited 非 0 | `logs migrate` 看 Prisma 报错；若在 `.env` 自设过 `POSTGRES_PASSWORD`，避免 `@#/` 等特殊字符（要拼进 DATABASE_URL），换纯字母数字最省事 |
| `/api/health` 返回 `"db":"down"` | `logs db` 看数据库是否异常；若刚修改过 `POSTGRES_*`：这些变量只在数据库**首次初始化**时生效，改已有库的口令需 `exec db psql` 进库 `ALTER ROLE … WITH PASSWORD`，或 `down` 后 `rm -rf ./data` 重建（数据全丢） |
| 页面报 502 upstream unreachable | backend 还没就绪或已挂，`logs backend`；frontend 本身正常 |
| `up -d` 报 `dependency failed to start: ...backend... is unhealthy`，但 `logs backend` 显示 Nest 正常启动 | 进程好、健康检查没过。`docker inspect --format '{{json .State.Health}}' <backend容器名>` 看健康日志：401 说明健康检查没带 `x-internal-token` 头（全局守卫拦截一切无令牌请求含 `/health`，本文件健康检查已内置该头；手改过才可能出现）；connection refused 则是进程/端口问题 |
| backend 日志报 `EACCES` 无法写 `/app/.data` | `./data/snapshots` 属主不对（目录不存在时 docker 会以 root 自动创建）；执行 `chown -R 1000:1000 data/snapshots` 后 `restart backend` |
| 登录提示"邮箱或密码不正确" | 本模式没有 demo 内置账号；确认账号是按第 4 节创建的 |
| `bootstrap-admin` 返回 403 `Forbidden resource` | 旧后端镜像的 bug：全局会话守卫漏把该接口放进匿名白名单（修复见 `backend/src/auth/session.guard.ts` 的 `PUBLIC_PATHS`）。`pull` 新镜像后 `up -d` 即可 |
| 调接口 401 | 会话 cookie 失效或未携带；重新登录 |
| 忘记管理员密码 | 仓库暂无自助重置流程；用另一个管理员重建账号，或 `down` 后 `rm -rf ./data` 清空重新引导（数据全丢） |
| 机会列表为空 | 不是故障，空库正常状态；按 4.3 走公告流水线录入 |

---

## 9. 公网暴露前的安全清单

本文件的安全模型建立在**网络隔离**上：唯一发布端口是 frontend 的 `3000`，backend / db 只在 compose 内网可达，所以内部凭据用固定默认值是安全的——前提是这个隔离不被打破：

- [ ] **先引导管理员，再开放公网**：`bootstrap-admin` 接口在公网可达，用的还是公开默认值时，任何人都能抢建管理员。启动后立即执行第 4.1 节（引导成功接口即永久关闭）；来不及引导就在 `.env` 自设 `ADMIN_BOOTSTRAP_TOKEN` 强随机值
- [ ] 不要给 backend / db 加 `ports` 映射；因调试必须加时，把 `INTERNAL_TOKEN`、`POSTGRES_PASSWORD` 改成强随机值，调试完撤掉
- [ ] nginx 终止 TLS 并反代到 `127.0.0.1:3000`；会话 cookie 会按实际协议自动启用 `secure`，不得通过 IP 明文 HTTP 长期运营
- [ ] nginx 与 docker 同主机时，可把 compose 端口绑定改为 `127.0.0.1:3000:3000`，让前端也不直接暴露到局域网
- [ ] 配置定期备份（`pg_dump` 逻辑备份 + `./data` 目录归档）并验证可恢复
- [ ] 面向国内用户还需 ICP 备案与国内网络可达性验证，见 [`../docs/china-network-accessibility.md`](../docs/china-network-accessibility.md)
