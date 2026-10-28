import { describe, expect, it } from "vitest";
import type { AnnouncementVersion, ApplicationUnit, RecruitmentAnnouncement, Requirement } from "@/lib/announcements/types";
import type {
  EducationExperience,
  UserRecruitmentProfile,
} from "@/lib/profile/types";
import {
  buildCandidates,
  evaluateAnnouncement,
  evaluateOpportunity,
  evaluateRequirement,
  filterValidOpportunities,
  groupByMissingDimension,
  isValidOpportunity,
  sortCandidates,
} from "@/lib/matching/domain";
import {
  V61_NOW,
  V61_SCENARIO_IDS,
  V61_SEED_ANNOUNCEMENTS,
  V61_SEED_PROFILE,
} from "@/lib/seed/v61-opportunities";
import type { OpportunityCandidate } from "@/lib/matching/domain";

function findAnnouncement(id: string): RecruitmentAnnouncement {
  const found = V61_SEED_ANNOUNCEMENTS.find((a) => a.id === id);
  if (!found) throw new Error(`seed 中缺少公告 ${id}`);
  return found;
}

function candidateFor(id: string): OpportunityCandidate {
  const candidate = buildCandidates(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW).find(
    (c) => c.announcement.id === id,
  );
  if (!candidate) throw new Error(`seed 中缺少公告 ${id} 的候选结果`);
  return candidate;
}

describe("v6.1 匹配四档结果（seed 六场景）", () => {
  it("杭州：关键条件全部 PASS → 初步符合", () => {
    const { match } = candidateFor(V61_SCENARIO_IDS.eligible);
    expect(match.overall).toBe("preliminary_eligible");
    expect(match.dimensions.every((d) => d.value === "PASS")).toBe(true);
    expect(match.gates.every((g) => g.passed)).toBe(true);
  });

  it("宁波鄞州：缺户籍信息 → 补充信息后判断（UNKNOWN 不是 FAIL）", () => {
    const { match } = candidateFor(V61_SCENARIO_IDS.needHukou);
    expect(match.overall).toBe("need_more_info");
    const hukou = match.dimensions.find((d) => d.dimension === "hukou");
    expect(hukou?.value).toBe("UNKNOWN");
  });

  it("苏州：专业目录表述歧义 → 建议人工确认", () => {
    const { match } = candidateFor(V61_SCENARIO_IDS.majorAmbiguous);
    expect(match.overall).toBe("manual_review");
    const major = match.dimensions.find((d) => d.dimension === "major");
    expect(major?.value).toBe("MANUAL_REVIEW");
    // 歧义专业不得被自动判成不符合
    expect(major?.value).not.toBe("FAIL");
  });

  it("南京：硕士门槛 → 明确不符合", () => {
    const { match } = candidateFor(V61_SCENARIO_IDS.educationFail);
    expect(match.overall).toBe("not_eligible");
    const education = match.dimensions.find((d) => d.dimension === "education");
    expect(education?.value).toBe("FAIL");
    expect(match.summary).toContain("学历");
  });
});

