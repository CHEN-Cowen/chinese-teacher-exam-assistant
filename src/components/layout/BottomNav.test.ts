/**
 * 移动端主导航渲染测试（无 @testing-library 依赖，使用 react-dom/server）：
 * 验证四个入口（U09）、激活态 aria-current 与可见文字（状态不只靠颜色）。
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
  it("渲染当年招聘/往年参考/我的关注/我的资料四个入口（顺序一致）", () => {
    mockPathname = "/opportunities";
    const html = render();
    expect(html).toContain("当年招聘");
    expect(html).toContain("往年参考");
    expect(html).toContain("我的关注");
    expect(html).toContain("我的资料");
    expect(html).not.toContain("备考");
    expect(html).not.toContain("设置");
    expect(html).not.toContain("日程");
    expect(html).toContain('href="/opportunities"');
    expect(html).toContain('href="/history"');
    expect(html).toContain('href="/follows"');
    expect(html).toContain('href="/me"');
  });

  it("当前页带 aria-current=page 与「当前页面」文字提示", () => {
    mockPathname = "/history";
    const html = render();
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("当前页面");
  });

  it("子路由高亮所属分区（/history/<id> 高亮往年参考）", () => {
    mockPathname = "/history/unit-hangzhou-01";
    const html = render();
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("当前页面");
  });

  it("二级页面无任何导航高亮（备考降级为次级入口）", () => {
    mockPathname = "/study";
    const html = render();
    expect(html).not.toContain('aria-current="page"');
  });

  it("日程页无任何导航高亮（日程为次级入口）", () => {
    mockPathname = "/schedule";
    const html = render();
    expect(html).not.toContain('aria-current="page"');
  });

  it("设置页无任何导航高亮", () => {
    mockPathname = "/settings";
    const html = render();
    expect(html).not.toContain('aria-current="page"');
  });
});
