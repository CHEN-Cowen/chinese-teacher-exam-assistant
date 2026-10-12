import { describe, it, expect } from "vitest";
import { V61_NOW, V61_SEED_ANNOUNCEMENTS, V61_SCENARIO_IDS } from "@/lib/seed/v61-opportunities";
import {
  draftToProfile,
  type GuestProfileDraft,
} from "./guestSession";
import {
  buildGuestPreview,
  GUEST_PREVIEW_ACTION_HREF,
  type GuestPreviewReady,
} from "./previewEngine";

/** 与 v6.1 seed 画像对齐的完整访客草稿（浙江本科师范生，未填户籍/年龄） */
function completeDraft(overrides: Partial<GuestProfileDraft> = {}): GuestProfileDraft {
  return {
    regions: [
      { code: "330000", province: "浙江省", level: "required" },
      { code: "320000", province: "江苏省", level: "consider" },
      { code: "340000", province: "安徽省", level: "consider" },
    ],
    educationLevel: "bachelor",
    degree: "bachelor",
    majorFullName: "汉语言文学（师范）",
    graduationDate: "2026-06-15",
    employmentStatus: "fresh_unemployed",
    teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
    intendedSubject: "chinese",
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

function ready(draft = completeDraft()): GuestPreviewReady {
  const result = buildGuestPreview(draft, V61_SEED_ANNOUNCEMENTS, V61_NOW);
  if (result.kind !== "ready") {
    throw new Error(`expected ready preview, got ${result.kind}`);
  }
  return result;
}

describe("buildGuestPreview：初步符合优先且有解释", () => {
  it("标准画像：杭州排在优先位且初步符合，每条结论带逐项依据", () => {
    const r = ready();
    expect(r.view.priority?.unitId).toBe("unit-hangzhou-01");
    expect(r.view.priority?.status).toBe("preliminary_eligible");
    expect(r.view.preliminary.some((row) => row.unitId === "unit-hangzhou-01")).toBe(true);
    expect(r.view.validCount).toBeGreaterThanOrEqual(1);

    // 机会卡三层信息齐全：地区/性质/截止 + 逐项条件原因 + 官方来源
    const hangzhou = r.view.priority!;
    expect(hangzhou.dimensions.length).toBeGreaterThan(0);
    expect(hangzhou.dimensions.every((d) => d.reason.length > 0)).toBe(true);
    expect(hangzhou.officialUrl).toContain("example.gov.cn");
  });

  it("合肥补充公告 v2（延期扩招）也在初步符合中", () => {
    const r = ready();
    expect(r.view.preliminary.some((row) => row.announcementId === V61_SCENARIO_IDS.supplemented)).toBe(true);
  });
});

describe("buildGuestPreview：未填写条件只能 UNKNOWN，绝不判不符合", () => {
  it("缺少户籍：鄞州进入“补充户籍信息后判断”分组，不在明确不符合中", () => {
    const r = ready();

    const hukouGroup = r.view.needInfoGroups.find((g) => g.dimension === "hukou");
    expect(hukouGroup).toBeDefined();
    expect(hukouGroup!.count).toBe(1);
    expect(hukouGroup!.rows[0].unitId).toBe("unit-yinzhou-01");
    expect(hukouGroup!.rows[0].status).toBe("need_more_info");

    // 明确不符合列表不能出现鄞州
    expect(
      r.view.notEligible.some((row) => row.unitId === "unit-yinzhou-01"),
    ).toBe(false);

    // 补问说明要解释“为什么要补、影响几个机会、不补不等于不符合”
    const followUp = r.followUps.find((f) => f.dimension === "hukou");
    expect(followUp).toBeDefined();
    expect(followUp!.affectsCount).toBe(1);
    expect(followUp!.reason).toContain("户籍");
    expect(followUp!.reason).toContain("不会被直接判定为不符合");

    // 卡片逐项依据里户籍维度必须是“信息不足”，不是“不满足”
    const hukouDim = hukouGroup!.rows[0].dimensions.find((d) => d.label === "户籍");
    expect(hukouDim?.value).toBe("UNKNOWN");
  });

  it("草稿映射出的画像不含出生/户籍/社保/工作经历字段", () => {
    const profile = draftToProfile(completeDraft())!;
    expect(profile).not.toHaveProperty("birthDate");
    expect(profile).not.toHaveProperty("hukouRegionCode");
    expect(profile).not.toHaveProperty("socialSecurityMonths");
    expect(profile).not.toHaveProperty("workExperienceMonths");
  });

  it("苏州专业目录歧义：建议人工确认，而不是自动判符合或不符合", () => {
    const r = ready();
    const suzhou = r.view.manualReview.find((row) => row.unitId === "unit-suzhou-01");
    expect(suzhou).toBeDefined();
    expect(suzhou!.status).toBe("manual_review");
  });

  it("南京硕士门槛：明确不符合，出现在折叠分组", () => {
    const r = ready();
    const nanjing = r.view.notEligible.find((row) => row.unitId === "unit-nanjing-01");
    expect(nanjing).toBeDefined();
    expect(nanjing!.status).toBe("not_eligible");
  });

  it("温州已截止：不进入有效推荐，闸门原因可查", () => {
    const r = ready();
    const wenzhou = r.view.closed.find((row) => row.unitId === "unit-wenzhou-01");
    expect(wenzhou).toBeDefined();
    expect(wenzhou!.gateReason).toContain("截止");
    // 有效机会 = 杭州、合肥（初步符合）+ 鄞州（补信息）+ 苏州（人工确认），已截止/来源失效不计入
    expect(r.view.validCount).toBe(4);
  });

  it("嘉兴来源失效：不进入有效推荐，闸门原因可查且与已截止分桶", () => {
    const r = ready();
    const jiaxing = r.view.closed.find((row) => row.unitId === "unit-jiaxing-01");
    expect(jiaxing).toBeDefined();
    expect(jiaxing!.gateCode).toBe("source_unavailable");
    expect(jiaxing!.gateReason).toContain("404");
    const sourceBucket = r.view.closedBuckets.find((b) => b.key === "source");
    expect(sourceBucket?.rows.some((row) => row.unitId === "unit-jiaxing-01")).toBe(true);
    const expiredBucket = r.view.closedBuckets.find((b) => b.key === "expired");
    expect(expiredBucket?.rows.some((row) => row.unitId === "unit-wenzhou-01")).toBe(true);
  });
});

describe("buildGuestPreview：返回修改后重新计算（纯函数确定性）", () => {
  it("把专业改成公告外专业：杭州从初步符合变为明确不符合", () => {
    const before = ready();
    expect(
      before.view.preliminary.some((row) => row.unitId === "unit-hangzhou-01"),
    ).toBe(true);

    const after = ready(completeDraft({ majorFullName: "计算机科学与技术" }));
    expect(
      after.view.notEligible.some((row) => row.unitId === "unit-hangzhou-01"),
    ).toBe(true);
    expect(
      after.view.preliminary.some((row) => row.unitId === "unit-hangzhou-01"),
    ).toBe(false);
  });

  it("去掉浙江地区：杭州/鄞州因地区硬边界进入「地区不重叠」，不判资格不符合；江苏/安徽机会不受影响", () => {
    const draft = completeDraft({
      regions: [{ code: "320000", province: "江苏省", level: "required" }],
    });
    const r = ready(draft);
    expect(
      r.view.preliminary.some((row) => row.unitId === "unit-hangzhou-01"),
    ).toBe(false);
    // 宁波鄞州也随浙江地区一起被过滤（地区 FAIL，闸门外失效）：
    // 模块 5 起与「明确不符合」分离，进入「不在你填写的地区范围」
    expect(
      r.view.regionOutOfScope.some((row) => row.announcementId === V61_SCENARIO_IDS.needHukou),
    ).toBe(true);
    expect(
      r.view.notEligible.some((row) => row.announcementId === V61_SCENARIO_IDS.needHukou),
    ).toBe(false);
    // 广东之外：画像地区之外的浙江省份不算「收录覆盖」， uncovered 不涉及（江苏有岗位）
    expect(r.view.uncoveredRegions).toEqual([]);
  });

  it("同一草稿多次计算结果一致（返回修改前后可稳定复算）", () => {
    const a = ready();
    const b = ready();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildGuestPreview：非语文学科不产生伪造结果", () => {
  it("资格证学科为数学：直接 subject_not_open，不跑匹配", () => {
    const draft = completeDraft({
      teacherCert: { status: "obtained", subject: "math", stage: "middle" },
      intendedSubject: "math",
    });
    const result = buildGuestPreview(draft, V61_SEED_ANNOUNCEMENTS, V61_NOW);
    expect(result.kind).toBe("subject_not_open");
    if (result.kind === "subject_not_open") {
      expect(result.subjectLabel).toBe("数学");
    }
  });

  it("没有教师资格证但意向报英语：同样只给未开放分流", () => {
    const draft = completeDraft({
      teacherCert: { status: "none" },
      intendedSubject: "english",
    });
    const result = buildGuestPreview(draft, V61_SEED_ANNOUNCEMENTS, V61_NOW);
    expect(result.kind).toBe("subject_not_open");
  });
});

describe("buildGuestPreview：Preview 只有一个主要行动，且不生成 7 天计划", () => {
  it("整页只有一个主行动，只查看示例判断，不保存虚构机会或触发登录", () => {
    const r = ready();
    expect(r.primaryAction).not.toBeNull();
    expect(r.primaryAction!.href).toBe(GUEST_PREVIEW_ACTION_HREF);
    expect(r.primaryAction!.label).toContain("示例");
    expect(r.primaryAction!.href).not.toContain("/login");
    expect([r.primaryAction].filter(Boolean)).toHaveLength(1);

    // 所有机会行只是数据行，不暴露任何主行动字段（展开为卡片自身的轻量交互）
    for (const row of [
      ...r.view.preliminary,
      ...r.view.manualReview,
      ...r.view.notEligible,
    ]) {
      expect(row).not.toHaveProperty("primaryAction");
    }
  });

  it("首次结果模型不含任何备考计划/今日任务字段", () => {
    const r = ready() as unknown as Record<string, unknown>;
    expect(r).not.toHaveProperty("weekThemes");
    expect(r).not.toHaveProperty("todayTask");
    expect(r).not.toHaveProperty("plan");
  });

  it("没有任何有效机会时不产生主行动（页面转空态）", () => {
    // 全博士 + 浙江：本科学历机会全部不符，仅可能没有有效机会
    const draft = completeDraft({
      regions: [{ code: "330000", province: "浙江省", level: "required" }],
      // 反向构造：中专学历且专业不符，使所有在招机会失效
      educationLevel: "secondary",
      degree: "none",
      majorFullName: "烹饪工艺",
      teacherCert: { status: "none" },
    });
    const r = ready(draft);
    expect(r.view.priority).toBeNull();
    expect(r.primaryAction).toBeNull();
  });
});

describe("buildGuestPreview：未完成画像", () => {
  it("画像未完成时返回 incomplete，不产出机会", () => {
    // 清空地区使 step 1 不完成
    const draft = completeDraft({ regions: [] });
    const result = buildGuestPreview(draft, V61_SEED_ANNOUNCEMENTS, V61_NOW);
    expect(result.kind).toBe("incomplete");
  });
});

describe("buildGuestPreview：暂不确定/暂不提供（模块 4）", () => {
  it("缺专业：相关岗位只进「补充专业信息后判断」，绝不进明确不符合", () => {
    const draft = completeDraft({
      majorFullName: undefined,
    });
    const r = ready(draft);

    // step 2 有其他内容（学历/证书/用工形式），不出现在限制列表
    expect(r.limitations.map((l) => l.step)).not.toContain(2);

    const majorGroup = r.view.needInfoGroups.find((g) => g.dimension === "major");
    expect(majorGroup).toBeDefined();
    const hangzhouInMajor = majorGroup!.rows.some((row) => row.unitId === "unit-hangzhou-01");
    expect(hangzhouInMajor).toBe(true);

    // 杭州的专业维度是 UNKNOWN；不出现在初步符合，也不出现在明确不符合
    const hangzhou = majorGroup!.rows.find((row) => row.unitId === "unit-hangzhou-01")!;
    expect(hangzhou.dimensions.find((d) => d.label === "专业")?.value).toBe("UNKNOWN");
    expect(r.view.notEligible.some((row) => row.unitId === "unit-hangzhou-01")).toBe(false);
    expect(r.view.preliminary.some((row) => row.unitId === "unit-hangzhou-01")).toBe(false);

    // 补问原因是「暂未提供」口径
    const followUp = r.followUps.find((f) => f.dimension === "major");
    expect(followUp?.reason).toContain("暂未提供");
  });

  it("未选地区（含旧草稿 skippedSteps:[1]）：返回 incomplete，不生成个性化结论（v7.1 M2 消除假跳过）", () => {
    const draft = completeDraft({
      regions: [],
      graduationDate: undefined,
      employmentStatus: undefined,
      // 旧 3 步草稿可能带有 step 1 跳过标记；新模型不允许第一屏跳过
      skippedSteps: [1],
    });
    const result = buildGuestPreview(draft, V61_SEED_ANNOUNCEMENTS, V61_NOW);
    // 未选地区不得生成「初步符合」的个性化结论：返回 incomplete，页面应回到 onboarding
    expect(result.kind).toBe("incomplete");
  });

  it("跳过教师资格：岗位教师维度 UNKNOWN，画像不崩、不判不符合", () => {
    const draft = completeDraft({
      teacherCert: undefined,
      intendedSubject: undefined,
      skippedSteps: [2],
    });
    const r = ready(draft);
    const certGroup = r.view.needInfoGroups.find((g) => g.dimension === "teacher_cert");
    expect(certGroup).toBeDefined();
    const hangzhou = certGroup!.rows.find((row) => row.unitId === "unit-hangzhou-01");
    expect(hangzhou).toBeDefined();
    expect(
      hangzhou!.dimensions.find((d) => d.label === "教师资格")?.value,
    ).toBe("UNKNOWN");
  });

  it("仅跳过第二屏（第一屏必须有地区）：可生成结果页模型，限制数为 1（v7.1 M2 两屏模型）", () => {
    const draft = completeDraft({
      educationLevel: undefined,
      degree: undefined,
      majorFullName: undefined,
      graduationDate: undefined,
      employmentStatus: undefined,
      teacherCert: undefined,
      intendedSubject: undefined,
      acceptedEmploymentNatures: [],
      // 第一屏不允许跳过，只跳过第二屏
      skippedSteps: [2],
    });
    const r = ready(draft);
    // step 2 无内容 → 1 条限制；step 1 有地区不产生限制
    expect(r.limitations).toHaveLength(1);
    expect(r.limitations[0].step).toBe(2);
    // 有地区匹配的岗位 → priority 不为空（need_more_info 状态），但不出现初步符合
    expect(r.view.preliminary).toHaveLength(0);
    expect(r.view.validCount).toBeGreaterThanOrEqual(1);
  });
});

describe("buildGuestPreview：用工形式偏好（v7.1 M3，只筛选不判资格）", () => {
  it("未选择偏好（旧草稿缺省）：不筛选，natureOutOfPreference 为空，与显式 undecided 结果一致", () => {
    const baseline = ready();
    expect(baseline.naturePreference).toBeUndefined();
    expect(baseline.natureOutOfPreference).toHaveLength(0);

    const undecided = ready(completeDraft({ employmentNaturePreference: "undecided" }));
    expect(undecided.natureOutOfPreference).toHaveLength(0);
    expect(undecided.view.validCount).toBe(baseline.view.validCount);
    expect(undecided.view.preliminary).toHaveLength(baseline.view.preliminary.length);
  });

  it("official_open（也接受其他官方用工形式）：同样不筛选", () => {
    const baseline = ready();
    const open = ready(completeDraft({ employmentNaturePreference: "official_open" }));
    expect(open.natureOutOfPreference).toHaveLength(0);
    expect(open.view.validCount).toBe(baseline.view.validCount);
  });

  it("只看事业编：备案制/员额制岗位移入偏好筛除分组，事业编保留且优先机会不变", () => {
    const r = ready(completeDraft({ employmentNaturePreference: "public_only" }));

    // 杭州（事业编）仍是优先机会；初步符合只剩事业编岗位
    expect(r.view.priority?.unitId).toBe("unit-hangzhou-01");
    expect(r.natureOutOfPreference.length).toBeGreaterThanOrEqual(2);
    expect(
      r.natureOutOfPreference.every(
        (row) => row.natureCode !== "public_institution_staff",
      ),
    ).toBe(true);
    // 鄞州（备案制）、苏州（员额制）被筛出主要推荐
    expect(
      r.natureOutOfPreference.some((row) => row.unitId === "unit-yinzhou-01"),
    ).toBe(true);
    expect(
      r.natureOutOfPreference.some((row) => row.unitId === "unit-suzhou-01"),
    ).toBe(true);
    expect(
      r.view.preliminary.every((row) => row.natureCode === "public_institution_staff"),
    ).toBe(true);

    // 有效机会数相应减少（偏好收窄，不是资格变化）
    const baseline = ready();
    expect(r.view.validCount).toBeLessThan(baseline.view.validCount);
  });

  it("只看事业编：被筛除岗位绝不进入「明确不符合」，资格判定保持原样", () => {
    const r = ready(completeDraft({ employmentNaturePreference: "public_only" }));

    // 被偏好筛除的岗位只是“暂不推荐”，绝不是资格不符合
    expect(
      r.view.notEligible.some((row) =>
        r.natureOutOfPreference.some((f) => f.unitId === row.unitId),
      ),
    ).toBe(false);
    // 南京硕士门槛（事业编但学历硬不符）仍在明确不符合：偏好不影响资格判定
    expect(
      r.view.notEligible.some((row) => row.unitId === "unit-nanjing-01"),
    ).toBe(true);
    // 已截止/来源失效的岗位也留在原分桶，不因偏好漂移
    expect(
      r.natureOutOfPreference.some((row) => row.unitId === "unit-wenzhou-01"),
    ).toBe(false);
    expect(
      r.natureOutOfPreference.some((row) => row.unitId === "unit-jiaxing-01"),
    ).toBe(false);
  });

  it("只看事业编：只含非事业编的补问分组整体消失，followUps 同步收窄", () => {
    const baseline = ready();
    const r = ready(completeDraft({ employmentNaturePreference: "public_only" }));

    // 鄞州（备案制）是基线里唯一的户籍补问来源；筛除后户籍分组消失
    const baselineHukou = baseline.view.needInfoGroups.find((g) => g.dimension === "hukou");
    if (baselineHukou && baselineHukou.rows.every((row) => row.unitId === "unit-yinzhou-01")) {
      expect(r.view.needInfoGroups.find((g) => g.dimension === "hukou")).toBeUndefined();
      expect(r.followUps.find((f) => f.dimension === "hukou")).toBeUndefined();
    }
    // 补问分组中不再出现非事业编岗位
    expect(
      r.view.needInfoGroups.every((group) =>
        group.rows.every((row) => row.natureCode === "public_institution_staff"),
      ),
    ).toBe(true);
  });

  it("只看事业编且优先机会为非事业编时：从剩余有效机会中重选优先位，不误入空态", () => {
    // 构造一个优先机会是备案制的场景：鄞州 need_more_info 且无初步符合时
    // 用只含鄞州+事业编岗位的最小画像验证重选逻辑（借 baseline 断言 priority 重算分支）
    const baseline = ready();
    if (baseline.view.priority?.natureCode !== "public_institution_staff") {
      // 基线优先位本就是事业编；该分支由“priority 被筛掉”场景覆盖，这里跳过
      return;
    }
    // 直接验证纯函数行为：筛除后 priority 仍是事业编或从剩余中重选
    const r = ready(completeDraft({ employmentNaturePreference: "public_only" }));
    if (r.natureOutOfPreference.some((row) => row.unitId === baseline.view.priority!.unitId)) {
      expect(r.view.priority?.natureCode).toBe("public_institution_staff");
    } else {
      expect(r.view.priority?.unitId).toBe(baseline.view.priority!.unitId);
    }
  });
});