describe("缺失信息永远不是不符合（回归）", () => {
  function requirementFor(dimension: Requirement["dimension"], criterion: Requirement["criterion"]): Requirement {
    return {
      id: `test-${dimension}`,
      dimension,
      description: "测试条件",
      hard: true,
      criterion,
      evidence: {
        id: `test-${dimension}-ev`,
        locator: { kind: "url", url: "https://example.gov.cn/test" },
        state: "official",
        checkedAt: V61_NOW,
      },
    };
  }

  it("未填出生日期：年龄条件只能 UNKNOWN，总结果不是明确不符合", () => {
    const req = requirementFor("age", { kind: "age", maxAgeYears: 30 });
    const result = evaluateRequirement(req, V61_SEED_PROFILE, V61_NOW);
    expect(result.value).toBe("UNKNOWN");

    const profile: UserRecruitmentProfile = { ...V61_SEED_PROFILE, birthDate: undefined };
    const announcement = findAnnouncement(V61_SCENARIO_IDS.eligible);
    const version: AnnouncementVersion = {
      ...announcement.versions[0],
      units: [
        {
          ...announcement.versions[0].units[0],
          requirements: [...announcement.versions[0].units[0].requirements, req],
        },
      ],
    };
    const match = evaluateOpportunity(
      { ...announcement, versions: [version] },
      version,
      version.units[0],
      profile,
      V61_NOW,
    );
    expect(match.overall).not.toBe("not_eligible");
    expect(match.overall).toBe("need_more_info");
  });

  it("未填社保/经历：对应条件均为 UNKNOWN", () => {
    // 画像未提供条件事实（区别于 seed 中明确填写的 socialSecurityMonths: 0）
    const profileWithoutFacts: UserRecruitmentProfile = {
      ...V61_SEED_PROFILE,
      socialSecurityMonths: undefined,
      workExperienceMonths: undefined,
    };

    const socialSecurity = evaluateRequirement(
      requirementFor("social_security", { kind: "social_security", requireNone: true }),
      profileWithoutFacts,
      V61_NOW,
    );
    expect(socialSecurity.value).toBe("UNKNOWN");

    const experience = evaluateRequirement(
      requirementFor("work_experience", { kind: "work_experience", minMonths: 12 }),
      profileWithoutFacts,
      V61_NOW,
    );
    expect(experience.value).toBe("UNKNOWN");
  });

  it("未填任何可接受地区：地区维度 UNKNOWN 而非 FAIL", () => {
    const profile: UserRecruitmentProfile = { ...V61_SEED_PROFILE, regions: [] };
    const results = evaluateAnnouncement(findAnnouncement(V61_SCENARIO_IDS.eligible), profile, V61_NOW);
    const region = results[0].dimensions.find((d) => d.dimension === "region");
    expect(region?.value).toBe("UNKNOWN");
    expect(results[0].overall).not.toBe("not_eligible");
  });

  it("未填教师资格情况（第 5 组暂不提供）：教师维度 UNKNOWN，不抛错也不判不符合", () => {
    const req = requirementFor("teacher_cert", {
      kind: "teacher_cert",
      subject: "chinese",
      stage: "middle",
      acceptInProgress: false,
    });
    const profileWithoutCert = {
      ...V61_SEED_PROFILE,
      teacherCert: undefined,
    } as unknown as UserRecruitmentProfile;
    const result = evaluateRequirement(req, profileWithoutCert, V61_NOW);
    expect(result.value).toBe("UNKNOWN");

    // 整体评估也不能因 teacherCert 缺省而抛 TypeError
    const match = evaluateOpportunity(
      findAnnouncement(V61_SCENARIO_IDS.eligible),
      findAnnouncement(V61_SCENARIO_IDS.eligible).versions[0],
      findAnnouncement(V61_SCENARIO_IDS.eligible).versions[0].units[0],
      profileWithoutCert,
      V61_NOW,
    );
    expect(match.overall).not.toBe("not_eligible");
  });
});

