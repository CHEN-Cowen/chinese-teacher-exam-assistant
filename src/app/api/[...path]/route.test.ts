import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("同源后端代理的身份边界", () => {
  it("受邀模式绝不转发浏览器自报的身份和角色", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "invited");
    vi.stubEnv("BACKEND_URL", "http://backend.internal:3000");
    vi.stubEnv("INTERNAL_TOKEN", "test-internal-token");
    vi.resetModules();
    const upstream = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost:3000/api/opportunities/match", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "attacker",
        "x-user-role": "admin",
      },
      body: "{}",
    });
    const response = await POST(request, { params: Promise.resolve({ path: ["opportunities", "match"] }) });
    expect(response.status).toBe(200);
    const headers = upstream.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-user-id")).toBeNull();
    expect(headers.get("x-user-role")).toBeNull();
    expect(headers.get("x-internal-token")).toBe("test-internal-token");
  });

  it("公开演示即使误配后端也不会代理业务请求", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "demo");
    vi.stubEnv("BACKEND_URL", "http://backend.internal:3000");
    vi.stubEnv("INTERNAL_TOKEN", "test-internal-token");
    vi.resetModules();
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost:3000/api/opportunities/match", {
      method: "POST",
      body: "{}",
    });
    const response = await POST(request, { params: Promise.resolve({ path: ["opportunities", "match"] }) });
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("M03/F5：把可信代理链的 x-forwarded-proto/for 转发给后端（req.secure 依据）", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "invited");
    vi.stubEnv("BACKEND_URL", "http://backend.internal:3000");
    vi.stubEnv("INTERNAL_TOKEN", "test-internal-token");
    vi.resetModules();
    const upstream = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("./route");
    // 模拟 Caddy 已重写后的转发头（proto 覆写、for 追加真实 IP）
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.7",
      },
      body: "{}",
    });
    await POST(request, { params: Promise.resolve({ path: ["auth", "login"] }) });
    const headers = upstream.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("M03/F5：明文请求（无转发头）不会编造 proto，后端据此拒绝正式登录", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "invited");
    vi.stubEnv("BACKEND_URL", "http://backend.internal:3000");
    vi.stubEnv("INTERNAL_TOKEN", "test-internal-token");
    vi.resetModules();
    const upstream = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await POST(request, { params: Promise.resolve({ path: ["auth", "login"] }) });
    const headers = upstream.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-forwarded-proto")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });
});
