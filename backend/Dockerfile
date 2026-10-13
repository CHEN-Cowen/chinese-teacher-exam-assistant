# syntax=docker/dockerfile:1
# 在 Linux 镜像内安装依赖并生成 Prisma Client，不能复制 Windows 的查询引擎。

FROM node:24-alpine AS build
WORKDIR /app
# 境内轻量服务器访问默认 Alpine 源极慢；使用已验证可访问的阿里云镜像。
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache openssl
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
RUN mkdir -p /app/.data && chown node:node /app/.data
EXPOSE 3000
USER node
# 同一镜像承载两个 entrypoint：
# - API 进程（默认）：node dist/main.js，只投递抓取任务
# - 抓取 Worker：以 command 覆盖为 node dist/worker.js，单独消费队列（见 deploy compose）
CMD ["node", "dist/main.js"]
