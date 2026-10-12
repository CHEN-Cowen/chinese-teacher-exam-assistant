/**
 * 集成测试（jsdom + localStorage）：
 * - 访客五组画像刷新后不丢失，分步保存前序答案不被覆盖；
 * - 过期会话自动失效；
 * - 同一任务重复提交反馈被拦截，只能修改已有反馈（与访客流程无关的既有回归）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DailyPlan, PlanTask, WeeklyPlan } from "@/types";
import { STORAGE_KEYS } from "@/lib/mock-data";
import { saveToStorageStrict } from "@/lib/storage";
import { authService } from "@/lib/auth";
import { feedbackService } from "@/lib/services";
import { DuplicateFeedbackError } from "@/lib/plans/feedbackService";
import {
  TOTAL_PROFILE_STEPS,
  guestSessionService,
  type GuestProfileDraft,
  type GuestProfileSession,
} from "./guestSession";

const FULL_DRAFT: GuestProfileDraft = {
  regions: [
    { code: "330000", province: "浙江省", level: "required" },
    { code: "320000", province: "江苏省", level: "consider" },
  ],
  educationLevel: "bachelor",
  degree: "bachelor",
  majorFullName: "汉语言文学（师范）",
  graduationDate: "2026-06-15",
  employmentStatus: "fresh_unemployed",
  teacherCert: { status: "obtained", subject: "chinese", stage: "middle" },
  intendedSubject: "chinese",
  acceptedEmploymentNatures: ["public_institution_staff", "record_filing"],
};

beforeEach(async () => {
  localStorage.clear();
  await authService.logout().catch(() => undefined);
});

describe("访客画像：刷新恢复", () => {
  it("五组答完保存后重新加载（模拟刷新）：字段与进度完整保留", () => {
    guestSessionService.save({ draft: FULL_DRAFT, step: TOTAL_PROFILE_STEPS });

    // 重新从 localStorage 读取，模拟页面刷新后的无状态加载
    const restored = guestSessionService.load();
    expect(restored).not.toBeNull();
    expect(restored!.step).toBe(TOTAL_PROFILE_STEPS);
    expect(restored!.draft.regions).toHaveLength(2);
    expect(restored!.draft.regions[0]).toMatchObject({
      code: "330000",
      province: "浙江省",
      level: "required",
    });
    expect(restored!.draft.educationLevel).toBe("bachelor");
    expect(restored!.draft.degree).toBe("bachelor");
    expect(restored!.draft.majorFullName).toBe("汉语言文学（师范）");
    expect(restored!.draft.graduationDate).toBe("2026-06-15");
    expect(restored!.draft.employmentStatus).toBe("fresh_unemployed");
    expect(restored!.draft.teacherCert).toMatchObject({
      status: "obtained",
      subject: "chinese",
      stage: "middle",
    });
    expect(restored!.draft.acceptedEmploymentNatures).toEqual([
      "public_institution_staff",
      "record_filing",
    ]);
    expect(guestSessionService.isComplete()).toBe(true);
    expect(guestSessionService.isInProgress()).toBe(false);
  });

  it("新草稿不再默认接受全部用工形式（v7.1 M2 移出首次流程）", () => {
    guestSessionService.save({ draft: { regions: FULL_DRAFT.regions }, step: 1 });
    const session = guestSessionService.load()!;
    // 空数组=未提供；用户从未确认的偏好不得被静默记为接受
    expect(session.draft.acceptedEmploymentNatures).toEqual([]);
  });

  it("结果页用工形式偏好随草稿保存与恢复（v7.1 M3 round-trip）", () => {
    guestSessionService.save({
      draft: { ...FULL_DRAFT, employmentNaturePreference: "public_only" },
      step: TOTAL_PROFILE_STEPS,
    });
    const restored = guestSessionService.load()!;
    expect(restored.draft.employmentNaturePreference).toBe("public_only");

    // 切换偏好后覆盖保存，读取到新值
    guestSessionService.save({ draft: { employmentNaturePreference: "undecided" } });
    expect(guestSessionService.load()!.draft.employmentNaturePreference).toBe("undecided");
  });

  it("旧会话数据没有用工偏好字段：读取正常且不视为已选择（v7.1 M3 兼容）", () => {
    // 手工写入一份不含 employmentNaturePreference 的历史会话（M2 时期结构）
    const legacy: GuestProfileSession = {
      draft: FULL_DRAFT,
      step: TOTAL_PROFILE_STEPS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    saveToStorageStrict(STORAGE_KEYS.GUEST_PROFILE_V61, legacy);

    const restored = guestSessionService.load()!;
    expect(restored.draft.employmentNaturePreference).toBeUndefined();
    // 未选择偏好 = 不筛选，画像其余字段不受影响
    expect(restored.step).toBe(TOTAL_PROFILE_STEPS);
    expect(restored.draft.regions).toHaveLength(2);
  });

  it("分步保存时前序答案不被覆盖（返回修改后继续）", () => {
    guestSessionService.save({ draft: { regions: FULL_DRAFT.regions }, step: 1 });
    guestSessionService.save({
      draft: { educationLevel: "master", degree: "master" },
      step: 2,
    });

    const session = guestSessionService.load()!;
    expect(session.step).toBe(2);
    expect(session.draft.regions).toHaveLength(2);
    expect(session.draft.educationLevel).toBe("master");
    expect(session.draft.degree).toBe("master");
    // v7.1 M2 两屏模型：完成 step 2 即全部完成
    expect(guestSessionService.isComplete()).toBe(true);
    expect(guestSessionService.isInProgress()).toBe(false);
  });

  it("返回上一组时只保存草稿不回退已完成进度", () => {
    guestSessionService.save({ draft: FULL_DRAFT, step: TOTAL_PROFILE_STEPS });
    // 返回修改（不带 step）：草稿更新，进度保持
    guestSessionService.save({ draft: { majorFullName: "汉语言文学" } });
    const session = guestSessionService.load()!;
    expect(session.step).toBe(TOTAL_PROFILE_STEPS);
    expect(session.draft.majorFullName).toBe("汉语言文学");
    expect(session.draft.regions).toHaveLength(2);
  });

  it("过期会话：load 返回 null 并清除，需要重新开始", () => {
    const expired: GuestProfileSession = {
      draft: FULL_DRAFT,
      step: TOTAL_PROFILE_STEPS,
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-02T00:00:00.000Z",
    };
    saveToStorageStrict(STORAGE_KEYS.GUEST_PROFILE_V61, expired);

    expect(guestSessionService.load()).toBeNull();
    expect(guestSessionService.isComplete()).toBe(false);
    expect(guestSessionService.isInProgress()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_PROFILE_V61)).toBeNull();
  });

  it("clear 后会话消失", () => {
    guestSessionService.save({ draft: FULL_DRAFT, step: TOTAL_PROFILE_STEPS });
    expect(guestSessionService.load()).not.toBeNull();
    guestSessionService.clear();
    expect(guestSessionService.load()).toBeNull();
  });

  it("「暂不提供」的步骤号随草稿一起保存与恢复（模块 4）", () => {
    const draft: GuestProfileDraft = {
      ...FULL_DRAFT,
      majorFullName: undefined,
      // step 2（基础资格）标记为跳过：清掉所有计入 stepHasContent 的字段
      educationLevel: undefined,
      degree: undefined,
      graduationDate: undefined,
      teacherCert: undefined,
      acceptedEmploymentNatures: [],
      skippedSteps: [2],
    };
    guestSessionService.save({ draft, step: TOTAL_PROFILE_STEPS });
    const restored = guestSessionService.load()!;
    expect(restored.draft.skippedSteps).toEqual([2]);
    expect(restored.draft.majorFullName).toBeUndefined();
    expect(guestSessionService.isComplete()).toBe(true); // 跳过的步骤视为完成
  });

  it("补填内容后的保存会自动清掉对应跳过标记", () => {
    // 清空 step 2 的字段并标记为跳过（graduationDate 也需清掉，否则 stepHasContent 为 true）
    guestSessionService.save({
      draft: {
        ...FULL_DRAFT,
        educationLevel: undefined,
        degree: undefined,
        majorFullName: undefined,
        graduationDate: undefined,
        teacherCert: undefined,
        acceptedEmploymentNatures: [],
        skippedSteps: [2],
      },
      step: TOTAL_PROFILE_STEPS,
    });
    // 补填专业名称：step 2 现在有内容，跳过标记自动移除
    guestSessionService.save({ draft: { majorFullName: "汉语言文学" } });
    expect(guestSessionService.load()!.draft.skippedSteps ?? []).toEqual([]);
  });

  it("本机存储写入失败时 save 抛错（页面据此保留输入并提示重试）", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => guestSessionService.save({ draft: FULL_DRAFT, step: 1 })).toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("重复提交反馈（既有回归，与访客画像解耦）", () => {
  function seedWeeklyPlan(): { task: PlanTask } {
    const ts = "2026-03-01T20:00:00.000Z";
    const task: PlanTask = {
      id: "t-seed-1",
      dailyPlanId: "d-seed-1",
      title: "课程标准学习",
      module: "mod_kebiao",
      sourceType: "resource",
      resourceId: "r-1",
      estimatedTime: 40,
      completionCriteria: "复述课程理念",
      arrangementReason: "先打底",
      reviewAction: "合上书本默写要点",
      order: 1,
      status: "pending",
      priority: "medium",
      isCore: true,
      createdAt: ts,
      updatedAt: ts,
    };
    const daily: DailyPlan = {
      id: "d-seed-1",
      weeklyPlanId: "wp-seed",
      date: "2026-03-02",
      dayOfWeek: 1,
      tasks: [task],
      totalEstimatedTime: 40,
      isMinimumViable: true,
      availableMinutes: 45,
      createdAt: ts,
      updatedAt: ts,
    };
    const weekly: WeeklyPlan = {
      id: "wp-seed",
      userId: "u-001",
      examTargetId: "et-001",
      weekNumber: 1,
      startDate: "2026-03-02",
      endDate: "2026-03-08",
      focus: "课标",
      status: "active",
      version: 1,
      generationReason: "种子计划",
      createdAt: ts,
      updatedAt: ts,
    };
    saveToStorageStrict(STORAGE_KEYS.PLANS, [weekly]);
    saveToStorageStrict(STORAGE_KEYS.DAILY_PLANS, [daily]);
    return { task };
  }

  it("同一任务第二次提交抛 DuplicateFeedbackError，已有反馈可修改", async () => {
    await authService.login({
      account: "student@demo.app",
      password: "demo1234",
    });
    const { task } = seedWeeklyPlan();

    feedbackService.submit(task.id, {
      status: "not_completed",
      incompleteReason: "time",
      errorTypes: [],
      hasSecondPractice: false,
    });

    expect(() =>
      feedbackService.submit(task.id, {
        status: "completed",
        errorTypes: [],
        hasSecondPractice: false,
      }),
    ).toThrow(DuplicateFeedbackError);

    // 只能修改已有反馈：状态变更成功，创建时间保留
    const existing = feedbackService.getByTask(task.id)!;
    const updated = feedbackService.update(existing.id, {
      status: "partial",
      actualTime: 20,
      incompleteReason: "time",
      errorTypes: [],
      hasSecondPractice: false,
    });
    expect(updated.status).toBe("partial");
    expect(updated.createdAt).toBe(existing.createdAt);
  });
});
