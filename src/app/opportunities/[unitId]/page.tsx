"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hero } from "@/components/ia/Hero";
import { Disclosure } from "@/components/ia/Layer";
import { GateTag, MatchStatusTag } from "@/components/ia/MatchStatusTag";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { Callout } from "@/components/ui/Callout";
import {
  deadlineText,
  natureShortLabel,
  regionLabel,
  stageSubjectLabel,
} from "@/lib/ia/labels";
import { MATCH_STATUS_LABELS } from "@/lib/matching/types";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type {
  FollowStatus,
  MaterialStatus,
  StudyTargetRole,
  UnitDetailResponse,
} from "@/lib/opportunities/api-types";
import {
  failedGateViews,
  groupDimensions,
  nextAction,
  primaryGate,
} from "@/lib/opportunities/detail-view";
import { useActiveProfile } from "@/lib/opportunities/useOpportunities";
import {
  buildActiveProfile,
  supplementFactsService,
  type SupplementFacts,
} from "@/lib/profile/activeProfile";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { ConditionRows } from "@/components/opportunities/ConditionRows";
import { useCurrentUser } from "@/lib/auth";
import { upsertGuestFollow } from "@/lib/guest/guestFollows";
import { FollowControls } from "@/components/opportunities/FollowControls";
import { SupplementForm } from "@/components/opportunities/SupplementForm";
import {
  OfficialSourceSection,
  VerificationSection,
} from "@/components/opportunities/EvidenceSection";
import { CorrectionModal } from "@/components/opportunities/CorrectionModal";
import { MaterialsList } from "@/components/opportunities/MaterialsList";
import { ConsultationPanel } from "@/components/opportunities/ConsultationPanel";
import { SavedNextActionPanel } from "@/components/opportunities/SavedNextActionPanel";
import {
  selectSavedNextAction,
  timelineCandidatesFromUnit,
} from "@/lib/opportunities/next-action-selector";
import { track, trackView } from "@/lib/analytics/eventService";
import { gateStateMeta } from "@/lib/gate-states";
import { buildMapEntry } from "@/lib/opportunities/map-link";
import { schoolDisplayText } from "@/lib/opportunities/school-placement";
import { MapLink } from "@/components/opportunities/MapLink";
import { useOnlineStatus, isForbiddenError } from "@/lib/useOnlineStatus";
import { FLAGS, resolveSupplementTarget } from "@/lib/flags";

