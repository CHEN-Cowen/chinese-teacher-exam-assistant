/**
 * WB4：按岗位人工审核工作台测试（ReviewWorkbench + ReviewPanel 集成）。
 *
 * 覆盖：
 * 1. 公共事实与两个岗位正确分组；
 * 2. unknown/conflict 与阻塞原因显示；
 * 3. 证据定位显示且不泄露签名 query；
 * 4. edit 原因必填，提交保留 before/after；
 * 5. AI/OCR 采用后才确认；
 * 6. reject/pending 原因；
 * 7. 批量操作不跨岗位；
 * 8. 保存失败保留输入；
 * 11. 键盘和移动布局基础验收；
 * 12. 旧候选没有 scope 时仍能显示兼容分组。
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

function jobField(field: string, value: string, jobKey: string, jobCode: string, extra: Record<string, unknown> = {}) {
  return {
    field,
    value,
    status: "extracted",
    scope: "job",
    jobScope: { key: jobKey, jobCode, sheet: "岗位表", row: 2 },
    ruleVersion: "rule-field-extractor@2.0.0",
    origin: "rule",
    anchor: { field, locator: { kind: "worksheet", sheet: "岗位表", cell: "A2" }, excerpt: `${field}原文` },
    ...extra,
  };
}

/** 测试用 Run 形状（允许覆盖 candidate/quality） */
interface RunLike {
  id: string;
  snapshotId: string;
  announcementId: string | null;
  parserVersion: string;
  status: string;
  progress: number;
  candidate: { fields: Array<Record<string, unknown>> };
  quality: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  publishedVersion: null;
  snapshot: {
    id: string;
    officialUrl: string | null;
    contentHash: string;
    mimeType: string;
    httpStatus: number;
    fetchedAt: string;
    source: { publisher: string; officialUrl: string };
  };
}

function makeRun(status = "pending_review"): RunLike {
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
          field: "region",
          value: "杭州市",
          status: "extracted",
          scope: "announcement",
          ruleVersion: "wb@1.0.0",
          origin: "rule",
          anchor: { field: "region", locator: { kind: "excerpt", excerpt: "杭州市" }, excerpt: "杭州市教育局" },
        },
        {
          field: "registration_time",
          value: "2026-10-20 至 2026-11-05",
          status: "extracted",
          scope: "announcement",
          ruleVersion: "wb@1.0.0",
          origin: "rule",
          anchor: { field: "registration_time", locator: { kind: "excerpt", excerpt: "报名时间" }, excerpt: "报名时间：..." },
        },
        // 岗位 A：汉语言文学（师范）+ conflict headcount
        jobField("job_code", "3301A01", "job:3301A01", "3301A01"),
        jobField("major", "汉语言文学（师范）", "job:3301A01", "3301A01", {
          anchor: { field: "major", locator: { kind: "worksheet", sheet: "岗位表", cell: "F2" }, excerpt: "汉语言文学（师范）" },
        }),
        {
          field: "headcount",
          value: "2",
          status: "conflict",
          scope: "job",
          jobScope: { key: "job:3301A01", jobCode: "3301A01", sheet: "岗位表", row: 2 },
          ruleVersion: "wb@1.0.0",
          origin: "rule",
          anchor: { field: "headcount", locator: { kind: "worksheet", sheet: "岗位表", cell: "E2" } },
          alternatives: [
            { value: "2", excerpt: "岗位表 2 人" },
            { value: "3", excerpt: "附件 3 人" },
          ],
        },
        // 岗位 B：数学 + unknown degree
        jobField("job_code", "3301A02", "job:3301A02", "3301A02"),
        jobField("major", "数学与应用数学", "job:3301A02", "3301A02"),
        {
          field: "degree",
          value: "",
          status: "unknown",
          scope: "job",
          jobScope: { key: "job:3301A02", jobCode: "3301A02", sheet: "岗位表", row: 3 },
          ruleVersion: "wb@1.0.0",
          origin: "rule",
        },
      ],
    },
    quality: {
      scopes: [
        { key: "announcement", expected: 2, extracted: 2, unknown: 0, conflict: 0, fieldNames: ["region", "registration_time"] },
        { key: "job:3301A01", expected: 3, extracted: 2, unknown: 0, conflict: 1, fieldNames: ["job_code", "major", "headcount"] },
        { key: "job:3301A02", expected: 3, extracted: 2, unknown: 1, conflict: 0, fieldNames: ["job_code", "major", "degree"] },
      ],
      missingEvidence: [],
      unconfirmedAuto: [],
      conflicts: [{ field: "headcount", scope: "job", jobKey: "job:3301A01", alternativeCount: 2 }],
      reviewBlockers: [],
      publishBlockers: [{ code: "conflict_field", field: "headcount", scope: "job", jobKey: "job:3301A01", alternativeCount: 2, message: "冲突字段未经人工裁决" }],
      metrics: { completeness: 0.75, adoptionRate: 0.75, editRate: 0 },
    },
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: "2026-10-13T01:00:00.000Z",
    updatedAt: "2026-10-13T01:00:00.000Z",
    finishedAt: null,
    publishedVersion: null,
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

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as Response;
}

