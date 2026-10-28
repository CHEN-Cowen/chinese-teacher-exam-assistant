/**
 * 测试数据隔离守护（工作包 0）。
 *
 * 不变量：生产代码（src/ 与 backend/src/）不得引用 tests/fixtures/ 下的任何样本。
 * 样本只能被测试文件消费；一旦被生产代码 import，测试数据就可能混入
 * 演示/生产目录——这是本工作包明确禁止的（「测试样本不得进入生产目录」）。
 *
 * 实现：递归扫描两个生产源码树，断言没有任何 import/require 指向 tests/fixtures。
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const PRODUCTION_TREES = [path.join(REPO_ROOT, "src"), path.join(REPO_ROOT, "backend", "src")];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

/** 匹配任何形式的 tests/fixtures 引用（相对/绝对/别名路径，import/export from/require） */
const FIXTURE_REFERENCE =
  /(?:from\s+|import\s*\(|require\s*\(|export\s+[^;]*?from\s+)["'][^"']*tests\/fixtures[^"']*["']/;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("测试样本与生产代码隔离", () => {
  // 递归读全量源码文件，单跑已接近默认 5s 超时；并发全量跑时 IO 竞争会超限，
  // 显式放宽到 20s（只放时间窗口，不断言/skip 任何检查）。
  it("src/ 与 backend/src/ 中没有任何文件引用 tests/fixtures", { timeout: 20000 }, () => {
    const violations: string[] = [];
    for (const tree of PRODUCTION_TREES) {
      for (const file of collectSourceFiles(tree)) {
        const content = readFileSync(file, "utf8");
        if (FIXTURE_REFERENCE.test(content)) {
          violations.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("fixtures 目录自身存在且包含三类样本入口", () => {
    const fixturesDir = path.join(REPO_ROOT, "tests", "fixtures");
    const entries = readdirSync(fixturesDir);
    expect(entries).toContain("samples");
    expect(entries).toContain("golden-sources");
    const samples = readdirSync(path.join(fixturesDir, "samples"));
    expect(samples).toEqual(
      expect.arrayContaining(["profiles.ts", "announcements.ts", "published-announcement.ts"]),
    );
  });

  it("黄金样本三来源齐备（杭州/宁波/鄞州，各含列表页与正文页）", () => {
    const goldenDir = path.join(REPO_ROOT, "tests", "fixtures", "golden-sources");
    for (const source of ["hangzhou", "ningbo", "yinzhou"]) {
      const files = readdirSync(path.join(goldenDir, source));
      expect(files, `${source} 缺样本文件`).toEqual(
        expect.arrayContaining(["list.html", "detail.html"]),
      );
    }
  });
});
