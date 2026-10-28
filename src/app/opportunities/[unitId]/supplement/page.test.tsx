/**
 * D05 回归锁：/opportunities/[unitId]/supplement 的渲染通道必须跟随构建环境。
 *
 * 背景：该路由曾硬编码 mode="real"。demo 构建里 /opportunities 只服务浏览器
 * 本地演示岗位（无后端代理，/api 恒 503），已登录演示账号的补充保存会走
 * 受邀式 PATCH /api/profile → 503 → 整页「机会详情加载失败 / proxy not
 * configured」。修复后 mode 由构建期内联的 isDemoMode 决定（不读运行时 env）。
 *
 * 无 @testing-library 依赖，使用 createRoot + act（同仓库约定）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** vi.mock 提升：用持有者在用例间切换构建环境并捕获渲染入参 */
const holders = vi.hoisted(() => ({
  demo: true,
  receivedMode: undefined as string | undefined,
  receivedUnitId: undefined as string | undefined,
  receivedSearch: undefined as string | undefined,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ unitId: "unit-yinzhou-01" }),
  useSearchParams: () => new URLSearchParams("origin=detail&bucket=need_more_info"),
}));

vi.mock("@/lib/demo/config", () => ({
  get isDemoMode() {
    return holders.demo;
  },
  APP_ENV: "demo",
}));

vi.mock("@/components/opportunities/SupplementPageView", () => ({
  SupplementPageView: (props: {
    mode: string;
    unitId: string;
    searchParamsString: string;
  }) => {
    holders.receivedMode = props.mode;
    holders.receivedUnitId = props.unitId;
    holders.receivedSearch = props.searchParamsString;
    return null;
  },
}));

import SupplementPage from "./page";

describe("/opportunities/[unitId]/supplement：渲染通道随构建环境", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    holders.receivedMode = undefined;
    holders.receivedUnitId = undefined;
    holders.receivedSearch = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("demo 构建：以演示通道渲染（mode=demo），不透传受邀持久化", () => {
    holders.demo = true;
    act(() => {
      root.render(createElement(SupplementPage));
    });
    expect(holders.receivedMode).toBe("demo");
    // 路由参数照常透传
    expect(holders.receivedUnitId).toBe("unit-yinzhou-01");
    expect(holders.receivedSearch).toContain("origin=detail");
  });

  it("受邀构建：保持真实通道（mode=real）", () => {
    holders.demo = false;
    act(() => {
      root.render(createElement(SupplementPage));
    });
    expect(holders.receivedMode).toBe("real");
  });
});
