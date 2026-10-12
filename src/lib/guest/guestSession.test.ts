/**
 * v7.1 M2：两屏基础画像「暂不提供」机制与迁移纯函数测试。
 * 不变量：跳过只放宽采集门禁，不伪造画像事实；引擎侧缺字段只能 UNKNOWN。
 * v7.1 M2 变更：3 步 → 2 步；第一屏不允许跳过地区（消除"假跳过"）。
 */
import { describe, expect, it } from "vitest";
import {
  buildProfileLimitations,
  draftToProfile,
  hasMinimumPreviewProfile,
  isStepComplete,
  isStepSkipped,
  migrateSessionStep,
  pruneSkippedSteps,
  stepHasContent,
  TOTAL_PROFILE_STEPS,
  type GuestProfileDraft,
} from "./guestSession";

function partialDraft(overrides: Partial<GuestProfileDraft> = {}): GuestProfileDraft {
  return {
    regions: [],
    acceptedEmploymentNatures: [
      "public_institution_staff",
      "record_filing",
      "post_quota",
      "headcount_control",
      "other",
    ],
    ...overrides,
  };
}

describe("两屏模型常量", () => {
  it("TOTAL_PROFILE_STEPS = 2", () => {
    expect(TOTAL_PROFILE_STEPS).toBe(2);
  });
});

describe("跳过门禁：isStepComplete / isStepSkipped", () => {
  it("未跳过且内容为空：两屏都不算完成", () => {
    const draft = partialDraft();
    for (let step = 1; step <= TOTAL_PROFILE_STEPS; step += 1) {
      expect(isStepComplete(draft, step)).toBe(false);
    }
  });

  it("第一屏不允许跳过：即使有 skippedSteps 标记也不放行", () => {
    // 旧草稿可能残留 step 1 跳过标记
    const draft = partialDraft({ skippedSteps: [1] });
    expect(isStepSkipped(draft, 1)).toBe(true);
    // 但 isStepComplete 仍然要求 regions
    expect(isStepComplete(draft, 1)).toBe(false);
  });

  it("第二屏跳过时放行", () => {
    const draft = partialDraft({ skippedSteps: [2], regions: [{ code: "330000", province: "浙江省", level: "consider" }] });
    expect(isStepSkipped(draft, 2)).toBe(true);
    expect(isStepComplete(draft, 2)).toBe(true);
  });

  it("两屏全跳过（step 1 被 prune 移除后）：需选地区才能完成", () => {
    // 旧草稿 skippedSteps: [1,2,3]，prune 后 step 1/3 被移除
    const draft = partialDraft({ skippedSteps: [1, 2, 3] });
    const pruned = pruneSkippedSteps(draft);
    expect(pruned.skippedSteps).toEqual([2]);
    // step 1 不再跳过，且无 regions → 不算完成
    expect(isStepComplete(pruned, 1)).toBe(false);
    // step 2 跳过 → 算完成
    expect(isStepComplete(pruned, 2)).toBe(true);
  });

  it("最低门槛：至少选一个地区", () => {
    expect(hasMinimumPreviewProfile(partialDraft({ skippedSteps: [2] }))).toBe(false);
    expect(
      hasMinimumPreviewProfile(
        partialDraft({
          regions: [{ code: "330000", province: "浙江省", level: "consider" }],
        }),
      ),
    ).toBe(true);
  });
});

describe("pruneSkippedSteps：补填内容自动取消跳过 + 旧标记清理", () => {
  it("已跳过的步骤一旦填入实质内容，跳过标记自动移除", () => {
    const draft = partialDraft({
      skippedSteps: [2],
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      educationLevel: "bachelor",
    });
    const pruned = pruneSkippedSteps(draft);
    expect(pruned.skippedSteps ?? []).toEqual([]);
  });

  it("仍空缺的跳过标记保留；越界与旧 step 1/3 被清理", () => {
    const draft = partialDraft({ skippedSteps: [1, 2, 2, 3, 9, 0] });
    const pruned = pruneSkippedSteps(draft);
    expect(pruned.skippedSteps).toEqual([2]);
  });

  it("没有可规整内容时返回原引用", () => {
    const draft = partialDraft({ skippedSteps: [2] });
    expect(pruneSkippedSteps(draft)).toBe(draft);
  });

  it("旧 step 1 跳过标记在 prune 时被移除（v7.1 M2 不允许跳过地区）", () => {
    const draft = partialDraft({ skippedSteps: [1] });
    const pruned = pruneSkippedSteps(draft);
    expect(pruned.skippedSteps).toBeUndefined();
  });
});