describe("D03 资格与求职偏好分离", () => {
  const jiangsuOnly: UserRecruitmentProfile = {
    ...V61_SEED_PROFILE,
    regions: [{ code: "320000", province: "江苏省", level: "required" }],
  };

  it("浙江岗位资格初步符合但地区不在必须接受范围 → preferenceOutOfScope，不计有效机会", () => {
    const candidate = buildCandidates(V61_SEED_ANNOUNCEMENTS, jiangsuOnly, V61_NOW).find(
      (c) => c.announcement.id === V61_SCENARIO_IDS.eligible,
    )!;
    const region = candidate.match.dimensions.find((d) => d.dimension === "region");
    expect(region?.value).toBe("FAIL");
    expect(region?.hard).toBe(false);
    expect(candidate.match.overall).toBe("preliminary_eligible");
    expect(candidate.match.preferenceOutOfScope).toBe(true);
    expect(isValidOpportunity(candidate.match)).toBe(false);
  });

  it("只有“可考虑/优先”地区时不排除岗位", () => {
    const profile: UserRecruitmentProfile = {
      ...V61_SEED_PROFILE,
      regions: [{ code: "340000", province: "安徽省", level: "preferred" }],
    };
    const candidate = buildCandidates(V61_SEED_ANNOUNCEMENTS, profile, V61_NOW).find(
      (c) => c.announcement.id === V61_SCENARIO_IDS.eligible,
    )!;
    expect(candidate.match.dimensions.find((d) => d.dimension === "region")?.value).toBe("PASS");
    expect(candidate.match.preferenceOutOfScope).toBeUndefined();
    expect(isValidOpportunity(candidate.match)).toBe(true);
  });

  it("资格硬性不符合时不做偏好范围外标记（仍为明确不符合）", () => {
    const profile: UserRecruitmentProfile = {
      ...V61_SEED_PROFILE,
      regions: [{ code: "110000", province: "北京市", level: "required" }],
    };
    const candidate = buildCandidates(V61_SEED_ANNOUNCEMENTS, profile, V61_NOW).find(
      (c) => c.announcement.id === V61_SCENARIO_IDS.educationFail,
    )!;
    expect(candidate.match.overall).toBe("not_eligible");
    expect(candidate.match.preferenceOutOfScope).toBeUndefined();
  });

  it("每个条件维度都带下一步动作，地区维度说明是偏好约束", () => {
    const { match } = candidateFor(V61_SCENARIO_IDS.eligible);
    expect(match.dimensions.every((d) => (d.nextStep ?? "").length > 0)).toBe(true);
    const region = match.dimensions.find((d) => d.dimension === "region");
    expect(region?.nextStep).toContain("偏好");
    expect(region?.userFact).toContain("必须接受");
  });
});

describe("D03 分阶段专业匹配", () => {
  function stagedProfile(
    experiences: EducationExperience[],
  ): UserRecruitmentProfile {
    return {
      ...V61_SEED_PROFILE,
      majorFullName: undefined,
      educationExperiences: experiences,
    };
  }

  const req = (
    stages?: NonNullable<EducationExperience["stage"]>[],
    mode?: "any" | "all",
  ): Requirement => ({
    id: "major-staged",
    dimension: "major",
    description: "公告要求的专业范围",
    hard: true,
    criterion: {
      kind: "major",
      majorNames: ["汉语言文学"],
      ...(stages ? { stages } : {}),
      ...(mode ? { stageMode: mode } : {}),
    },
    evidence: {
      id: "ev-major-staged",
      locator: { kind: "url", url: "https://example.gov.cn/a" },
      state: "official",
      checkedAt: V61_NOW,
    },
  });

  it("公告指定本科时只看本科专业，并返回采用的经历", () => {
    const profile = stagedProfile([
      { id: "b", stage: "bachelor", majorFullName: "汉语言文学", teacherTraining: "yes", majorConfirmed: true, source: "user" },
      { id: "m", stage: "master", majorFullName: "学科教学（语文）", teacherTraining: "no", majorConfirmed: true, source: "user" },
    ]);
    const result = evaluateRequirement(req(["bachelor"]), profile, V61_NOW);
    expect(result.value).toBe("PASS");
    expect(result.adoptedEducation?.[0]?.experienceId).toBe("b");
    expect(result.reason).toContain("本科");
  });

  it("公告要求本硕同时满足时，任一阶段不符 → FAIL", () => {
    const profile = stagedProfile([
      { id: "b", stage: "bachelor", majorFullName: "汉语言文学", teacherTraining: "yes", majorConfirmed: true, source: "user" },
      { id: "m", stage: "master", majorFullName: "学科教学（语文）", teacherTraining: "no", majorConfirmed: true, source: "user" },
    ]);
    expect(evaluateRequirement(req(["bachelor", "master"], "all"), profile, V61_NOW).value).toBe("FAIL");
  });

  it("公告未指定阶段时按最高学历阶段专业判断", () => {
    const profile = stagedProfile([
      { id: "b", stage: "bachelor", majorFullName: "汉语言文学", teacherTraining: "yes", majorConfirmed: true, source: "user" },
      { id: "m", stage: "master", majorFullName: "学科教学（语文）", teacherTraining: "no", majorConfirmed: true, source: "user" },
    ]);
    const result = evaluateRequirement(req(undefined), profile, V61_NOW);
    expect(result.value).toBe("FAIL");
    expect(result.adoptedEducation?.[0]?.stage).toBe("master");
  });

  it("公告要求某阶段专业但用户缺该阶段经历 → UNKNOWN", () => {
    const profile = stagedProfile([
      { id: "b", stage: "bachelor", majorFullName: "汉语言文学", teacherTraining: "yes", majorConfirmed: true, source: "user" },
    ]);
    expect(evaluateRequirement(req(["master"]), profile, V61_NOW).value).toBe("UNKNOWN");
  });

  it("迁移记录阶段未确认且专业未命中 → UNKNOWN，不判 FAIL", () => {
    const profile = stagedProfile([
      {
        id: "legacy-education",
        stage: "master",
        majorFullName: "中文教育",
        teacherTraining: "unknown",
        majorConfirmed: false,
        source: "legacy",
        stageNeedsConfirmation: true,
      },
    ]);
    const result = evaluateRequirement(req(undefined), profile, V61_NOW);
    expect(result.value).toBe("UNKNOWN");
    expect(result.reason).toContain("确认");
  });
});

