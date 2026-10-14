"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { track, trackOncePerUser } from "@/lib/analytics/eventService";
import type { GuestPreviewReady } from "@/lib/guest/previewEngine";
import type { EmploymentNaturePreference } from "@/lib/guest/guestSession";
import { GUEST_COVERAGE } from "@/lib/guest/coverage";
import { coverageProvinceLine } from "@/lib/opportunities/coverage-view";
import { upsertGuestFollow } from "@/lib/guest/guestFollows";
import { buildGuestWorkbenchTabs } from "@/lib/results/workbench-view";
import type { OpportunityCardViewModel } from "@/lib/results/workbench-view";
import { buildEditConditionsHref } from "@/lib/results/condition-summary";
import { ResultsWorkbench } from "@/components/results/ResultsWorkbench";
import {
  UnifiedOpportunityCard,
  type OpportunityCardCapabilities,
} from "@/components/results/UnifiedOpportunityCard";
import { ResultConditionSummary } from "@/components/results/ResultConditionSummary";
import { Hero } from "@/components/ia/Hero";
import { Disclosure, LayerHeading } from "@/components/ia/Layer";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { AUTH_MODE } from "@/lib/auth";

function formatCoverageLine(): string {
  const d = new Date(GUEST_COVERAGE.lastCheckedAt);
  const day = Number.isNaN(d.getTime())
    ? GUEST_COVERAGE.lastCheckedAt
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${coverageProvinceLine(GUEST_COVERAGE)} · ${day}核对 · 当前在报 ${GUEST_COVERAGE.openOpportunityCount} 个`;
}

/**
 * v7.2 访客统一结果工作台（ff_new_results 开启时的 /preview 主体）。
 *
 * 与 /opportunities 共用同一套结果信息架构：
 * - ResultConditionSummary：当前条件一句紧凑摘要 + 修改入口（不再重复询问用工形式）；
 * - ResultsWorkbench：三互斥标签（优先机会 / 补充后判断 / 偏好范围外），?tab= 语义一致；
 * - UnifiedOpportunityCard：唯一岗位卡，地图在标题正下方地点行；
 * - 留档区：已截止 / 来源失效 / 明确不符合折叠展示，不混入正常标签。
 *
 * 身份差异只在数据来源与操作能力：访客数据来自 previewEngine（虚构演示示例，
 * 卡片明确标注），「保存机会」先暂存本机保存意图再引导登录，登录后回到原岗位。
 */
export function PreviewWorkbench({
  preview,
  naturePref,
}: {
  preview: GuestPreviewReady;
  naturePref: EmploymentNaturePreference | undefined;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { view, limitations } = preview;

  const { tabs, archived } = useMemo(
    () => buildGuestWorkbenchTabs(preview),
    [preview],
  );

  // P0 漏斗②：访客看到至少一个有效机会；与旧版结果页同口径
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

  // 「修改」回程：保留当前标签，保存后回到原结果页原标签并重新计算
  const tabParam = searchParams.get("tab");
  const returnTo =
    tabParam && tabParam !== "priority" ? `/preview?tab=${tabParam}` : "/preview";
  const editHref = buildEditConditionsHref(returnTo);

  /** 访客「保存机会」：先暂存本机保存意图，再引导登录；登录后合并并回到原岗位 */
  const handleSave = (vm: OpportunityCardViewModel) => {
    upsertGuestFollow(vm.id, { status: "considering" });
    track("opportunity_followed", "opportunity", { targetId: vm.id });
    router.push(
      `/login?next=${encodeURIComponent(`/opportunities/${vm.id}`)}&reason=save`,
    );
  };

  const guestCapabilities = (
    vm: OpportunityCardViewModel,
  ): OpportunityCardCapabilities => ({
    canSave: true,
    saveLabel: "保存机会",
    onSave: () => handleSave(vm),
    evidenceLabel: "查看判断依据",
  });

  const archivedCapabilities = (): OpportunityCardCapabilities => ({
    canSave: false,
    evidenceLabel: "查看判断依据",
  });

  const normalCount =
    tabs.priority.length + tabs.supplement.length + tabs.outOfScope.length;
  const archivedCount = archived.reduce((sum, g) => sum + g.cards.length, 0);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
        {/* 真实监测事实（与旧版一致；下方示例判断均为虚构演示） */}
        <Hero
          meta="真实机会监测"
          conclusion={
            GUEST_COVERAGE.openOpportunityCount > 0
              ? `当前监测到 ${GUEST_COVERAGE.openOpportunityCount} 个正在报名的真实机会`
              : "当前没有监测到正在报名的真实机会"
          }
          risk={{ tone: "info", text: GUEST_COVERAGE.nextWindowNote }}
        >
          <p className="text-xs leading-relaxed text-ink-muted">
            {formatCoverageLine()}
          </p>
        </Hero>

        {/* 当前条件摘要 + 修改入口（替代旧版整卡用工形式询问） */}
        <ResultConditionSummary
          source={{
            ...preview.profile,
            employmentNaturePreference: naturePref,
          }}
          editHref={editHref}
        />

        {/* 演示声明：示例判断均为虚构，绝不伪装成真实招聘 */}
        <p className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-xs leading-5 text-warn">
          下方为功能示例（虚构数据），仅演示产品如何判断，不代表真实招聘岗位。
        </p>

        {normalCount === 0 && archivedCount === 0 ? (
          <EmptyState
            title="当前已覆盖的公告里还没有你能考虑的机会"
            description="可以修改地区或学历等条件再看；未覆盖地区不等于没有招聘，新公告核对后会出现在这里。"
            actionLabel="修改报考信息"
            actionHref={editHref}
          />
        ) : (
          <ResultsWorkbench
            tabs={tabs}
            basePath="/preview"
            renderCard={(vm, variant) => (
              <UnifiedOpportunityCard
                vm={vm}
                variant={variant}
                capabilities={guestCapabilities(vm)}
              />
            )}
          />
        )}

        {/* 留档区：已截止 / 来源失效 / 明确不符合，折叠展示不混入正常标签 */}
        {archivedCount > 0 && (
          <Disclosure title="查看暂不推荐的示例" count={archivedCount}>
            <div className="space-y-6">
              {archived.map((group) => (
                <section key={group.key} className="space-y-3">
                  <LayerHeading title={group.label} count={group.cards.length} />
                  {group.cards.map((vm) => (
                    <UnifiedOpportunityCard
                      key={vm.id}
                      vm={vm}
                      variant="excluded"
                      capabilities={archivedCapabilities()}
                    />
                  ))}
                </section>
              ))}
            </div>
          </Disclosure>
        )}

        {limitations.length > 0 && (
          <LimitationsNote
            count={limitations.length}
            lines={limitations.map((item) => `${item.label}：${item.impact}`)}
            editHref={editHref}
          />
        )}

        {AUTH_MODE === "invited" && (
          <Card className="border-brand/25 bg-brand-soft/35 p-5 shadow-none">
            <p className="text-xs font-semibold tracking-wide text-brand">
              继续完整试用
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              登录后查看我的机会、材料和日程
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              你刚填写的报考信息会在登录后同步到受邀账号，无需重新填写。
            </p>
            <LinkButton
              href="/login?next=/opportunities"
              variant="primary"
              size="md"
              className="mt-4 w-full sm:w-auto"
            >
              登录后查看我的机会
            </LinkButton>
          </Card>
        )}

        <p className="text-center text-xs text-ink-muted">
          示例仅用于体验判断方式，不代表真实招聘。你填写的报考信息仅保存在这台设备，可随时
          <Link href={editHref} className="mx-1 text-brand hover:underline">
            修改报考信息
          </Link>
          。
        </p>
      </div>
    </div>
  );
}

function LimitationsNote({
  count,
  lines,
  editHref,
}: {
  count: number;
  lines: string[];
  editHref: string;
}) {
  return (
    <section
      aria-label="暂未提供信息导致的结果限制"
      data-testid="profile-limitations"
      className="rounded-lg border border-warn/30 bg-warn-soft/70 px-4 py-3"
    >
      <h2 className="text-sm font-semibold text-warn">
        有 {count} 项信息你暂未提供，结果已相应收窄
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((line) => (
          <li key={line} className="text-xs leading-relaxed text-warn">
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-warn">
        没有填写的信息一律显示「补充信息后判断」，不会被判为不符合；
        <Link href={editHref} className="ml-1 font-medium underline underline-offset-2">
          返回补填
        </Link>
        后结果自动更新。
      </p>
    </section>
  );
}
