"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Hero } from "@/components/ia/Hero";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { Callout } from "@/components/ui/Callout";
import { SupplementForm } from "@/components/opportunities/SupplementForm";
import { useActiveProfile } from "@/lib/opportunities/useOpportunities";
import { useCurrentUser } from "@/lib/auth";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type { UnitDetailResponse, OpportunityMatchStatus } from "@/lib/opportunities/api-types";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { groupDimensions, nextAction, primaryGate } from "@/lib/opportunities/detail-view";
import { supplementFactsService, buildActiveProfile, type SupplementFacts } from "@/lib/profile/activeProfile";
import {
  createProfileRepository,
  ProfileConflictError,
  type ProfilePatch,
} from "@/lib/profile/profileRepository";
import {
  parseSupplementParams,
  type SupplementOrigin,
} from "@/lib/opportunities/supplement-route";
import { gateStateMeta } from "@/lib/gate-states";
import { track } from "@/lib/analytics/eventService";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

export interface SupplementPageViewProps {
  /** 真实岗位还是演示岗位 */
  mode: "real" | "demo";
  /** 报考单元 ID */
  unitId: string;
  /** URL search params 字符串 */
  searchParamsString: string;
}

/**
 * v7.2 定向补充页面共享视图（PRD 7.4.4 / 7.7 / 7.8）。
 *
 * 流程：
 * 1. 解析并校验 origin/bucket 参数（非法安全回退）；
 * 2. 加载最新岗位详情（POST detail 获取最新缺失维度）；
 * 3. 只渲染仍缺失的子字段（已知信息不重复问）；
 * 4. 解释为何需要该信息；
 * 5. UNKNOWN 可暂不提供（留空保持 UNKNOWN，不转 FAIL）；
 * 6. MANUAL_REVIEW 进入官方确认（不进入自动重算表单）；
 * 7. 防重复提交；
 * 8. 保存失败保留输入；
 * 9. 409 可恢复（冲突后同步最新状态）；
 * 10. 截止/来源失效/版本变化优先展示最新闸门状态；
 * 11. 保存后重新详情与匹配；
 * 12. 比较前后分类；
 * 13. 返回正确标签；
 * 14. 聚焦对应岗位或状态；
 * 15. 使用可访问状态播报。
 *
 * 动作分流：补充信息 → supplement（本页）；修改全部信息 → onboarding；
 * 保存机会 → follow；建议官方确认 → consultation。四种动作不共享错误路由。
 *
 * Demo 模式不持久化敏感事实（出生日期/户籍/社保/工作经历）。
 */
