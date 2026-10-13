"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SourceHealthBadge, RunCountBadges } from "@/components/admin/SourceHealthBadge";
import { cn, formatDateTime } from "@/lib/utils";
import {
  sourcesApi,
  type CrawlRun,
  type SourceDocument,
  type SourceHealth,
  type SourcesHealthResponse,
} from "@/lib/admin/sourcesApi";

// ==================== 文案映射 ====================

const TRIGGER_LABELS: Record<string, string> = {
  schedule: "定时",
  admin: "手动",
  retry: "重试",
};

const RUN_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  queued: { label: "排队中", className: "bg-slate-100 text-slate-600" },
  running: { label: "进行中", className: "bg-blue-100 text-blue-700" },
  succeeded: { label: "成功", className: "bg-emerald-100 text-emerald-700" },
  failed: { label: "失败", className: "bg-red-100 text-red-700" },
  unchanged: { label: "无变化", className: "bg-slate-100 text-slate-500" },
  skipped_paused: { label: "已跳过（暂停）", className: "bg-slate-100 text-slate-500" },
  skipped_blocked: { label: "已跳过（阻止）", className: "bg-red-100 text-red-700" },
};

const RELATION_LABELS: Record<string, string> = {
  supplement: "补充公告",
  delay: "延期公告",
  cancel: "取消公告",
};

/** 手动检查返回状态 → 页面提示 */
function checkResultMessage(result: { status: string; deduplicated: boolean; runId: string }) {
  if (result.deduplicated || result.status === "already_running") {
    return { kind: "info" as const, text: "该来源已有进行中的检查，本次未重复投递" };
  }
  if (result.status === "skipped_paused") {
    return { kind: "info" as const, text: "来源已暂停，未执行检查；请先恢复来源" };
  }
  if (result.status === "skipped_blocked") {
    return { kind: "info" as const, text: "来源被阻止（验证码/封禁），需人工处理后才能检查" };
  }
  return { kind: "success" as const, text: `已触发检查，运行 ID：${result.runId.slice(0, 8)}` };
}

function urlHost(url?: string | null): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "—";
}

// ==================== 主页面 ====================

