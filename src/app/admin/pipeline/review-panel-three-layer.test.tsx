/**
 * v7.2 审核详情三层对照测试（公告流水线 ReviewPanel）。
 *
 * 覆盖：
 * - 三层标题（原始快照 / 标准文档 / 候选字段与证据）都渲染；
 * - 解析警告逐条显示（PDF/OCR/表格徽标）、快照元信息、来源变化提示；
 * - origin 徽标（AI/OCR 候选）、低置信度、待人工确认；
 * - 投影失败红条；
 * - 版本链撤回流程（填原因 → 调用 → 刷新显示 withdrawn + 原因）；
 * - 回归：高影响字段无证据时「通过」被禁止的提示仍存在。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/auth", () => ({
  AUTH_MODE: "public",
  authService: { getSession: () => null },
}));

import AdminPipelinePage from "./page";

// ==================== 测试数据 ====================

function makeRun(status: string) {
  return {
    id: "run-123456789abc",
    snapshotId: "snap-1",
    announcementId: "ann-1",
    parserVersion: "extract-v2",
    status,
    progress: 100,
    candidate: {
      fields: [
        {
          field: "title",
          value: "2026 年杭州市教师招聘公告",
          origin: "rule",
          confidence: 0.95,
          anchor: { locator: { kind: "html" }, excerpt: "标题原文摘录" },
        },
        {
          // 高影响 + 无证据 + AI 低置信度 + 待人工确认
          field: "registration_time",
          value: "10 月 20 日至 25 日",
          origin: "ai",
          confidence: 0.42,
          needsHumanConfirm: true,
          humanConfirmedAt: null,
        },
        {
          field: "exam_time",
          value: "11 月 30 日笔试",
          origin: "ocr",
          confidence: 0.88,
          anchor: { locator: { kind: "ocr" }, excerpt: "笔试时间：11 月 30 日" },
        },
      ],
    },
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: "2026-10-13T01:00:00.000Z",
    updatedAt: "2026-10-13T01:00:00.000Z",
    finishedAt: null,
    publishedVersion:
      status === "published" ? { id: "v2", versionNumber: 2, status: "published" } : null,
    snapshot: {
      id: "snap-1",
      officialUrl: "https://edu.hangzhou.gov.cn/notice/1",
      contentHash: "abcdef1234567890ff",
      mimeType: "text/html",
      httpStatus: 200,
      fetchedAt: "2026-10-13T00:30:00.000Z",
      source: { publisher: "杭州市教育局", officialUrl: "https://edu.hangzhou.gov.cn" },
    },
  };
}

const PARSED_BODY = {
  parseRun: {
    id: "pr-1",
    format: "html",
    parserVersion: "docparse-v1",
    status: "parsed",
    blocks: [
      {
        kind: "heading",
        text: "2026 年杭州市教师招聘公告",
        locator: { kind: "html", selector: "h1", textFragment: "招聘公告" },
      },
      {
        kind: "paragraph",
        text: "报名时间：10 月 20 日至 25 日",
        locator: { kind: "html", selector: "div.content > p:nth-of-type(2)", textFragment: "报名时间" },
      },
      // 未知块类型：防御渲染
      { kind: "mystery-block", text: "未知结构块内容", locator: null },
    ],
    tableHeaders: null,
    warnings: [
      { type: "PDF", message: "PDF 第 2 页表格提取不完整" },
      { type: "OCR", message: "OCR 置信度低于阈值" },
      "表格第 3 行存在合并单元格",
    ],
    warningCount: 3,
    scanned: false,
    ocrRequired: false,
    ocrStatus: null,
    finishedAt: "2026-10-13T00:31:00.000Z",
  },
  change: {
    hasPreviousSnapshot: true,
    previousFetchedAt: "2026-10-10T08:00:00.000Z",
    currentFetchedAt: "2026-10-13T00:30:00.000Z",
  },
};

const PROJECTION_FAILED = {
  status: "failed",
  message: "岗位单元缺少学校名称",
  fieldPath: "units[0].schoolName",
  versionNumber: 2,
};

let versionsData: Array<Record<string, unknown>> = [];

function resetVersions() {
  versionsData = [
    {
      id: "v2",
      announcementId: "ann-1",
      versionNumber: 2,
      status: "published",
      payload: {},
      publishedAt: "2026-10-12T10:00:00.000Z",
      previousVersionId: "v1",
      supersededAt: null,
    },
    {
      id: "v1",
      announcementId: "ann-1",
      versionNumber: 1,
      status: "superseded",
      payload: {},
      publishedAt: "2026-10-01T10:00:00.000Z",
      previousVersionId: null,
      supersededAt: "2026-10-12T10:00:00.000Z",
    },
  ];
}

// ==================== fetch mock ====================

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as Response;
}

let currentRun = makeRun("pending_review");
let projectionBody: Record<string, unknown> = PROJECTION_FAILED;

const fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? "GET";
  if (u.includes("/withdraw") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { reason: string };
    versionsData = versionsData.map((v) =>
      v.id === "v2"
        ? {
            ...v,
            status: "withdrawn",
            withdrawReason: body.reason,
            withdrawnAt: "2026-10-13T09:00:00.000Z",
            withdrawnBy: "运营管理员",
          }
        : v
    );
    return Promise.resolve(jsonResponse(versionsData.find((v) => v.id === "v2")));
  }
  if (u.endsWith("/api/announcements/runs")) return Promise.resolve(jsonResponse([currentRun]));
  if (u.includes("/runs/")) return Promise.resolve(jsonResponse(currentRun));
  if (u.includes("/snapshots/snap-1/content")) {
    return Promise.resolve(jsonResponse({ content: "公告原文：2026 年杭州市教师招聘公告……", mimeType: "text/html" }));
  }
  if (u.includes("/snapshots/snap-1/parsed")) return Promise.resolve(jsonResponse(PARSED_BODY));
  if (u.includes("/projection")) return Promise.resolve(jsonResponse(projectionBody));
  if (u.includes("/versions")) return Promise.resolve(jsonResponse(versionsData));
  return Promise.resolve(jsonResponse({}));
});

// ==================== 渲染辅助 ====================

let cleanup: (() => void) | null = null;

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AdminPipelinePage));
  });
  const page = { container, html: () => container.innerHTML };
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return page;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`按钮不存在：${text}`);
  return btn as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  resetVersions();
  currentRun = makeRun("pending_review");
  projectionBody = PROJECTION_FAILED;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

// ==================== 测试 ====================

describe("ReviewPanel 三层对照", () => {
  it("三层标题、警告逐条、快照元信息、来源变化与字段徽标", async () => {
    const { container, html } = await renderPage();

    // 打开审核面板
    await click(findButton(container, "去审核"));

    // 三层标题都渲染
    expect(html()).toContain("层 1 · 原始快照");
    expect(html()).toContain("层 2 · 标准文档");
    expect(html()).toContain("层 3 · 提取候选字段与证据");

    // 快照元信息：contentHash 前 12 位 / mimeType / httpStatus / fetchedAt
    expect(html()).toContain("哈希：abcdef123456");
    expect(html()).toContain("类型：text/html");
    expect(html()).toContain("HTTP：200");
    expect(html()).toContain("抓取时间：");

    // 来源变化提示
    expect(html()).toContain("内容较上次抓取已更新");

    // 解析警告逐条显示（PDF / OCR / 表格徽标）
    expect(html()).toContain("解析警告（3）");
    expect(html()).toContain("PDF 第 2 页表格提取不完整");
    expect(html()).toContain("OCR 置信度低于阈值");
    expect(html()).toContain("表格第 3 行存在合并单元格");

    // 标准文档块渲染（含未知块类型防御）
    expect(html()).toContain("报名时间：10 月 20 日至 25 日");
    expect(html()).toContain("未知结构块内容");
    expect(html()).toContain("mystery-block");

    // 字段徽标：origin（AI 候选 / OCR 候选）、低置信度、待人工确认
    expect(html()).toContain("AI 候选");
    expect(html()).toContain("OCR 候选");
    expect(html()).toContain("低置信度");
    expect(html()).toContain("待人工确认");

    // 回归：高影响字段无证据时「通过」被禁止的提示存在
    expect(html()).toContain("无法审核通过");
  });

  it("投影失败红条与版本链撤回流程", async () => {
    currentRun = makeRun("published");
    const { container, html } = await renderPage();

    // 已发布任务通过「查看」打开面板
    await click(findButton(container, "查看"));

    // 投影失败红条
    const projection = container.querySelector('[data-testid="projection-section"]');
    expect(projection).toBeTruthy();
    expect(projection!.textContent).toContain("投影失败：岗位单元缺少学校名称");
    expect(projection!.textContent).toContain("units[0].schoolName");
    expect(projection!.querySelector(".border-red-200")).toBeTruthy();

    // 版本链：v2 当前生效，可撤回
    const chain = container.querySelector('[data-testid="version-chain-section"]') as HTMLElement;
    expect(chain).toBeTruthy();
    expect(chain.textContent).toContain("v2");
    expect(chain.textContent).toContain("当前生效");

    await click(findButton(chain, "撤回"));

    // 填原因（必填）→ 确认撤回
    const reasonInput = chain.querySelector("input") as HTMLInputElement;
    expect(reasonInput).toBeTruthy();
    await act(async () => {
      setInputValue(reasonInput, "官方已撤销该公告");
    });
    await click(findButton(chain, "确认撤回"));

    // 调用撤回接口
    const withdrawCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/versions/v2/withdraw"));
    expect(withdrawCall).toBeTruthy();
    expect((withdrawCall![1] as RequestInit)?.method).toBe("POST");
    expect(JSON.parse(String((withdrawCall![1] as RequestInit)?.body))).toEqual({
      reason: "官方已撤销该公告",
    });

    // 刷新后显示已撤回 + 原因 + 操作人
    expect(html()).toContain("已撤回");
    expect(html()).toContain("撤回原因：官方已撤销该公告");
    expect(html()).toContain("操作人：运营管理员");
  });
});
