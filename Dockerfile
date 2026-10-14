# syntax=docker/dockerfile:1
#
# 受邀环境（环境 B）生产镜像：Next.js standalone 服务端。
# 浏览器内联变量在构建期固定为受邀模式；BACKEND_URL/INTERNAL_TOKEN 由
# 运行时环境变量注入（见根仓库 deploy/frontend.env.example），不得写入镜像层。
#
# 在 Linux 镜像内安装依赖，不能复制 Windows 的 node_modules（含平台专属 Next 二进制）。

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY next.config.ts postcss.config.mjs tsconfig.json ./
# 受邀环境标识（内联进浏览器产物）：生产 + invited + 关闭演示模式
ENV NEXT_PUBLIC_APP_ENV=production
ENV NEXT_PUBLIC_AUTH_MODE=invited
ENV NEXT_PUBLIC_DEMO_MODE=false
# v7.2 统一结果工作台开关：必须在构建阶段内联进浏览器产物
# （NEXT_PUBLIC_* 为编译期常量，容器运行时设置不会生效）
ENV NEXT_PUBLIC_FF_NEW_RESULTS=true
COPY public ./public
COPY scripts ./scripts
COPY src ./src
# next build 之后 postbuild 会运行境外依赖/密钥扫描，发现阻断项直接构建失败
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