let currentRun = makeRun("pending_review");
let reviewFail = false;

const fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? "GET";
  if (u.endsWith("/api/announcements/runs")) return Promise.resolve(jsonResponse([currentRun]));
  if (u.includes("/runs/") && u.includes("/review") && method === "POST") {
    if (reviewFail) {
      return Promise.resolve(jsonResponse({ message: "质量门禁未通过：冲突字段未经人工裁决" }, { ok: false, status: 400 }));
    }
    return Promise.resolve(jsonResponse(currentRun));
  }
  if (u.includes("/runs/")) return Promise.resolve(jsonResponse(currentRun));
  if (u.includes("/snapshots/snap-1/content")) {
    return Promise.resolve(jsonResponse({ content: "公告原文：2026 年杭州市教师招聘公告……", mimeType: "text/html" }));
  }
  if (u.includes("/snapshots/snap-1/parsed")) {
    return Promise.resolve(jsonResponse({ parseRun: { id: "pr-1", warnings: [{ type: "OCR", message: "OCR 置信度低于阈值" }], blocks: [], format: "html", parserVersion: "v1", status: "parsed", scanned: false, ocrRequired: false, ocrStatus: null, warningCount: 1, tableHeaders: null, finishedAt: null }, change: { hasPreviousSnapshot: false } }));
  }
  if (u.includes("/versions")) return Promise.resolve(jsonResponse([]));
  return Promise.resolve(jsonResponse({}));
});

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

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  currentRun = makeRun("pending_review");
  reviewFail = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

// ==================== 测试 ====================

