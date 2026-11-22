/**
 * 移动端主导航渲染测试（无 @testing-library 依赖，使用 react-dom/server）：
 * 验证四个入口（机会 / 我的报考 / 备考 / 我的）、激活态 aria-current 与可见文字
 * （状态不只靠颜色）。
 */
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let mockPathname = "/opportunities";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest }, children),
}));

import { BottomNav } from "./BottomNav";

function render() {
  return renderToString(createElement(BottomNav));
}

describe("BottomNav 移动端主导航", () => {
  it("渲染机会/我的报考/备考/我的四个入口（与桌面侧栏同一常量、顺序一致）", () => {
    mockPathname = "/opportunities";
    const html = render();
    expect(html).toContain("机会");
    expect(html).toContain("我的报考");
    expect(html).toContain("备考");
    expect(html).toContain("我的");
    // 2026-11 合并后旧入口标签不再出现
    expect(html).not.toContain("当年招聘");
    expect(html).not.toContain("往年参考");
    expect(html).not.toContain("我的关注");
    expect(html).not.toContain("我的资料");
    expect(html).not.toContain("设置");
    expect(html).not.toContain("日程");
    expect(html).toContain('href="/opportunities"');
    expect(html).toContain('href="/applications"');
    expect(html).toContain('href="/study"');
    expect(html).toContain('href="/me"');
    expect(html).not.toContain('href="/history"');
    expect(html).not.toContain('href="/follows"');
  });

  it("当前页带 aria-current=page 与「当前页面」文字提示", () => {
    mockPathname = "/applications";
    const html = render();
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("当前页面");
  });

  it("子路由高亮所属分区（/opportunities/<id> 高亮机会）", () => {
    mockPathname = "/opportunities/unit-hangzhou-01";
    const html = render();
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("当前页面");
  });

  it("备考页高亮备考入口", () => {
    mockPathname = "/study";
    const html = render();
    expect(html).toContain('aria-current="page"');
  });

  it("设置页无任何导航高亮", () => {
    mockPathname = "/settings";
    const html = render();
    expect(html).not.toContain('aria-current="page"');
  });
});
