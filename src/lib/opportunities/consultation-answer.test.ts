/**
 * 官方咨询个人答复信封编码测试（v7.2 FR-3）。
 * 四态往返 + 旧纯文本/坏 JSON 向后兼容（解析永不抛错）。
 */
import { describe, expect, it } from "vitest";
import {
  CONSULTATION_OUTCOMES,
  encodeConsultationAnswer,
  parseConsultationAnswer,
} from "./consultation-answer";

describe("encodeConsultationAnswer", () => {
  for (const outcome of CONSULTATION_OUTCOMES) {
    it(`编码 ${outcome} 为 v=1 信封 JSON`, () => {
      const raw = encodeConsultationAnswer({
        outcome,
        note: "电话沟通记录",
        at: "2026-10-12T09:00:00+08:00",
      });
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual({
        v: 1,
        outcome,
        note: "电话沟通记录",
        at: "2026-10-12T09:00:00+08:00",
      });
    });
  }

  it("note 缺省为空字符串", () => {
    const raw = encodeConsultationAnswer({
      outcome: "not_contacted",
      at: "2026-10-12T09:00:00+08:00",
    });
    expect(JSON.parse(raw).note).toBe("");
  });
});

describe("parseConsultationAnswer", () => {
  it("四态编码往返", () => {
    for (const outcome of CONSULTATION_OUTCOMES) {
      const raw = encodeConsultationAnswer({
        outcome,
        note: "备注",
        at: "2026-10-12T09:00:00+08:00",
      });
      expect(parseConsultationAnswer(raw)).toEqual({
        outcome,
        note: "备注",
        at: "2026-10-12T09:00:00+08:00",
      });
    }
  });

  it("历史纯文本备注回退为 outcome=null 且原文不丢", () => {
    expect(parseConsultationAnswer("我自己打电话问过，应该可以报")).toEqual({
      outcome: null,
      note: "我自己打电话问过，应该可以报",
    });
  });

  it("空字符串/null/undefined 安全回退", () => {
    expect(parseConsultationAnswer("")).toEqual({ outcome: null, note: "" });
    expect(parseConsultationAnswer(null)).toEqual({ outcome: null, note: "" });
    expect(parseConsultationAnswer(undefined)).toEqual({ outcome: null, note: "" });
  });

  it("坏 JSON 不抛错，按纯文本保留", () => {
    expect(parseConsultationAnswer("{broken json")).toEqual({
      outcome: null,
      note: "{broken json",
    });
  });

  it("JSON 但信封版本/字段不合法时回退为纯文本", () => {
    expect(parseConsultationAnswer(JSON.stringify({ foo: 1 }))).toEqual({
      outcome: null,
      note: JSON.stringify({ foo: 1 }),
    });
    expect(
      parseConsultationAnswer(JSON.stringify({ v: 1, outcome: "weird" })),
    ).toEqual({
      outcome: null,
      note: JSON.stringify({ v: 1, outcome: "weird" }),
    });
  });

  it("信封中 note 不是字符串时安全降级为空 note", () => {
    const raw = JSON.stringify({ v: 1, outcome: "confirmed_match", note: 123 });
    expect(parseConsultationAnswer(raw).outcome).toBe("confirmed_match");
    expect(parseConsultationAnswer(raw).note).toBe("");
  });
});