describe("有效推荐过滤", () => {
  it("已截止机会不进入有效推荐（温州），但匹配结果仍可查看", () => {
    const closed = candidateFor(V61_SCENARIO_IDS.closed);
    expect(closed.match.gates.find((g) => g.code === "registration_closed")?.passed).toBe(false);
    expect(isValidOpportunity(closed.match)).toBe(false);
    // 资格本身其实符合，被排除仅因为截止
    expect(closed.match.overall).toBe("preliminary_eligible");
  });

  it("明确不符合不进入有效推荐（南京）", () => {
    const failed = candidateFor(V61_SCENARIO_IDS.educationFail);
    expect(isValidOpportunity(failed.match)).toBe(false);
  });

  it("有效推荐只含：杭州、宁波、苏州、合肥当前版本", () => {
    const candidates = buildCandidates(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);
    const valid = filterValidOpportunities(candidates);
    const validIds = new Set(
      candidates.filter((c) => valid.some((v) => v.unitId === c.unit.id)).map((c) => c.announcement.id),
    );
    expect(validIds).toEqual(
      new Set([
        V61_SCENARIO_IDS.eligible,
        V61_SCENARIO_IDS.needHukou,
        V61_SCENARIO_IDS.majorAmbiguous,
        V61_SCENARIO_IDS.supplemented,
      ]),
    );
  });

  it("未填地区时不产生有效推荐（不铺全量）", () => {
    const profile: UserRecruitmentProfile = { ...V61_SEED_PROFILE, regions: [] };
    const candidates = buildCandidates(V61_SEED_ANNOUNCEMENTS, profile, V61_NOW);
    expect(filterValidOpportunities(candidates)).toHaveLength(0);
  });

  it("缺失维度分组：户籍组至少包含宁波机会", () => {
    const candidates = buildCandidates(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);
    const groups = groupByMissingDimension(candidates);
    const hukouGroup = groups.find((g) => g.dimension === "hukou");
    expect(hukouGroup).toBeDefined();
    expect(hukouGroup!.candidates.some((c) => c.announcement.id === V61_SCENARIO_IDS.needHukou)).toBe(true);
  });

  it("默认排序：确定程度优先，初步符合排在补充/人工确认之前", () => {
    const candidates = buildCandidates(V61_SEED_ANNOUNCEMENTS, V61_SEED_PROFILE, V61_NOW);
    const sorted = sortCandidates(
      candidates.filter((c) => isValidOpportunity(c.match)),
      V61_SEED_PROFILE,
    );
    const firstThree = sorted.slice(0, 3).map((c) => c.announcement.id);
    expect(firstThree).toContain(V61_SCENARIO_IDS.eligible);
    const eligibleIndex = firstThree.indexOf(V61_SCENARIO_IDS.eligible);
    const manualIndex = firstThree.indexOf(V61_SCENARIO_IDS.majorAmbiguous);
    if (manualIndex >= 0) expect(eligibleIndex).toBeLessThan(manualIndex);
  });
});

