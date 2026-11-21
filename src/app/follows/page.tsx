"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/lib/auth";
import { useOpportunities } from "@/lib/opportunities/useOpportunities";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type {
  FollowDTO,
  MatchResponse,
  OrganizationFollowDTO,
  SubscriptionDTO,
  SubscriptionSyncDTO,
  UnitMatchDTO,
} from "@/lib/opportunities/api-types";
import { organizationIdentityKey } from "@/lib/opportunities/organization-follow";
import { FOLLOW_STATUS_LABELS } from "@/lib/opportunities";
import {
  daysUntil,
  deadlineText,
  regionFullLabel,
  stageSubjectLabel,
} from "@/lib/ia/labels";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/**
 * 我的关注（D07 / PRD 11.8 U07）。
 *
 * 两个分区：
 * - 岗位动态：全部关注记录（考虑中/准备报名/已报名/等待考试），
 *   突出截止临近、公告版本更新、待核实项；已结束/不再考虑归档展示，不自动删除。
 * - 单位与地区动态：单位关注（身份键=发布主体+公告级地区码，仅精确匹配，
 *   同名不同地区不串联，更名/合并不自动关联）与地区订阅摘要；
 *   展示监测范围与最近检查时间；提醒只出现在站内，不发邮件/短信/微信。
 */
