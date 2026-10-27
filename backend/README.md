# 教招有据：后端

当前产品需求见根目录 [PRD](../PRD.md)，整体架构与启动见 [README](../README.md)。本目录提供 NestJS API 和独立采集 Worker，二者共用 PostgreSQL、Redis 与快照存储。

## 模块与职责

| 模块 | 职责 |
|---|---|
| auth / profile | 会话、账号恢复、用户画像与部分更新 |
| opportunities / matching | 逐条件预筛、机会、关注、报考与纠错 |
| sourcing | 官方来源适配、周期投递、健康、退避与告警 |
| document-processing | HTML、PDF、表格、DOCX 标准化及资源预算 |
| announcements / catalog | 快照、证据、审核、不可变发布版本和匹配目录 |
| schedule / plans | 日程通知与次级备考计划存储 |
| membership | 期限套餐、会员状态、幂等授予与续购 |
| payments | 订单、模拟微信、全额退款与手动对账 |
| trial / health | 试用记录及服务健康 |

API 从 `src/main.ts` 启动；Worker 从 `src/worker.ts` 启动，不监听 HTTP。前端经同源反代携带内部令牌，业务接口仍执行会话与管理权限校验。

## 开发与检查

准备 Node.js 24、PostgreSQL 与 Redis，根据 [.env.example](.env.example) 创建本机环境配置。后端默认端口 3000，与前端同机时建议改为 3002。

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

另开终端启动 Worker：

```bash
npm run build
node dist/worker.js
```

```bash
npm run lint
npm test
npm run build
npx prisma validate
```

Prisma Schema 和迁移是数据库结构事实来源，不在文档固定模型或迁移数量。正式部署见 [部署说明](../DEPLOYMENT.md)；更新前备份，回退保留支付与审核数据。

## 当前运行边界

- 11 个官方来源适配器不等于全国覆盖，持续采集观察待验，见 [来源记录](../docs/m08-source-acceptance-report.md)。
- 真实微信渠道未实现；仅 `wechat_mock` 支持受控测试，生产禁止模拟。会员售卖和年卡默认关闭，增值权益清单为空。
- OCR 与邮件等供应商能力按实际配置及验证声明；SMTP 真实投递、线上 Cookie 与生产迁移仍需验证。
- 历史测试与已知缺口见 [集成验收](../docs/final-e2e-acceptance-report.md)，不代表当前生产通过。
