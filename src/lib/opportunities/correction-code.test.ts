import { describe, expect, it } from "vitest";
import { correctionTicketCode } from "./correction-code";

describe("correctionTicketCode", () => {
  it("取 id 末 6 位字母数字并大写，前缀 JC-", () => {
    expect(correctionTicketCode("cor-a1b2c3d4e5")).toBe("JC-C3D4E5");
    // 时间戳尾号恰为数字：末 6 位即编号
    expect(correctionTicketCode("demo-correction-1730000000000")).toBe(
      "JC-000000",
    );
  });

  it("非字母数字字符不参与编号", () => {
    expect(correctionTicketCode("ab-cd--ef")).toBe("JC-ABCDEF");
  });

  it("id 过短时用 0 补足 6 位", () => {
    expect(correctionTicketCode("ab")).toBe("JC-0000AB");
    expect(correctionTicketCode("")).toBe("JC-000000");
  });
});
