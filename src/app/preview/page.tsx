"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AUTH_MODE, useCurrentUser } from "@/lib/auth";
import { FLAGS } from "@/lib/flags";
import { PreviewWorkbench } from "./PreviewWorkbench";
import {
  CREDENTIAL_LEVEL_OPTIONS,
  guestSessionService,
  NATURE_PREFERENCE_OPTIONS,
  OFFICIAL_NATURE_INFO,
  subjectLabel,
  type EmploymentNaturePreference,
  type GuestProfileDraft,
} from "@/lib/guest/guestSession";
import { buildGuestPreview, type GuestPreview } from "@/lib/guest/previewEngine";
import { GUEST_COVERAGE } from "@/lib/guest/coverage";
import { coverageProvinceLine } from "@/lib/opportunities/coverage-view";
import { getRollingDemoAnnouncements } from "@/lib/seed/demoTimeline";
import { Hero } from "@/components/ia/Hero";
import { OpportunityCard } from "@/components/ia/OpportunityCard";
import type { GuestCardNextStepKind } from "@/lib/ia/opportunities-view";
import type { OpportunityRow } from "@/lib/ia/opportunities-view";
import { safeOfficialLink } from "@/lib/links/official";
import { Disclosure, LayerHeading } from "@/components/ia/Layer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingPage } from "@/components/ui/Loading";
import { QualifyConclusionCard, type QualifyLevel } from "@/components/ui/QualifyConclusionCard";
import { track, trackOncePerUser } from "@/lib/analytics/eventService";
import { USER_COPY } from "@/lib/ux/userCopy";
import { natureShortLabel, stageLabel } from "@/lib/ia/labels";
import type { GuestPreviewReady } from "@/lib/guest/previewEngine";
import type { ProfileLimitation } from "@/lib/guest/guestSession";

/**
 * v6.1 访客初步机会结果页：
 * 未登录完成基础画像后，立即看到按匹配程度排序的教师公开招聘机会。
 *
 * - 优先展示“初步符合”，其余机会按需要补充的条件分组，并说明为什么要补、影响几个机会；
 * - 每条机会都能展开看到逐项条件依据与官方来源；
 * - 未填写户籍/年龄等条件只显示“补充信息后判断”，绝不判为不符合；
 * - v7.1 M3：用工形式偏好三选一（只看事业编/也接受其他官方形式/暂不确定），
 *   只影响筛选与展示，不形成资格结论；展开可见各形式审慎解释；
 * - 未登录可完整查看，只有“关注/保存”一个主行动触发登录；
 * - 不生成 7 天备考计划；非语文学科显示“尚未开放 + 留下意向”终态。
 */
