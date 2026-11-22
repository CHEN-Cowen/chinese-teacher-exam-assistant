/**
 * RegionNoticeBrowser 组件测试（B2 省市区级联检索）。
 *
 * 验证：
 * - 省份/城市/区县选项由公告数据派生（唯一、排序）；
 * - 选择省份后城市选项联动收敛，公告列表同步过滤；
 * - 选择区县时保留该市的市级公告（district 为空覆盖全市）；
 * - 关键词命中标题或发布单位；
 * - 全部为空与筛选后为空分别呈现空状态。
 *
 * 无 @testing-library 依赖，使用 createRoot + act + dispatchEvent。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { listPublicNoticesMock } = vi.hoisted(() => ({
  listPublicNoticesMock: vi.fn(),
}));

vi.mock("@/lib/opportunities/api", () => ({
  opportunitiesApi: {
    listPublicNotices: listPublicNoticesMock,
  },
}));

import type { PublicNoticeDTO } from "@/lib/opportunities/api-types";
import { RegionNoticeBrowser } from "./RegionNoticeBrowser";

const CHECKED_AT = "2026-11-01T09:00:00+08:00";

function notice(
  overrides: Partial<PublicNoticeDTO> & {
    region: PublicNoticeDTO["region"];
    id: string;
    title: string;
  },
): PublicNoticeDTO {
  return {
    publisher: "某市教育局",
    province: overrides.region.province,
    subjects: ["chinese"],
    stages: ["middle"],
    checkedAt: CHECKED_AT,
    publishedAt: "2026-10-20T09:00:00+08:00",
    officialUrl: "https://gov.example.edu/notice",
    registrationStart: "2026-10-25",
    registrationEnd: "2026-11-20",
    ...overrides,
  } as PublicNoticeDTO;
}

const FIXTURES: PublicNoticeDTO[] = [
  notice({
    id: "n-hz-city",
    title: "2026年杭州市教育局直属学校公开招聘教师公告",
    region: { code: "330100", province: "浙江省", city: "杭州市", district: null },
  }),
  notice({
    id: "n-xiacheng",
    title: "2026年杭州市上城区公开招聘教师公告",
    region: { code: "330102", province: "浙江省", city: "杭州市", district: "上城区" },
  }),
  notice({
    id: "n-yinzhou",
    title: "2026年宁波市鄞州区公开招聘教师公告",
    region: { code: "330212", province: "浙江省", city: "宁波市", district: "鄞州区" },
  }),
  notice({
    id: "n-nanjing",
    title: "2026年南京市教育局直属学校公开招聘教师公告",
    region: { code: "320100", province: "江苏省", city: "南京市", district: null },
  }),
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderBrowser() {
  act(() => {
    root.render(createElement(RegionNoticeBrowser));
  });
}

function selectByTestId(testId: string): HTMLSelectElement {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`缺少 ${testId}`);
  return el;
}

function optionsOf(el: HTMLSelectElement): string[] {
  return Array.from(el.options).map((option) => option.value);
}

/** React 受控组件的值跟踪会吞掉直接赋值，必须用原生 setter 再派发事件 */
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
}

async function selectOption(testId: string, value: string) {
  const el = selectByTestId(testId);
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function cardTitles(): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="region-notice-card"]'),
  ).map((card) => card.querySelector("a")?.textContent ?? "");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  listPublicNoticesMock.mockReset();
  listPublicNoticesMock.mockResolvedValue(FIXTURES);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("RegionNoticeBrowser 省市区级联检索", () => {
  it("加载中呈现 Loading，就绪后省份选项由公告派生且唯一", async () => {
    renderBrowser();
    expect(
      container.querySelector('[data-testid="region-province-select"]'),
    ).toBeNull();
    await act(async () => {});
    const province = selectByTestId("region-province-select");
    expect(optionsOf(province)).toEqual(["", "江苏省", "浙江省"]);
    // 初始不过滤：4 条公告全量展示
    expect(cardTitles()).toHaveLength(4);
  });

  it("选择省份后城市选项联动收敛，列表只显示该省公告", async () => {
    renderBrowser();
    await act(async () => {});
    await selectOption("region-province-select", "浙江省");
    const city = selectByTestId("region-city-select");
    expect(optionsOf(city)).toEqual(["", "杭州市", "宁波市"]);
    const titles = cardTitles();
    expect(titles).toHaveLength(3);
    expect(titles.join("|")).not.toContain("南京市");
  });

  it("选择区县时保留该市的市级公告（district 为空覆盖全市）", async () => {
    renderBrowser();
    await act(async () => {});
    await selectOption("region-province-select", "浙江省");
    await selectOption("region-city-select", "杭州市");
    await selectOption("region-district-select", "上城区");
    const titles = cardTitles();
    expect(titles).toHaveLength(2);
    expect(titles.join("|")).toContain("上城区");
    expect(titles.join("|")).toContain("杭州市教育局直属学校");
  });

  it("关键词命中标题或发布单位", async () => {
    renderBrowser();
    await act(async () => {});
    const input = container.querySelector(
      '[data-testid="region-keyword"]',
    ) as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "南京");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const titles = cardTitles();
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain("南京市");
  });

  it("筛选组合无结果时呈现空状态而非报错", async () => {
    renderBrowser();
    await act(async () => {});
    const input = container.querySelector(
      '[data-testid="region-keyword"]',
    ) as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "不存在的关键词");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(cardTitles()).toHaveLength(0);
    expect(container.textContent).toContain("当前筛选下没有公告");
  });
});
