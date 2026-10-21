/**
 * WB6：审核导出与实测指标（ExportSection）测试。
 *
 * 覆盖：
 * 1. 下载 JSON / 下载 CSV / 指标口径说明按钮存在且有可访问性标注；
 * 2. 数据集标记（测试/演示/真实/未标记 + example 域名提示）；
 * 3. 指标摘要：比例带分子分母、时间未记录不补零；
 * 4. 下载成功：blob 触发浏览器下载、文件名取自 Content-Disposition；
 * 5. 导出失败：显示可恢复错误，不生成空文件（不触发下载）；
 * 6. 指标口径说明展开。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/auth", () => ({
  AUTH_MODE: "public",
  authService: { getSession: () => null },
}));

import { ExportSection } from "./export-section";

// ==================== 夹具 ====================

const METRICS = {
  runId: "run-1",
  status: "approved",
  parserVersion: "wb-golden@1.0.0",
  datasetMark: "test" as const,
  sourceHost: "www.example.gov.cn",
  isExampleSource: true,
  scopes: [
    { key: "announcement", expected: 8, extracted: 8, unknown: 0, conflict: 0, highImpactEvidenced: 7, highImpactExpected: 7, adopt: 0, edit: 0, reject: 0, pending: 0, humanModified: 0 },
    { key: "job-A-3301A01", expected: 7, extracted: 6, unknown: 0, conflict: 1, highImpactEvidenced: 7, highImpactExpected: 7, adopt: 1, edit: 0, reject: 0, pending: 0, humanModified: 0 },
  ],
  totals: { key: "run", expected: 15, extracted: 14, unknown: 0, conflict: 1, highImpactEvidenced: 14, highImpactExpected: 14, adopt: 1, edit: 0, reject: 0, pending: 0, humanModified: 0 },
  ratios: [
    { key: "completeness" as const, numerator: 14, denominator: 15, formula: "完整性 = extracted / expected", value: 14 / 15 },
    { key: "highImpactEvidenceCoverage" as const, numerator: 14, denominator: 14, formula: "覆盖率 = 有证据/应有", value: 1 },
    { key: "humanAdoptionRate" as const, numerator: 0, denominator: 0, formula: "人工采用率不是准确率", value: null },
  ],
  timing: { totalDurationMs: null, reviewDurationMs: null, retryCount: 0 },
  formulaNotes: ["人工采用率不是准确率：没有黄金答案或独立人工裁决时，不输出准确率/召回率/提效百分比"],
};

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; headers?: Record<string, string> }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
    blob: async () => new Blob(["x"], { type: "application/octet-stream" }),
    headers: new Map(Object.entries(init?.headers ?? {})),
  };
}

let exportFails = false;
let downloadClicks: string[] = [];

const fetchMock = vi.fn((url: unknown) => {
  const u = String(url);
  if (u.includes("/export/metrics")) {
    return Promise.resolve(jsonResponse(METRICS));
  }
  if (u.includes("/export/json")) {
    if (exportFails) {
      return Promise.resolve(jsonResponse({ message: "该任务还没有提取结果，无法导出" }, { ok: false, status: 400 }));
    }
    return Promise.resolve(
      jsonResponse({}, { headers: { "Content-Disposition": 'attachment; filename="workbuddy-run-run-1.json"' } }),
    );
  }
  if (u.includes("/export/csv")) {
    if (exportFails) {
      return Promise.resolve(jsonResponse({ message: "该任务还没有提取结果，无法导出" }, { ok: false, status: 400 }));
    }
    return Promise.resolve(
      jsonResponse({}, { headers: { "Content-Disposition": 'attachment; filename="workbuddy-run-run-1.csv"' } }),
    );
  }
  return Promise.resolve(jsonResponse({}));
});

// 下载触发桩：记录文件名
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  exportFails = false;
  downloadClicks = [];
  vi.stubGlobal(
    "URL",
    Object.assign(class FakeURL {
      static createObjectURL() {
        return "blob:fake";
      }
      static revokeObjectURL() {}
    } as unknown as typeof URL, {}),
  );
  vi.stubGlobal(
    "URL.createObjectURL",
    vi.fn(() => "blob:fake"),
  );
  vi.stubGlobal("URL.revokeObjectURL", vi.fn());
  // 拦截 <a download> 点击
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloadClicks.push(this.download);
  };
  return () => {
    HTMLAnchorElement.prototype.click = origClick;
  };
});

let cleanup: (() => void) | null = null;

async function renderSection() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ExportSection, { runId: "run-1" }));
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

function findButton(container: HTMLElement, testId: string): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(btn).toBeDefined();
  return btn!;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
}

describe("ExportSection：按钮与可访问性", () => {
  it("提供下载 JSON、下载 CSV、指标口径说明按钮，且带 aria-label", async () => {
    const container = await renderSection();

    const jsonBtn = findButton(container, "export-json-button");
    const csvBtn = findButton(container, "export-csv-button");
    const notesBtn = findButton(container, "formula-notes-toggle");

    expect(jsonBtn.getAttribute("aria-label")).toContain("JSON");
    expect(csvBtn.getAttribute("aria-label")).toContain("CSV");
    expect(notesBtn.getAttribute("aria-label")).toContain("指标口径说明");
  });

  it("当前结果有明显的数据集标记：测试材料 + example 域名提示", async () => {
    const container = await renderSection();

    const mark = container.querySelector('[data-testid="dataset-mark"]');
    expect(mark?.textContent).toContain("测试材料");
    expect(mark?.textContent).toContain("example 域名");
  });
});

describe("ExportSection：指标摘要", () => {
  it("比例带分子/分母；人工采用率分母为 0 时显示未记录", async () => {
    const container = await renderSection();

    const summary = container.querySelector('[data-testid="metrics-summary"]');
    expect(summary?.textContent).toContain("14/15");
    expect(summary?.textContent).toContain("未记录"); // humanAdoptionRate value=null
  });

  it("缺少时间戳显示未记录，不补零", async () => {
    const container = await renderSection();

    const summary = container.querySelector('[data-testid="metrics-summary"]');
    expect(summary?.textContent).toContain("总耗时");
    expect(summary?.textContent).toContain("人工审核耗时");
    // totalDurationMs=null → 未记录（而不是 0ms）
    expect(summary?.textContent).not.toContain("0ms");
  });

  it("指标口径说明可展开，包含「人工采用率不是准确率」声明", async () => {
    const container = await renderSection();

    expect(container.querySelector('[data-testid="formula-notes"]')).toBeNull();
    await click(findButton(container, "formula-notes-toggle"));
    const notes = container.querySelector('[data-testid="formula-notes"]');
    expect(notes?.textContent).toContain("人工采用率不是准确率");
    expect(notes?.textContent).toContain("不输出准确率");
  });
});

describe("ExportSection：下载与错误恢复", () => {
  it("下载 JSON 成功：以 Content-Disposition 文件名触发浏览器下载", async () => {
    const container = await renderSection();

    await click(findButton(container, "export-json-button"));

    expect(downloadClicks).toEqual(["workbuddy-run-run-1.json"]);
    expect(container.querySelector('[data-testid="export-error"]')).toBeNull();
  });

  it("下载 CSV 成功：文件名正确", async () => {
    const container = await renderSection();

    await click(findButton(container, "export-csv-button"));

    expect(downloadClicks).toEqual(["workbuddy-run-run-1.csv"]);
  });

  it("导出失败：显示可恢复错误且不生成任何文件", async () => {
    exportFails = true;
    const container = await renderSection();

    await click(findButton(container, "export-json-button"));

    // 不触发下载（不生成空文件冒充成功）
    expect(downloadClicks).toEqual([]);
    const error = container.querySelector('[data-testid="export-error"]');
    expect(error?.textContent).toContain("该任务还没有提取结果，无法导出");
    expect(error?.textContent).toContain("未生成文件");

    // 可恢复：失败恢复后重试成功
    exportFails = false;
    await click(findButton(container, "export-json-button"));
    expect(downloadClicks).toEqual(["workbuddy-run-run-1.json"]);
    expect(container.querySelector('[data-testid="export-error"]')).toBeNull();
  });
});
