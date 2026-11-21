import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 后端与 QA 脚本是独立工程，不属于前端 Next.js 构建/检查范围
    "backend/**",
    ".qa-harness/**",
    // git 已忽略的非源码目录：旧 v6.1 构建副本与 v7 原型产物
    "frontend/**",
    "prototype-v7/**",
    "prototype-v7-source/**",
    // 历史合并副本与编辑器缓存（见 .gitignore）
    ".legacy-git-metadata/**",
    ".merge-primary-repo/**",
    ".trae/**",
    // 本地抓取/探针临时产物（非源码，见 .gitignore）
    ".tmp-probe/**",
    ".workbuddy/**",
    "outputs/**",
  ]),
]);

export default eslintConfig;