describe("stepHasContent：只认真实内容，不认跳过标记", () => {
  it("第一屏选了地区才算有内容", () => {
    expect(
      stepHasContent(
        partialDraft({ regions: [{ code: "330000", province: "浙江省", level: "required" }] }),
        1,
      ),
    ).toBe(true);
    // 毕业时间不再属于第一屏
    expect(stepHasContent(partialDraft({ graduationDate: "2026-06-15" }), 1)).toBe(false);
  });

  it("第二屏填了学历/专业/毕业时间/证书任一项才算有内容", () => {
    expect(stepHasContent(partialDraft({ educationLevel: "bachelor" }), 2)).toBe(true);
    expect(stepHasContent(partialDraft({ majorFullName: "汉语言文学" }), 2)).toBe(true);
    expect(stepHasContent(partialDraft({ graduationDate: "2026-06-15" }), 2)).toBe(true);
    expect(stepHasContent(partialDraft({ teacherCert: { status: "obtained" } }), 2)).toBe(true);
    // 用工形式不再属于第二屏
    expect(stepHasContent(partialDraft({ acceptedEmploymentNatures: [] }), 2)).toBe(false);
  });
});

describe("buildProfileLimitations：以实际缺失为准", () => {
  it("完整画像没有限制项", () => {
    const draft = partialDraft({
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      educationLevel: "bachelor",
      majorFullName: "汉语言文学",
      graduationDate: "2026-06-15",
      teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
    });
    expect(buildProfileLimitations(draft)).toEqual([]);
  });

  it("跳过基础资格：限制列表包含第二屏且文案明确「不是不符合」", () => {
    const draft = partialDraft({
      skippedSteps: [2],
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
    });
    const limitations = buildProfileLimitations(draft);
    expect(limitations.map((l) => l.step)).toContain(2);
    const qualLimit = limitations.find((l) => l.step === 2)!;
    expect(qualLimit.impact).toContain("补充信息后判断");
    expect(qualLimit.impact).toContain("不会被当作不符合");
  });

  it("跳过标记还在但字段已补填：限制自动消失", () => {
    const draft = partialDraft({
      skippedSteps: [2],
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      educationLevel: "bachelor",
      majorFullName: "汉语言文学",
    });
    expect(buildProfileLimitations(draft).some((l) => l.step === 2)).toBe(false);
  });
});

describe("draftToProfile：跳过不伪造事实", () => {
  it("跳过第二屏且未选学科：按语文生成画像，teacherCert 留空", () => {
    const draft = partialDraft({
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      skippedSteps: [2],
    });
    const profile = draftToProfile(draft);
    expect(profile).not.toBeNull();
    expect(profile!.teacherCert).toBeUndefined();
    expect(profile!.educationLevel).toBeUndefined();
  });

  it("主动选了非语文学科：画像完整时仍然分流为 null（不跑匹配）", () => {
    const draft = partialDraft({
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      educationLevel: "bachelor",
      majorFullName: "数学与应用数学",
      graduationDate: "2026-06-15",
      teacherCert: { status: "obtained", subject: "math", stage: "middle" },
      intendedSubject: "math",
    });
    expect(draftToProfile(draft)).toBeNull();
  });

  it("旧草稿含 employmentStatus/degree：draftToProfile 透传不丢", () => {
    const draft = partialDraft({
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      educationLevel: "bachelor",
      degree: "bachelor",
      majorFullName: "汉语言文学",
      graduationDate: "2026-06-15",
      employmentStatus: "fresh_unemployed",
      teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
    });
    const profile = draftToProfile(draft);
    expect(profile).not.toBeNull();
    expect(profile!.employmentStatus).toBe("fresh_unemployed");
    expect(profile!.degree).toBe("bachelor");
  });
});

describe("migrateSessionStep：旧 step 迁移", () => {
  it("old step 0 → 0（未开始）", () => {
    expect(migrateSessionStep(0)).toBe(0);
  });

  it("old step 1 → 1（完成地区意向）", () => {
    expect(migrateSessionStep(1)).toBe(1);
  });

  it("old step 2 → 2（完成基础资格）", () => {
    expect(migrateSessionStep(2)).toBe(2);
  });

  it("old step 3 → 2（旧补充信息步骤取消，视为完成）", () => {
    expect(migrateSessionStep(3)).toBe(2);
  });

  it("old step 5 → 2（更早的 5 步草稿也归入 2 步）", () => {
    expect(migrateSessionStep(5)).toBe(2);
  });
});