export default function AdminSourcesPage() {
  const [data, setData] = useState<SourcesHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "info" | "error"; text: string } | null>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [confirmPauseId, setConfirmPauseId] = useState<string | null>(null);
  const [pausingIds, setPausingIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await sourcesApi.getHealth();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载：内联 fetch，避免在 effect 中直接调用含 setState 的函数
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await sourcesApi.getHealth();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheck = async (sourceId: string) => {
    if (checkingIds.has(sourceId)) return;
    setNotice(null);
    setCheckingIds((prev) => new Set(prev).add(sourceId));
    try {
      const result = await sourcesApi.checkSource(sourceId);
      setNotice(checkResultMessage(result));
      await load();
    } catch (e) {
      setNotice({
        kind: "error",
        text: `检查触发失败：${e instanceof Error ? e.message : "网络错误"}，请重试`,
      });
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const handlePauseToggle = async (source: SourceHealth) => {
    const pause = source.healthStatus !== "paused";
    setPausingIds((prev) => new Set(prev).add(source.id));
    setNotice(null);
    try {
      if (pause) {
        await sourcesApi.pauseSource(source.id);
        setNotice({ kind: "success", text: `已暂停「${source.publisher}」的自动抓取` });
      } else {
        await sourcesApi.resumeSource(source.id);
        setNotice({ kind: "success", text: `已恢复「${source.publisher}」的抓取` });
      }
      setConfirmPauseId(null);
      await load();
    } catch (e) {
      setNotice({
        kind: "error",
        text: `操作失败：${e instanceof Error ? e.message : "网络错误"}，请重试`,
      });
    } finally {
      setPausingIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  const sources = data?.sources ?? [];
  const queue = data?.queue ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">来源管理</h1>
        <p className="text-sm text-slate-500 mt-1">
          监控官方公告来源的抓取健康：连续失败、结构变化与待审核积压在这里一览；可手动触发检查或暂停来源。
        </p>
      </div>

      {/* 队列积压摘要 */}
      {queue && (
        <Card padding="sm">
          <p className="text-xs text-slate-500">
            抓取队列积压：等待 <span className="font-semibold text-slate-800">{queue.waiting}</span>
            {" · "}延迟 <span className="font-semibold text-slate-800">{queue.delayed}</span>
            {" · "}执行中 <span className="font-semibold text-slate-800">{queue.active}</span>
          </p>
        </Card>
      )}

      {/* 操作结果提示（成功/信息/错误均可重试） */}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border p-3 text-sm",
            notice.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : notice.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-blue-200 bg-blue-50 text-blue-700"
          )}
        >
          {notice.kind === "error" ? "⚠️ " : ""}
          {notice.text}
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-800">来源列表</p>
          <Button size="sm" variant="outline" onClick={load}>
            刷新
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">加载中...</p>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-600 mb-3">⚠️ 来源数据加载失败：{error}</p>
            <Button size="sm" variant="outline" onClick={load}>
              重试
            </Button>
          </div>
        ) : sources.length === 0 ? (
          <EmptyState
            icon={<span className="text-4xl">🌐</span>}
            title="还没有登记任何来源"
            description="请管理员先调用后端 POST /admin/sources/seed 幂等登记首批官方来源，登记后在此监控抓取健康"
          />
        ) : (
          <>
            {/* 桌面：表格 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" data-testid="sources-table">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">来源</th>
                    <th className="py-2 pr-3">健康状态</th>
                    <th className="py-2 pr-3">检查时间</th>
                    <th className="py-2 pr-3">最近一次运行</th>
                    <th className="py-2 pr-3">连续失败</th>
                    <th className="py-2 pr-3">Adapter / 解析器</th>
                    <th className="py-2 pr-3">待审核</th>
                    <th className="py-2 pr-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <SourceRow
                      key={s.id}
                      source={s}
                      checking={checkingIds.has(s.id)}
                      pausing={pausingIds.has(s.id)}
                      confirming={confirmPauseId === s.id}
                      expanded={expandedId === s.id}
                      onCheck={() => handleCheck(s.id)}
                      onAskPauseToggle={() =>
                        setConfirmPauseId(confirmPauseId === s.id ? null : s.id)
                      }
                      onConfirmPauseToggle={() => handlePauseToggle(s)}
                      onToggleExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* 移动：卡片 */}
            <div className="md:hidden space-y-3" data-testid="sources-cards">
              {sources.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  checking={checkingIds.has(s.id)}
                  pausing={pausingIds.has(s.id)}
                  confirming={confirmPauseId === s.id}
                  expanded={expandedId === s.id}
                  onCheck={() => handleCheck(s.id)}
                  onAskPauseToggle={() => setConfirmPauseId(confirmPauseId === s.id ? null : s.id)}
                  onConfirmPauseToggle={() => handlePauseToggle(s)}
                  onToggleExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
                />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ==================== 行/卡片共享的操作区 ====================

interface SourceActionProps {
  source: SourceHealth;
  checking: boolean;
  pausing: boolean;
  confirming: boolean;
  expanded: boolean;
  onCheck: () => void;
  onAskPauseToggle: () => void;
  onConfirmPauseToggle: () => void;
  onToggleExpand: () => void;
}

function SourceActions({
  source,
  checking,
  pausing,
  confirming,
  expanded,
  onCheck,
  onAskPauseToggle,
  onConfirmPauseToggle,
  onToggleExpand,
}: SourceActionProps) {
  const paused = source.healthStatus === "paused";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" onClick={onCheck} disabled={checking}>
        {checking ? "触发中..." : "立即检查"}
      </Button>
      {confirming ? (
        <>
          <Button size="sm" variant="danger" onClick={onConfirmPauseToggle} disabled={pausing}>
            {pausing ? "处理中..." : paused ? "确认恢复" : "确认暂停"}
          </Button>
          <Button size="sm" variant="outline" onClick={onAskPauseToggle} disabled={pausing}>
            取消
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={onAskPauseToggle}>
          {paused ? "恢复" : "暂停"}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onToggleExpand}>
        {expanded ? "收起" : "运行记录"}
      </Button>
    </div>
  );
}

/** 待审核积压徽标（>0 时 amber 强调并链接审核流水线） */
function PendingReviewLink({ count }: { count?: number }) {
  if (!count || count <= 0) return <span className="text-xs text-slate-400">0</span>;
  return (
    <Link
      href="/admin/pipeline"
      className="inline-flex items-center px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-medium hover:bg-amber-200"
    >
      {count} 待审核
    </Link>
  );
}

/** 最近运行四计数（无运行时显示占位） */
function LatestRunCounts({ source }: { source: SourceHealth }) {
  const run = source.latestRun ?? null;
  if (!run) return <span className="text-xs text-slate-400">—</span>;
  return (
    <RunCountBadges
      discovered={run.discoveredCount ?? 0}
      downloaded={run.downloadedCount ?? 0}
      unchanged={run.unchangedCount ?? 0}
      failed={run.failedCount ?? 0}
    />
  );
}

// ==================== 桌面行 ====================

function SourceRow(props: SourceActionProps) {
  const { source: s, expanded } = props;
  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="py-2.5 pr-3">
          <p className="font-medium text-slate-800 max-w-[180px] truncate">{s.publisher}</p>
          <p className="text-xs text-slate-400 max-w-[180px] truncate">{urlHost(s.officialUrl)}</p>
        </td>
        <td className="py-2.5 pr-3">
          <SourceHealthBadge status={s.healthStatus} />
          {s.lastFailReason && (
            <p className="text-[11px] text-red-500 mt-1 max-w-[140px] truncate">{s.lastFailReason}</p>
          )}
        </td>
        <td className="py-2.5 pr-3 text-xs text-slate-500">
          <p>最近检查：{formatTime(s.lastCheckedAt)}</p>
          <p>最近成功：{formatTime(s.lastSuccessAt)}</p>
          <p>下次检查：{formatTime(s.nextCheckAt)}</p>
        </td>
        <td className="py-2.5 pr-3">
          <LatestRunCounts source={s} />
        </td>
        <td className="py-2.5 pr-3">
          <span
            className={cn(
              "text-sm",
              s.consecutiveFailures > 0 ? "font-semibold text-red-600" : "text-slate-500"
            )}
          >
            {s.consecutiveFailures}
          </span>
        </td>
        <td className="py-2.5 pr-3 text-xs text-slate-500">
          <p>{s.latestRun?.adapterVersion ?? s.adapterKey ?? "—"}</p>
          <p className="text-slate-400">解析器：{s.parserVersion ?? "—"}</p>
        </td>
        <td className="py-2.5 pr-3">
          <PendingReviewLink count={s.pendingReviewCount} />
        </td>
        <td className="py-2.5 pr-3">
          <SourceActions {...props} />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100">
          <td colSpan={8} className="py-3 bg-slate-50/60">
            <SourceDetail sourceId={s.id} />
          </td>
        </tr>
      )}
    </>
  );
}

// ==================== 移动卡片 ====================

function SourceCard(props: SourceActionProps) {
  const { source: s, expanded } = props;
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-800 truncate">{s.publisher}</p>
          <p className="text-xs text-slate-400 truncate">{urlHost(s.officialUrl)}</p>
        </div>
        <SourceHealthBadge status={s.healthStatus} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
        <p>最近检查：{formatTime(s.lastCheckedAt)}</p>
        <p>最近成功：{formatTime(s.lastSuccessAt)}</p>
        <p>下次检查：{formatTime(s.nextCheckAt)}</p>
        <p>
          连续失败：
          <span className={s.consecutiveFailures > 0 ? "font-semibold text-red-600" : ""}>
            {s.consecutiveFailures}
          </span>
        </p>
        <p>Adapter：{s.latestRun?.adapterVersion ?? s.adapterKey ?? "—"}</p>
        <p>解析器：{s.parserVersion ?? "—"}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <LatestRunCounts source={s} />
        <PendingReviewLink count={s.pendingReviewCount} />
      </div>

      {s.lastFailReason && <p className="text-[11px] text-red-500">{s.lastFailReason}</p>}

      <SourceActions {...props} />

      {expanded && (
        <div className="pt-2 border-t border-slate-100">
          <SourceDetail sourceId={s.id} />
        </div>
      )}
    </div>
  );
}

