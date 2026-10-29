<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:product-docs-pointer -->

## 当前产品与架构入口

修改产品流程、页面、路由、领域模型、演示数据、会员或验收标准前，先读根目录 `PRD.md`；它是唯一产品需求基线。技术架构与启动方式见 `README.md`。

涉及外部请求或国内运行依赖，读取 `docs/china-network-accessibility.md`。涉及部署和发布，读取 `DEPLOYMENT.md` 与 `deploy/` 对应手册。核对已完成/待验证状态时，先读 `docs/recruitment-upgrade-acceptance.md`；历史证据见 `docs/final-e2e-acceptance-report.md` 和 `docs/m08-source-acceptance-report.md`，历史测试通过不代表当前生产已验收。

历史任务稿和阶段指南已从当前文件树精简，可从 Git 历史追溯；原型及旧记录不覆盖当前 PRD。需求冲突按“用户最新明确要求 → PRD.md → 技术与历史参考”处理。后续直接更新 PRD.md，不新增并行 PRD。

<!-- END:product-docs-pointer -->
