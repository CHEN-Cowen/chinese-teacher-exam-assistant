/**
 * 国内地图轻量入口测试（v7.1 M5）。
 *
 * 覆盖任务要求的八类场景：明确学校、同名学校含市区、只有区县、选岗待定、
 * 统一调配、地点完全未知、外链安全属性、点击前零地图请求、地图失败不影响页面。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMapEntry,
  MAP_LINK_LABEL,
  MAP_LINK_PROPS,
} from "./map-link";

/** 从链接中解出高德搜索词（keyword 参数） */
function keywordOf(url: string): string {
  const parsed = new URL(url);
  return parsed.searchParams.get("keyword") ?? "";
}

describe("buildMapEntry：链接策略", () => {
  it("有明确学校：市＋区＋学校名称，类别为 school", () => {
    const entry = buildMapEntry({
      city: "杭州市",
      district: "富阳区",
      schoolPlacement: { status: "specified", schoolName: "杭州第二中学富春学校" },
    })!;
    expect(entry.category).toBe("school");
    expect(keywordOf(entry.url)).toBe("杭州市富阳区杭州第二中学富春学校");
  });

  it("同名学校消歧：搜索词必须以市区开头，不能只有校名", () => {
    const entry = buildMapEntry({
      city: "宁波市",
      district: "鄞州区",
      schoolPlacement: { status: "specified", schoolName: "宁波外国语学校" },
    })!;
    const keyword = keywordOf(entry.url);
    expect(keyword.startsWith("宁波市鄞州区")).toBe(true);
    expect(keyword.endsWith("宁波外国语学校")).toBe(true);
  });

  it("只有区县（未登记定岗学校）：只打开市＋区，不标具体学校", () => {
    const entry = buildMapEntry({
      city: "杭州市",
      district: "滨江区",
    })!;
    expect(entry.category).toBe("district");
    expect(keywordOf(entry.url)).toBe("杭州市滨江区");
  });

  it("录用后选岗：只允许查看行政区，搜索词不含任何学校名", () => {
    const entry = buildMapEntry({
      city: "苏州市",
      district: "姑苏区",
      schoolPlacement: { status: "unspecified", note: "录用后选岗" },
    })!;
    expect(entry.category).toBe("district");
    const keyword = keywordOf(entry.url);
    expect(keyword).toBe("苏州市姑苏区");
    expect(keyword).not.toContain("学校");
  });

  it("统一调配：同样只给行政区，不制造学校点位", () => {
    const entry = buildMapEntry({
      city: "合肥市",
      district: "蜀山区",
      schoolPlacement: { status: "unspecified", note: "录取后统一调配" },
    })!;
    expect(entry.category).toBe("district");
    expect(keywordOf(entry.url)).toBe("合肥市蜀山区");
  });

  it("只有市没有区：打开该市，不猜测补齐区级", () => {
    const entry = buildMapEntry({ city: "杭州市" })!;
    expect(entry.category).toBe("district");
    expect(keywordOf(entry.url)).toBe("杭州市");
  });

  it("连市区也未明确：返回 null（页面隐藏地图按钮）", () => {
    expect(buildMapEntry({})).toBeNull();
    expect(buildMapEntry({ district: "鄞州区" })).toBeNull();
    expect(
      buildMapEntry({
        schoolPlacement: { status: "specified", schoolName: "某学校" },
      }),
    ).toBeNull();
  });

  it("链接为高德网页搜索：https uri.amap.com/search，callnative=0，关键词 URL 编码", () => {
    const entry = buildMapEntry({
      city: "南京市",
      district: "鼓楼区",
      schoolPlacement: { status: "specified", schoolName: "南京市芳草园小学" },
    })!;
    expect(entry.url.startsWith("https://uri.amap.com/search?")).toBe(true);
    expect(entry.url).toContain("callnative=0");
    expect(entry.url).toContain(
      `keyword=${encodeURIComponent("南京市鼓楼区南京市芳草园小学")}`,
    );
  });
});

describe("安全与隐私边界", () => {
  it("外链安全属性固定为 target=_blank + rel=noopener noreferrer", () => {
    expect(MAP_LINK_PROPS.target).toBe("_blank");
    expect(MAP_LINK_PROPS.rel).toContain("noopener");
    expect(MAP_LINK_PROPS.rel).toContain("noreferrer");
  });

  it("按钮文案固定为「在地图中查看 ↗」", () => {
    expect(MAP_LINK_LABEL).toBe("在地图中查看 ↗");
  });

  it("点击前零地图请求：实现模块不含任何自动网络/脚本/图片加载", () => {
    const source = readFileSync(join(__dirname, "map-link.ts"), "utf8");
    // 无 fetch/XHR/WebSocket/图片/脚本标签/定位 API
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|new Image|<script|geolocation/i);
    // 地图域名只允许出现在返回给用户的 href 字符串中（用户点击才请求）
    const component = readFileSync(
      join(__dirname, "../../components/opportunities/MapLink.tsx"),
      "utf8",
    );
    expect(component).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|new Image|geolocation/i);
  });

  it("地图失败不影响页面：入口是纯数据对象，构造失败路径只有 null（隐藏按钮），不抛异常", () => {
    // 各种残缺输入都不抛异常、只返回 null 或正常 entry
    expect(() =>
      buildMapEntry({ city: "  ", district: undefined, schoolPlacement: undefined }),
    ).not.toThrow();
    expect(buildMapEntry({ city: "  " })).toBeNull();
    expect(() =>
      buildMapEntry({
        city: "杭州市",
        schoolPlacement: { status: "specified", schoolName: "  " },
      }),
    ).not.toThrow();
    // 校名为空白时按未知处理：只给行政区
    const fallback = buildMapEntry({
      city: "杭州市",
      schoolPlacement: { status: "specified", schoolName: "  " },
    })!;
    expect(fallback.category).toBe("district");
  });
});
