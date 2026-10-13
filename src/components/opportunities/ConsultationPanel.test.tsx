/**
 * ConsultationPanel 官方确认面板组件测试（v7.2 FR-3）。
 *
 * 验证：原因/原文/证据按字段有无渲染；问题可编辑、复制的是编辑后文本；
 * 复制失败有可见提示且不触发埋点；四态按钮保存信封 JSON；无 tel:/mailto:；
 * 个人答复记录展示与隔离文案；自由文本失焦保存路径。
 *
 * 无 @testing-library 依赖，使用 createRoot + act + dispatchEvent。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsultationPanel } from "./ConsultationPanel";
import { encodeConsultationAnswer } from "@/lib/opportunities/consultation-answer";
import type {
  ConsultationTemplateDTO,
  DimensionDTO,
} from "@/lib/opportunities/api-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TEMPLATE: ConsultationTemplateDTO = {
  dimensionKey: "major",
  dimensionLabel: "专业",
  question: "请问汉语言文学（师范）是否可以报考？",
};

function dimension(over: Partial<DimensionDTO> = {}): DimensionDTO {
  return {
    requirementId: "sz-major",
    dimension: "major",
    value: "MANUAL_REVIEW",
    reason: "公告使用「相关专业」开放表述，专业口径以招聘单位解释为准。",
    hard: true,
    requirementDescription:
      "中国语言文学类相关专业，师范类毕业生优先，具体专业口径以招聘单位解释为准。",
    evidence: {
      id: "ev-1",
      locator: {
        kind: "url",
        url: "https://rsks.suzhou.gov.cn/hr/2026/teacher-03",
        anchor: "岗位表第 2 行",
      },
      excerpt: "中国语言文学类相关专业，师范类毕业生优先。",
      state: "official",
      checkedAt: "2026-09-29T10:30:00+08:00",
    },
    ...over,
  };
}

const CONTACT = {
  publisher: "苏州高新区（虎丘区）教育局",
  officialUrl: "https://rsks.suzhou.gov.cn/hr/2026/teacher-03",
  contactInfo: "咨询电话：0512-68780000（工作日 9:00-17:00）",
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let writeTextMock: ReturnType<typeof vi.fn>;

function render(props: Parameters<typeof ConsultationPanel>[0]) {
  act(() => {
    root.render(createElement(ConsultationPanel, props));
  });
}

function setValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function blur(el: HTMLTextAreaElement) {
  // React 的 onBlur 在根节点委托监听 focusout（blur 不冒泡）
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const $ = (selector: string) => container.querySelector(selector) as Element | null;
const $$ = (selector: string) => Array.from(container.querySelectorAll(selector));

describe("ConsultationPanel v7.2", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("渲染原因、公告原文、证据位置/摘录/核对时间、发布主体与联系方式", () => {
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote: () => {},
    });
    expect(container.textContent).toContain("为什么需要你向官方确认");
    expect(container.textContent).toContain(dimension().reason!);
    expect(container.textContent).toContain("中国语言文学类相关专业");
    expect(container.textContent).toContain("岗位表第 2 行");
    expect(container.textContent).toContain("核对时间：2026-09-29 10:30");
    expect(container.textContent).toContain(CONTACT.publisher);
    expect(container.textContent).toContain(CONTACT.contactInfo);
  });

  it("字段缺失时不编造：无原文/证据/联系电话时对应内容不渲染并降级提示", () => {
    render({
      templates: [TEMPLATE],
      contact: { publisher: "某教育局", officialUrl: "https://x.example/blocked" },
      dimensions: [dimension({ reason: "", requirementDescription: undefined, evidence: undefined })],
      notes: null,
      busy: false,
      onSaveNote: () => {},
    });
    // 无 requirementDescription 时不渲染「公告原文」blockquote
    expect($("figure")).toBeNull();
    expect(container.textContent).not.toContain("原文位置与摘录");
    expect(container.textContent).toContain("公告未提供联系电话/邮箱");
    // 演示/虚构链接不当作官方入口
    expect($$('a[href*="example"]')).toHaveLength(0);
  });

  it("问题可编辑，复制的是编辑后的文本并回调 edited=true（正文不进埋点回调）", async () => {
    const onCopied = vi.fn();
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote: () => {},
      onCopied,
    });
    const textarea = $('textarea[data-testid="consult-question-major"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe(TEMPLATE.question);
    setValue(textarea, "编辑后的问题：师范类专业口径是什么？");
    await click($('button[data-testid="copy-question-major"]')!);
    expect(writeTextMock).toHaveBeenCalledWith("编辑后的问题：师范类专业口径是什么？");
    expect(onCopied).toHaveBeenCalledWith("major", true);
    // 回调参数只有维度枚举与布尔，没有正文
    expect(JSON.stringify(onCopied.mock.calls[0])).not.toContain("编辑后的问题");
    expect($('[data-testid="copy-question-feedback-major"]')?.textContent).toContain("已复制");
  });

  it("未编辑直接复制回调 edited=false", async () => {
    const onCopied = vi.fn();
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote: () => {},
      onCopied,
    });
    await click($('button[data-testid="copy-question-major"]')!);
    expect(onCopied).toHaveBeenCalledWith("major", false);
  });

  it("剪贴板失败：显示可见的失败提示，且不触发埋点回调", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("denied"));
    const onCopied = vi.fn();
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote: () => {},
      onCopied,
    });
    await click($('button[data-testid="copy-question-major"]')!);
    expect($('[data-testid="copy-question-feedback-major"]')?.textContent).toBe(
      "复制失败，请手动选择文本",
    );
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("复制联系方式拼接非空字段", async () => {
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote: () => {},
    });
    await click($('button[data-testid="copy-contact"]')!);
    const copied = writeTextMock.mock.calls[0][0] as string;
    expect(copied).toContain(CONTACT.publisher);
    expect(copied).toContain(CONTACT.contactInfo);
    expect(copied).toContain(CONTACT.officialUrl);
  });

  it("四态按钮：保存的是 v=1 信封 JSON（含 outcome/note/at），不乐观更新", () => {
    const onSaveNote = vi.fn();
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote,
    });
    const btn = $('button[data-testid="outcome-major-confirmed_match"]')!;
    // 未保存前按钮未按下
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    const [key, raw] = onSaveNote.mock.calls[0];
    expect(key).toBe("major");
    const envelope = JSON.parse(raw);
    expect(envelope).toMatchObject({ v: 1, outcome: "confirmed_match", note: "" });
    expect(typeof envelope.at).toBe("string");
  });

  it("已保存的结构化答复：按钮按下、记录展示；历史纯文本不显示四态记录", () => {
    const withEnvelope = encodeConsultationAnswer({
      outcome: "confirmed_match",
      note: "电话确认符合",
      at: "2026-10-11T09:00:00+08:00",
    });
    const rerender = (notes: Record<string, string> | null) =>
      render({
        templates: [TEMPLATE],
        contact: CONTACT,
        dimensions: [dimension()],
        notes,
        busy: false,
        onSaveNote: () => {},
      });
    rerender({ major: withEnvelope });
    expect(
      $('button[data-testid="outcome-major-confirmed_match"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect($('[data-testid="consult-record-major"]')?.textContent).toContain("电话确认符合");
    expect(container.textContent).toContain(
      "这是你的个人记录，不会变成所有用户的判断规则，也不会影响其他用户",
    );
    rerender({ major: "我自己随便记的纯文本" });
    expect($('[data-testid="consult-record-major"]')).toBeNull();
  });

  it("自由文本失焦：无四态时按纯文本保存；有四态时随信封重存", () => {
    const onSaveNote = vi.fn();
    const notes = {
      major: encodeConsultationAnswer({
        outcome: "still_unclear",
        note: "",
        at: "2026-10-10T00:00:00+08:00",
      }),
    };
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes,
      busy: false,
      onSaveNote,
    });
    const noteArea = $('textarea[data-testid="consult-note-major"]') as HTMLTextAreaElement;
    setValue(noteArea, "又问了一次还是没明确");
    blur(noteArea);
    const [, raw] = onSaveNote.mock.calls[0];
    expect(JSON.parse(raw)).toMatchObject({ v: 1, outcome: "still_unclear" });

    onSaveNote.mockClear();
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote,
    });
    const plainArea = $('textarea[data-testid="consult-note-major"]') as HTMLTextAreaElement;
    setValue(plainArea, "纯文本备注");
    blur(plainArea);
    expect(onSaveNote.mock.calls[0][1]).toBe("纯文本备注");
  });

  it("全面板不出现 tel: / mailto:（不自动拨号或发送）", () => {
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: false,
      onSaveNote: () => {},
    });
    expect(container.innerHTML).not.toContain("tel:");
    expect(container.innerHTML).not.toContain("mailto:");
  });

  it("busy 时所有交互控件禁用", () => {
    render({
      templates: [TEMPLATE],
      contact: CONTACT,
      dimensions: [dimension()],
      notes: null,
      busy: true,
      onSaveNote: () => {},
    });
    for (const el of $$("button, textarea")) {
      expect((el as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