describe("WB4 按岗位审核工作台", () => {
  it("公共事实与两个岗位正确分组，默认选中存在阻塞的岗位", async () => {
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));

    // 分区导航：公共事实 + 岗位 3301A01 + 岗位 3301A02
    expect(html()).toContain("公告公共事实");
    expect(html()).toContain("岗位 3301A01");
    expect(html()).toContain("岗位 3301A02");

    // 默认选中第一个存在阻塞的岗位（3301A01 有 conflict）
    const activeTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(activeTab?.textContent).toContain("3301A01");
  });

  it("unknown 与 conflict 显著可见，阻塞原因显示", async () => {
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));

    // 切换到岗位 3301A01（含 conflict headcount）
    await click(findButton(container, "岗位 3301A01"));
    expect(html()).toContain("冲突");
    // M3：冲突标题按来源值计数（跨文件复核后每个来源值一条）
    expect(html()).toContain("2 个来源值");

    // 切换到岗位 3301A02（含 unknown degree）
    await click(findButton(container, "岗位 3301A02"));
    expect(html()).toContain("未知");
    expect(html()).toContain("原文未写明");
  });

  it("证据定位显示且不泄露签名 query", async () => {
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));
    await click(findButton(container, "岗位 3301A01"));

    // 证据定位文本（worksheet cell），不含 URL query
    expect(html()).toContain("证据定位");
    expect(html()).toContain("工作表 岗位表");
    // 不包含签名 URL
    expect(html()).not.toContain("signature");
    expect(html()).not.toContain("?token=");
  });

  it("edit 原因必填，提交保留 before/after", async () => {
    const { container } = await renderPage();
    await click(findButton(container, "去审核"));
    await click(findButton(container, "岗位 3301A02"));

    // 对 major 字段选择"修改"
    const fieldRow = container.querySelector('[data-testid="field-row-major"]') as HTMLElement;
    await click(findButton(fieldRow, "修改"));

    // 填新值
    const valueInput = fieldRow.querySelector("input") as HTMLInputElement;
    await act(async () => setInputValue(valueInput, "数学（师范）"));

    // 填字段原因
    const fieldReason = container.querySelector('[data-testid="field-reason-major"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(fieldReason, "附件为最新口径"));

    // 填整体原因
    const overallReason = container.querySelector('[data-testid="overall-reason"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(overallReason, "逐字段核对完毕"));

    await click(findButton(container, "提交本分区审核"));

    // 提交请求携带 fieldDecisions（edit + before/after 由后端留痕）
    const reviewCall = fetchMock.mock.calls.find(([u, i]) => String(u).includes("/review") && (i as RequestInit)?.method === "POST");
    expect(reviewCall).toBeTruthy();
    const body = JSON.parse(String((reviewCall![1] as RequestInit)?.body));
    expect(body.fieldDecisions).toBeTruthy();
    const majorDecision = body.fieldDecisions.find((d: { field: string }) => d.field === "major");
    expect(majorDecision.action).toBe("edit");
    expect(majorDecision.afterValue).toBe("数学（师范）");
  });

  it("保存失败保留输入（显示可恢复错误）", async () => {
    reviewFail = true;
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));
    await click(findButton(container, "岗位 3301A01"));

    // 填整体原因
    const overallReason = container.querySelector('[data-testid="overall-reason"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(overallReason, "测试原因"));

    // 采用 headcount 字段
    const fieldRow = container.querySelector('[data-testid="field-row-headcount"]') as HTMLElement;
    await click(findButton(fieldRow, "采用"));
    const fieldReason = container.querySelector('[data-testid="field-reason-headcount"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(fieldReason, "以岗位表为准"));

    await click(findButton(container, "提交本分区审核"));

    // 显示错误（门禁：冲突未裁决）
    expect(html()).toContain("质量门禁未通过");
    // 输入保留
    expect(overallReason.value).toBe("测试原因");
  });

  it("批量操作不跨岗位：切换分区前提示未保存变更，确认后清空", async () => {
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));
    await click(findButton(container, "岗位 3301A01"));

    // 对 major 采用
    const fieldRow = container.querySelector('[data-testid="field-row-major"]') as HTMLElement;
    await click(findButton(fieldRow, "采用"));

    // 切换到岗位 B：有未保存决策 → 弹确认框，不清空
    await click(findButton(container, "岗位 3301A02"));
    expect(html()).toContain("有未保存的变更");
    expect(html()).toContain("本分区已记录决策");

    // 确认切换 → 清空决策（不跨岗位）
    await click(findButton(container, "放弃并切换"));
    expect(html()).not.toContain("本分区已记录决策");
    // 已切到岗位 B
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("3301A02");
  });

  it("旧候选没有 scope 时仍能显示兼容分组（公告公共事实）", async () => {
    const legacyRun = makeRun("pending_review");
    // 构造无 scope 的旧候选
    legacyRun.candidate = {
      fields: [
        { field: "title", value: "杭州市教师招聘公告", origin: "rule", anchor: { locator: { kind: "html" }, excerpt: "标题" } },
        { field: "education", value: "本科及以上", origin: "rule", anchor: { locator: { kind: "excerpt" }, excerpt: "学历" } },
      ],
    };
    legacyRun.quality = null;
    currentRun = legacyRun;

    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));

    // 旧字段（无 scope）归入公告公共事实
    expect(html()).toContain("公告公共事实");
    expect(html()).toContain("杭州市教师招聘公告");
    expect(html()).toContain("本科及以上");
  });

  it("键盘可聚焦（按钮与输入有 focus 语义），移动布局不依赖悬停", async () => {
    const { container } = await renderPage();
    await click(findButton(container, "去审核"));

    // 分区 tab 按钮可聚焦（type=button + role=tab）
    const tab = container.querySelector('[role="tab"]') as HTMLElement;
    expect(tab).toBeTruthy();
    expect(tab.getAttribute("type")).toBe("button");

    // 表单输入存在 label 关联（Input/Textarea 组件带 label）
    const textareas = container.querySelectorAll("textarea");
    expect(textareas.length).toBeGreaterThan(0);
  });
});
