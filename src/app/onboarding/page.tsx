"use client";

import { Suspense, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { FeedbackBar } from "@/components/ui/FeedbackBar";
import { useCurrentUser, AUTH_MODE } from "@/lib/auth";
import { safeReturnPath } from "@/lib/auth/return-to";
import {
  CITY_OPTIONS,
  CREDENTIAL_LEVEL_OPTIONS,
  NATURE_PREFERENCE_OPTIONS,
  PROVINCE_OPTIONS,
  REGION_LEVEL_OPTIONS,
  STAGE_OPTIONS,
  STEP_PURPOSE,
  STEP_SKIP_COPY,
  SUBJECT_OPTIONS,
  TEACHER_CERT_STATUS_OPTIONS,
  TOTAL_PROFILE_STEPS,
  draftToProfile,
  guestSessionService,
  hasMinimumPreviewProfile,
  isStepComplete,
  isStepSkipped,
  pruneSkippedSteps,
  stepHasContent,
  type EmploymentNaturePreference,
  type GuestProfileDraft,
} from "@/lib/guest/guestSession";
import { GUEST_COVERAGE } from "@/lib/guest/coverage";
import { profileApi } from "@/lib/profile/profileApi";
import { track, trackOncePerUser } from "@/lib/analytics/eventService";
import type { SubjectCode } from "@/lib/announcements/types";
import type {
  RegionPreference,
  RegionPreferenceLevel,
  TeacherCertInfo,
} from "@/lib/profile/types";

/**
 * v7.2 两屏基础画像采集（PRD 7.4.2）：
 * 1. 地区意向 — 可接受地区（只考虑 / 优先考虑 / 也可以考虑）
 * 2. 基础资格 — 按顺序收集学历、毕业时间、专业、教师资格、用工偏好
 *
 * - 未登录可完成，草稿自动保存在本机浏览器，刷新可恢复；
 * - 随时返回修改，已填内容保留；
 * - 第一屏不允许跳过地区（消除"假跳过"），但可查看覆盖范围；
 * - 第二屏可「暂不提供」：允许继续，但相关维度引擎只能判 UNKNOWN，
 *   结果页明确标注限制，绝不把缺失信息当作「不符合」；
 * - 本机存储写入失败时页面输入不丢失，明确提示重试；
 * - v7.2：用工偏好三档（只看事业编 / 事业编优先也看其他官方岗位 / 暂不确定先全部看看）
 *   在第二屏末尾收集，只影响展示、排序和偏好范围外分类，
 *   不改变 PASS/FAIL/UNKNOWN/MANUAL_REVIEW；未选择行为等同「暂不确定」；已知偏好自动回填；
 * - 年龄/户籍/社保/工作经历不在此收齐，结果页按需说明补问原因；
 * - 意向学科非语文时明确提示尚未开放，可留下意向，不生成虚假匹配；
 * - 完成后访客进入 /preview 预筛结果，登录用户进入 /opportunities 真实机会；
 *   防止重复提交；敏感字段不进入日志和埋点正文。
 */

const STEP_TITLES = [
  "你想优先查看哪些地区的教师招聘？",
  "你的学历、专业和教师资格情况？",
];

const STEP_LABELS = ["地区意向", "基础资格"];

const STEP_FEEDBACK: Record<number, string> = {
  1: "已记住你的地区意向，接下来核对基础资格",
};

function OnboardingForm() {
  const router = useRouter();
  const { status } = useCurrentUser();
  const searchParams = useSearchParams();
  // 带 ?from= 或 ?mode=edit 进入（结果页/我的/机会页的"返回修改画像""填写报考信息"等）
  // 是明确填写或修改意图，不触发自动跳转；否则画像已完成的访客弹回 /preview、
  // 已登录用户弹回 /opportunities，永远无法进入修改
  const editMode = searchParams.get("mode") === "edit";
  const editing = searchParams.has("from") || editMode;
  // v7.2 修改条件流程：默认进入资格与偏好所在的第二屏；returnTo 只接受本站安全路径
  // （safeReturnPath 拒绝外域、协议相对 URL 与 /onboarding，防开放重定向）
  const stepParam = searchParams.get("step");
  const returnTo = safeReturnPath(searchParams.get("returnTo"));

  // 惰性初始化从 localStorage 恢复，避免 effect 内 setState；已有资料全部保留回填
  const [draft, setDraft] = useState<GuestProfileDraft>(() => {
    if (typeof window === "undefined") {
      return { regions: [], acceptedEmploymentNatures: [] };
    }
    return guestSessionService.load()?.draft ?? {
      regions: [],
      acceptedEmploymentNatures: [],
    };
  });

  const [view, setView] = useState(() => {
    if (typeof window === "undefined") return 1;
    // 修改条件：默认第二屏（资格与偏好），step=1 时才进入地区第一屏
    if (editMode) {
      return stepParam === "1" ? 1 : TOTAL_PROFILE_STEPS;
    }
    const session = guestSessionService.load();
    if (!session || session.step <= 0) return 1;
    if (session.step >= TOTAL_PROFILE_STEPS) return 1; // effect 会 replace 到结果页
    return Math.min(session.step + 1, TOTAL_PROFILE_STEPS);
  });

  // 本机存储写入失败提示（输入仍保留在 draft 状态中，不会丢失）
  const [saveError, setSaveError] = useState(false);

  // v7.2：最终提交中标记，防止重复点击 / 重复 router.push / 重复 saveProfile
  const [submitting, setSubmitting] = useState(false);

  // 完成一组后的非阻塞即时反馈（v7 FeedbackBar：done=完成，note=进行中）
  const [recentFeedback, setRecentFeedback] = useState<{
    variant: "note" | "done";
    message: string;
    key: number;
  } | null>(null);

  // 步骤切换后将焦点移到标题，辅助屏幕阅读器播报新内容
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const prevViewRef = useRef(view);
  useEffect(() => {
    if (prevViewRef.current !== view) {
      prevViewRef.current = view;
      // 延迟到下一帧，确保新内容已渲染
      requestAnimationFrame(() => {
        stepHeadingRef.current?.focus();
      });
    }
  }, [view]);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "authenticated") {
      if (!editing) router.replace("/opportunities");
      return;
    }
    const session = guestSessionService.load();
    if (
      !editing &&
      session &&
      guestSessionService.isComplete() &&
      hasMinimumPreviewProfile(session.draft)
    ) {
      router.replace("/preview");
    }
  }, [status, router, editing]);

  // 任何一阶段补填了实质内容，自动取消该阶段的「暂不提供」标记（由纯函数规整）
  const updateDraft = (patch: Partial<GuestProfileDraft>) => {
    setSaveError(false);
    setDraft((prev) => pruneSkippedSteps({ ...prev, ...patch }));
  };

  /** 把当前进度写入本机存储；失败返回 false（调用方保留页面状态并提示） */
  const persist = (step?: number): boolean => {
    try {
      guestSessionService.save({ draft, step });
      setSaveError(false);
      return true;
    } catch {
      setSaveError(true);
      return false;
    }
  };

  /** 进入下一屏：保存草稿与完成进度。
   *  v7.2：两屏流程，第一屏必须选地区才能进入第二屏。
   *  invited 模式下若草稿已完整且没有「暂不提供」项，同步持久化到服务端（跨浏览器恢复），
   *  用工偏好随画像同字段写入服务端。提交中防止重复请求。 */
  const goNext = () => {
    if (submitting) return; // 防重复提交：保存失败可重试，但成功后不重复触发
    const finishedStep = view;
    if (!persist(finishedStep)) return; // 保存失败：停在本步，输入不丢
    // 画像各步漏斗（模块 7）：完成（未跳过）的每步记一次
    track("profile_step_completed", "profile", {
      props: { step: finishedStep, skipped: 0 },
    });
    if (AUTH_MODE === "invited" && (draft.skippedSteps?.length ?? 0) === 0) {
      const profile = draftToProfile(draft);
      if (profile) profileApi.saveProfile(profile).catch(() => undefined);
    }
    if (finishedStep >= TOTAL_PROFILE_STEPS) {
      // v7.2：进入最终提交中状态，防止重复 router.push / 重复 saveProfile
      setSubmitting(true);
      // P0 漏斗①：基础画像完成（访客身份先暂存，登录后归属到真实账号；同用户只记一次）
      trackOncePerUser("profile_completed", "profile", {
        props: { stepCount: TOTAL_PROFILE_STEPS },
      });
      // v7.2 修改条件流程：保存后返回原结果页（含原标签），结果页用最新草稿重新计算；
      // 资料不清空；returnTo 非法时回退默认结果页
      router.push(returnTo ?? "/preview");
    } else {
      setRecentFeedback({
        variant: "done",
        key: Date.now(),
        message: STEP_FEEDBACK[finishedStep],
      });
      setView(finishedStep + 1);
    }
  };

  /** 返回上一阶段：草稿照样保留（即使本阶段尚未答完或已跳过） */
  const goBack = () => {
    persist(); // 返回修改时也尝试落盘；失败不拦截返回（输入仍在当前会话里）
    setView((v) => Math.max(v - 1, 1));
  };

  /** 第二屏标记为「暂不提供」并进入结果页（v7.1 M2：仅第二屏可跳过） */
  const skipCurrentStep = () => {
    const nextDraft: GuestProfileDraft = {
      ...draft,
      skippedSteps: [...new Set([...(draft.skippedSteps ?? []), view])],
    };
    setDraft(nextDraft);
    setSaveError(false);
    try {
      guestSessionService.save({ draft: nextDraft, step: view });
    } catch {
      setSaveError(true);
      return;
    }
    track("profile_step_completed", "profile", {
      props: { step: view, skipped: 1 },
    });
    // 跳过第二屏后直接进入结果页（第一屏已选地区，最低门槛已满足）
    trackOncePerUser("profile_completed", "profile", {
      props: { stepCount: TOTAL_PROFILE_STEPS, skipped: true },
    });
    router.push(returnTo ?? "/preview");
  };

  /** 撤销本阶段的「暂不提供」，留在本阶段填写 */
  const undoSkip = () => {
    updateDraft({
      skippedSteps: (draft.skippedSteps ?? []).filter((step) => step !== view),
    });
  };

  if (status === "loading") return null;

  const canContinue = isStepComplete(draft, view);
  const skippedHere = isStepSkipped(draft, view);
  const hasContentHere = stepHasContent(draft, view);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-1 rounded-md px-1 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            退出
          </Link>
          <span className="rounded-pill bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-line">
            {view} / {TOTAL_PROFILE_STEPS}
          </span>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">报考信息</p>
          <p className="text-xs text-ink-muted">{STEP_LABELS[view - 1]}</p>
        </div>

        {/* 进度条：原型 .prog__bar（4px 高、ink-2 填充）；蓝=已完成，琥珀=已选暂不提供，灰=未到达 */}
        <div
          className="mb-5 flex gap-2"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_PROFILE_STEPS}
          aria-valuenow={view}
          aria-label={`报考信息填写进度：第 ${view} 阶段，共 ${TOTAL_PROFILE_STEPS} 阶段`}
        >
          {Array.from({ length: TOTAL_PROFILE_STEPS }).map((_, i) => {
            const stepNo = i + 1;
            const isSkipped = isStepSkipped(draft, stepNo);
            return (
              <div
                key={i}
                title={isSkipped ? `第 ${stepNo} 阶段：暂不提供` : undefined}
                className={`h-1 flex-1 rounded-pill transition-colors duration-300 ${
                  isSkipped
                    ? "bg-warn"
                    : i < view
                      ? "bg-brand-strong"
                      : "bg-line"
                }`}
              />
            );
          })}
        </div>

        {/* v7 反馈条：done=完成（绿），note=进行中（蓝），不打断用户继续操作 */}
        {recentFeedback && (
          <div className="mb-4">
            <FeedbackBar
              key={recentFeedback.key}
              message={recentFeedback.message}
              variant={recentFeedback.variant}
            />
          </div>
        )}

        <section className="rounded-xl border border-line bg-surface p-5 shadow-1 sm:p-7">
          <p className="mb-2 text-xs font-semibold tracking-wide text-brand">{view} / {TOTAL_PROFILE_STEPS} {STEP_LABELS[view - 1]}</p>
          <h1
            ref={stepHeadingRef}
            tabIndex={-1}
            className="text-xl font-bold leading-snug tracking-[-0.02em] text-ink focus:outline-none sm:text-2xl"
          >
            {STEP_TITLES[view - 1]}
          </h1>
          {/* 短提示：每阶段先说一句"这些信息用来做什么" */}
          <p className="mt-2 text-sm leading-6 text-ink-muted">{STEP_PURPOSE[view]}</p>

          {/* "为什么问这个？"长解释按需展开（仅第二屏，第一屏用覆盖范围入口替代） */}
          {view === 2 && (
            <div className="mt-2">
              <Disclosure
                trigger="为什么问这个？"
                contentClassName="text-sm leading-relaxed text-ink-muted"
              >
                {STEP_SKIP_COPY[view].confirm}
              </Disclosure>
            </div>
          )}

          {/* 已选择暂不提供：明确结果限制，一键返回补填 */}
          {skippedHere && (
            <div
              className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5"
              data-testid={`skipped-banner-${view}`}
            >
              <p className="text-sm text-warn">
                已选择「暂不提供」这一阶段。{STEP_SKIP_COPY[view].confirm}
              </p>
              <button
                type="button"
                onClick={undoSkip}
                className="mt-1.5 text-sm font-medium text-warn underline underline-offset-2 hover:text-warn/80"
              >
                现在补上这一阶段
              </button>
            </div>
          )}

          {view === 1 && (
            <>
              <StepRegions value={draft.regions} onChange={(regions) => updateDraft({ regions })} />
              {/* v7.1 M2：第一屏"还没想好"入口 → 展开覆盖概览，不跳过、不生成个性化结论 */}
              <div className="mt-5">
                <Disclosure
                  trigger="还没想好，先看看当前覆盖范围"
                  contentClassName="text-sm leading-relaxed text-ink-muted"
                  onOpenChange={(open) => {
                    if (open) {
                      // v7.1 M9：「还没想好地区」选择，记 undecided，不记地区正文
                      track("region_preference_selected", "profile", {
                        props: { level: "undecided" },
                      });
                    }
                  }}
                >
                  <StepCoverageOverview />
                </Disclosure>
              </div>
            </>
          )}
          {view === 2 && (
            <>
              <StepEducation
                educationLevel={draft.educationLevel}
                onChange={(patch) => updateDraft(patch)}
              />
              <div className="mt-5 border-t border-line pt-4">
                <StepGraduation
                  graduationDate={draft.graduationDate ?? ""}
                  onChange={(patch) => updateDraft(patch)}
                />
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <StepMajor
                  major={draft.majorFullName ?? ""}
                  onChange={(majorFullName) => updateDraft({ majorFullName })}
                />
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <StepCert draft={draft} onChange={updateDraft} />
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <StepEmploymentPreference
                  value={draft.employmentNaturePreference}
                  onChange={(value) => updateDraft({ employmentNaturePreference: value })}
                />
              </div>
            </>
          )}

          {/* 写入失败：不跳转、不丢输入，提示重试 */}
          {saveError && (
            <div
              className="mt-5 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger"
              data-testid="save-error"
              role="alert"
            >
              本机浏览器存储当前不可用（隐私模式或空间已满），进度没能保存；你填写的内容仍在页面上，
              <button
                type="button"
                onClick={goNext}
                className="mx-1 font-medium underline underline-offset-2"
              >
                点这里重试
              </button>
              ，或调整浏览器设置后继续。
            </div>
          )}

          <div className="mt-7 border-t border-line pt-5">
            <Button
              onClick={goNext}
              disabled={!canContinue || submitting}
              loading={submitting}
              size="lg"
              fullWidth
            >
              {view >= TOTAL_PROFILE_STEPS ? "查看筛选结果" : "下一步"}
            </Button>
            {!canContinue && view === 1 && (
              <p className="mt-2 text-center text-xs text-ink-muted">
                请至少选择一个地区，或展开&ldquo;先看看当前覆盖范围&rdquo;了解已收录地区
              </p>
            )}
            {!canContinue && view === 2 && (
              <p className="mt-2 text-center text-xs text-ink-muted">
                填一项即可继续，也可以暂时跳过
              </p>
            )}
            {submitting && (
              <p role="status" className="mt-2 text-center text-xs text-ink-muted">
                正在生成你的筛选结果…
              </p>
            )}
          </div>

          {/* 暂不提供：仅第二屏无实质内容时出现（v7.1 M2：第一屏不允许跳过地区） */}
          {view === 2 && !skippedHere && !hasContentHere && (
            <button
              type="button"
              onClick={skipCurrentStep}
              className="mt-3 min-h-10 w-full text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {STEP_SKIP_COPY[view].action}
            </button>
          )}
        </section>

        {view > 1 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={goBack}
              data-testid={editMode ? "edit-regions-entry" : undefined}
              className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              {editMode ? "修改地区（返回第一阶段）" : "返回上一阶段修改"}
            </button>
          </div>
        )}

        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-1 text-center text-xs leading-relaxed text-ink-muted">
          <svg aria-hidden="true" className="mr-0.5 h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
            <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" />
          </svg>
          答案仅存在本机，7 天后清除
          <Link href="/login" className="ml-1 text-brand hover:underline">
            已有账号？登录
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ================== 第 1 组：可接受地区 ================== */