export default function PreviewPage() {
  const router = useRouter();
  const { status } = useCurrentUser();

  // 基础输入（草稿/公告/参考时间）只在进入页面时取一次；
  // 用工偏好变化只重算 preview（纯函数），不重复生成公告时间线。
  const [base] = useState<{
    draft: GuestProfileDraft;
    announcements: ReturnType<typeof getRollingDemoAnnouncements>;
    nowIso: string;
  } | null>(() => {
    if (typeof window === "undefined") return null;
    const session = guestSessionService.load();
    if (!session) return null;
    const now = new Date();
    return {
      draft: session.draft,
      announcements: getRollingDemoAnnouncements(now),
      nowIso: now.toISOString(),
    };
  });
  const [naturePref, setNaturePref] = useState<EmploymentNaturePreference | undefined>(
    () => base?.draft.employmentNaturePreference,
  );
  // 偏好写入失败提示：本次会话内仍生效，但不持久化
  const [prefSaveError, setPrefSaveError] = useState(false);
  const [intentionLeft, setIntentionLeft] = useState(base?.draft.intentionLeft === true);
  const [intentionError, setIntentionError] = useState<string | null>(null);

  const preview: GuestPreview | null = useMemo(() => {
    if (!base) return null;
    return buildGuestPreview(
      { ...base.draft, employmentNaturePreference: naturePref },
      base.announcements,
      base.nowIso,
    );
  }, [base, naturePref]);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "authenticated") {
      // 已登录用户有自己的机会主流程，访客预览不对其开放
      router.replace("/opportunities");
      return;
    }
    if (!preview || preview.kind === "incomplete") {
      router.replace("/onboarding");
    }
  }, [status, router, preview]);

  /** 选择用工偏好：立即重算结果并持久化；写入失败不阻断（本次会话仍生效） */
  const selectNaturePref = (value: EmploymentNaturePreference) => {
    setNaturePref(value);
    setPrefSaveError(false);
    try {
      guestSessionService.save({ draft: { employmentNaturePreference: value } });
    } catch {
      setPrefSaveError(true);
    }
    track("nature_preference_changed", "opportunity", { props: { value } });
  };

  if (status === "loading") return <LoadingPage />;
  if (!preview || preview.kind === "incomplete") return <LoadingPage />;

  if (preview.kind === "subject_not_open") {
    return (
      <NotOpenSubject
        subjectLabel={preview.subjectLabel}
        intentionLeft={intentionLeft}
        error={intentionError}
        onLeaveIntention={() => {
          try {
            guestSessionService.save({ draft: { intentionLeft: true } });
            setIntentionLeft(true);
            setIntentionError(null);
          } catch {
            setIntentionError("本机存储不可用，意向没有保存，请检查浏览器存储设置后重试。");
          }
        }}
      />
    );
  }

  return FLAGS.ff_new_results ? (
    // v7.2 统一结果工作台：与 /opportunities 同一套三标签 + 统一岗位卡；
    // 结果页不再重复询问用工形式（条件摘要 + 修改入口）。
    // PreviewWorkbench 使用 useSearchParams，生产构建需要 Suspense 边界。
    <Suspense fallback={<LoadingPage />}>
      <PreviewWorkbench preview={preview} naturePref={naturePref} />
    </Suspense>
  ) : (
    <ReadyPreview
      preview={preview}
      naturePref={naturePref}
      onSelectNaturePref={selectNaturePref}
      prefSaveError={prefSaveError}
    />
  );
}

/* ================== 学科尚未开放终态 ================== */

