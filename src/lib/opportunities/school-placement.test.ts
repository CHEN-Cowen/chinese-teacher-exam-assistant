import { describe, expect, it } from "vitest";
import {
  ALLOCATION_UNKNOWN_SCHOOL_NOTE,
  deriveSchoolDisplay,
  schoolDisplayText,
} from "./school-placement";

describe("学校定岗展示派生：招聘单位/岗位组 ≠ 最终任教学校", () => {
  it("未显式登记时四种分配方式均为未知，并给对应官方口径说明", () => {
    for (const code of [
      "direct_school",
      "score_based_choice",
      "unified_assignment",
      "other",
    ]) {
      const display = deriveSchoolDisplay({
        allocation: { code, description: code },
      });
      expect(display.known).toBe(false);
      expect(display.schoolName).toBeNull();
      expect(display.note).toBe(ALLOCATION_UNKNOWN_SCHOOL_NOTE[code]);
    }
  });

  it("按分择岗：显示「录用后选岗，具体学校以官方安排为准」，绝不把岗位名当学校（苏州员额制场景）", () => {
    const text = schoolDisplayText({
      allocation: {
        code: "score_based_choice",
        description: "按总成绩从高到低依次择岗",
      },
    });
    expect(text).toBe("录用后选岗，具体学校以官方安排为准");
  });

  it("统一调配：明确显示录取后统一调配、具体学校以官方安排为准，不虚构学校", () => {
    const display = deriveSchoolDisplay({
      allocation: { code: "unified_assignment", description: "统一调配" },
    });
    expect(display.known).toBe(false);
    expect(display.note).toBe("录取后统一调配，具体学校以官方安排为准");
  });

  it("显式 specified 才展示官方岗位表列明的具体校名，传入地区时附市区", () => {
    const unit = {
      allocation: { code: "direct_school", description: "按报考学校直接定岗" },
      schoolPlacement: {
        status: "specified",
        schoolName: "杭州第二中学富春学校",
      },
    } as const;
    expect(schoolDisplayText(unit)).toBe("杭州第二中学富春学校");
    expect(schoolDisplayText(unit, "杭州市 富阳区")).toBe(
      "杭州第二中学富春学校（杭州市 富阳区）",
    );
  });

  it("显式 unspecified 的说明优先于分配方式默认文案", () => {
    const display = deriveSchoolDisplay({
      allocation: { code: "other", description: "其他" },
      schoolPlacement: {
        status: "unspecified",
        note: "预告批次只列岗位组，定岗学校以岗位计划表为准",
      },
    });
    expect(display).toEqual({
      known: false,
      schoolName: null,
      note: "预告批次只列岗位组，定岗学校以岗位计划表为准",
    });
  });

  it("未知分配码回退到 other 保守口径，不抛出也不虚构校名", () => {
    const display = deriveSchoolDisplay({
      allocation: { code: "unknown_future_code", description: "" },
    });
    expect(display.known).toBe(false);
    expect(display.note).toBe(ALLOCATION_UNKNOWN_SCHOOL_NOTE.other);
  });
});
