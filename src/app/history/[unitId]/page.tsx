"use client";

/**
 * 往年参考详情（D06 / PRD 11.7 U06）。
 *
 * 不变量：
 * - 顶部固定声明「往年已截止，仅供参考；本年度以新公告为准」；
 * - 无报名、无关注动作；不进入当前可报名计数；
 * - 日期保留公告原文（北京时间口径），缺日期显示「待官方通知」，不臆造；
 * - 个人资料对照明确标注计算时间，且不等同用户当年身份或今年资格。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Disclosure } from "@/components/ia/Layer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { Callout } from "@/components/ui/Callout";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { ConditionRows } from "@/components/opportunities/ConditionRows";
import { CorrectionModal } from "@/components/opportunities/CorrectionModal";
import {
  dimensionLabel,
  natureShortLabel,
  stageSubjectLabel,
} from "@/lib/ia/labels";
import { MATCH_STATUS_LABELS } from "@/lib/matching/types";
import type {
  EmploymentNatureCode,
  EvidenceAnchor,
} from "@/lib/announcements/types";
import type { HistoryDetailResponse } from "@/lib/opportunities/api-types";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { useActiveProfile } from "@/lib/opportunities/useOpportunities";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/** 日期行：保留公告原文，缺失不臆造 */
function DateRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm text-ink">
        {value ? value.slice(0, 10) : "待官方通知（当年公告未公布）"}
      </span>
    </div>
  );
}

const EVIDENCE_STATE_LABELS: Record<EvidenceAnchor["state"], string> = {
  official: "已人工核对",
  ai_extracted: "AI 初核，待人工复核",
  pending_review: "待人工审核",
};