export default function FollowsPage() {
  const { status: authStatus } = useCurrentUser();
  const { state, reload } = useOpportunities();
  const online = useOnlineStatus();

  const [orgFollows, setOrgFollows] = useState<OrganizationFollowDTO[] | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionDTO | null>(null);
  const [syncInfo, setSyncInfo] = useState<SubscriptionSyncDTO | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const authenticated = authStatus === "authenticated";

  // 单位关注/订阅读取 + 一次幂等同步（产生新公告站内提醒）
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    opportunitiesApi
      .syncSubscription()
      .then((sync) => {
        if (!cancelled) setSyncInfo(sync);
      })
      .catch(() => {
        // 同步失败不阻塞页面，下面列表仍可展示
      });
    Promise.all([
      opportunitiesApi.listOrganizationFollows(),
      opportunitiesApi.getSubscription(),
    ])
      .then(([orgs, sub]) => {
        if (cancelled) return;
        setOrgFollows(orgs);
        setSubscription(sub);
        setOrgError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOrgError(e instanceof Error ? e.message : "关注信息加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  // 当前可见目录全部单元（含已截止分组），按 unitId 索引
  const unitById = useMemo(() => {
    const map = new Map<string, UnitMatchDTO>();
    if (state.status !== "ready") return map;
    for (const unit of collectUnits(state.data)) map.set(unit.unit.id, unit);
    return map;
  }, [state]);

  // 单位身份键 → 当前在报公告（同公告多单元去重）
  const orgHits = useMemo(() => {
    const map = new Map<
      string,
      { announcementId: string; title: string; unitId: string; unitCount: number }[]
    >();
    if (state.status !== "ready") return map;
    const byAnnouncement = new Map<string, UnitMatchDTO[]>();
    for (const unit of collectUnits(state.data)) {
      const key = organizationIdentityKey({
        publisherName: unit.announcement.publisher,
        regionCode: unit.announcement.region.code,
      });
      if (!byAnnouncement.has(`${key}|${unit.announcement.id}`)) {
        byAnnouncement.set(`${key}|${unit.announcement.id}`, []);
      }
      byAnnouncement.get(`${key}|${unit.announcement.id}`)!.push(unit);
    }
    for (const [compound, units] of byAnnouncement) {
      const key = compound.slice(0, compound.lastIndexOf("|"));
      const first = units[0]!;
      const list = map.get(key) ?? [];
      list.push({
        announcementId: first.announcement.id,
        title: first.announcement.title,
        unitId: first.unit.id,
        unitCount: units.length,
      });
      map.set(key, list);
    }
    return map;
  }, [state]);

  // 省级地区码 → 展示名（单位关注无命中公告时的地区回退展示）
  const regionLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    if (state.status !== "ready") return map;
    for (const province of state.data.coverage.provinces) {
      map.set(province.code, province.label);
    }
    return map;
  }, [state]);

  if (state.status === "loading") return <LoadingPage />;

  if (state.status === "no-profile") {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="先填写报考信息"
          description="填写报考信息后才能保存机会、关注单位，并在这里集中查看动态。"
          actionLabel="去填写"
          actionHref="/onboarding?from=follows"
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title={online ? "关注动态暂时加载失败" : "当前离线，无法加载关注动态"}
        description={
          online
            ? state.error
            : "网络已断开。恢复网络后点击重试，或返回后再打开。"
        }
        onRetry={() => void reload()}
      />
    );
  }

  const { data } = state;
  const nowIso = new Date().toISOString();
  const follows = data.follows;
  const active = follows.filter(
    (f) => f.status !== "closed" && f.status !== "abandoned",
  );
  const archived = follows.filter(
    (f) => f.status === "closed" || f.status === "abandoned",
  );
  // 进行中的按报名截止升序（未公布截止的排最后），归档保持关注时间倒序
  const activeSorted = [...active].sort((a, b) => {
    const endA = unitById.get(a.unitId)?.version.timeline.registrationEnd;
    const endB = unitById.get(b.unitId)?.version.timeline.registrationEnd;
    if (!endA && !endB) return 0;
    if (!endA) return 1;
    if (!endB) return -1;
    return endA.localeCompare(endB);
  });
  const archivedSorted = [...archived].sort((a, b) =>
    b.followedAt.localeCompare(a.followedAt),
  );

  const emptyAll =
    follows.length === 0 && (orgFollows ?? []).length === 0 && !subscription;

  return (
    <div className="mx-auto max-w-2xl space-y-7 pb-2">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-brand">我的关注</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          关注与动态
        </h1>
        <p className="text-sm text-ink-muted">
          岗位进度、关注单位与地区的新公告，集中在这里。提醒只出现在站内，不发送邮件、短信或微信。
        </p>
      </header>

      {syncInfo && syncInfo.orgNewNotices > 0 && (
        <p className="rounded-lg border border-brand/30 bg-brand-soft/40 px-4 py-2.5 text-sm text-ink" role="status">
          你关注的单位有 {syncInfo.orgNewNotices} 条新公告提醒，已放入站内通知。
        </p>
      )}
      {orgError && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft/40 px-4 py-2.5 text-sm text-danger" role="alert">
          {orgError}
        </p>
      )}

      {emptyAll ? (
        <EmptyState
          title="还没有关注任何内容"
          description="在机会列表保存岗位，或在岗位详情页关注发布单位；也可以开启地区订阅，新公告会在站内提醒你。"
          actionLabel="去看机会"
          actionHref="/opportunities"
        />
      ) : (
        <>
          {/* ==================== 岗位动态 ==================== */}
          <section className="space-y-3" aria-labelledby="follows-units">
            <div>
              <h2 id="follows-units" className="text-base font-semibold text-ink">
                岗位动态
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                正在跟进 {activeSorted.length} 个岗位
                {archivedSorted.length > 0
                  ? ` · 已归档 ${archivedSorted.length} 个（不自动删除）`
                  : ""}
              </p>
            </div>

            {activeSorted.length === 0 && (
              <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
                没有正在跟进的岗位。去机会列表保存一个岗位后，会出现在这里。
              </p>
            )}

            <div className="grid gap-3">
              {activeSorted.map((follow) => (
                <FollowRow
                  key={follow.id}
                  follow={follow}
                  unit={unitById.get(follow.unitId) ?? null}
                  nowIso={nowIso}
                />
              ))}
            </div>

            {archivedSorted.length > 0 && (
              <details className="rounded-xl border border-line bg-surface">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-muted [&::-webkit-details-marker]:hidden">
                  已结束 / 不再考虑（{archivedSorted.length}）▾
                </summary>
                <div className="grid gap-3 border-t border-line px-4 py-3">
                  {archivedSorted.map((follow) => (
                    <FollowRow
                      key={follow.id}
                      follow={follow}
                      unit={unitById.get(follow.unitId) ?? null}
                      nowIso={nowIso}
                      muted
                    />
                  ))}
                </div>
              </details>
            )}
          </section>

          {/* ==================== 单位与地区动态 ==================== */}
          <section className="space-y-3" aria-labelledby="follows-orgs">
            <div>
              <h2 id="follows-orgs" className="text-base font-semibold text-ink">
                单位与地区动态
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                单位关注只按「发布主体 + 地区」精确匹配；同名不同地区不串联，单位更名或合并不自动关联，需人工审核确认。
              </p>
            </div>

            {authenticated && orgFollows === null && !orgError && (
              <p className="text-xs text-ink-muted">单位关注加载中…</p>
            )}
            {!authenticated && (
              <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
                登录后可以关注单位并接收新公告站内提醒。
                <Link href="/login?next=/follows" className="text-brand hover:underline">
                  去登录
                </Link>
              </p>
            )}

            {(orgFollows ?? []).map((org) => {
              const hits = orgHits.get(org.identityKey) ?? [];
              return (
                <div
                  key={org.identityKey}
                  className="space-y-2 rounded-xl border border-line bg-surface p-4"
                  data-testid="org-follow-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {org.publisherName}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {regionLabelByCode.get(org.regionCode) ?? org.regionCode}
                        　关注于 {formatIsoDate(org.followedAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyKey === org.identityKey}
                      onClick={() => void unfollowOrg(org.identityKey)}
                    >
                      取消关注
                    </Button>
                  </div>
                  {hits.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      该单位当前没有在报公告；有新公告经人工核对发布后在站内提醒你。
                    </p>
                  ) : (
                    <ul className="space-y-1 text-xs text-ink-muted">
                      {hits.map((hit) => (
                        <li key={hit.announcementId}>
                          ·{" "}
                          <Link
                            href={`/opportunities/${hit.unitId}`}
                            className="text-brand hover:underline"
                          >
                            {hit.title}
                          </Link>
                          <span>（{hit.unitCount} 个在报岗位）</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {authenticated && (orgFollows ?? []).length === 0 && !orgError && (
              <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
                还没有关注单位。在岗位详情页点「关注该单位的新公告」即可添加。
              </p>
            )}

            {/* 地区订阅摘要（管理入口在机会页订阅卡片） */}
            <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink">地区订阅</p>
              {subscription ? (
                <p className="text-xs leading-5 text-ink-muted">
                  {subscription.enabled ? "已开启" : "已关闭（停止新提醒，历史通知保留）"}
                  　地区：
                  {subscription.regions.length > 0
                    ? subscription.regions
                        .map((r) => r.district ?? r.city ?? r.province)
                        .join("、")
                    : "未设置"}
                  　学科：语文
                </p>
              ) : (
                <p className="text-xs text-ink-muted">
                  未开启地区订阅。开启后，符合地区与学科的新公告会在站内提醒你。
                </p>
              )}
              <Link
                href="/opportunities#subscription"
                className="inline-flex items-center text-xs font-medium text-brand hover:underline"
              >
                管理订阅条件 →
              </Link>
            </div>

            {/* 监测范围与最近检查（来自统一覆盖投影，不编造实时性） */}
            <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink">监测范围与检查</p>
              <p className="text-xs leading-5 text-ink-muted">
                {data.coverage.scopeNote}
              </p>
              <p className="text-xs leading-5 text-ink-muted">
                最近成功检查：{formatIsoDateTime(data.coverage.lastCheckedAt)}
                　统计生成：{formatIsoDateTime(data.coverage.caliber.generatedAt)}
              </p>
              {data.coverage.caliber.isFallback && (
                <p className="text-xs leading-5 text-ink-muted">
                  {data.coverage.caliber.fallbackNote ??
                    "运行状态不可用，当前为台账静态投影（非实时）。"}
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );

  async function unfollowOrg(identityKey: string) {
    setBusyKey(identityKey);
    setOrgError(null);
    try {
      await opportunitiesApi.unfollowOrganization(identityKey);
      setOrgFollows((rows) =>
        (rows ?? []).filter((row) => row.identityKey !== identityKey),
      );
    } catch (e) {
      setOrgError(e instanceof Error ? e.message : "取消关注失败，请重试");
    } finally {
      setBusyKey(null);
    }
  }
}

// ===== 子组件与辅助 =====

/** 汇总匹配响应全部分组的单元（含已截止分组，供关注记录解析详情） */
function collectUnits(data: MatchResponse): UnitMatchDTO[] {
  return [
    ...data.groups.preliminary,
    ...data.groups.needInfo.flatMap((group) => group.units),
    ...data.groups.manualReview,
    ...data.groups.notEligible,
    ...data.groups.closed,
  ];
}

function FollowRow({
  follow,
  unit,
  nowIso,
  muted = false,
}: {
  follow: FollowDTO;
  unit: UnitMatchDTO | null;
  nowIso: string;
  muted?: boolean;
}) {
  const registrationEnd = unit?.version.timeline.registrationEnd;
  const deadline = deadlineText(registrationEnd, nowIso);
  const daysLeft = registrationEnd ? daysUntil(registrationEnd, nowIso) : null;
  const urgent =
    !muted && daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
  const manualReviewCount =
    unit?.dimensions.filter((d) => d.value === "MANUAL_REVIEW").length ?? 0;
  const materials = follow.materialStatuses ?? null;
  const materialDone = materials
    ? Object.values(materials).filter((s) => s === "done").length
    : 0;
  const materialTotal = materials
    ? Object.values(materials).filter((s) => s !== "not_applicable").length
    : 0;

  return (
    <div
      className={`space-y-2 rounded-xl border p-4 ${
        muted ? "border-line bg-canvas" : "border-line bg-surface"
      }`}
      data-testid="follow-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/opportunities/${follow.unitId}`}
          className={`text-sm font-semibold hover:underline ${
            muted ? "text-ink-muted" : "text-ink"
          }`}
        >
          {unit?.unit.name ?? "该机会当前不在可见目录中"}
        </Link>
        <Badge variant={statusBadgeVariant(follow.status)}>
          {FOLLOW_STATUS_LABELS[follow.status]}
        </Badge>
        {follow.newerVersion && <Badge variant="warning">公告有更新</Badge>}
        {manualReviewCount > 0 && (
          <Badge variant="info">待核实 {manualReviewCount} 项</Badge>
        )}
      </div>
      {unit && (
        <p className="text-xs text-ink-muted">
          {regionFullLabel(unit.unit.region)} ·{" "}
          {stageSubjectLabel(unit.unit.stage, unit.unit.subject)} · 招{" "}
          {unit.unit.headcount} 人
        </p>
      )}
      <p
        className={`text-xs ${
          deadline.closed || muted
            ? "text-ink-muted"
            : urgent
              ? "font-semibold text-danger"
              : "text-ink-muted"
        }`}
      >
        报名{deadline.text}
        {materials && materialTotal > 0
          ? ` · 材料 ${materialDone}/${materialTotal}`
          : ""}
      </p>
      {follow.abandonReason && (
        <p className="text-xs text-ink-muted">
          放弃原因：{follow.abandonReason}
        </p>
      )}
    </div>
  );
}

function statusBadgeVariant(
  status: FollowDTO["status"],
): "info" | "primary" | "success" | "muted" {
  switch (status) {
    case "considering":
      return "info";
    case "preparing":
      return "primary";
    case "registered":
    case "waiting_exam":
      return "success";
    case "abandoned":
    case "closed":
      return "muted";
  }
}

function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatIsoDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatIsoDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
