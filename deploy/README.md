# 教招有据：单仓库 Docker 部署

本仓库根目录是 Next.js 前端，`backend/` 是 NestJS 后端。本目录的 Compose 文件使用 GitHub Actions 构建的 GHCR 镜像，适合只负责拉取和运行镜像的轻量服务器；不要在现有约 1.6 GiB 内存服务器上构建 Next.js。

## 两种部署文件

| 文件 | 适用场景 |
|---|---|
| `docker-compose.standalone.yml` | **自包含一键部署**：前端 + 后端 + 迁移 + PostgreSQL 全在一个文件里，干净机器（或本地 Docker Desktop）`docker compose -f docker-compose.standalone.yml up -d` 即可运行；数据库为全新空库，需引导首个管理员。**完整操作步骤见 [STANDALONE.md](./STANDALONE.md)** |
| `docker-compose.ghcr.yml`（+ `docker-compose.internal.yml` / `--profile public`） | 现有阿里云服务器：复用已有 `kaobian-postgres` 容器与 `kaobian-net` 网络，分内部验收与公开 HTTPS 两阶段，见下文 |

镜像发布地址：

- 前端：`ghcr.io/chen-cowen/chinese-teacher-exam-assistant`
- 后端：`ghcr.io/chen-cowen/chinese-teacher-exam-assistant-api`

推送本仓库后，根目录 `.github/workflows/docker-publish.yml` 自动构建两个镜像。同一次提交的镜像共享 `sha-<完整提交 SHA>` 标签；默认分支还会更新 `latest`。前端镜像固定为 **invited 受邀模式**，不是 Vercel 的公开 demo 模式。镜像发布成功不会自动部署服务器。

## 服务器所需文件

将 `docker-compose.ghcr.yml`、`docker-compose.internal.yml`、`Caddyfile`、`.env.example`、`backend.env.example`、`frontend.env.example` 放在服务器的 `/opt/kaobian/deploy/`。真实的 `.env`、`backend.env`、`frontend.env` 只在服务器创建，不提交 GitHub。

```bash
cd /opt/kaobian/deploy
cp .env.example .env
cp backend.env.example backend.env
cp frontend.env.example frontend.env
chmod 600 .env backend.env frontend.env
```

在 `.env` 中设置 `GHCR_OWNER=chen-cowen`，并把 `BACKEND_IMAGE_TAG` 和 `FRONTEND_IMAGE_TAG` 固定为同一个成功构建的 `sha-<完整提交 SHA>`。`backend.env` 的 `DATABASE_URL` 必须指向实际 PostgreSQL；`INTERNAL_TOKEN` 生成强随机值，并在 `backend.env` 和 `frontend.env` 中填写相同值。`frontend.env` 的 `BACKEND_URL` 保持 `http://backend:3000`。按实际入口填写 `CORS_ORIGINS`，首次管理员初始化需要单独设置 `ADMIN_BOOTSTRAP_TOKEN`。

当前 Compose **复用**服务器已有的 `kaobian-postgres` 容器和 `kaobian-net` 网络，不创建数据库。启动前确认数据库备份可恢复，检查旧容器与内存余量。不要把本地 `deploy/kaobian-db.env` 或任何真实密钥上传到 GitHub。

## 内部测试

内部模式只将前端绑定到服务器的 `127.0.0.1:3002`，适合 SSH 端口转发，不是手机可直接访问的公开链接。

```bash
cd /opt/kaobian/deploy
docker compose -f docker-compose.ghcr.yml -f docker-compose.internal.yml config --quiet
docker compose -f docker-compose.ghcr.yml -f docker-compose.internal.yml pull
docker compose -f docker-compose.ghcr.yml -f docker-compose.internal.yml up -d
docker compose -f docker-compose.ghcr.yml -f docker-compose.internal.yml ps
docker compose -f docker-compose.ghcr.yml -f docker-compose.internal.yml logs --tail=100 migrate backend frontend
```

`docker-compose.ghcr.yml` 当前从南京大学 GHCR 缓存镜像站拉取，只适用于**公开、可匿名拉取**的 Package。若保持私有，须把 Compose 中两处 `ghcr.nju.edu.cn` 改回 `ghcr.io`，只向官方 GHCR 登录；不要把 GitHub 令牌交给镜像站。镜像站从这台服务器拉取是否稳定仍需实测。

## 公开 HTTPS 入口

完成域名、DNS、证书与服务器入口条件检查并通过内部验收后，在 `.env` 中填 `SITE_DOMAIN`（只填域名，不带协议），确认 80/443 未被旧服务占用，再显式启用公开 profile：

```bash
cd /opt/kaobian/deploy
docker compose -f docker-compose.ghcr.yml --profile public config --quiet
docker compose -f docker-compose.ghcr.yml --profile public up -d
```

上线后至少验证 `/api/health`、登录/登出、机会关注、日程、手机网络直连和账号间数据隔离。公开入口默认关闭；本次仓库合并**不会**修改阿里云服务器或现有 Vercel 链接。