function NotOpenSubject({
  subjectLabel,
  intentionLeft,
  error,
  onLeaveIntention,
}: {
  subjectLabel: string;
  intentionLeft: boolean;
  error: string | null;
  onLeaveIntention: () => void;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-lg mx-auto px-4 py-10">
        <Card className="rounded-xl border-line p-6 text-center shadow-1 sm:p-8">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-ink-2" aria-hidden="true">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <h1 className="mt-4 text-xl font-bold text-ink">
            「{subjectLabel}」教师公开招聘匹配尚未开放
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            当前先开放<strong className="text-ink">语文</strong>教师公开招聘。
            为了避免误导，我们不会用语文岗位为你生成不相关的匹配结果。
          </p>
          {intentionLeft ? (
            <div className="mt-5 rounded-md border border-ok-line bg-ok-bg px-4 py-3 text-sm text-ok-ink">
              已在本机记录你对「{subjectLabel}」的开注意向。
              <p className="mt-1 text-xs">
                意向仅保存在当前浏览器，不会上传服务器；演示环境不会发送真实通知。
              </p>
            </div>
          ) : (
            <Button size="lg" fullWidth onClick={onLeaveIntention} className="mt-5">
              留下「{subjectLabel}」开注意向
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            意向只保存在这台设备，不上传、不发送真实通知。
          </p>
        </Card>
        <p className="text-center text-sm text-ink-muted mt-6">
          想先看看语文机会？
          <Link href="/onboarding?from=preview" className="text-brand hover:underline ml-1">
            返回修改学科
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ================== 初步机会结果 ================== */

/** 真实监测事实行（与首页同一数据源）；下方 seed 机会必须明确标注为演示示例 */
function formatCoverageLine(): string {
  const d = new Date(GUEST_COVERAGE.lastCheckedAt);
  const day = Number.isNaN(d.getTime())
    ? GUEST_COVERAGE.lastCheckedAt
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${coverageProvinceLine(GUEST_COVERAGE)} · ${day}核对 · 当前在报 ${GUEST_COVERAGE.openOpportunityCount} 个`;
}

function ReadyPreview({
  preview,
  naturePref,
  onSelectNaturePref,
  prefSaveError,
}: {
  preview: GuestPreviewReady;
  naturePref: EmploymentNaturePreference | undefined;
  onSelectNaturePref: (value: EmploymentNaturePreference) => void;
  prefSaveError: boolean;
}) {
  const router = useRouter();
  const { view, followUps, limitations, primaryAction } = preview;

  // P0 漏斗②：访客看到至少一个有效（初步符合）机会；同用户只记一次
  // 模块 0A 补缺口事件：初步结果曝光
  useEffect(() => {
    track("preview_revealed", "opportunity", {
      props: { validCount: view.validCount },
    });
    if (view.validCount > 0) {
      trackOncePerUser("opportunity_revealed", "opportunity", {
        targetId: view.priority?.unitId,
        props: { validCount: view.validCount },
      });
    }
    // 仅在预览结果首次展示时记录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 首屏先看机会概要，需要时再展开逐项依据。
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  const toggleRow = (unitId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  /**
   * v7.2 四档主行动（与卡片上的按钮一一对应）：
   * 初步符合→登录并保存；待补信息→定向补充（只补缺失子字段，不回基础画像页）；
   * 建议确认/明确不符→展开看要点/原因；异常态→打开官方公告。展开判断依据降为次级文本操作。
   */
  const handleCardNextStep = (kind: GuestCardNextStepKind, row: OpportunityRow) => {
    switch (kind) {
      case "login":
        router.push("/login?next=/opportunities");
        break;
      case "supplement":
        // v7.2：补充信息走定向补充路由（demo 模式），绝不回基础画像页。
        router.push(`/preview/supplement/${row.unitId}?origin=preview&bucket=need_more_info`);
        break;
      case "official": {
        const href = safeOfficialLink(row.officialUrl) ?? row.officialUrl;
        if (href) window.open(href, "_blank", "noopener,noreferrer");
        break;
      }
      case "expand":
        toggleRow(row.unitId);
        break;
    }
  };

  const archivedCount =
    preview.natureOutOfPreference.length +
    view.regionOutOfScope.length +
    view.notEligible.length +
    view.closedBuckets.reduce((sum, bucket) => sum + bucket.rows.length, 0);

  // 不适合优先展示的示例统一收进一个入口，避免页面先铺满多个结果分区。
  const archiveSections = archivedCount > 0 ? (
    <Disclosure title="查看暂不推荐的示例" count={archivedCount}>
      <div className="space-y-6">
        {preview.natureOutOfPreference.length > 0 && (
          <section className="space-y-3">
            <LayerHeading
              title="不符合当前用工形式偏好"
              count={preview.natureOutOfPreference.length}
            />
            <p className="text-xs leading-5 text-ink-muted">
              这些岗位的用工形式不在你选择的「只看事业编」范围内，所以没有进入上面的推荐；
              这只是偏好筛选，不代表资格不符合，可随时在上方切换偏好后重新查看。
            </p>
            {preview.natureOutOfPreference.map((row) => (
              <OpportunityCard
                key={row.unitId}
                row={row}
                natureOutOfPreference
                expanded={openIds.has(row.unitId)}
                onToggle={() => toggleRow(row.unitId)}
                onSelectNextStep={handleCardNextStep}
              />
            ))}
          </section>
        )}

        {view.regionOutOfScope.length > 0 && (
          <section className="space-y-3">
            <LayerHeading title="地区不在你选择的范围" count={view.regionOutOfScope.length} />
            <p className="text-xs leading-5 text-ink-muted">
              这些岗位只是地点不在你填写的可接受地区内，并不代表其他条件不符合。
            </p>
            {view.regionOutOfScope.map((row) => (
              <OpportunityCard
                key={row.unitId}
                row={row}
                regionOutOfScope
                expanded={openIds.has(row.unitId)}
                onToggle={() => toggleRow(row.unitId)}
                onSelectNextStep={handleCardNextStep}
              />
            ))}
          </section>
        )}

        {view.notEligible.length > 0 && (
          <section className="space-y-3">
            <LayerHeading title="条件暂不符合" count={view.notEligible.length} />
            {view.notEligible.map((row) => (
              <OpportunityCard
                key={row.unitId}
                row={row}
                expanded={openIds.has(row.unitId)}
                onToggle={() => toggleRow(row.unitId)}
                onSelectNextStep={handleCardNextStep}
              />
            ))}
          </section>
        )}

        {view.closedBuckets.map((bucket) => (
          <section key={bucket.key} className="space-y-3">
            <LayerHeading title={bucket.label} count={bucket.rows.length} />
            {bucket.rows.map((row) => (
              <OpportunityCard
                key={row.unitId}
                row={row}
                expanded={openIds.has(row.unitId)}
                onToggle={() => toggleRow(row.unitId)}
                onSelectNextStep={handleCardNextStep}
              />
            ))}
          </section>
        ))}
      </div>
    </Disclosure>
  ) : null;

  // 空数据：画像完整但已覆盖公告中没有可考虑机会
  if (!view.priority) {
    const missingRegion = limitations.some((item) => item.step === 1);
    const regionFollowUp = followUps.find((f) => f.dimension === "region");
    if (missingRegion) {
      return (
        <div className="min-h-screen bg-canvas">
          <div className="mx-auto max-w-lg px-4 py-10">
            <Card className="rounded-xl border-brand/20 p-6 shadow-2 sm:p-7">
              <p className="text-xs font-semibold tracking-wide text-brand">还差一个信息</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                先选择一个能接受的地区
              </h1>
              <p className="mt-3 text-sm leading-6 text-ink-muted">
                没有地区时，我们无法判断哪些岗位值得你看
                {regionFollowUp ? `，当前有 ${regionFollowUp.affectsCount} 个示例机会在等这个信息` : ""}。
                学历、专业、毕业情况和教师资格都可以稍后再补。
              </p>
              <LinkButton href="/onboarding?from=preview" variant="primary" size="lg" className="mt-5 w-full">
                补充地区
              </LinkButton>
              <p className="mt-4 text-xs leading-5 text-ink-muted">
                缺少信息不会被当作不符合；补充地区后会立即重新计算。
              </p>
            </Card>
            <p className="mt-4 text-center text-xs text-ink-muted">{formatCoverageLine()}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-2xl space-y-4 py-6 px-4">
          <header>
            <p className="text-xs font-semibold tracking-wide text-brand">初步匹配结果</p>
            <h1 className="mt-1 text-xl font-bold text-ink">暂时没有可优先推进的机会</h1>
            <p className="mt-1 text-xs text-ink-muted">{formatCoverageLine()}</p>
          </header>
          <UncoveredRegionsCard regionLabels={view.uncoveredRegions.map((r) => r.label)} />
          <EmptyState
            title="当前已覆盖的公告里还没有你能考虑的机会"
            description="可以修改地区或学历等条件再看；未覆盖地区不等于没有招聘，新公告核对后会出现在这里。"
            actionLabel="修改报考信息"
            actionHref="/onboarding?from=preview"
          />
          <InvitedTrialHandoff />
          <SummaryCard />
          <LimitationsCard limitations={limitations} />
          {archiveSections}
        </div>
      </div>
    );
  }

  const priority = view.priority;
  // 四档分层标签文字（与 QualifyConclusionCard tagText 保持一致但不依赖默认值）
  const priorityLevel: QualifyLevel =
    priority.status === "preliminary_eligible"
      ? "ok"
      : priority.status === "need_more_info"
        ? "miss"
        : priority.status === "manual_review"
          ? "ask"
          : "no";
  const priorityStatusText =
    priority.status === "preliminary_eligible"
      ? "建议重点关注"
      : priority.status === "need_more_info"
        ? "信息补充后再判断"
        : priority.status === "manual_review"
          ? "需要你确认"
          : "当前条件可能不符合";
  // 关键限制条件：从 dimensions 中取出第一个 UNKNOWN / MANUAL_REVIEW / FAIL 作为 reasons
  const priorityReasons = priority.dimensions
    .filter((d) => d.value !== "PASS")
    .slice(0, 3)
    .map((d) => `${d.label}：${d.reason}`);
  const otherPreliminary = view.preliminary.filter((row) => row.unitId !== priority.unitId);
  const moreResultCount =
    otherPreliminary.length +
    view.needInfoGroups.reduce((sum, group) => sum + group.rows.length, 0) +
    view.manualReview.length;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* 真实监测事实（保留旧 Hero 组件：渐变背景由首页统一，preview 维持 surface 风
            以便与下方"示例判断"区在视觉上明确分隔真实监测事实 vs 虚构示例）。 */}
        <Hero
          meta="真实机会监测"
          conclusion={
            GUEST_COVERAGE.openOpportunityCount > 0
              ? `当前监测到 ${GUEST_COVERAGE.openOpportunityCount} 个正在报名的真实机会`
              : "当前没有监测到正在报名的真实机会"
          }
          risk={{ tone: "info", text: GUEST_COVERAGE.nextWindowNote }}
          action={
            primaryAction
              ? { label: primaryAction.label, href: primaryAction.href }
              : undefined
          }
        >
          <p className="text-xs leading-relaxed text-ink-muted">{formatCoverageLine()}</p>
        </Hero>

        {/* v7.1 M3 用工形式偏好：三档高层选择 + 展开解释；只影响筛选，不形成资格结论 */}
        <NaturePreferenceCard
          value={naturePref}
          onChange={onSelectNaturePref}
          saveError={prefSaveError}
        />

        {/* 示例判断：只解释产品会怎样帮助，不提供保存或报名动作。 */}
        <section id="demo-opportunity" className="scroll-mt-20 space-y-3">
          <div>
            <span className="inline-flex h-6 items-center rounded bg-warn-soft px-2.5 text-xs font-semibold text-warn">
              功能示例 · 不是当前真实岗位
            </span>
            <h2 className="mt-2 text-lg font-semibold text-ink">看看以后会怎样帮你判断</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              按你填写的信息，这个虚构机会会被标为「{priorityStatusText}」。
            </p>
          </div>
          {/* 四档分层结论卡（基于 evaluateOpportunity 结果，不写死判断）：
              level 由 priority.status 直接映射，reasons 来自 dimensions 中非 PASS 项 */}
          <QualifyConclusionCard
            level={priorityLevel}
            label={priorityStatusText}
            summary={priority.oneLineReason}
            reasons={priorityReasons}
            updatedAt={priority.checkedAtText}
            nextActions={[
              <LinkButton
                key="modify"
                href="/onboarding?from=preview"
                variant="ghost"
                size="sm"
                className="text-brand"
              >
                修改报考信息后重新判断
              </LinkButton>,
            ]}
          />
          <OpportunityCard
            row={priority}
            priority
            expanded={priorityOpen}
            onToggle={() => setPriorityOpen((v) => !v)}
            onSelectNextStep={handleCardNextStep}
          />
          <SummaryCard />
          <InvitedTrialHandoff />
        </section>

        {moreResultCount > 0 && (
          <Disclosure title="查看其他示例判断" count={moreResultCount}>
            <div className="space-y-6">
              {otherPreliminary.length > 0 && (
                <section className="space-y-3">
                  <LayerHeading title="其他可能适合" count={otherPreliminary.length} />
                  {otherPreliminary.map((row) => (
                    <OpportunityCard key={row.unitId} row={row} expanded={openIds.has(row.unitId)} onToggle={() => toggleRow(row.unitId)} onSelectNextStep={handleCardNextStep} />
                  ))}
                </section>
              )}

              {followUps.map((followUp) => {
                const group = view.needInfoGroups.find((g) => g.dimension === followUp.dimension);
                if (!group) return null;
                return (
                  <section key={followUp.dimension} className="space-y-3">
                    <LayerHeading title={`补充${followUp.dimensionText}后再判断`} count={followUp.affectsCount} />
                    <p className="text-xs leading-5 text-ink-muted">{followUp.reason}</p>
                    {group.rows.map((row) => (
                      <OpportunityCard key={row.unitId} row={row} expanded={openIds.has(row.unitId)} onToggle={() => toggleRow(row.unitId)} onSelectNextStep={handleCardNextStep} />
                    ))}
                  </section>
                );
              })}

              {view.manualReview.length > 0 && (
                <section className="space-y-3">
                  <LayerHeading title="需要向招聘单位确认" count={view.manualReview.length} />
                  {view.manualReview.map((row) => (
                    <OpportunityCard key={row.unitId} row={row} expanded={openIds.has(row.unitId)} onToggle={() => toggleRow(row.unitId)} onSelectNextStep={handleCardNextStep} />
                  ))}
                </section>
              )}
            </div>
          </Disclosure>
        )}

        {archiveSections}

        {(limitations.length > 0 || view.uncoveredRegions.length > 0) && (
          <Disclosure title="为什么结果可能不完整">
            <div className="space-y-4">
              <LimitationsCard limitations={limitations} />
              <UncoveredRegionsCard regionLabels={view.uncoveredRegions.map((region) => region.label)} />
            </div>
          </Disclosure>
        )}

        <p className="text-center text-xs text-ink-muted">
          示例仅用于体验判断方式，不代表真实招聘。你填写的报考信息仅保存在这台设备，可随时
          <Link href="/onboarding?from=preview" className="text-brand hover:underline mx-1">
            修改报考信息
          </Link>
          。
        </p>
      </div>
    </div>
  );
}

/**
 * v7.1 M3 用工形式偏好卡：
 * - 三档高层选项（PRD 5.4 文案）；未选择时不高亮任何项，不默认替用户选择；
 * - 展开可见各用工形式的一句审慎解释，并声明地区差异与官方口径；
 * - 偏好只影响筛选与展示，绝不形成资格结论。
 */
function NaturePreferenceCard({
  value,
  onChange,
  saveError,
}: {
  value: EmploymentNaturePreference | undefined;
  onChange: (value: EmploymentNaturePreference) => void;
  saveError: boolean;
}) {
  return (
    <section
      data-testid="nature-preference"
      aria-label="用工形式偏好"
      className="rounded-xl border border-line bg-surface p-4 shadow-1 sm:p-5"
    >
      <h2 className="text-base font-semibold text-ink">想看哪类用工形式的岗位？</h2>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        偏好只影响这里的展示范围和顺序，不会被当作资格结论，随时可以改。
      </p>
      <div className="mt-3 grid gap-2">
        {NATURE_PREFERENCE_OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              data-testid={`nature-pref-${opt.value}`}
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
              <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                {opt.hint}
              </span>
            </button>
          );
        })}
      </div>
      {saveError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          本机存储暂不可用，偏好本次生效但未能保存；下次进入页面需要重新选择。
        </p>
      )}
      <div className="mt-3">
        <Disclosure title="备案制、员额制这些词是什么意思？">
          <ul className="space-y-2">
            {OFFICIAL_NATURE_INFO.map((item) => (
              <li
                key={item.code}
                className="rounded-lg border border-line bg-canvas/60 px-3 py-2"
              >
                <span className="text-sm font-medium text-ink">
                  {natureShortLabel(item.code)}
                </span>
                <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            同一用工形式在不同地区的具体含义可能不同，请以官方公告和当地政策为准。
          </p>
        </Disclosure>
      </div>
    </section>
  );
}

/** 受邀测试承接：把访客预筛自然交给登录后的完整机会闭环。 */
function InvitedTrialHandoff() {
  if (AUTH_MODE !== "invited") return null;

  return (
    <Card className="border-brand/25 bg-brand-soft/35 p-5 shadow-none">
      <p className="text-xs font-semibold tracking-wide text-brand">继续完整试用</p>
      <h2 className="mt-1 text-base font-semibold text-ink">
        登录后查看我的机会、材料和日程
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        你刚填写的报考信息会在登录后同步到受邀账号，无需重新填写。机会页会同时说明真实监测范围与虚构试用数据，不会把示例当成真实岗位。
      </p>
      <LinkButton
        href="/login?next=/opportunities"
        variant="primary"
        size="md"
        className="mt-4 w-full sm:w-auto"
      >
        登录后查看我的机会
      </LinkButton>
      <p className="mt-3 text-xs leading-5 text-ink-muted">
        当前仅限受邀测试用户登录；请使用项目方提供的试用账号。
      </p>
    </Card>
  );
}

/* ================== 报考信息摘要：只保留一行关键内容 ================== */

/** 从访客草稿中拉取五项摘要，缺失项标"还不能判断" */
function SummaryCard() {
  if (typeof window === "undefined") return null;
  const session = guestSessionService.load();
  const draft: GuestProfileDraft | undefined = session?.draft;

  const regionText = draft?.regions?.length
    ? draft.regions
        .map((r) => [r.province, r.city].filter(Boolean).join("·"))
        .join("、")
    : USER_COPY.MATCH_STATUS.UNKNOWN;
  const educationText = draft?.educationLevel || draft?.degree
    ? [draft.educationLevel, draft.degree].filter(Boolean).join(" / ")
    : USER_COPY.MATCH_STATUS.UNKNOWN;
  const majorText = draft?.majorFullName?.trim() || USER_COPY.MATCH_STATUS.UNKNOWN;
  const educationLabel =
    CREDENTIAL_LEVEL_OPTIONS.find((option) => option.value === draft?.educationLevel)?.label ??
    educationText;
  const targetText = [
    draft?.teacherCert?.subject ? subjectLabel(draft.teacherCert.subject) : null,
    draft?.teacherCert?.stage ? stageLabel(draft.teacherCert.stage) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = [regionText, educationLabel, majorText, targetText]
    .filter((value) => value && value !== USER_COPY.MATCH_STATUS.UNKNOWN)
    .join(" · ");

  return (
    <div
      data-testid="preview-summary"
      className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-muted">根据你的报考信息判断</p>
        <p className="mt-1 line-clamp-2 text-sm text-ink">
          {summary || "部分信息暂未填写"}
        </p>
      </div>
      <Link
        href="/onboarding?from=preview"
        onClick={() => {
          // v7.1 M9：修改地区或资格信息，不记答案正文
          track("preview_summary_edited", "profile");
        }}
        className="shrink-0 text-xs font-medium text-brand hover:underline"
      >
        修改
      </Link>
    </div>
  );
}

/* ================== 画像地区暂未收录提示 ================== */

function UncoveredRegionsCard({ regionLabels }: { regionLabels: string[] }) {
  if (regionLabels.length === 0) return null;
  return (
    <section
      data-testid="uncovered-regions"
      className="rounded-lg border border-dashed border-line bg-canvas px-4 py-3"
    >
      <h2 className="text-sm font-semibold text-ink">
        这些地区当前暂未收录官方公告
      </h2>
      <p className="mt-1 text-xs text-ink-muted">{regionLabels.join("、")}</p>
      <p className="mt-1.5 text-xs leading-5 text-ink-muted">
        暂未收录不等于当地没有招聘：真实监测目前仅覆盖浙江杭州、宁波，江苏尚未接入；
        本页岗位均为虚构演示示例，报名前请以当地教育局或人社局官网为准。
      </p>
      <Link
        href="/onboarding?from=preview"
        className="mt-2 inline-block text-xs font-medium text-brand underline underline-offset-2"
      >
        修改报考地区
      </Link>
    </section>
  );
}

/* ================== 最低必要信息缺失的结果限制卡 ================== */

function LimitationsCard({ limitations }: { limitations: ProfileLimitation[] }) {
  if (limitations.length === 0) return null;
  return (
    <section
      aria-label="暂未提供信息导致的结果限制"
      data-testid="profile-limitations"
      className="rounded-lg border border-warn/30 bg-warn-soft/70 px-4 py-3"
    >
      <h2 className="text-sm font-semibold text-warn">
        有 {limitations.length} 项信息你暂未提供，结果已相应收窄
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {limitations.map((item) => (
          <li key={item.step} className="text-xs leading-relaxed text-warn">
            <span className="font-medium">{item.label}：</span>
            {item.impact}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-warn">
        没有填写的信息一律显示「补充信息后判断」，不会被判为不符合；
        <Link href="/onboarding?from=preview" className="font-medium underline underline-offset-2 ml-1">
          返回补填
        </Link>
        后结果自动更新。
      </p>
    </section>
  );
}