// ==================== 展开详情：运行记录 + 文档关系 ====================

function SourceDetail({ sourceId }: { sourceId: string }) {
  const [runs, setRuns] = useState<CrawlRun[] | null>(null);
  const [documents, setDocuments] = useState<SourceDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [runsRes, docsRes] = await Promise.all([
        sourcesApi.listRuns(sourceId, 20),
        sourcesApi.listDocuments(sourceId),
      ]);
      setRuns(runsRes.runs ?? []);
      setDocuments(docsRes.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [sourceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [runsRes, docsRes] = await Promise.all([
          sourcesApi.listRuns(sourceId, 20),
          sourcesApi.listDocuments(sourceId),
        ]);
        if (cancelled) return;
        setRuns(runsRes.runs ?? []);
        setDocuments(docsRes.documents ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  if (error) {
    return (
      <div className="text-sm text-red-600">
        ⚠️ 详情加载失败：{error}
        <Button size="sm" variant="outline" className="ml-2" onClick={reload}>
          重试
        </Button>
      </div>
    );
  }

  if (!runs || !documents) {
    return <p className="text-xs text-slate-400">加载运行记录与文档...</p>;
  }

  return (
    <div className="space-y-4 px-1">
      {/* 运行记录 */}
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-2">运行记录（最近 {runs.length} 条）</p>
        {runs.length === 0 ? (
          <p className="text-xs text-slate-400">暂无运行记录</p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((r) => {
              const st = RUN_STATUS_LABELS[r.status] ?? {
                label: r.status,
                className: "bg-slate-100 text-slate-600",
              };
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">{formatTime(r.startedAt)}</span>
                    <span className="text-slate-400">{TRIGGER_LABELS[r.trigger] ?? r.trigger}</span>
                    <span className={cn("px-1.5 py-px rounded font-medium", st.className)}>
                      {st.label}
                    </span>
                    {r.adapterVersion && <span className="text-slate-400">v:{r.adapterVersion}</span>}
                  </div>
                  <RunCountBadges
                    discovered={r.discoveredCount ?? 0}
                    downloaded={r.downloadedCount ?? 0}
                    unchanged={r.unchangedCount ?? 0}
                    failed={r.failedCount ?? 0}
                  />
                  {r.errorSummary && <p className="text-red-500">{r.errorSummary}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 文档与关系确认 */}
      <SourceDocuments documents={documents} onChanged={reload} />
    </div>
  );
}

function SourceDocuments({
  documents,
  onChanged,
}: {
  documents: SourceDocument[];
  onChanged: () => void;
}) {
  const [confirmingDocId, setConfirmingDocId] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [relationType, setRelationType] = useState<"supplement" | "delay" | "cancel">("supplement");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 父文档候选：同来源的 announcement 文档
  const parentCandidates = documents.filter((d) => d.kind === "announcement");

  const openConfirm = (doc: SourceDocument) => {
    setConfirmingDocId(doc.id);
    setParentId(doc.parentDocumentId ?? parentCandidates.find((d) => d.id !== doc.id)?.id ?? "");
    setRelationType("supplement");
    setError(null);
  };

  const handleConfirm = async (doc: SourceDocument) => {
    if (!parentId) return;
    setSubmitting(true);
    setError(null);
    try {
      await sourcesApi.confirmDocumentRelation(doc.id, {
        relationType,
        parentDocumentId: parentId,
      });
      setConfirmingDocId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold text-slate-700 mb-2">文档列表（{documents.length}）</p>
      {documents.length === 0 ? (
        <p className="text-xs text-slate-400">暂无文档</p>
      ) : (
        <div className="space-y-1.5">
          {documents.map((d) => {
            const isCandidate = !!d.relationType && d.relationType.endsWith("Candidate");
            return (
              <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-700 break-all max-w-full">{d.canonicalUrl}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-1.5 py-px rounded bg-slate-100 text-slate-600">{d.kind}</span>
                  {d.relationType && (
                    <span
                      className={cn(
                        "px-1.5 py-px rounded",
                        isCandidate ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                      )}
                    >
                      {isCandidate
                        ? `待确认关系：${d.relationType}`
                        : `关系：${RELATION_LABELS[d.relationType] ?? d.relationType}`}
                    </span>
                  )}
                  {isCandidate && confirmingDocId !== d.id && (
                    <Button size="sm" variant="outline" onClick={() => openConfirm(d)}>
                      确认关系
                    </Button>
                  )}
                </div>

                {isCandidate && confirmingDocId === d.id && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-slate-500">父文档：</label>
                      <select
                        className="border border-slate-300 rounded px-2 py-1 text-xs max-w-[260px]"
                        value={parentId}
                        onChange={(e) => setParentId(e.target.value)}
                        aria-label="选择父文档"
                      >
                        <option value="">选择父文档（公告）...</option>
                        {parentCandidates
                          .filter((p) => p.id !== d.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.canonicalUrl}
                            </option>
                          ))}
                      </select>
                      <label className="text-slate-500">关系：</label>
                      <select
                        className="border border-slate-300 rounded px-2 py-1 text-xs"
                        value={relationType}
                        onChange={(e) =>
                          setRelationType(e.target.value as "supplement" | "delay" | "cancel")
                        }
                        aria-label="选择关系类型"
                      >
                        <option value="supplement">补充公告</option>
                        <option value="delay">延期公告</option>
                        <option value="cancel">取消公告</option>
                      </select>
                    </div>
                    {error && <p className="text-red-500">⚠️ {error}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleConfirm(d)} disabled={!parentId || submitting}>
                        {submitting ? "提交中..." : "确认关系"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmingDocId(null)}>
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
