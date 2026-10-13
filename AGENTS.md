<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:v7-docs-pointer -->

## 当前代码基线：v7.1；下一迭代设计基线：v7.2

修改产品流程、页面信息架构、路由、领域模型、演示数据或验收标准之前，先读以下文档（路径相对于本仓库根目录），再动代码：

- `PRD-教招有据-v7.2-决策体验与可信机会闭环.md` — 下一迭代的实施主文档；代码尚未实现，开始 v7.2 工作时以其范围、顺序和验收为准
- `docs/prototypes/README.md` — v7.2 原型入口、实施状态与 Coding 工具读取顺序
- `PRD-教招有据-v7.1-首次体验与报考闭环优化版.md` — 当前已实现代码的需求与验收基线；v7.2 未覆盖行为继续以此为准
- `PRD-全国教师公开招聘助手-v7.0-研究验证版.md` — 产品定位、资格规则、数据可信度与 v7.1 未覆盖行为的基础事实来源
- `docs/china-network-accessibility.md` — 国内网络基线、允许域名与验收方法

涉及历史路由迁移、既有领域对象、公告数据管线或回退策略时，再查阅以下 V6.1 兼容参考：

- `PRD-全国教师公开招聘与备考助手-v6.1.md`
- `docs/v6.1-migration-plan.md`
- `docs/v6.1-information-architecture.md`
- `docs/v6.1-data-pipeline.md`

需求冲突时按“用户最新要求 → v7.2 → v7.1 → v7.0 → V6.1”处理。不要把上述文档内容复制进本文件；保持指针简短，文档本身以仓库中的最新版本为准。

<!-- END:v7-docs-pointer -->