function regionFromSelect(
  provinceCode: string,
  cityCode: string,
  level: RegionPreferenceLevel,
): RegionPreference {
  const province = PROVINCE_OPTIONS.find((p) => p.code === provinceCode);
  if (cityCode) {
    const city = CITY_OPTIONS[provinceCode]?.find((c) => c.code === cityCode);
    return {
      code: cityCode,
      province: province?.name ?? "",
      city: city?.name,
      level,
    };
  }
  return { code: provinceCode, province: province?.name ?? "", level };
}

function StepRegions({
  value,
  onChange,
}: {
  value: RegionPreference[];
  onChange: (regions: RegionPreference[]) => void;
}) {
  // 至少保证一行可编辑
  const rows = value.length > 0 ? value : [];

  const updateRow = (index: number, next: RegionPreference) => {
    onChange(rows.map((r, i) => (i === index ? next : r)));
  };
  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };
  const addRow = () => {
    onChange([
      ...rows,
      { code: "330000", province: "浙江省", level: "consider" },
    ]);
  };

  return (
    <div className="mt-4">
      <div className="space-y-4">
        {rows.map((region, index) => {
          const provinceCode = region.code.endsWith("0000")
            ? region.code
            : `${region.code.slice(0, 2)}0000`;
          const cityCode = region.code.endsWith("0000") ? "" : region.code;
          const cities = CITY_OPTIONS[provinceCode] ?? [];
          return (
            <div key={index} className="space-y-4 rounded-2xl border border-line bg-canvas/60 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-ink-muted">省份</span>
                  <select
                    value={provinceCode}
                    onChange={(e) =>
                      updateRow(index, regionFromSelect(e.target.value, "", region.level))
                    }
                    className="mt-1.5 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
                  >
                    {PROVINCE_OPTIONS.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-ink-muted">城市（不选即全省）</span>
                  <select
                    value={cityCode}
                    onChange={(e) =>
                      updateRow(index, regionFromSelect(provinceCode, e.target.value, region.level))
                    }
                    className="mt-1.5 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
                  >
                    <option value="">全省均可</option>
                    {cities.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset className="m-0 border-0 p-0">
                <legend className="text-xs font-medium text-ink-muted">你对这个地区的考虑程度是？</legend>
                <div className="mt-1.5 grid grid-cols-3 gap-2" role="group">
                  {REGION_LEVEL_OPTIONS.map((opt) => {
                    const selected = region.level === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          // v7.1 M9：地区考虑程度选择（determined/considering），不记地区正文
                          const level =
                            opt.value === "required" ? "determined" : "considering";
                          track("region_preference_selected", "profile", {
                            props: { level },
                          });
                          updateRow(
                            index,
                            regionFromSelect(provinceCode, cityCode, opt.value),
                          );
                        }}
                        title={opt.hint}
                        aria-pressed={selected}
                        className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-medium transition-all ${
                          selected
                            ? "border-brand bg-brand-soft text-brand ring-1 ring-brand/10"
                            : "border-line bg-surface text-ink-muted hover:border-brand/30 hover:text-ink"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs text-ink-muted hover:text-danger"
                >
                  删除这个地区
                </button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-brand/30 bg-brand-soft/30 p-5 text-center">
            <button
              type="button"
              onClick={() => onChange([{ code: "330000", province: "浙江省", level: "required" }])}
              className="font-medium text-brand hover:underline"
            >
              添加第一个地区
            </button>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <button
          type="button"
          onClick={addRow}
          className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-brand hover:underline"
        >
          + 再加一个可以考虑的地区
        </button>
      )}
    </div>
  );
}

/* ================== 第 2 组：学历学位 ================== */

function OptionList<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            aria-pressed={selected}
            className={`flex min-h-12 items-center justify-between rounded-xl border p-3 text-left text-sm font-medium transition-all ${
              selected
                ? "border-brand bg-brand-soft text-brand ring-1 ring-brand/10"
                : "border-line bg-surface text-ink hover:border-brand/30 hover:bg-brand-soft/30"
            }`}
          >
            <span>{opt.label}</span>
            {selected && (
              <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StepEducation({
  educationLevel,
  onChange,
}: {
  educationLevel: GuestProfileDraft["educationLevel"];
  onChange: (patch: Partial<GuestProfileDraft>) => void;
}) {
  return (
    <div className="mt-4">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium text-ink">最高学历</legend>
        <OptionList
          options={CREDENTIAL_LEVEL_OPTIONS}
          value={educationLevel}
          onSelect={(v) => onChange({ educationLevel: v })}
        />
      </fieldset>
    </div>
  );
}

/* ================== 第 3 组：专业全称 ================== */

function StepMajor({
  major,
  onChange,
}: {
  major: string;
  onChange: (major: string) => void;
}) {
  return (
    <div className="mt-4">
      <label htmlFor="major-full-name" className="mb-2 block text-sm font-medium text-ink">
        专业全称
      </label>
      <input
        id="major-full-name"
        value={major}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例如：汉语言文学（师范）"
        autoComplete="off"
        // text-base 防止 iOS Safari 聚焦时自动放大页面
        className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
      />
      <p className="mt-2 text-xs leading-5 text-ink-muted">
        请与毕业证保持一致，包含括号中的方向
      </p>
    </div>
  );
}

/* ================== 第二屏：毕业时间 ================== */

function StepGraduation({
  graduationDate,
  onChange,
}: {
  graduationDate: string;
  onChange: (patch: Partial<GuestProfileDraft>) => void;
}) {
  // 存储 YYYY-MM-DD；input[type=month] 使用 YYYY-MM
  const monthValue = graduationDate.slice(0, 7);
  return (
    <div className="mt-4">
      <label htmlFor="graduation-month" className="mb-2 block text-sm font-medium text-ink">
        毕业（或预计毕业）时间
      </label>
      <input
        id="graduation-month"
        type="month"
        value={monthValue}
        onChange={(e) =>
          onChange({ graduationDate: e.target.value ? `${e.target.value}-15` : undefined })
        }
        className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
      />
      <p className="mt-2 text-xs leading-5 text-ink-muted">
        是否属于应届生会按每条公告单独判断
      </p>
    </div>
  );
}

/* ================== 第二屏：教师资格 ================== */

function StepCert({
  draft,
  onChange,
}: {
  draft: GuestProfileDraft;
  onChange: (patch: Partial<GuestProfileDraft>) => void;
}) {
  // 暂不提供时 cert 可能整体缺失：不预选任何状态，避免把「未填」显示成「已取得」
  const cert: Partial<TeacherCertInfo> = draft.teacherCert ?? {};
  const certNone = cert.status === "none";
  const subjectValue = certNone ? draft.intendedSubject : cert.subject;
  const subjectOpen = subjectValue === "chinese";

  const updateCert = (patch: Partial<TeacherCertInfo>) => {
    const nextCert = {
      status: "obtained",
      ...cert,
      ...patch,
    } as TeacherCertInfo;
    onChange({
      teacherCert: nextCert,
      // 有证/在途时，报考学科跟随资格证学科；无证时由单独的意向学科选择决定
      intendedSubject: nextCert.status === "none" ? draft.intendedSubject : nextCert.subject,
    });
  };

  const changeStatus = (status: TeacherCertInfo["status"]) => {
    if (status === "none") {
      onChange({
        teacherCert: { status },
        intendedSubject: draft.intendedSubject ?? "chinese",
      });
    } else {
      const nextCert: TeacherCertInfo = {
        status,
        subject: cert.subject ?? "chinese",
        stage: cert.stage ?? "middle",
        ...(status === "in_progress" ? { expectedDate: cert.expectedDate } : {}),
      };
      onChange({ teacherCert: nextCert, intendedSubject: nextCert.subject });
    }
  };

  const changeIntendedSubject = (e: ChangeEvent<HTMLSelectElement>) => {
    const subject = e.target.value as SubjectCode;
    if (certNone) {
      onChange({ intendedSubject: subject });
    } else {
      updateCert({ subject });
    }
  };

  return (
    <div className="mt-4 space-y-5">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium text-ink">教师资格</legend>
        <OptionList
          options={TEACHER_CERT_STATUS_OPTIONS}
          value={cert.status}
          onSelect={changeStatus}
        />
      </fieldset>

      {cert.status !== undefined && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-ink-muted">
              {certNone ? "想报考的学科" : "资格证学科"}
            </span>
            <select
              value={subjectValue ?? ""}
              onChange={changeIntendedSubject}
              className="mt-1.5 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
            >
              <option value="" disabled>
                请选择学科
              </option>
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {!certNone && (
            <label className="block">
              <span className="text-xs font-medium text-ink-muted">资格证学段</span>
              <select
                value={cert.stage ?? ""}
                onChange={(e) => updateCert({ stage: e.target.value as TeacherCertInfo["stage"] })}
                className="mt-1.5 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
              >
                <option value="" disabled>
                  请选择学段
                </option>
                {STAGE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {cert.status === "in_progress" && (
        <label className="block">
          <span className="text-xs font-medium text-ink-muted">预计取得教师资格时间</span>
          <input
            type="month"
            value={cert.expectedDate?.slice(0, 7) ?? ""}
            onChange={(e) =>
              updateCert({ expectedDate: e.target.value ? `${e.target.value}-15` : undefined })
            }
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 sm:text-sm"
          />
        </label>
      )}

      {!subjectOpen && cert.status !== undefined && (
        <div className="rounded-xl border border-warn/20 bg-warn-soft px-3.5 py-3 text-sm leading-6 text-warn">
          当前先开放<strong>语文</strong>教师公开招聘；其他学科暂未开放匹配，完成后可以在结果页留下开注意向，
          不会为你生成不相关的匹配结果。
        </div>
      )}
    </div>
  );
}

/* ================== 第二屏：用工偏好（v7.2 PRD 7.4.2） ================== */

/**
 * v7.2 用工偏好三档选择（只看事业编 / 事业编优先也看其他官方岗位 / 暂不确定先全部看看）。
 * - 只影响展示、排序和偏好范围外分类，不改变 PASS/FAIL/UNKNOWN/MANUAL_REVIEW；
 * - 未选择时不高亮任何项，行为等同「暂不确定」（不筛选）；
 * - 已知偏好自动回填（draft.employmentNaturePreference）；
 * - 不进入资格判定，不写入日志和埋点正文（track 只记动作枚举）。
 */
function StepEmploymentPreference({
  value,
  onChange,
}: {
  value: EmploymentNaturePreference | undefined;
  onChange: (value: EmploymentNaturePreference) => void;
}) {
  return (
    <div className="mt-4">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-sm font-medium text-ink">你想看哪类用工形式？</legend>
        <p className="mb-2 text-xs leading-5 text-ink-muted">
          这只影响结果的筛选和排序，不会被当作资格不符合。
        </p>
        <div
          className="grid gap-2"
          role="group"
          aria-label="用工形式偏好"
          data-testid="employment-preference-group"
        >
          {NATURE_PREFERENCE_OPTIONS.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  // v7.2：偏好选择只记动作枚举，不记偏好正文
                  track("nature_preference_changed", "profile", {
                    props: { value: opt.value },
                  });
                  onChange(opt.value);
                }}
                aria-pressed={selected}
                data-testid={`employment-preference-${opt.value}`}
                aria-describedby={`employment-preference-${opt.value}-hint`}
                className={`min-h-11 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                  selected
                    ? "border-brand bg-brand-soft ring-1 ring-brand/10"
                    : "border-line bg-canvas/50 hover:border-brand/30"
                }`}
              >
                <span
                  className={`block text-sm font-medium ${
                    selected ? "text-brand" : "text-ink"
                  }`}
                >
                  {opt.label}
                </span>
                <span
                  id={`employment-preference-${opt.value}-hint`}
                  className="mt-0.5 block text-xs leading-5 text-ink-muted"
                >
                  {opt.hint}
                </span>
              </button>
            );
          })}
        </div>
        {value === undefined && (
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            可以现在选，也可以稍后在结果页调整；不选默认看全部官方岗位。
          </p>
        )}
      </fieldset>
    </div>
  );
}

/* ================== 第一屏：覆盖概览 ================== */

/** v7.1 M2：地区未确定时展示当前覆盖范围，不生成个性化结论 */
function StepCoverageOverview() {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-ink">
        目前已收录{GUEST_COVERAGE.regions.length}个省份的官方招聘公告监测：
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {GUEST_COVERAGE.regions.map((r) => (
          <li
            key={r.code}
            className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm"
          >
            <span className="font-medium text-ink">{r.label}</span>
            <span className="ml-1.5 text-ink-muted">
              {r.sources.length}个公告来源
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-ink-muted">
        选择地区后，只会展示该地区相关的招聘机会。未收录的地区暂无法匹配，持续扩展中。
      </p>
    </div>
  );
}

export default function OnboardingPage() {
  // useSearchParams 需要 Suspense 边界以支持静态预渲染
  return (
    <Suspense fallback={null}>
      <OnboardingForm />
    </Suspense>
  );
}
