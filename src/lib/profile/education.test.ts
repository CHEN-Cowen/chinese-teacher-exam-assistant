import { describe, expect, it } from "vitest";
import type { UserRecruitmentProfile } from "./types";
import {
  buildLegacyEducationExperience,
  confirmLegacyStage,
  createEducationExperience,
  migrateEducationProfile,
  nextEducationStage,
  normalizeEducationExperience,
  normalizeEducationExperiences,
  resolveEducationFacts,
  validateEducationExperiences,
} from "./education";

const now = "2026-10-28T00:00:00.000Z";

function base(): UserRecruitmentProfile {
  return {
    regions: [{ code: "330000", province: "浙江省", level: "required" }],
    educationLevel: "master",
    degree: "master",
    majorFullName: "学科教学（语文）",
    graduationDate: "2026-06-15",
    acceptedEmploymentNatures: ["public_institution_staff"],
  };
}

describe("分阶段教育经历迁移", () => {
  it("旧单一字段生成一条待确认记录，原值完整保留", () => {
    const profile = base();
    const result = migrateEducationProfile(profile, now);
    expect(result.changed).toBe(true);
    expect(result.profile.majorFullName).toBe("学科教学（语文）");
    expect(result.profile.educationLevel).toBe("master");
    expect(result.profile.degree).toBe("master");
    expect(result.profile.graduationDate).toBe("2026-06-15");
    expect(result.profile.educationExperiences).toHaveLength(1);
    const legacy = result.profile.educationExperiences![0];
    expect(legacy.source).toBe("legacy");
    expect(legacy.stage).toBe("master");
    expect(legacy.stageNeedsConfirmation).toBe(true);
    expect(legacy.majorConfirmed).toBe(false);
    expect(legacy.status).toBe("graduated");
    expect(result.profile.legacyEducation).toEqual({ confirmed: false });
  });

  it("迁移幂等：已有经历时不再生成新记录", () => {
    const first = migrateEducationProfile(base(), now).profile;
    const second = migrateEducationProfile(first, now);
    expect(second.changed).toBe(false);
    expect(second.profile.educationExperiences).toHaveLength(1);
    expect(second.profile.educationExperiences![0].id).toBe("legacy-education");
  });

  it("没有任何旧事实时不迁移，也不臆造经历", () => {
    const profile: UserRecruitmentProfile = {
      regions: [],
      acceptedEmploymentNatures: [],
    };
    const result = migrateEducationProfile(profile, now);
    expect(result.changed).toBe(false);
    expect(result.profile.educationExperiences).toBeUndefined();
  });

  it("毕业时间在未来时迁移记录为在读", () => {
    const profile = { ...base(), graduationDate: "2027-06-15" };
    expect(buildLegacyEducationExperience(profile, now).status).toBe("in_progress");
  });

  it("确认阶段只改归属与确认标记，不改专业原文", () => {
    const migrated = migrateEducationProfile(base(), now).profile;
    const confirmed = confirmLegacyStage(
      migrated,
      "legacy-education",
      "bachelor",
      now,
    );
    const record = confirmed.educationExperiences![0];
    expect(record.stage).toBe("bachelor");
    expect(record.stageNeedsConfirmation).toBe(false);
    expect(record.majorConfirmed).toBe(true);
    expect(record.majorFullName).toBe("学科教学（语文）");
    expect(confirmed.majorFullName).toBe("学科教学（语文）");
    expect(confirmed.legacyEducation?.confirmed).toBe(true);
  });
});

describe("教育经历规整与校验", () => {
  it("拒绝不合法阶段，空专业保留到校验阶段", () => {
    expect(
      normalizeEducationExperience({ id: "a", majorFullName: "汉语言文学", stage: "phd" }),
    ).toBeNull();
    const emptyMajor = normalizeEducationExperience({ id: "a", majorFullName: "  " });
    expect(emptyMajor).not.toBeNull();
    expect(
      validateEducationExperiences([emptyMajor!]).map((issue) => issue.field),
    ).toContain("majorFullName");
  });

  it("只保留可解释字段，不补事实", () => {
    const normalized = normalizeEducationExperience({
      id: "b1",
      stage: "bachelor",
      majorFullName: " 汉语言文学（师范） ",
      teacherTraining: "yes",
      majorConfirmed: true,
      unexpected: "ignored",
    });
    expect(normalized).toMatchObject({
      id: "b1",
      stage: "bachelor",
      majorFullName: "汉语言文学（师范）",
      teacherTraining: "yes",
      majorConfirmed: true,
      source: "user",
    });
    expect(normalized).not.toHaveProperty("degree");
    expect(normalized).not.toHaveProperty("unexpected");
  });

  it("校验重复阶段、重复 id、空专业与非法日期", () => {
    const experiences = normalizeEducationExperiences([
      { id: "1", stage: "bachelor", majorFullName: "汉语言文学" },
      { id: "1", stage: "bachelor", majorFullName: "" },
      { id: "2", stage: "master", majorFullName: "学科教学（语文）", graduationDate: "not-a-date" },
    ]);
    const issues = validateEducationExperiences(experiences);
    const fields = issues.map((issue) => issue.field);
    expect(fields).toContain("id");
    expect(fields).toContain("stage");
    expect(fields).toContain("graduationDate");
  });

  it("用户填写的新记录必须有阶段", () => {
    const issues = validateEducationExperiences([
      { ...createEducationExperience(undefined, "x"), majorFullName: "汉语言文学" },
    ]);
    expect(issues.map((i) => i.field)).toContain("stage");
  });

  it("下一阶段按顺序取第一个未填写阶段", () => {
    const experiences = [createEducationExperience("bachelor", "1")];
    expect(nextEducationStage(experiences)).toBe("secondary");
  });
});

describe("解析匹配用教育事实", () => {
  it("多阶段时取最高阶段与对应专业", () => {
    const profile: UserRecruitmentProfile = {
      ...base(),
      educationExperiences: [
        { id: "b", stage: "bachelor", majorFullName: "汉语言文学（师范）", teacherTraining: "yes", majorConfirmed: true, source: "user" },
        { id: "m", stage: "master", majorFullName: "学科教学（语文）", degree: "master", teacherTraining: "no", majorConfirmed: true, source: "user" },
      ],
    };
    const facts = resolveEducationFacts(profile);
    expect(facts.highestStage).toBe("master");
    expect(facts.majorFullName).toBe("学科教学（语文）");
    expect(facts.adoptedExperienceId).toBe("m");
    expect(facts.fromLegacyFields).toBe(false);
  });

  it("无分阶段记录时回退旧字段", () => {
    const facts = resolveEducationFacts(base());
    expect(facts.fromLegacyFields).toBe(true);
    expect(facts.adoptedExperienceId).toBeNull();
    expect(facts.majorFullName).toBe("学科教学（语文）");
  });
});
