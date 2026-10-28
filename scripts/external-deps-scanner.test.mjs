/**
 * 网络基线守卫测试（v6.1 模块 0A）。
 *
 * 这个文件本身是“报警器有效性”的保障：
 * 1. 源码/资源中一旦重新出现 Google Fonts 或境外 CDN，npm test 立即失败；
 * 2. 构建后（存在 .next）构建产物与浏览器 chunk 同样受检，且不得含服务端密钥；
 * 3. 用临时文件自证扫描器确实能发现被禁域名，防止报警器自身失效。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCKED_HOSTS,
  classifyOrigin,
  collectFiles,
  extractOrigins,
  isBlockedHost,
  runReport,
  scanClientSecrets,
  scanRoots,
} from "./external-deps-scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

describe("阻断主机清单", () => {
  it("覆盖 Google Fonts 与主要境外 CDN", () => {
    expect(BLOCKED_HOSTS).toContain("fonts.googleapis.com");
    expect(BLOCKED_HOSTS).toContain("fonts.gstatic.com");
    expect(BLOCKED_HOSTS).toContain("unpkg.com");
    expect(BLOCKED_HOSTS).toContain("jsdelivr.net");
  });

  it("按相等或子域后缀匹配，避免子域绕过", () => {
    expect(isBlockedHost("fonts.googleapis.com")).toBe(true);
    expect(isBlockedHost("FONTS.GSTATIC.COM")).toBe(true);
    expect(isBlockedHost("cdn.jsdelivr.net")).toBe(true);
    expect(isBlockedHost("raw.githubusercontent.com")).toBe(true);
    expect(isBlockedHost("www.gov.cn")).toBe(false);
    expect(isBlockedHost("localhost")).toBe(false);
  });
});

describe("URL 提取与分类", () => {
  it("提取绝对 URL 的 origin 且忽略结尾标点", () => {
    const content =
      '见 https://www.gov.cn/zhengce/，以及 http://www.moe.gov.cn。';
    expect(extractOrigins(content)).toEqual([
      "https://www.gov.cn",
      "http://www.moe.gov.cn",
    ]);
  });

  it("把被禁域名归为 blocked，政府链接归为 external-click", () => {
    expect(classifyOrigin("https://fonts.googleapis.com/css2?family=X")).toBe(
      "blocked",
    );
    expect(classifyOrigin("https://www.gov.cn")).toBe("external-click");
    expect(classifyOrigin("http://localhost:3000")).toBe("local");
  });
});

describe("应用源码网络基线", () => {
  const roots = [
    path.join(frontendRoot, "src"),
    path.join(frontendRoot, "public"),
    path.join(frontendRoot, "next.config.ts"),
    path.join(frontendRoot, "postcss.config.mjs"),
    path.join(frontendRoot, "package.json"),
  ];

  it("src/public/配置文件中不存在任何被阻断的境外字体或 CDN", () => {
    const { blocked } = scanRoots(roots);
    expect(
      blocked.map((b) => `${b.origin} @ ${b.file}`),
    ).toEqual([]);
  }, 60_000); // 全量并发时扫描 src/public 在 Windows 上可能超出默认 5s

  it("没有任何文件再引用 next/font/google 或 geist 字体变量", () => {
    const files = collectFiles(path.join(frontendRoot, "src")).filter((f) =>
      [".ts", ".tsx", ".css"].includes(path.extname(f).toLowerCase()),
    );
    const offenders = files.filter((f) => {
      const content = fs.readFileSync(f, "utf8");
      return (
        content.includes("next/font/google") ||
        content.includes("--font-geist-sans") ||
        content.includes("--font-geist-mono")
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe("构建产物基线（执行过 npm run build 时生效）", () => {
  const nextDir = path.join(frontendRoot, ".next");
  const staticDir = path.join(nextDir, "static");

  it("构建产物中不存在被阻断的境外 origin", (ctx) => {
    if (!fs.existsSync(nextDir)) {
      ctx.skip(); // 未构建时跳过，postbuild 与 check:external --build 负责产物检查
      return;
    }
    const { blocked } = scanRoots([nextDir]);
    expect(blocked.map((b) => `${b.origin} @ ${b.file}`)).toEqual([]);
  }, 60_000); // 全量并发时扫描数千个产物文件在 Windows 上可能超出默认 5s

  it("浏览器静态 chunk 不含服务端密钥变量名", (ctx) => {
    if (!fs.existsSync(staticDir)) {
      ctx.skip();
      return;
    }
    expect(scanClientSecrets(staticDir)).toEqual([]);
  }, 60_000);
});

describe("报警器有效性自检", () => {
  it("临时目录中放入 Google Fonts 引用时，检查必须失败（退出码 1）", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netdep-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "bad.tsx"),
        `export const x = "https://fonts.googleapis.com/css2?family=Geist";\n`,
      );
      const { blocked, inventory } = scanRoots([tmp]);
      expect(blocked).toHaveLength(1);
      expect(blocked[0].origin).toBe("https://fonts.googleapis.com");
      expect(inventory[0].category).toBe("blocked");

      // runReport 对阻断项返回 1
      const originalError = console.error;
      console.error = () => {};
      const code = runReport({ roots: [tmp] });
      console.error = originalError;
      expect(code).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("只有政府外链时检查通过（退出码 0）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netdep-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "ok.tsx"),
        `export const u = "https://www.gov.cn/";\n`,
      );
      const originalLog = console.log;
      console.log = () => {};
      const code = runReport({ roots: [tmp] });
      console.log = originalLog;
      expect(code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
