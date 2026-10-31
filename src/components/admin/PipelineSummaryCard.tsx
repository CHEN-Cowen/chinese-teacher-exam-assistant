"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { announcementsAdminApi } from "@/lib/admin/sourcesApi";
import type { PipelineSummary } from "@/lib/admin/sourcesApi";
import { formatDateTime } from "@/lib/utils";

const HEALTH_LABELS: Record<string, string> = {
  healthy: "正常",
  degraded: "降级",
  structure_changed: "结构变化",
  blocked: "受限",
  paused: "已暂停",
};

const PARSE_STATUS_LABELS: Record<string, string> = {
  pending: "待解析",
  parsed: "已解析",
  pending_manual: "待人工处理",
  unsupported_format: "格式不支持",
  failed: "解析失败",
};

const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  submitted: "已提交",
  extracting: "提取中",
  pending_review: "待人工审核",
  approved: "已审核",
  published: "已发布",
  rejected: "已驳回",
  failed: "提取失败",
};

const PUBLISHED_STATUS_LABELS: Record<string, string> = {
  published: "当前有效",
  superseded: "已被新版本取代",
  withdrawn: "已撤回",
};

function StatusChips({
  counts,
  labels,
  warnKeys,
}: {
  counts: Record<string, number>;
  labels: Record<string, string>;
  warnKeys: string[];
}) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    return <p className="text-xs text-slate-400">暂无记录</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([status, count]) => (
        <span
          key={status}
          className={
            warnKeys.includes(status) && count > 0
              ? "inline-flex h-6 items-center gap-1 rounded bg-amber-50 px-2 text-xs text-amber-800"
              : "inline-flex h-6 items-center gap-1 rounded bg-slate-100 px-2 text-xs text-slate-600"
          }
        >
          {labels[status] ?? status}
          <span className="font-semibold">{count}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * 采集管线跨阶段汇总卡（D09 / U10）：
 * 来源检查 → 快照 → 解析 → 提取审核 → 发布各阶段真实持久化计数。
 * 只展示后端返回的数字，加载失败明确报错，绝不编造统计；
 * 「来源异常（覆盖缺口）」与「检查正常但无新增」按健康状态分布区分。
 */
export function PipelineSummaryCard() {
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    announcementsAdminApi
      .pipelineSummary()
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载管线汇总失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <ErrorState
        title="管线汇总暂时加载失败"
        description={error}
        retryLabel="重试"
        onRetry={() => {
          setError(null);
          setSummary(null);
          announcementsAdminApi
            .pipelineSummary()
            .then((data) => setSummary(data))
            .catch((e) =>
              setError(e instanceof Error ? e.message : "加载管线汇总失败"),
            );
        }}
      />
    );
  }
  if (!summary) {
    return (
      <Card className="py-6 text-center text-sm text-slate-500">
        正在加载管线汇总…
      </Card>
    );
  }

  // 后端并行开发/代理异常时字段可能缺省：防御性判空，缺块显示占位而不是崩溃
  const sources = summary.sources ?? { total: 0, byHealthStatus: {}, lastSuccessAt: null };
  const snapshots = summary.snapshots ?? { total: 0, last24h: 0 };
  const byHealthStatus = sources.byHealthStatus ?? {};

  const abnormal =
    (byHealthStatus.degraded ?? 0) +
    (byHealthStatus.structure_changed ?? 0) +
    (byHealthStatus.blocked ?? 0);
  const paused = byHealthStatus.paused ?? 0;
  const healthy = byHealthStatus.healthy ?? 0;
  let coverageNote: string;
  if (sources.total === 0) {
    coverageNote = "尚未登记任何官方来源，覆盖为空。";
  } else if (abnormal > 0) {
    coverageNote = `${abnormal} 个来源处于降级/结构变化/受限状态，存在覆盖缺口，需按来源处置。`;
  } else if (paused === sources.total) {
    coverageNote = "全部来源已暂停，采集停止，不会产生新增。";
  } else if (snapshots.last24h === 0) {
    coverageNote = `检查运行正常（正常来源 ${healthy} 个）但最近 24 小时无新增快照：属「无新增」，不是采集故障。`;
  } else {
    coverageNote = `检查运行正常（正常来源 ${healthy} 个），最近 24 小时新增 ${snapshots.last24h} 个快照。`;
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">采集管线总览</h2>
        <p className="text-xs text-slate-400">
          统计生成于 {formatDateTime(summary.generatedAt)}
        </p>
      </div>
      <p
        className={
          abnormal > 0
            ? "rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
            : "rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
        }
      >
        {coverageNote}
      </p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <dt className="text-xs text-slate-400">来源检查</dt>
          <dd className="mt-1.5 space-y-1.5">
            <p className="text-sm text-slate-700">
              登记来源 <span className="font-semibold">{sources.total}</span> 个
              {sources.lastSuccessAt && (
                <> · 最近成功检查 {formatDateTime(sources.lastSuccessAt)}</>
              )}
            </p>
            <StatusChips
              counts={byHealthStatus}
              labels={HEALTH_LABELS}
              warnKeys={["degraded", "structure_changed", "blocked"]}
            />
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <dt className="text-xs text-slate-400">正文与附件快照</dt>
          <dd className="mt-1.5 text-sm text-slate-700">
            累计 <span className="font-semibold">{snapshots.total}</span> 份 ·
            最近 24 小时新增 <span className="font-semibold">{snapshots.last24h}</span> 份
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <dt className="text-xs text-slate-400">文档解析</dt>
          <dd className="mt-1.5">
            <StatusChips
              counts={summary.parseRuns?.byStatus ?? {}}
              labels={PARSE_STATUS_LABELS}
              warnKeys={["pending_manual", "failed", "unsupported_format"]}
            />
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <dt className="text-xs text-slate-400">提取与审核</dt>
          <dd className="mt-1.5">
            <StatusChips
              counts={summary.extractionRuns?.byStatus ?? {}}
              labels={EXTRACTION_STATUS_LABELS}
              warnKeys={["pending_review", "failed"]}
            />
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
          <dt className="text-xs text-slate-400">发布版本（用户匹配目录消费已发布数据）</dt>
          <dd className="mt-1.5 space-y-1.5">
            <StatusChips
              counts={summary.publishedVersions?.byStatus ?? {}}
              labels={PUBLISHED_STATUS_LABELS}
              warnKeys={[]}
            />
            {summary.publishedVersions?.lastPublishedAt && (
              <p className="text-xs text-slate-400">
                最新发布 {formatDateTime(summary.publishedVersions.lastPublishedAt)}
              </p>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