describe("单元字段完整性", () => {
  it("seed 中所有单元均为语文学科，且证据锚点已官方核对", () => {
    const units: ApplicationUnit[] = V61_SEED_ANNOUNCEMENTS.flatMap((a) =>
      a.versions.flatMap((v) => v.units),
    );
    expect(units.length).toBe(8); // 6 个单版本场景 + 合肥 v1/v2
    expect(units.every((u) => u.subject === "chinese")).toBe(true);
    for (const announcement of V61_SEED_ANNOUNCEMENTS) {
      for (const v of announcement.versions) {
        expect(v.officialSource.state).toBe("official");
      }
    }
  });
});

describe("高风险回归（模块 9）：无官方来源不得进入主要推荐", () => {
  it("官方来源未经人工核对（ai_extracted/pending_review）时 no_official_source 闸门失败，即使资格全过也不是有效机会", () => {
    const base = candidateFor(V61_SCENARIO_IDS.eligible);
    const unverifiedVersion: AnnouncementVersion = {
      ...base.version,
      officialSource: {
        ...base.version.officialSource,
        state: "ai_extracted",
      },
    };
    const match = evaluateOpportunity(
      base.announcement,
      unverifiedVersion,
      base.unit,
      V61_SEED_PROFILE,
      V61_NOW,
    );
    const gate = match.gates.find((g) => g.code === "no_official_source");
    expect(gate?.passed).toBe(false);
    expect(isValidOpportunity(match)).toBe(false);
  });

  it("官方来源为 url 但没有 URL 时闸门同样失败", () => {
    const base = candidateFor(V61_SCENARIO_IDS.eligible);
    const noUrlVersion: AnnouncementVersion = {
      ...base.version,
      officialSource: {
        ...base.version.officialSource,
        state: "official",
        locator: { kind: "url" } as AnnouncementVersion["officialSource"]["locator"],
      },
    };
    const match = evaluateOpportunity(
      base.announcement,
      noUrlVersion,
      base.unit,
      V61_SEED_PROFILE,
      V61_NOW,
    );
    expect(match.gates.find((g) => g.code === "no_official_source")?.passed).toBe(false);
    expect(isValidOpportunity(match)).toBe(false);
  });
});

describe("模块 5：source_unavailable 闸门（官方来源巡检不可用）", () => {
  it("嘉兴 seed：报名窗口名义开放，但 sourceHealth.ok=false 时闸门失败并带上原因与巡检时间", () => {
    const base = candidateFor(V61_SCENARIO_IDS.sourceUnavailable);
    const match = evaluateOpportunity(
      base.announcement,
      base.version,
      base.unit,
      V61_SEED_PROFILE,
      V61_NOW,
    );
    const gate = match.gates.find((g) => g.code === "source_unavailable");
    expect(gate?.passed).toBe(false);
    expect(gate?.reason).toContain("404");
    expect(gate?.reason).toContain("2026-10-04");
    expect(isValidOpportunity(match)).toBe(false);
  });

  it("sourceHealth.ok=true（健康）时不阻断推荐", () => {
    const base = candidateFor(V61_SCENARIO_IDS.eligible);
    const healthy: typeof base.announcement = {
      ...base.announcement,
      sourceHealth: { ok: true, checkedAt: "2026-10-04T09:00:00+08:00" },
    };
    const match = evaluateOpportunity(
      healthy,
      base.version,
      base.unit,
      V61_SEED_PROFILE,
      V61_NOW,
    );
    expect(match.gates.find((g) => g.code === "source_unavailable")?.passed).toBe(true);
  });
});
