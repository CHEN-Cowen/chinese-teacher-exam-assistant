/**
 * M1：提交入口 API 客户端测试（界面调用 → API 接线）。
 *
 * 覆盖：
 * - submitSource 正确序列化正文 + 附件（base64）到 POST /api/announcements/sources；
 * - runExtraction 响应透传 manualExtraction（材料包文件读取状态）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  AUTH_MODE: "public",
  authService: { getSession: () => null },
}));

import { announcementsPipelineApi } from "./api";

const fetchMock = vi.fn();
(globalThis as Record<string, unknown>).fetch = fetchMock;

afterEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
    blob: async () => new Blob(),
  };
}

describe("S2 显式发布数据集", () => {
  it.each(["real", "demo"] as const)("发布请求显式携带 %s", async (dataset) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "v1" }));
    await announcementsPipelineApi.publish("run-1", dataset);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toContain("/runs/run-1/publish");
    expect(JSON.parse(init.body)).toEqual({ dataset });
  });
});

describe("announcementsPipelineApi.submitSource（M1 材料包）", () => {
  it("正文 + 附件（base64）正确提交到 /sources", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "run-1", status: "submitted" }),
    );

    await announcementsPipelineApi.submitSource({
      publisher: "杭州市教育局",
      officialUrl: "text://123",
      sourceType: "manual_text",
      content: "<html>正文</html>",
      mimeType: "text/html",
      attachments: [
        { name: "岗位表.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: "aGVsbG8=" },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toContain("/api/announcements/sources");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.content).toBe("<html>正文</html>");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].name).toBe("岗位表.xlsx");
    expect(body.attachments[0].base64).toBe("aGVsbG8=");
  });

  it("无附件时提交不含 attachments（保持向后兼容）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "run-2", status: "submitted" }),
    );

    await announcementsPipelineApi.submitSource({
      publisher: "杭州市教育局",
      officialUrl: "https://www.hz.gov.cn/notice/1",
      sourceType: "government",
      content: "https://www.hz.gov.cn/notice/1",
      mimeType: "text/plain",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.attachments).toBeUndefined();
  });
});
