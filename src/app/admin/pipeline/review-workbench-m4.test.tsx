/**
 * M4：审核工作台效率优化测试。
 *
 * 覆盖验收（可离线测项）：
 * - M4-01：风险排序（冲突/遗漏优先）+ 每岗位未解决项数来自服务端；
 * - M4-01b：整岗位漏抽（清单零输出岗位）进入导航，可点进去看遗漏槽位；
 * - M4-03：edit 决策用 approve（fieldDecisions）持久化，不传 editedFields 覆盖；
 * - M4-05：409 并发冲突显示重新加载/比对引导，不静默覆盖；
 * - M4-09：切岗位前提示未保存变更。
 *
 * 其余（浏览器端到端、真实 DB 落库、焦点恢复实测）见 M4-report 未验证项。
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

interface RunLike {
  id: string;
  snapshotId: string;
  announcementId: string | null;
  parserVersion: string;
  status: string;
  progress: number;
  candidate: { fields: Array<Record<string, unknown>> };
  quality: Record<string, unknown> | null;
  checklistQuality: Record<string, unknown> | null;
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
          origin: "rule",
          anchor: { locator: { kind: "excerpt" }, excerpt: "杭州市" },
        },
        // 岗位 A：conflict headcount（高风险，应排最前）
        jobField("job_code", "3301A01", "job:3301A01", "3301A01"),
        {
          field: "headcount",
          value: "2",
          status: "conflict",
          scope: "job",
          jobScope: { key: "job:3301A01", jobCode: "3301A01" },
          origin: "rule",
          anchor: { locator: { kind: "worksheet", sheet: "岗位表", cell: "E2" } },
          alternatives: [
            { value: "2", excerpt: "岗位表 2 人" },
            { value: "3", excerpt: "附件 3 人" },
          ],
        },
        // 岗位 B：unknown degree（低风险）
        jobField("job_code", "3301A02", "job:3301A02", "3301A02"),
        {
          field: "degree",
          value: "",
          status: "unknown",
          scope: "job",
          jobScope: { key: "job:3301A02", jobCode: "3301A02" },
          origin: "rule",
        },
      ],
    },
    quality: {
      scopes: [
        { key: "announcement", expected: 1, extracted: 1, unknown: 0, conflict: 0, fieldNames: ["region"] },
        { key: "job:3301A01", expected: 2, extracted: 1, unknown: 0, conflict: 1, fieldNames: ["job_code", "headcount"] },
        { key: "job:3301A02", expected: 2, extracted: 1, unknown: 1, conflict: 0, fieldNames: ["job_code", "degree"] },
      ],
      missingEvidence: [],
      unconfirmedAuto: [],
      conflicts: [{ field: "headcount", scope: "job", jobKey: "job:3301A01", alternativeCount: 2 }],
      reviewBlockers: [],
      publishBlockers: [{ code: "conflict_field", field: "headcount", scope: "job", jobKey: "job:3301A01", alternativeCount: 2, message: "冲突字段未经人工裁决" }],
      metrics: { completeness: 0.6, adoptionRate: 0.6, editRate: 0 },
    },
    checklistQuality: null,
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
let reviewError: { status: number; message: string } | null = null;

const fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? "GET";
  if (u.endsWith("/api/announcements/runs")) return Promise.resolve(jsonResponse([currentRun]));
  if (u.includes("/runs/") && u.includes("/review") && method === "POST") {
    if (reviewError) {
      return Promise.resolve(jsonResponse({ message: reviewError.message }, { ok: false, status: reviewError.status }));
    }
    return Promise.resolve(jsonResponse(currentRun));
  }
  if (u.includes("/runs/")) return Promise.resolve(jsonResponse(currentRun));
  if (u.includes("/snapshots/snap-1/content")) {
    return Promise.resolve(jsonResponse({ content: "公告原文……", mimeType: "text/html" }));
  }
  if (u.includes("/snapshots/snap-1/parsed")) {
    return Promise.resolve(jsonResponse({ parseRun: null }));
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
  reviewError = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

// ==================== 测试 ====================

describe("M4 审核工作台效率优化", () => {
  it("M4-01：冲突岗位排最前，每岗位显示未解决项数", async () => {
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));

    // 默认选中风险最高的岗位（3301A01 有 conflict）
    const activeTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(activeTab?.textContent).toContain("3301A01");

    // 岗位 A 未解决 = 1（conflict），岗位 B 未解决 = 1（unknown）
    const badgeA = container.querySelector('[data-testid="nav-badge-job:3301A01"]');
    const badgeB = container.querySelector('[data-testid="nav-badge-job:3301A02"]');
    expect(badgeA?.textContent).toContain("1");
    expect(badgeB?.textContent).toContain("1");

    // 岗位 A（conflict）排在岗位 B（unknown）之前（风险 3 > 1）
    const tabTexts = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent ?? "");
    expect(tabTexts.findIndex((t) => t.includes("3301A01"))).toBeLessThan(
      tabTexts.findIndex((t) => t.includes("3301A02"))
    );
    expect(html()).toContain("岗位 3301A01");
  });

  it("M4-01b：清单里的漏抽岗位进入导航，可点进去看遗漏槽位", async () => {
    // 构造带 checklistQuality 的 run：清单含岗位 C（候选里没有）
    const runWithChecklist = makeRun("pending_review");
    runWithChecklist.checklistQuality = {
      hasChecklist: true,
      checklistVersion: 1,
      checklistSource: "independent",
      evaluation: {
        hasChecklist: true,
        checklistVersion: 1,
        slots: [],
        jobs: [
          { key: "job:3301A01", jobCode: "3301A01", results: [] },
          { key: "job:3301A02", jobCode: "3301A02", results: [] },
          {
            key: "job:3301A03",
            jobCode: "3301A03",
            results: [
              { field: "headcount", scope: "job", jobKey: "job:3301A03", declaredApplicability: "applicable", status: "should_have_but_missing" },
              { field: "major", scope: "job", jobKey: "job:3301A03", declaredApplicability: "applicable", status: "should_have_but_missing" },
            ],
          },
        ],
        announcement: [],
        metrics: { rawSlots: 6, notApplicable: 0, effectiveDenominator: 6, byStatus: {}, extracted: 4, missing: 2 },
      },
      fixedDenominatorCompleteness: 0.667,
      retrospective: false,
      completenessNotEvaluated: false,
    };
    currentRun = runWithChecklist;

    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));

    // 漏抽岗位 3301A03 出现在导航，且显示未解决 2
    expect(html()).toContain("岗位 3301A03");
    const badgeC = container.querySelector('[data-testid="nav-badge-job:3301A03"]');
    expect(badgeC?.textContent).toContain("2");

    // 点进去看到遗漏槽位视图
    await click(findButton(container, "岗位 3301A03"));
    expect(html()).toContain("疑似整岗位漏抽");
    expect(html()).toContain("headcount");
    expect(html()).toContain("major");
  });

  it("M4-03：edit 决策用 approve + fieldDecisions，不传 editedFields 覆盖", async () => {
    const { container } = await renderPage();
    await click(findButton(container, "去审核"));
    await click(findButton(container, "岗位 3301A02"));

    const fieldRow = container.querySelector('[data-testid="field-row-degree"]') as HTMLElement;
    await click(findButton(fieldRow, "修改"));
    const valueInput = fieldRow.querySelector("input") as HTMLInputElement;
    await act(async () => setInputValue(valueInput, "硕士及以上"));
    const fieldReason = container.querySelector('[data-testid="field-reason-degree"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(fieldReason, "附件为最新口径"));
    const overallReason = container.querySelector('[data-testid="overall-reason"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(overallReason, "逐字段核对完毕"));

    await click(findButton(container, "提交本分区审核"));

    const reviewCall = fetchMock.mock.calls.find(([u, i]) => String(u).includes("/review") && (i as RequestInit)?.method === "POST");
    const body = JSON.parse(String((reviewCall![1] as RequestInit)?.body));
    // 关键：action=approve（不是 approve_with_edit），且不传 editedFields
    expect(body.action).toBe("approve");
    expect(body.editedFields).toBeUndefined();
    const degreeDecision = body.fieldDecisions.find((d: { field: string }) => d.field === "degree");
    expect(degreeDecision.action).toBe("edit");
    expect(degreeDecision.afterValue).toBe("硕士及以上");
  });

  it("M4-05：409 并发冲突显示重新加载/比对引导", async () => {
    reviewError = { status: 409, message: "审核记录已被他人更新，请刷新后重试" };
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));
    await click(findButton(container, "岗位 3301A02"));

    const fieldRow = container.querySelector('[data-testid="field-row-degree"]') as HTMLElement;
    await click(findButton(fieldRow, "采用"));
    const fieldReason = container.querySelector('[data-testid="field-reason-degree"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(fieldReason, "与原文一致"));
    const overallReason = container.querySelector('[data-testid="overall-reason"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(overallReason, "核对完毕"));

    await click(findButton(container, "提交本分区审核"));

    // 显示重新加载引导（不是原文 409 英文）
    expect(html()).toContain("重新加载后再比对提交");
  });

  it("M4-09：无未保存变更时切岗位不弹窗", async () => {
    const { container, html } = await renderPage();
    await click(findButton(container, "去审核"));
    // 未做任何决策 → 切岗位直接切换，不弹窗
    await click(findButton(container, "岗位 3301A02"));
    expect(html()).not.toContain("有未保存的变更");
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("3301A02");
  });

  it("R02：专业字段可分阶段确认，写入结构化新值并随审核提交", async () => {
    currentRun = makeRun("pending_review");
    currentRun.candidate.fields.push(
      jobField("major", "汉语言文学（师范）", "job:3301A01", "3301A01"),
    );
    const { container } = await renderPage();
    await click(findButton(container, "去审核"));

    const fieldRow = container.querySelector('[data-testid="field-row-major"]') as HTMLElement;
    await click(findButton(fieldRow, "修改"));

    const namesInput = fieldRow.querySelector('[data-testid="major-names-input"]') as HTMLInputElement;
    await act(async () => setInputValue(namesInput, "汉语言文学、学科教学（语文）"));

    const bachelor = fieldRow.querySelector('[data-testid="major-stage-bachelor"]') as HTMLInputElement;
    const master = fieldRow.querySelector('[data-testid="major-stage-master"]') as HTMLInputElement;
    await act(async () => {
      bachelor.click();
      master.click();
    });

    // 多阶段时必须显式选择任一/同时口径（系统不默认猜测）
    expect(fieldRow.textContent).toContain("任一阶段符合即可");
    expect(fieldRow.textContent).toContain("各阶段均须符合");

    await click(fieldRow.querySelector('[data-testid="major-structured-apply"]') as HTMLElement);

    const newValueInput = fieldRow.querySelector('input[placeholder="输入 专业要求 的修正值"]') as HTMLInputElement;
    const structured = JSON.parse(newValueInput.value);
    expect(structured).toEqual({
      names: ["汉语言文学", "学科教学（语文）"],
      stages: ["bachelor", "master"],
      stageMode: "any",
    });

    const fieldReason = container.querySelector('[data-testid="field-reason-major"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(fieldReason, "岗位表分阶段口径已确认"));
    const overallReason = container.querySelector('[data-testid="overall-reason"]') as HTMLTextAreaElement;
    await act(async () => setTextareaValue(overallReason, "逐字段核对完毕"));

    await click(findButton(container, "提交本分区审核"));

    const reviewCall = fetchMock.mock.calls.find(
      ([u, i]) => String(u).includes("/review") && (i as RequestInit)?.method === "POST",
    );
    const body = JSON.parse(String((reviewCall![1] as RequestInit)?.body));
    const majorDecision = body.fieldDecisions.find((d: { field: string }) => d.field === "major");
    expect(majorDecision).toMatchObject({ action: "edit", afterValue: JSON.stringify(structured) });
  });
});