export function SupplementPageView({
  mode,
  unitId,
  searchParamsString,
}: SupplementPageViewProps) {
  const router = useRouter();
  const profileState = useActiveProfile();
  const { status: authStatus } = useCurrentUser();
  const online = useOnlineStatus();

  // 1. 解析参数
  const params = useMemo(() => {
    const sp = new URLSearchParams(searchParamsString);
    return parseSupplementParams(sp);
  }, [searchParamsString]);

  // v7.2 埋点：进入定向补充页记录一次（origin/bucket 只记枚举，不记岗位名与画像正文）
  useEffect(() => {
    track("supplement_opened", "profile", {
      targetId: unitId,
      props: { origin: params.origin, bucket: params.bucket },
    });
    // 仅按进入时的入口参数记录；单元变更视为重新进入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const isGuest = profileState.status === "ready" && profileState.isGuest;
  const isDemo = mode === "demo";

  // 2. 状态
  const [detail, setDetail] = useState<UnitDetailResponse | null>(null);
  const [loading, setLoading] = useState(() => profileState.status === "ready");
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<SupplementFacts>(() =>
    supplementFactsService.load(),
  );
  const [saving, setSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [beforeOverall, setBeforeOverall] = useState<OpportunityMatchStatus | null>(null);
  const [afterOverall, setAfterOverall] = useState<OpportunityMatchStatus | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null);

  // 3. 加载最新详情
  const loadDetail = useCallback(
    async (profile: UserRecruitmentProfile) => {
      setLoading(true);
      setError(null);
      try {
        const response = await opportunitiesApi.unitDetail(unitId, profile, {
          sendProfile: isGuest,
        });
        setDetail(response);
        setBeforeOverall(response.unit.overall);
        return response;
      } catch (e) {
        setError(e instanceof Error ? e.message : "详情加载失败");
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [unitId, isGuest],
  );

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    // 加载最新详情：不在 effect 体中直接 setState，用 .then 延迟到异步回调
    opportunitiesApi
      .unitDetail(unitId, profileState.profile, { sendProfile: isGuest })
      .then((response) => {
        if (cancelled) return;
        setDetail(response);
        setBeforeOverall(response.unit.overall);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "详情加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileState.status]);

  if (profileState.status === "loading" || (authStatus === "loading" && !loading && !detail)) {
    return <LoadingPage />;
  }

  if (loading) return <LoadingPage />;

  if (profileState.status === "no-profile") {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState
          title="先填写报考信息才能补充条件"
          description="补充信息基于你的报考画像和岗位条件逐项核对。"
          onRetry={() => router.push("/onboarding?from=supplement")}
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
            ? (error ?? "未找到该报考单元。")
            : "网络已断开。恢复网络后点击重试。"
        }
        onRetry={() => {
          if (profileState.status === "ready") void loadDetail(profileState.profile);
        }}
      />
    );
  }

  const unit = detail.unit;
  const groups = groupDimensions(unit.dimensions);
  const primaryClosedGate = primaryGate(unit.gates);
  const closed = primaryClosedGate !== null;

  // 10. 截止/来源失效/版本变化优先展示
  if (closed) {
    const gateMeta = gateStateMeta(primaryClosedGate.code);
    const action = nextAction(unit);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Hero
          conclusion={gateMeta.label}
          meta={primaryClosedGate.reason}
          action={{
            label: action.label,
            ...(action.href
              ? { href: action.href, external: action.external }
              : {}),
          }}
        />
        <Callout variant="no">
          该机会当前无法继续补充信息。请先查看官方公告了解最新状态。
        </Callout>
        <div className="flex gap-3">
          <Link href={getReturnHref(params.origin, unitId)}>
            <Button variant="ghost">返回</Button>
          </Link>
        </div>
      </div>
    );
  }

  // 6. MANUAL_REVIEW → 官方确认，不进入自动重算表单
  const askableUnknown = groups.missingInfo.filter(
    (d) =>
      d.dimension === "age" ||
      d.dimension === "hukou" ||
      d.dimension === "social_security" ||
      d.dimension === "work_experience" ||
      d.dimension === "other",
  );

  // 12. 保存后比较前后分类
  const conclusionChanged = beforeOverall !== null && afterOverall !== null && beforeOverall !== afterOverall;

  // 7. 防重复提交 + 8. 保存失败保留输入 + 9. 409 可恢复
  const handleSave = async (next: SupplementFacts) => {
    if (saving) return; // 防重复
    setSaving(true);
    setConflictError(null);
    setError(null);
    try {
      // Demo 模式：只写 localStorage，不调服务端
      if (isDemo || isGuest) {
        const saved = supplementFactsService.save(next);
        setFacts(saved);
      } else {
        // 真实模式：通过 ProfileRepository.patch() 更新
        const repo = createProfileRepository(authStatus === "authenticated");
        const patch: ProfilePatch = {};
        if (next.birthDate !== undefined) patch.birthDate = next.birthDate;
        if (next.hukouProvinceCode !== undefined) patch.hukouProvinceCode = next.hukouProvinceCode;
        if (next.hukouCityCode !== undefined) patch.hukouCityCode = next.hukouCityCode;
        if (next.socialSecurityMonths !== undefined) patch.socialSecurityMonths = next.socialSecurityMonths;
        if (next.workExperienceMonths !== undefined) patch.workExperienceMonths = next.workExperienceMonths;
        if (next.extraAnswers !== undefined) patch.extraAnswers = next.extraAnswers;
        await repo.patch(patch);
        // 同步本地缓存
        setFacts(supplementFactsService.load());
      }

      // 11. 保存后重新详情与匹配
      const active = buildActiveProfile();
      if (active.ready) {
        const fresh = await loadDetail(active.profile);
        if (fresh) {
          setAfterOverall(fresh.unit.overall);
          // v7.2 埋点：补充保存后重算成功（结论是否变化由 qualification_supplemented 承载）
          track("supplement_recomputed", "profile", { targetId: unitId });
          // 13. 返回正确标签 + 15. 可访问状态播报
          const newOverall = fresh.unit.overall;
          const tag = overallTag(newOverall);
          if (beforeOverall !== newOverall) {
            setStatusAnnouncement(
              `信息已保存。机会判断已更新为：${tag}。`,
            );
            track("qualification_supplemented", "profile", {
              targetId: unitId,
              props: { conclusionChanged: 1 },
            });
          } else {
            setStatusAnnouncement("信息已保存，当前判断暂时没有变化。");
          }
        }
      }
    } catch (e) {
      if (e instanceof ProfileConflictError) {
        // 9. 409 可恢复
        setConflictError("画像已在其他设备更新，已同步最新状态，请重试。");
        // 读取最新状态
        const active = buildActiveProfile();
        if (active.ready) await loadDetail(active.profile);
      } else {
        // 8. 保存失败保留输入（不 clear facts）
        setError(e instanceof Error ? e.message : "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  // v7.2 埋点：保存重算后返回机会结果页（仅 origin=opportunities 且本次已保存）
  const handleReturnToResult = () => {
    if (params.origin === "opportunities" && afterOverall !== null) {
      track("supplement_returned_to_result", "profile", { targetId: unitId });
    }
  };

  // 14. 返回正确岗位上下文
  const returnHref = getReturnHref(params.origin, unitId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-4">
      <nav className="text-xs text-ink-muted">
        <Link
          href={returnHref}
          onClick={handleReturnToResult}
          className="underline underline-offset-2 hover:text-brand"
        >
          ← 返回
        </Link>
      </nav>

      <Hero
        conclusion="补充缺失信息后重新判断"
        meta={`${unit.unit.name} · ${unit.unit.region.province}${unit.unit.region.city ? unit.unit.region.city : ""}`}
      />

      {/* 4. 解释为何需要该信息 */}
      <Callout variant="note">
        <p className="text-sm leading-relaxed text-ink-muted">
          以下信息只在这个岗位需要时才补问。留空表示暂不提供，该条件会继续保持
          「待确认」，不会被判定为不符合。保存后会立即根据新信息重新判断。
        </p>
        {askableUnknown.length > 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            当前还差 {askableUnknown.length} 项信息才能完成判断。
          </p>
        )}
      </Callout>

      {/* 15. 可访问状态播报 */}
      {statusAnnouncement && (
        <StatusMessage
          tone={conclusionChanged ? "success" : "info"}
          message={statusAnnouncement}
        />
      )}

      {conflictError && (
        <StatusMessage tone="warn" message={conflictError} />
      )}

      {error && (
        <StatusMessage tone="danger" message={error} />
      )}

      {/* 2/3. 只渲染仍缺失的子字段；已知信息不重复问 */}
      <SupplementForm
        dimensions={unit.dimensions}
        initial={facts}
        saving={saving}
        onSave={handleSave}
      />

      {/* 6. MANUAL_REVIEW → 官方确认提示 */}
      {groups.confirmOfficial.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-surface p-4">
          <h3 className="text-sm font-semibold text-warn">
            需向招聘单位人工确认
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            以下条件公告表述有歧义，补充资料不能替代确认。建议直接联系招聘单位确认。
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-ink-muted space-y-1">
            {groups.confirmOfficial.map((d) => (
              <li key={d.requirementId}>
                {d.dimension}：{d.reason}
              </li>
            ))}
          </ul>
          <Link href={`/opportunities/${unitId}#to-confirm`}>
            <Button variant="ghost" size="sm" className="mt-2">
              查看确认要点
            </Button>
          </Link>
        </div>
      )}

      {/* 动作分流：修改全部信息 → onboarding */}
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <p className="text-xs text-ink-muted">
          需要修改学历、专业、教师资格等基础信息？
          <Link
            href="/onboarding?from=supplement"
            className="ml-1 text-brand hover:underline"
          >
            修改全部报考信息
          </Link>
        </p>
      </div>

      {/* 14. 聚焦对应岗位或状态 */}
      {afterOverall && (
        <div className="flex gap-3">
          <Link href={returnHref} onClick={handleReturnToResult}>
            <Button>
              {afterOverall === "preliminary_eligible"
                ? "返回查看机会"
                : afterOverall === "need_more_info"
                  ? "返回继续补充"
                  : "返回查看结果"}
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

/** 根据 origin 决定返回地址（返回正确岗位上下文） */
function getReturnHref(
  origin: SupplementOrigin,
  unitId: string,
): string {
  switch (origin) {
    case "preview":
      return "/preview";
    case "opportunities":
      return "/opportunities";
    case "detail":
      return `/opportunities/${unitId}`;
  }
}

/** 13. 返回正确标签 */
function overallTag(overall: OpportunityMatchStatus): string {
  switch (overall) {
    case "preliminary_eligible":
      return "初步符合";
    case "need_more_info":
      return "仍需补充信息";
    case "manual_review":
      return "需人工确认";
    case "not_eligible":
      return "条件不符合";
  }
}