export default function HistoryDetailPage() {
  const params = useParams<{ unitId: string }>();
  const unitId = params?.unitId ?? "";
  const profileState = useActiveProfile();
  const online = useOnlineStatus();

  const [detail, setDetail] = useState<HistoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionDone, setCorrectionDone] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (profileState.status === "loading") return;
    let cancelled = false;
    const profile =
      profileState.status === "ready" ? profileState.profile : undefined;
    opportunitiesApi
      .historyDetail(unitId, profile, {
        sendProfile: profileState.status === "ready" && profileState.isGuest,
      })
      .then((response) => {
        if (!cancelled) setDetail(response);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // profileState 就绪/变化时重取对照结果
  }, [unitId, profileState, reloadToken]);

  const retry = () => {
    setError(null);
    setLoading(true);
    setReloadToken((value) => value + 1);
  };

  if (profileState.status === "loading" || loading) return <LoadingPage />;
  if (error || !detail) {
    return (
      <ErrorState
        title={online ? "往年公告加载失败" : "当前离线，无法加载往年公告"}
        description={
          online
            ? `${error ?? "未找到该记录"}。它可能不在已收录的往年范围内。`
            : "网络已断开。恢复网络后点击重试。"
        }
        onRetry={retry}
      />
    );
  }

  const { item } = detail;
  const regionText = [item.region.province, item.region.city, item.region.district]
    .filter(Boolean)
    .join(" ");
  const evidenceStateText = EVIDENCE_STATE_LABELS[item.completeness.evidenceState];

  const submitCorrection = async (input: {
    fieldPath: string;
    content: string;
    contact?: string;
  }) => {
    setCorrectionSubmitting(true);
    setCorrectionError(null);
    try {
      const result = await opportunitiesApi.submitCorrection(item.unitId, input);
      setCorrectionDone(result.id);
      setCorrectionOpen(false);
    } catch (cause) {
      setCorrectionError(
        cause instanceof Error ? cause.message : "提交失败，请稍后重试",
      );
      setCorrectionOpen(false);
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-2 sm:px-5">
      <nav aria-label="返回">
        <Link href="/history" className="text-sm text-brand underline underline-offset-2">
          ← 返回往年参考
        </Link>
      </nav>

      <Callout variant="ask" title="往年已截止，仅供参考">
        这是{item.batchYear !== null ? ` ${item.batchYear} 年批次` : "往年批次"}
        的历史公告，报名已结束；本年度招聘以新公告为准。本页不提供报名动作，
        也不计入当前可报名机会。
      </Callout>

      {item.archiveNote && (
        <Callout variant="no" title="官方链接已失效（存档）">
          {item.archiveNote}
        </Callout>
      )}

      {correctionDone && (
        <StatusMessage
          tone="success"
          message={`纠错已提交，受理编号 ${correctionDone}。处理进度可在「我的」页查询。`}
          onDismiss={() => setCorrectionDone(null)}
        />
      )}
      {correctionError && (
        <Callout variant="no" title="纠错未提交">
          {correctionError}
        </Callout>
      )}

      <header className="space-y-1">
        <h1 className="text-xl font-bold text-ink">{item.unitName}</h1>
        <p className="text-sm text-ink-muted">{item.announcement.title}</p>
        <p className="text-xs text-ink-muted">
          发布主体：{item.announcement.publisher} · 公告发布于{" "}
          {item.publishedAt.slice(0, 10)}（北京时间）
        </p>
      </header>

      <section
        aria-labelledby="history-facts"
        className="rounded-xl border border-line bg-surface p-4"
      >
        <h2 id="history-facts" className="text-sm font-semibold text-ink">
          当年岗位信息
        </h2>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span>{regionText}</span>
          <span>{stageSubjectLabel(item.stage, item.subject)}</span>
          <span>招 {item.headcount} 人</span>
          <span>
            {natureShortLabel(item.employmentNature.code as EmploymentNatureCode)}（
            {item.employmentNature.officialName}）
          </span>
        </div>
        {item.teachingScope && (
          <p className="mt-2 text-xs text-ink-muted">任教范围：{item.teachingScope}</p>
        )}
        <p className="mt-1 text-xs text-ink-muted">分配方式：{item.allocation.description}</p>
      </section>

      <section
        aria-labelledby="history-dates"
        className="rounded-xl border border-line bg-surface p-4"
      >
        <h2 id="history-dates" className="text-sm font-semibold text-ink">
          当年日程（公告原文，北京时间）
        </h2>
        <div className="mt-1 divide-y divide-line">
          <DateRow label="公告发布" value={item.publishedAt} />
          <DateRow label="报名开始" value={item.registrationStart} />
          <DateRow label="报名截止" value={item.registrationEnd} />
          <DateRow label="笔试" value={item.writtenExamDate} />
          <DateRow label="面试" value={item.interviewDate} />
        </div>
        {item.pendingItems.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs text-ink-muted">
            {item.pendingItems.map((pending) => (
              <li key={pending}>{pending}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          完整程度：{item.completeness.totalDateCount} 项日程中{" "}
          {item.completeness.knownDateCount} 项有明确日期 · 报名材料{" "}
          {item.completeness.materialCount} 项 · 证据{evidenceStateText}
        </p>
      </section>

      <section
        aria-labelledby="history-requirements"
        className="rounded-xl border border-line bg-surface p-4"
      >
        <h2 id="history-requirements" className="text-sm font-semibold text-ink">
          当年报考条件（官方事实）
        </h2>
        <ul className="mt-2 divide-y divide-line">
          {detail.requirements.map((requirement) => (
            <li key={requirement.id} className="py-3">
              <p className="text-sm font-medium text-ink">
                {dimensionLabel(requirement.dimension)}
                {requirement.hard ? "" : "（非硬性）"}
              </p>
              <p className="mt-1 text-sm leading-6 text-ink">{requirement.description}</p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                依据：{requirement.evidence.excerpt ?? "见官方原文"}（
                {EVIDENCE_STATE_LABELS[requirement.evidence.state]} · 核对于{" "}
                {requirement.evidence.checkedAt.slice(0, 10)}）
              </p>
            </li>
          ))}
        </ul>
      </section>

      {detail.materials.length > 0 && (
        <section
          aria-labelledby="history-materials"
          className="rounded-xl border border-line bg-surface p-4"
        >
          <h2 id="history-materials" className="text-sm font-semibold text-ink">
            当年报名材料
          </h2>
          <ul className="mt-2 list-inside list-disc text-sm text-ink">
            {detail.materials.map((material) => (
              <li key={material.id}>
                {material.label}
                <span className="text-xs text-ink-muted">
                  （{material.applicableAudience}）
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="history-comparison"
        className="rounded-xl border border-line bg-surface p-4"
      >
        <h2 id="history-comparison" className="text-sm font-semibold text-ink">
          用你的资料对照当年条件
        </h2>
        {detail.comparison ? (
          <>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              以你当前填写的资料对照该批次当年条件，计算于{" "}
              {detail.comparison.computedAt.slice(0, 16).replace("T", " ")}。
              这不代表你当年的身份，也不代表今年新公告的要求；今年的资格以新公告为准。
            </p>
            <p className="mt-2 text-sm font-medium text-ink">
              对照结论：{MATCH_STATUS_LABELS[detail.comparison.overall] ?? detail.comparison.overall}
            </p>
            <p className="mt-1 text-sm text-ink-muted">{detail.comparison.summary}</p>
            <div className="mt-2">
              <ConditionRows dimensions={detail.comparison.dimensions} showDescription />
            </div>
          </>
        ) : (
          <div className="mt-2">
            <EmptyState
              title="填写报考信息后可对照当年条件"
              description="填写地区、学历、专业、毕业情况和教师资格后，这里会用你的资料逐项对照该批次当年条件。"
              actionLabel="填写报考信息"
              actionHref="/onboarding?from=history"
            />
          </div>
        )}
      </section>

      <Disclosure title="版本与官方来源" count={detail.previousVersions.length + 1}>
        <ul className="space-y-2 text-sm text-ink">
          <li>
            当前留档版本：发布于 {item.publishedAt.slice(0, 10)} ·{" "}
            <a
              href={item.announcement.officialUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand underline underline-offset-2"
            >
              官方公告原文
            </a>
            {item.archiveNote ? "（链接已失效，以上为存档内容）" : ""}
          </li>
          {detail.previousVersions.map((version) => (
            <li key={version.id} className="text-ink-muted">
              历史版本 v{version.versionNumber}：发布于 {version.publishedAt.slice(0, 10)}
              {version.supersededAt
                ? `，${version.supersededAt.slice(0, 10)} 起被新版本取代`
                : ""}
              {version.changeNote ? `；${version.changeNote}` : ""}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setCorrectionOpen(true)}
          className="mt-3 text-sm text-brand underline underline-offset-2"
        >
          发现内容有误？提交纠错
        </button>
      </Disclosure>

      <CorrectionModal
        isOpen={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        submitting={correctionSubmitting}
        onSubmit={submitCorrection}
      />
    </div>
  );
}
