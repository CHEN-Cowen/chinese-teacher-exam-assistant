import { describe, expect, it } from "vitest";
import {
  checkOfficialUrl,
  submissionStatusMeta,
  validateSubmissionForm,
} from "./announcement-submission";

describe("checkOfficialUrl（D08 补录链接安全校验，与后端同口径）", () => {
  it("接受公网 http/https 链接并规范化（小写主机、去 hash 与结尾斜杠）", () => {
    expect(checkOfficialUrl("https://Example.Gov.CN/a/b?x=1#top")).toEqual({
      ok: true,
      normalized: "https://example.gov.cn/a/b?x=1",
    });
    expect(
      checkOfficialUrl("https://example.gov.cn:443/notice/").normalized,
    ).toBe("https://example.gov.cn/notice");
  });

  it("拒绝非 http(s)、本机、内网、保留地址与凭据 URL", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://example.gov.cn/a",
      "http://localhost/notice",
      "http://127.0.0.1/notice",
      "http://10.0.0.5/notice",
      "http://172.16.0.9/notice",
      "http://192.168.1.10/notice",
      "http://[::1]/notice",
      "http://[fe80::1]/notice",
      "http://[::ffff:192.168.0.1]/notice",
      "https://user:pass@example.gov.cn/a",
      "not-a-url",
      "",
    ]) {
      const result = checkOfficialUrl(bad);
      expect(result.ok).toBe(false);
      expect(result.message).toBeTruthy();
    }
  });
});

describe("validateSubmissionForm（D08 补录表单整体校验）", () => {
  const VALID = {
    officialUrl: "https://example.gov.cn/notice",
    publisherName: "某市教育局",
    regionCode: "330100",
    note: "未收录",
  };

  it("合法输入返回裁剪后的规范化值", () => {
    const result = validateSubmissionForm({
      ...VALID,
      publisherName: " 某市教育局 ",
      note: " 未收录 ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.publisherName).toBe("某市教育局");
      expect(result.value.note).toBe("未收录");
    }
  });

  it("逐项拒绝：空链接/坏链接、空单位、坏地区码、超长说明", () => {
    expect(validateSubmissionForm({ ...VALID, officialUrl: "" }).ok).toBe(false);
    expect(validateSubmissionForm({ ...VALID, officialUrl: "http://127.0.0.1/x" }).ok).toBe(false);
    expect(validateSubmissionForm({ ...VALID, publisherName: "  " }).ok).toBe(false);
    expect(validateSubmissionForm({ ...VALID, regionCode: "33" }).ok).toBe(false);
    expect(validateSubmissionForm({ ...VALID, note: "长".repeat(501) }).ok).toBe(false);
  });
});

describe("submissionStatusMeta（D08 状态文案映射）", () => {
  it("五档状态各有文案；未知状态回退原文", () => {
    expect(submissionStatusMeta("submitted").label).toBe("已提交");
    expect(submissionStatusMeta("reviewing").label).toBe("处理中");
    expect(submissionStatusMeta("need_supplement").label).toBe("需补充");
    expect(submissionStatusMeta("resolved").label).toBe("已处理");
    expect(submissionStatusMeta("rejected").label).toBe("暂未采纳");
    expect(submissionStatusMeta("other").label).toBe("other");
  });
});
