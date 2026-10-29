import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Windows 上高并发下 Nest 模块编译、PDF.js 首次加载等初始化开销
    // 容易超过 vitest 默认 5 秒；限制 worker 数 + 针对性用例 timeout
    // 避免 flaky，不放宽断言
    pool: 'forks',
    maxWorkers: 4,
    testTimeout: 15_000,
  },
});
