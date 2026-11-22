/**
 * 旧路由兼容跳转（v5.2 → v6.1，以及 2026-11 导航合并产生的旧路由）：
 * 旧路径必须 307 到新路由（合并路由带页内标签参数），其余路径放行。
 *
 * Next.js 16 起 middleware → proxy，测试同步迁移。
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("旧路由兼容跳转", () => {
  it("/exam → /opportunities（307，保留查询参数）", () => {
    const res = proxy(request("/exam?target=t-1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/opportunities?target=t-1");
  });

  it("/today → /study（307）", () => {
    const res = proxy(request("/today"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/study");
  });

  it("/plan → /study（307）", () => {
    const res = proxy(request("/plan"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/study");
  });

  it("/history → /opportunities?tab=history（307）", () => {
    const res = proxy(request("/history"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/opportunities?tab=history");
  });

  it("/follows → /applications?tab=follows（307）", () => {
    const res = proxy(request("/follows"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/applications?tab=follows");
  });

  it("/schedule → /applications?tab=schedule（307）", () => {
    const res = proxy(request("/schedule"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/applications?tab=schedule");
  });

  it("/materials → /study?tab=materials（307）", () => {
    const res = proxy(request("/materials"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/study?tab=materials");
  });

  it("新路由与其他路径直接放行", () => {
    for (const p of ["/opportunities", "/applications", "/study", "/login", "/history/unit-x"]) {
      expect(proxy(request(p)).status).toBe(200);
    }
  });
});