function scrollToId(id: string) {
  const target = document.getElementById(id);
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  } else if (target) {
    // 目标在折叠的 Disclosure（details）内时，先展开祖先再滚动
    const ancestor = target.closest("details");
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  target?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

export default function OpportunityDetailPage() {
  const params = useParams<{ unitId: string }>();
  const unitId = params?.unitId ?? "";
  const router = useRouter();
  const profileState = useActiveProfile();
  const { status: authStatus } = useCurrentUser();
  // v7.1 M8：访客（未登录）在请求体携带画像
  const isGuest = profileState.status === "ready" && profileState.isGuest;

  const [detail, setDetail] = useState<UnitDetailResponse | null>(null);
  const [loading, setLoading] = useState(
    () => profileState.status === "ready",
  );
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const online = useOnlineStatus();
  const [facts, setFacts] = useState<SupplementFacts>(() =>
    supplementFactsService.load(),
  );
  const [savingFacts, setSavingFacts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 失败动作的重试闭包（目前仅保存动作提供：follow 无状态版本依赖，重试安全） */
  const [actionRetry, setActionRetry] = useState<(() => void) | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionDone, setCorrectionDone] = useState(false);
  // v7.2：本次会话刚保存成功＝面板绿色强调态；syncedEventCount 仅 follow 响应携带
  const [justSaved, setJustSaved] = useState(false);
  const [syncedEventCount, setSyncedEventCount] = useState<number | undefined>(
    undefined,
  );

  // 手动重试 / 补充信息后重拉：事件处理器中调用，可以同步切 loading。
  // 返回最新响应，供「补信息导致结论变化」对比前后结论（模块 7 埋点）。
  const loadDetail = useCallback(
    async (profile: UserRecruitmentProfile): Promise<UnitDetailResponse | undefined> => {
      setLoading(true);
      setError(null);
      setForbidden(false);
      try {
        const response = await opportunitiesApi.unitDetail(unitId, profile, {
          sendProfile: isGuest,
        });
        setDetail(response);
        // P0 漏斗③：打开详情即看到逐项官方依据（同一会话每机会只记一次）
        trackView(unitId, "match_basis_viewed", "opportunity", {
          targetId: unitId,
          props: { fieldCount: response.unit.dimensions.length },
        });
        return response;
      } catch (e) {
        if (isForbiddenError(e)) setForbidden(true);
        else setError(e instanceof Error ? e.message : "详情加载失败");
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [unitId, isGuest],
  );

  // 首次加载：setState 均在异步回调中，避免渲染级联
  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    opportunitiesApi
      .unitDetail(unitId, profileState.profile, { sendProfile: isGuest })
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
          // P0 漏斗③：打开详情即看到逐项官方依据（同一会话每机会只记一次）
          trackView(unitId, "match_basis_viewed", "opportunity", {
            targetId: unitId,
            props: { fieldCount: response.unit.dimensions.length },
          });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          if (isForbiddenError(e)) setForbidden(true);
          else setError(e instanceof Error ? e.message : "详情加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unitId, profileState, isGuest]);

  // 带 hash 进入（如列表「去看下一步」→ #follow）：详情就绪后展开折叠区并滚动一次
  const hashHandledUnitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || hashHandledUnitRef.current === unitId) return;
    hashHandledUnitRef.current = unitId;
    const raf = window.requestAnimationFrame(() => {
      const hash = window.location.hash;
      if (hash.startsWith("#")) scrollToId(hash.slice(1));
    });
    return () => window.cancelAnimationFrame(raf);
  }, [detail, unitId]);

  // v7.1 M8：invited 模式下等待会话恢复完成
  if (profileState.status === "loading" || (authStatus === "loading" && !loading && !detail)) {
    return <LoadingPage />;
  }

  if (loading) return <LoadingPage />;

  if (profileState.status === "no-profile") {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="先填写报考信息，才能查看这项机会的判断依据"
          description="机会详情会根据你填写的报考信息逐项核对。"
          actionLabel="填写报考信息"
          actionHref="/onboarding?from=opportunity"
        />
      </div>
    );
  }

  // 到此分支 profileState 必然 ready（上面已对 loading/no-profile 提前返回）
  const profile = profileState.profile;

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="无权限查看这个机会"
          description="登录已过期或当前账号无权访问该数据。请重新登录后再试。"
          actionLabel="去登录"
          actionHref="/login"
        />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <ErrorState
        title={online ? "机会详情加载失败" : "当前离线，无法加载机会详情"}
        description={
          online
            ? (error ?? "未找到该报考单元，它可能不属于当前已发布公告版本。")
            : "网络已断开。恢复网络后点击重试，或返回机会列表浏览其他机会。"
        }
        onRetry={() => void loadDetail(profile)}
      />
    );
  }

  const unit = detail.unit;
  // 模块 7.5 合规过滤：用户端不展示 AI 初核待人工复核记录（dataset === "real"）。
  // 列表已不输出 real；用户直接访问详情 URL 时同样退出，显示"尚未正式发布"。
  // 真正解决需后端 unitDetail() 加 status 过滤（见最终报告"后续任务"）。
  if (
    unit.announcement.dataset === "real" &&
    unit.announcement.reviewStatus !== "human_reviewed"
  ) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="该机会尚未正式发布"
          description="这条记录仍在人工复核中，暂不向用户端展示。可以稍后查看，或返回机会列表浏览其他已发布机会。"
          actionLabel="返回机会列表"
          actionHref="/opportunities"
        />
      </div>
    );
  }
  const groups = groupDimensions(unit.dimensions);
  const primaryClosedGate = primaryGate(unit.gates);
  const gateViews = failedGateViews(unit.gates);
  const closed = gateViews.length > 0;
  const action = nextAction(unit);
  // v7.2：保存区唯一主动作（considering 时重算；闸门/其他状态由选择器内部短路）。
  // 每次渲染取当前时钟；纯函数规则本身不读时钟，可用任意 nowIso 单测。
  const savedNextAction =
    unit.follow && unit.follow.status === "considering"
      ? selectSavedNextAction(
          {
            gates: unit.gates,
            follow: unit.follow,
            dimensions: unit.dimensions,
            materials: unit.unit.materials ?? [],
            events: timelineCandidatesFromUnit(unit),
          },
          new Date().toISOString(),
        )
      : null;
  // 补充表单只收集画像外的事实（出生日期/户籍/社保/工作年限）与自由项；
  // 学历、专业等画像信息缺失时表单无可补字段，需引导用户去报考信息页补填。
  const askableUnknown = groups.missingInfo.filter(
    (d) =>
      d.dimension === "age" ||
      d.dimension === "hukou" ||
      d.dimension === "social_security" ||
      d.dimension === "work_experience" ||
      d.dimension === "other",
  );
  const deadline = deadlineText(
    unit.version.timeline.registrationEnd,
    detail.meta.evaluatedAt,
  );
  const heroConclusion = closed
    ? gateStateMeta(primaryClosedGate!.code).label
    : unit.overall === "preliminary_eligible"
      ? "目前初步符合，可以进入报名准备"
      : unit.overall === "need_more_info"
        ? `还差 ${groups.missingInfo.length} 项信息才能完成判断`
        : unit.overall === "manual_review"
          ? `${groups.confirmOfficial.length} 项条件需要向招聘单位确认`
          : `${groups.unsatisfied.length} 项条件明确不符合`;

  const heroAction = (() => {
    const base = { label: action.label };
    if (action.href) {
      return { ...base, href: action.href, external: action.external };
    }
    if (action.kind === "supplement") {
      // v7.2 ff_targeted_supplement：开 → 专用补充页（origin=detail + 按总体结论选桶）；
      // 关（回退）→ 详情页内联补充表单锚点，绝不回 /onboarding（PRD 8.4，由 flags 测试锁定）。
      const supplementTarget = resolveSupplementTarget(unitId);
      if (supplementTarget.kind === "route") {
        const bucket =
          unit.overall === "manual_review" ? "manual_review" : "need_more_info";
        return {
          ...base,
          href: `${supplementTarget.href}?origin=detail&bucket=${bucket}`,
        };
      }
      return { ...base, onClick: () => scrollToId("supplement") };
    }
    if (action.kind === "confirm") {
      return { ...base, onClick: () => scrollToId("to-confirm") };
    }
    if (action.kind === "reviewFail") {
      return { ...base, onClick: () => scrollToId("unsatisfied") };
    }
    if (action.kind === "follow") {
      return {
        ...base,
        onClick: () => void followUnit(),
      };
    }
    if (action.kind === "prepare") {
      // 必须走 handleTransition：首屏主行动与下方跟进区共用同一条状态流转与
      // P0 漏斗⑥埋点，不能只调 API 导致主行动路径漏记 follow_status_changed。
      return {
        ...base,
        onClick: () => void handleTransition("preparing"),
      };
    }
    // waiting / registered：滚动到跟进区（register/official 已在前面处理外链）
    return { ...base, onClick: () => scrollToId("follow") };
  })();

  /** 用最新本机画像（含刚保存的补充事实）重新拉取后端结论，返回最新详情 */
  function refreshDetail(): Promise<UnitDetailResponse | undefined> {
    const active = buildActiveProfile();
    if (!active.ready) return Promise.resolve(undefined);
    return loadDetail(active.profile);
  }

  async function runAction(
    fn: () => Promise<unknown>,
    options?: {
      redirectAfter?: boolean;
      successMessage?: string;
      /** 仅在 await 成功并刷新后调用（失败不会触发，失败显真） */
      onSuccess?: () => void;
      /** 失败时在错误条内提供「重试」按钮；仅无状态版本依赖的动作可传 */
      retry?: () => void;
    },
  ) {
    setBusy(true);
    setActionError(null);
    setActionRetry(null);
    setActionNotice(null);
    try {
      await fn();
      if (options?.redirectAfter) {
        router.push("/opportunities");
        return;
      }
      await refreshDetail();
      options?.onSuccess?.();
      if (options?.successMessage) setActionNotice(options.successMessage);
    } catch (e) {
      const err = e as Error & { status?: number; body?: { error?: string; current?: unknown } };
      // 乐观锁冲突：服务端已有更新版本，拉取最新状态后提示用户，不丢进度
      if (err.body?.error === "VERSION_CONFLICT") {
        setActionError("状态已在其他设备更新，已同步最新状态，请重试。");
        await refreshDetail();
      } else {
        setActionError(err.message || "操作失败");
      }
      // 失败显真：不出现任何成功 UI，仅在动作允许时提供原地重试
      setActionRetry(options?.retry ? () => options.retry! : null);
    } finally {
      setBusy(false);
    }
  }

  /** 关注成功后埋点（失败由 runAction 捕获，不会产生事件）。
   *  v7.1 M8：未登录用户先暂存到本机再跳登录。 */
  const followUnit = () => {
    // v7.1 M8：访客保存触发登录（先本机暂存 considering 意图，再带 next 跳登录）
    if (isGuest) {
      upsertGuestFollow(unitId, { status: "considering" });
      router.push(`/login?next=/opportunities/${unitId}&reason=save`);
      return;
    }
    runAction(
      async () => {
        const saved = await opportunitiesApi.follow(unitId);
        // 真实后端 follow 响应携带日程同步节点数；演示数据无此字段时不显示
        setSyncedEventCount(saved.syncedEventCount);
        // P0 漏斗④：关注机会（保存≠报名，此处绝不调 transition）
        track("opportunity_followed", "opportunity", {
          targetId: unitId,
          props: { from: detail?.unit.overall ?? "unknown" },
        });
      },
      {
        onSuccess: () => {
          // 只有 await 成功并刷新后才展示绿色面板并展开跟进区（失败显真）
          setJustSaved(true);
          const followDetails = document.getElementById("follow");
          if (followDetails instanceof HTMLDetailsElement) followDetails.open = true;
          window.requestAnimationFrame(() => scrollToId("follow"));
        },
        // follow 幂等且无版本号依赖，失败后可原地重试
        retry: () => followUnit(),
      },
    );
  };

  const handleTransition = (
    status: FollowStatus,
    opts?: { note?: string; abandonReason?: string },
  ) =>
    runAction(async () => {
      const from = unit.follow?.status ?? "considering";
      await opportunitiesApi.transition(unitId, status, {
        ...opts,
        version: unit.follow?.version,
      });
      // P0 漏斗⑥：标记准备报名/已报名（含其他报名状态流转）
      track("follow_status_changed", "opportunity", {
        targetId: unitId,
        props: { from, to: status },
      });
    }, {
      successMessage:
        status === "preparing"
          ? "已标记为准备报名，接下来可以核对材料与报名时间。"
          : status === "registered"
            ? "报名状态已更新为已报名。"
            : status === "considering"
              ? "已移回考虑中。"
              : status === "abandoned"
                ? "已记录为放弃，这不会影响其他机会。"
                : "已标记为结束。",
    });

  const handleSetRole = (role: StudyTargetRole) => {
    // v7.1 M8：访客设置主要目标触发登录
    if (isGuest && role === "primary") {
      router.push(`/login?next=/opportunities/${unitId}&reason=set_primary`);
      return;
    }
    runAction(async () => {
      await opportunitiesApi.setRole(unitId, role);
      // P0 漏斗⑦：设为主要目标
      if (role === "primary") {
        track("primary_target_set", "opportunity", { targetId: unitId });
      }
    }, {
      successMessage:
        role === "primary"
          ? "已设为重点准备的机会，接下来可以开始安排备考。"
          : "已改为备选机会，原有记录会继续保留。",
    });
  };

  /** 标记某报名材料项完成状态（带乐观锁）；材料完成进度进看板「材料完成」（模块 7） */
  const handleMaterialStatus = (itemId: string, status: MaterialStatus) =>
    runAction(async () => {
      if (!unit.follow) return;
      await opportunitiesApi.setMaterialStatus(
        unitId,
        itemId,
        status,
        unit.follow.version,
      );
      // 只记进度枚举，不采集证件信息
      track("material_status_changed", "opportunity", {
        targetId: unitId,
        props: { to: status },
      });
    });

  /** 保存用户自行记录的官方咨询结论（带乐观锁，不影响匹配） */
  const handleConsultationNote = (dimensionKey: string, note: string) =>
    runAction(async () => {
      if (!unit.follow) return;
      await opportunitiesApi.saveConsultationNote(
        unitId,
        dimensionKey,
        note,
        unit.follow.version,
      );
    });

  const handleSaveFacts = async (next: SupplementFacts) => {
    setSavingFacts(true);
    setActionError(null);
    try {
      const saved = supplementFactsService.save(next);
      setFacts(saved);
      // 必须重新装配画像：保存后的补充事实要参与后端重算，
      // 不能复用首屏缓存的 profile。
      const beforeOverall = detail?.unit.overall;
      const fresh = await refreshDetail();
      // P0 漏斗⑤：补充资格信息成功并触发重算（只记维度与字段数，不含答案）；
      // 模块 7：对比补问前后结论，结论变化单独进看板「补信息导致结论变化」。
      const dims = {
        age: saved.birthDate !== undefined,
        hukou: saved.hukouProvinceCode !== undefined,
        social_security: saved.socialSecurityMonths !== undefined,
        work_experience: saved.workExperienceMonths !== undefined,
        other: Object.keys(saved.extraAnswers ?? {}).length > 0,
      };
      const fieldCount = Object.values(dims).filter(Boolean).length;
      if (fieldCount > 0) {
        const conclusionChanged =
          fresh && beforeOverall !== undefined
            ? fresh.unit.overall !== beforeOverall
            : false;
        track("qualification_supplemented", "profile", {
          targetId: unitId,
          props: {
            fieldCount,
            age: dims.age ? 1 : 0,
            hukou: dims.hukou ? 1 : 0,
            social_security: dims.social_security ? 1 : 0,
            work_experience: dims.work_experience ? 1 : 0,
            other: dims.other ? 1 : 0,
            conclusionChanged: conclusionChanged ? 1 : 0,
          },
        });
      }
      setActionNotice(
        fresh && beforeOverall !== fresh.unit.overall
          ? "信息已保存，机会判断已经更新。"
          : "信息已保存，当前判断暂时没有变化。",
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingFacts(false);
    }
  };

  const handleCorrection = async (input: {
    fieldPath: string;
    content: string;
    contact?: string;
  }) => {
    setCorrectionSubmitting(true);
    setActionError(null);
    try {
      await opportunitiesApi.submitCorrection(unitId, input);
      setCorrectionOpen(false);
      setCorrectionDone(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "纠错提交失败");
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-4">
      <nav className="text-xs text-ink-muted">
        <Link
          href="/opportunities"
          className="underline underline-offset-2 hover:text-brand"
        >
          ← 返回机会列表
        </Link>
      </nav>

      {/* 标题区（报考单元基础事实） */}
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-snug tracking-tight text-ink">
              {unit.unit.name}
            </h1>
            {/* 演示数据必须在首屏可见地标识（不收进折叠层） */}
            {unit.announcement.dataset === "demo" && (
              <Badge variant="warning" className="mt-2">
                虚构演示
              </Badge>
            )}
          </div>
          {primaryClosedGate ? (
            <GateTag code={primaryClosedGate.code} />
          ) : (
            <MatchStatusTag status={unit.overall} />
          )}
        </div>
        <p className="text-sm text-ink-muted">
          {regionLabel(unit.unit.region)} ·{" "}
          {unit.unit.employmentNature.officialName}（
          {natureShortLabel(unit.unit.employmentNature.code as never)}） ·{" "}
          {stageSubjectLabel(unit.unit.stage, unit.unit.subject)} · 招{" "}
          {unit.unit.headcount} 人
        </p>
        <p className="text-sm text-ink-muted">
          {unit.announcement.publisher} · 报名
          {closed ? "" : deadline.text}
        </p>
        {/* 任教学校（v7.1 M4）：逐校列明才给校名和市区；录用后选岗/统一调配给官方口径，
            招聘单位与岗位组名不等于最终任教学校 */}
        <p className="text-sm text-ink-muted" data-testid="school-placement">
          任教学校：{schoolDisplayText(unit.unit, regionLabel(unit.unit.region))}
        </p>
        {/* v7.1 M5 地图轻量入口：用户主动点击后新窗口打开国内地图；连市也未明确时隐藏 */}
        {(() => {
          const mapEntry = buildMapEntry({
            city: unit.unit.region.city,
            district: unit.unit.region.district,
            schoolPlacement: unit.unit.schoolPlacement,
          });
          return mapEntry ? (
            <MapLink entry={mapEntry} unitId={unitId} from="opportunity_detail" />
          ) : null;
        })()}
        {/* 模块 7.5：dataset === "real" 已在加载后 early return，此处不再渲染提示 */}
        {unit.announcement.dataset === "demo" && (
          <aside
            className="rounded-xl border border-warn/25 bg-warn-soft/60 px-4 py-3"
            aria-label="演示数据说明"
          >
            <p className="text-sm font-semibold text-ink">这是虚构演示机会</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              标题、发布主体与日期均为演示示例，不代表真实招聘信息，不可用于真实报名。
            </p>
          </aside>
        )}
        {unit.follow?.newerVersion && (
          <Callout variant="note" title="公告版本已更新">
            你保存时依据的公告版本已有更新，当前展示的是最新已发布版本。
          </Callout>
        )}
      </header>

      {/* 第一段：结论 + 唯一下一步 */}
      <Hero
        meta={`机会结论 · ${
          primaryClosedGate
            ? gateStateMeta(primaryClosedGate.code).label
            : MATCH_STATUS_LABELS[unit.overall]
        }`}
        conclusion={heroConclusion}
        action={busy ? { ...heroAction, disabled: true, label: "处理中…" } : heroAction}
      >
        {!closed && (
          <p className="text-sm leading-6 text-ink-muted">{unit.summary}</p>
        )}
        {closed && (
          <Callout variant="no" title="不进入推荐的原因（历史留档已保留，不会当作资格不符合）">
            <ul className="space-y-1">
              {gateViews.map(({ gate, meta }) => (
                <li key={gate.code}>
                  <span className="font-medium">· {meta.label}：</span>
                  {gate.reason}
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </Hero>

      <section aria-labelledby="eligibility-summary" className="space-y-3">
        <div>
          <h2 id="eligibility-summary" className="text-base font-semibold text-ink">
            资格摘要
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">
            缺少信息不是不符合；存在歧义的条件必须向招聘单位确认，系统不会自动下结论。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "已满足", count: groups.satisfied.length, tone: "bg-ok-bg text-ok-ink border border-ok-line" },
            { label: "待补充", count: groups.missingInfo.length, tone: "bg-ask-bg text-ask-ink border border-ask-line" },
            { label: "需确认", count: groups.confirmOfficial.length, tone: "bg-ask-bg text-ask-ink border border-ask-line" },
            { label: "不符合", count: groups.unsatisfied.length, tone: "bg-no-bg text-no-ink border border-no-line" },
          ].map((item) => (
            <div key={item.label} className={`rounded-xl px-3 py-3 ${item.tone}`}>
              <p className="text-xs font-medium">{item.label}</p>
              <p className="mt-1 text-xl font-semibold" aria-label={`${item.label} ${item.count} 项`}>
                {item.count}
              </p>
            </div>
          ))}
        </div>
      </section>

      {actionError && (
        <Callout variant="no" title="操作未完成">
          <p>{actionError}</p>
          {actionRetry && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy}
              data-testid="action-retry"
              onClick={() => actionRetry()}
            >
              重试
            </Button>
          )}
        </Callout>
      )}
      {actionNotice && (
        <StatusMessage
          tone="success"
          message={actionNotice}
          duration={6000}
          onDismiss={() => setActionNotice(null)}
        />
      )}
      {correctionDone && (
        <Callout variant="ok" title="纠错已提交并留痕">
          我们会核对官方原文；如需更正将通过新版本发布，不会直接改动结论。
        </Callout>
      )}
      {!online && (
        <Callout variant="ask" title="当前离线">
          显示的是之前加载的资格判断，可能不是最新版本。恢复网络后会自动刷新。
        </Callout>
      )}

      <details
        id="follow"
        className="group scroll-mt-20 rounded-2xl border border-line bg-surface"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold text-ink">我的跟进</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {unit.follow
                ? `已保存 · ${unit.follow.role === "primary" ? "重点准备的机会" : unit.follow.role === "backup" ? "备选机会" : "可继续推进报名状态"}`
                : "保存后可记录报名进度并设为重点准备的机会"}
            </span>
          </span>
          <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="space-y-3 border-t border-line p-3">
          {/* v7.2 ff_post_save_next：关（回退）时不渲染「一个下一步」面板，
              保存成功提示仍走上方 actionNotice（StatusMessage），不回退到空反馈。 */}
          {FLAGS.ff_post_save_next &&
            unit.follow &&
            unit.follow.status === "considering" && (
            <SavedNextActionPanel
              action={savedNextAction}
              emphasized={justSaved}
              syncedEventCount={syncedEventCount}
              busy={busy}
              onUnfollow={() =>
                void runAction(
                  async () => {
                    await opportunitiesApi.unfollow(unitId);
                    track("opportunity_unfollowed", "opportunity", {
                      targetId: unitId,
                    });
                  },
                  { redirectAfter: true },
                )
              }
              onDismiss={() => setJustSaved(false)}
              onAnchor={scrollToId}
              onActionOpened={(next) =>
                // 只记级别与动作类型枚举，不记岗位以外的任何正文
                track("next_action_opened", "opportunity", {
                  targetId: unitId,
                  props: { tier: next.tier, kind: next.kind },
                })
              }
            />
          )}
          <FollowControls
            follow={unit.follow}
            unitName={unit.unit.name}
            busy={busy}
            onFollow={() => void followUnit()}
            onTransition={(status, opts) => void handleTransition(status, opts)}
            onSetRole={(role) => void handleSetRole(role)}
            onUnfollow={() =>
              void runAction(async () => {
                await opportunitiesApi.unfollow(unitId);
                track("opportunity_unfollowed", "opportunity", { targetId: unitId });
              }, { redirectAfter: true })
            }
          />
        </div>
      </details>

      {/* 第二段：关键依据与不确定项（官方事实 vs 系统预筛判断分行展示） */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            影响当前判断的条件
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            先处理缺失、不确定或不满足项；已满足条件可按需展开。
          </p>
        </div>

        {groups.missingInfo.length > 0 && (
          <Disclosure
            id="missing-info"
            title="需要补充的信息"
            count={groups.missingInfo.length}
          >
            <ConditionRows dimensions={groups.missingInfo} showDescription />
          </Disclosure>
        )}

        {groups.confirmOfficial.length > 0 && (
          <Disclosure
            id="to-confirm"
            title="需要向招聘单位确认"
            count={groups.confirmOfficial.length}
          >
            <ConditionRows dimensions={groups.confirmOfficial} showDescription />
          </Disclosure>
        )}

        {groups.unsatisfied.length > 0 && (
          <Disclosure
            id="unsatisfied"
            title="明确不符合项"
            count={groups.unsatisfied.length}
          >
            <ConditionRows dimensions={groups.unsatisfied} showDescription />
          </Disclosure>
        )}

        {groups.satisfied.length > 0 && (
          <Disclosure title="已满足的条件" count={groups.satisfied.length}>
            <ConditionRows dimensions={groups.satisfied} showDescription />
          </Disclosure>
        )}

        {/* 补充信息只影响当前画像，提交后即时重算；闸门失败（截止/来源失效等）时不引导补充 */}
        {!closed && groups.missingInfo.length > 0 && (
          <div id="supplement" className="scroll-mt-20">
            {askableUnknown.length > 0 ? (
              <SupplementForm
                dimensions={groups.missingInfo}
                initial={facts}
                saving={savingFacts}
                onSave={(next) => void handleSaveFacts(next)}
              />
            ) : (
              <aside className="rounded-xl border border-warn/30 bg-warn-soft/40 px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  这些信息在「报考信息」里补充
                </p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  缺少的是学历、专业等报考画像信息。缺失不等于不符合：补充后回到本页会自动重新判断。
                </p>
                <Link
                  href="/onboarding?from=opportunity"
                  className="mt-3 inline-flex h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
                >
                  去补充报考信息
                </Link>
              </aside>
            )}
          </div>
        )}
      </section>

      {/* 报名材料清单（关注后可标记进度；来源可追溯到官方公告） */}
      {unit.follow && unit.unit.materials && unit.unit.materials.length > 0 && (
        <section id="materials" className="scroll-mt-20 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-ink">报名材料清单</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              按公告要求生成；每项可追溯到官方来源。只记录准备进度，不采集证件号码或扫描件。
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4">
            <MaterialsList
              materials={unit.unit.materials}
              statuses={unit.follow.materialStatuses}
              busy={busy}
              onStatusChange={(itemId, status) =>
                void handleMaterialStatus(itemId, status)
              }
            />
          </div>
        </section>
      )}

      {/* 官方联系信息与咨询模板（仅对需官方确认维度） */}
      {unit.follow && unit.consultationTemplates && groups.confirmOfficial.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-ink">官方咨询</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              复制问题向招聘单位确认；你记录的结论仅自己可见，不会变成官方事实或影响匹配。
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <ConsultationPanel
              templates={unit.consultationTemplates}
              contact={{
                publisher: unit.announcement.publisher,
                officialUrl: unit.announcement.officialUrl,
                contactInfo: unit.announcement.contactInfo ?? null,
              }}
              dimensions={groups.confirmOfficial}
              notes={unit.follow.consultationNotes}
              busy={busy}
              onSaveNote={(key, note) => void handleConsultationNote(key, note)}
              onCopied={(tpl, edited) =>
                track("consultation_template_copied", "opportunity", {
                  targetId: unitId,
                  // 只记维度短枚举与是否编辑过，问题正文绝不进埋点
                  props: { tpl, edited },
                })
              }
            />
          </div>
        </section>
      )}

      {/* 第三层：官方依据、核对与版本记录按需展开 */}
      <details className="group rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold text-ink">官方依据与版本记录</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              查看公告位置、核对时间、历史版本与纠错入口
            </span>
          </span>
          <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="space-y-4 border-t border-line p-3">
          <OfficialSourceSection detail={detail} />
          <VerificationSection
            detail={detail}
            onOpenCorrection={() => {
              setCorrectionDone(false);
              setCorrectionOpen(true);
            }}
          />
        </div>
      </details>

      <CorrectionModal
        isOpen={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        submitting={correctionSubmitting}
        onSubmit={(input) => void handleCorrection(input)}
      />
    </div>
  );
}
