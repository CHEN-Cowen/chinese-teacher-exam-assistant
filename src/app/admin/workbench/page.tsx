"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { serviceDeskApi } from "@/lib/service-desk/api";
import type {
  PublishedResultDTO,
  TicketPriority,
  WorkbenchTaskDTO,
  WorkbenchTaskDetail,
} from "@/lib/service-desk/api";

const BUCKETS = [
  { key: "unassigned", label: "待认领" },
  { key: "mine", label: "我处理中" },
  { key: "pending_review", label: "待复核" },
  { key: "waiting_user", label: "待用户补充" },
  { key: "overdue", label: "已超时" },
  { key: "escalated", label: "已升级" },
  { key: "closed", label: "已结案" },
  { key: "all", label: "全部" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  correction: "数据纠错",
  announcement_submission: "公告补录",
  parse_manual: "扫描件/解析待人工",
  source_alert: "来源告警",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

function statusTone(status: string): "warning" | "info" | "success" | "muted" | "danger" {
  if (status === "resolved") return "success";
  if (status === "rejected") return "muted";
  if (status === "need_supplement") return "warning";
  if (status === "pending_review") return "info";
  if (status === "reviewing") return "info";
  return "muted";
}

export default function WorkbenchPage() {
  const { user, role } = useCurrentUser();
  const [bucket, setBucket] = useState<string>("unassigned");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WorkbenchTaskDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkbenchTaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await serviceDeskApi.queue({
        bucket,
        page: String(page),
        pageSize: "20",
        ...(type ? { type } : {}),
        ...(priority ? { priority } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "队列加载失败");
    } finally {
      setLoading(false);
    }
  }, [bucket, page, type, priority, q]);

  useEffect(() => {
    const timer = setTimeout(() => void loadQueue(), 0);
    return () => clearTimeout(timer);
  }, [loadQueue]);

  const openTask = useCallback(async (taskId: string) => {
    setDetailError(null);
    try {
      setSelected(await serviceDeskApi.task(taskId));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "任务详情加载失败");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("task");
    if (!taskId) return;
    const timer = setTimeout(() => void openTask(taskId), 0);
    return () => clearTimeout(timer);
  }, [openTask]);

  const refresh = useCallback(async () => {
    await loadQueue();
    if (selected) await openTask(selected.id);
  }, [loadQueue, openTask, selected]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">人工工作台</h1>
          <p className="mt-1 text-xs text-slate-500">
            待认领、临近截止、等待用户、超时与升级任务的统一处理入口。当前身份：
            {user?.name ?? "未登录"}（{role ?? "-"}）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/settings/service-desk" className="text-xs text-brand underline">
            负责人 / 时限配置
          </Link>
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
        {BUCKETS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setBucket(item.key);
              setPage(1);
            }}
            className={`rounded-t-md px-3 py-1.5 text-xs ${
              bucket === item.key
                ? "bg-slate-900 font-medium text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
            aria-pressed={bucket === item.key}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="任务类型"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
        >
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="优先级"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value);
            setPage(1);
          }}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
        >
          <option value="">全部优先级</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <input
          aria-label="按受理编号检索"
          placeholder="按受理编号检索，如 JC…"
          value={q}
          onChange={(event) => setQ(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(1);
              void loadQueue();
            }
          }}
          className="h-9 w-44 rounded-lg border border-slate-200 px-2 text-xs"
        />
        <span className="text-xs text-slate-500">共 {total} 条</span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void loadQueue()}>
            重试
          </button>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2">编号 / 类型</th>
                <th className="px-3 py-2">摘要</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">负责人</th>
                <th className="px-3 py-2">优先级</th>
                <th className="px-3 py-2">内部截止</th>
                <th className="px-3 py-2">等待方 / 风险</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    selected?.id === item.id ? "bg-slate-50" : ""
                  }`}
                  onClick={() => void openTask(item.id)}
                >
                  <td className="px-3 py-2">
                    <p className="font-mono text-[11px] text-slate-500">{item.ticketNo}</p>
                    <p className="text-slate-700">{TYPE_LABELS[item.type] ?? item.type}</p>
                  </td>
                  <td className="max-w-[240px] px-3 py-2">
                    <p className="truncate text-slate-700">{item.summary}</p>
                    {item.routeIssue && <p className="text-[11px] text-rose-600">{item.routeIssue}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusTone(item.status)}>{item.statusLabel}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {item.assignee ? item.assignee.name ?? item.assignee.email : "未认领"}
                    {item.defaultOwner && (
                      <p className="text-[11px] text-slate-400">
                        默认 {item.defaultOwner.name ?? item.defaultOwner.email}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {PRIORITY_LABELS[item.priority]}
                    {item.priorityReason && (
                      <p className="max-w-[120px] truncate text-[11px] text-slate-400">
                        {item.priorityReason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {item.responseDueAt && !item.firstResponseAt
                      ? formatDateTime(item.responseDueAt)
                      : item.updateDueAt
                        ? formatDateTime(item.updateDueAt)
                        : "-"}
                    {item.overdue && <p className="text-[11px] text-rose-600">已超时</p>}
                  </td>
                  <td className="px-3 py-2">
                    {item.waitingLabel ?? item.waitingOn ?? "-"}
                    {item.longWaitingSupplement && (
                      <p className="text-[11px] text-amber-600">长期待补充</p>
                    )}
                    {item.escalated && <p className="text-[11px] text-rose-600">已升级</p>}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    当前分组暂无任务
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-4">
          {!selected && !detailError && (
            <p className="text-xs text-slate-400">选择左侧任务查看依据、历史与处理操作。</p>
          )}
          {detailError && (
            <p role="alert" className="text-xs text-rose-600">
              {detailError}
            </p>
          )}
          {selected && (
            <TaskDetailPanel
              detail={selected}
              currentUserId={user?.id ?? ""}
              isAdmin={role === "admin"}
              onChanged={() => void refresh()}
            />
          )}
        </aside>
      </div>

      {total > 20 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span>
            第 {page} / {Math.ceil(total / 20)} 页
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

function TaskDetailPanel({
  detail,
  currentUserId,
  isAdmin,
  onChanged,
}: {
  detail: WorkbenchTaskDetail;
  currentUserId: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [note, setNote] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"public" | "internal">("internal");
  const [priority, setPriority] = useState<TicketPriority>(detail.priority);
  const [priorityReason, setPriorityReason] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [owners, setOwners] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [resolveStatus, setResolveStatus] = useState<"resolved" | "rejected">("resolved");
  const [resolveNote, setResolveNote] = useState("");
  const [resolvedVersionId, setResolvedVersionId] = useState("");
  const [publishedKeyword, setPublishedKeyword] = useState("");
  const [publishedOptions, setPublishedOptions] = useState<PublishedResultDTO[]>([]);
  const [selectedPublished, setSelectedPublished] = useState<PublishedResultDTO | null>(null);
  const [basis, setBasis] = useState("");
  const [derivedOutcome, setDerivedOutcome] = useState<"resolved" | "limited">("resolved");
  const [extractionRunId, setExtractionRunId] = useState("");
  const [missingCheckNote, setMissingCheckNote] = useState("");

  useEffect(() => {
    serviceDeskApi
      .eligibleOwners()
      .then((rows) => setOwners(rows))
      .catch(() => setOwners([]));
  }, []);

  const terminal = detail.status === "resolved" || detail.status === "rejected";

  const run = async (action: () => Promise<unknown>, successMessage?: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage ?? "操作已保存");
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const business = detail.business ?? {};
  const correction =
    detail.type === "correction"
      ? {
          fieldLabel: String(business.fieldLabel ?? ""),
          content: String(business.content ?? ""),
          unitName: String(business.unitName ?? ""),
          status: String(business.status ?? ""),
        }
      : null;
  const submission =
    detail.type === "announcement_submission"
      ? {
          officialUrl: String(business.officialUrl ?? ""),
          publisherName: String(business.publisherName ?? ""),
          note: business.note ? String(business.note) : "",
          status: String(business.status ?? ""),
        }
      : null;

  const searchPublished = async () => {
    try {
      setPublishedOptions(await serviceDeskApi.publishedResults(publishedKeyword));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "公告检索失败");
    }
  };

  const sourceMeta = useMemo(() => {
    if (!detail.sourcePath) return null;
    return detail.sourcePath;
  }, [detail.sourcePath]);

  return (
    <div className="space-y-4 text-xs">
      <div>
        <p className="font-mono text-[11px] text-slate-500">{detail.ticketNo}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">
          {TYPE_LABELS[detail.type] ?? detail.type} · {detail.statusLabel}
        </p>
        <p className="mt-1 text-slate-500">{detail.summary}</p>
        {sourceMeta && (
          <Link href={sourceMeta} className="mt-1 inline-block text-brand underline">
            打开原业务对象
          </Link>
        )}
      </div>

      {detail.routeIssue && (
        <p className="rounded bg-rose-50 px-2 py-1.5 text-rose-700">{detail.routeIssue}</p>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
        <p>负责人：{detail.assignee ? detail.assignee.name ?? detail.assignee.email : "未认领"}</p>
        <p>默认归属：{detail.defaultOwner ? detail.defaultOwner.name ?? detail.defaultOwner.email : "-"}</p>
        <p>优先级：{PRIORITY_LABELS[detail.priority]}（{detail.priorityReason ?? "系统建议"}）</p>
        <p>认领时间：{detail.claimedAt ? formatDateTime(detail.claimedAt) : "-"}</p>
        <p>首次响应：{detail.firstResponseAt ? formatDateTime(detail.firstResponseAt) : "未响应"}</p>
        <p>最近有效更新：{detail.lastEffectiveUpdateAt ? formatDateTime(detail.lastEffectiveUpdateAt) : "-"}</p>
        <p>下次更新截止：{detail.updateDueAt ? formatDateTime(detail.updateDueAt) : "-"}</p>
        <p>升级截止：{detail.escalationDueAt ? formatDateTime(detail.escalationDueAt) : "-"}</p>
        {detail.pausedAt && <p className="text-amber-700">计时已暂停（等待用户补充）</p>}
        {detail.supplementWaitingHours !== null && (
          <p className={detail.longWaitingSupplement ? "text-amber-700" : ""}>
            等待已 {detail.supplementWaitingHours} 小时
          </p>
        )}
      </div>

      {(correction || submission) && (
        <div className="rounded-lg border border-slate-200 p-2">
          <p className="font-medium text-slate-700">依据</p>
          {correction && (
            <>
              <p className="mt-1 text-slate-600">
                {correction.unitName} · {correction.fieldLabel}
              </p>
              <p className="whitespace-pre-line text-slate-700">{correction.content}</p>
            </>
          )}
          {submission && (
            <>
              <p className="mt-1">{submission.publisherName}</p>
              <a
                href={submission.officialUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="block truncate text-brand underline"
              >
                {submission.officialUrl}
              </a>
              {submission.note && <p className="text-slate-600">{submission.note}</p>}
            </>
          )}
          {detail.submitter && (
            <p className="mt-1 text-[11px] text-slate-400">
              提交人：{detail.submitter.name ?? detail.submitter.email}
            </p>
          )}
        </div>
      )}

      {detail.supplements.length > 0 && (
        <div>
          <p className="font-medium text-slate-700">用户补充</p>
          {detail.supplements.map((sup) => (
            <p key={sup.id} className="mt-1 whitespace-pre-line break-words rounded bg-slate-50 p-2">
              {sup.body}
              {sup.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1 block truncate text-brand underline"
                >
                  {link.url}
                </a>
              ))}
              <span className="mt-1 block text-[10px] text-slate-400">
                {formatDateTime(sup.createdAt)}
              </span>
            </p>
          ))}
        </div>
      )}

      {message && <p className="rounded bg-emerald-50 px-2 py-1.5 text-emerald-700">{message}</p>}
      {actionError && (
        <p role="alert" className="rounded bg-rose-50 px-2 py-1.5 text-rose-700">
          {actionError}
        </p>
      )}

      {!terminal && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {!detail.assignee && (
              <Button
                size="sm"
                onClick={() =>
                  void run(
                    () => serviceDeskApi.claim(detail.id, detail.statusVersion ?? 0),
                    "已认领任务（认领不算有效公开响应）",
                  )
                }
                disabled={busy}
              >
                认领
              </Button>
            )}
            {detail.status === "need_supplement" || detail.status === "pending_review" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void run(() => serviceDeskApi.startReview(detail.id), "已进入核对中")}
                disabled={busy}
              >
                继续核对
              </Button>
            ) : null}
          </div>

          <label className="block">
            <span className="text-slate-600">请求用户补充（必须写具体问题，至少 5 字）</span>
            <textarea
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5"
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () => serviceDeskApi.requestSupplement(detail.id, question.trim()),
                "已请求补充并通知提交人",
              )
            }
          >
            请求补充
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="转交目标"
              className="h-8 rounded border border-slate-200 px-1"
              value={transferTo}
              onChange={(event) => setTransferTo(event.target.value)}
            >
              <option value="">转交给…</option>
              {owners
                .filter((owner) => owner.id !== currentUserId)
                .map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name ?? owner.email}
                  </option>
                ))}
            </select>
            <input
              className="h-8 rounded border border-slate-200 px-2"
              placeholder="转交原因（≥5字）"
              value={transferReason}
              onChange={(event) => setTransferReason(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !transferTo}
            onClick={() =>
              void run(
                () =>
                  serviceDeskApi.transfer(detail.id, {
                    toUserId: transferTo,
                    reason: transferReason.trim(),
                    expectedVersion: detail.statusVersion ?? 0,
                  }),
                "已转交并记录原因",
              )
            }
          >
            转交
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="优先级"
              className="h-8 rounded border border-slate-200 px-1"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TicketPriority)}
            >
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
            <input
              className="h-8 rounded border border-slate-200 px-2"
              placeholder="调整原因（必填，≥5字）"
              value={priorityReason}
              onChange={(event) => setPriorityReason(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || priority === detail.priority}
            onClick={() =>
              void run(
                () =>
                  serviceDeskApi.setPriority(detail.id, {
                    priority,
                    reason: priorityReason.trim(),
                  }),
                "优先级已调整",
              )
            }
          >
            保存优先级
          </Button>

          <label className="block">
            <span className="text-slate-600">进展 / 内部备注</span>
            <textarea
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="note-visibility"
                checked={noteVisibility === "internal"}
                onChange={() => setNoteVisibility("internal")}
              />
              内部备注
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="note-visibility"
                checked={noteVisibility === "public"}
                onChange={() => setNoteVisibility("public")}
              />
              公开发布
            </label>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  serviceDeskApi.addNote(detail.id, {
                    message: note.trim(),
                    visibility: noteVisibility,
                  }),
                noteVisibility === "public" ? "公开进展已发布" : "内部备注已保存",
              )
            }
          >
            保存
          </Button>
        </div>
      )}

      {!terminal && detail.type === "correction" && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2">
          <p className="font-medium text-slate-700">结案（纠错）</p>
          <select
            aria-label="结案结论"
            className="h-8 w-full rounded border border-slate-200 px-1"
            value={resolveStatus}
            onChange={(event) => setResolveStatus(event.target.value as "resolved" | "rejected")}
          >
            <option value="resolved">已修正</option>
            <option value="rejected">不采纳</option>
          </select>
          <input
            className="h-8 w-full rounded border border-slate-200 px-2"
            placeholder="处理说明（必填）"
            value={resolveNote}
            onChange={(event) => setResolveNote(event.target.value)}
          />
          <input
            className="h-8 w-full rounded border border-slate-200 px-2"
            placeholder="生效版本 ID（数据类纠错需填写）"
            value={resolvedVersionId}
            onChange={(event) => setResolvedVersionId(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  serviceDeskApi.resolveCorrection(detail.id, {
                    status: resolveStatus,
                    reviewNote: resolveNote.trim(),
                    ...(resolvedVersionId.trim()
                      ? { resolvedVersionId: resolvedVersionId.trim() }
                      : {}),
                  }),
                "纠错已结案并通知提交人",
              )
            }
          >
            提交结案
          </Button>
        </div>
      )}

      {!terminal && detail.type === "announcement_submission" && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2">
          <p className="font-medium text-slate-700">结案（公告补录）</p>
          <select
            aria-label="结案结论"
            className="h-8 w-full rounded border border-slate-200 px-1"
            value={resolveStatus}
            onChange={(event) => setResolveStatus(event.target.value as "resolved" | "rejected")}
          >
            <option value="resolved">已收录（必须关联真实已发布公告）</option>
            <option value="rejected">不采纳</option>
          </select>
          {resolveStatus === "resolved" && (
            <>
              <div className="flex gap-1">
                <input
                  className="h-8 flex-1 rounded border border-slate-200 px-2"
                  placeholder="按标题/发布单位/链接检索正式公告"
                  value={publishedKeyword}
                  onChange={(event) => setPublishedKeyword(event.target.value)}
                />
                <Button size="sm" variant="ghost" onClick={() => void searchPublished()}>
                  检索
                </Button>
              </div>
              {publishedOptions.length > 0 && (
                <select
                  aria-label="关联正式公告"
                  className="w-full rounded border border-slate-200 px-1 text-[11px]"
                  onChange={(event) => {
                    const found = publishedOptions.find(
                      (option) => option.versionId === event.target.value,
                    );
                    setSelectedPublished(found ?? null);
                  }}
                  defaultValue=""
                >
                  <option value="">选择已发布版本…</option>
                  {publishedOptions.map((option) => (
                    <option key={option.versionId} value={option.versionId}>
                      {option.title || option.publisherName} · {option.versionId}
                    </option>
                  ))}
                </select>
              )}
              {selectedPublished && (
                <p className="rounded bg-slate-50 p-1.5 text-[11px] text-slate-600">
                  已选择：{selectedPublished.title || selectedPublished.publisherName}
                  <br />
                  {selectedPublished.officialUrl}
                </p>
              )}
              <input
                className="h-8 w-full rounded border border-slate-200 px-2"
                placeholder="关联依据（不同链接时必填，≥10字）"
                value={basis}
                onChange={(event) => setBasis(event.target.value)}
              />
            </>
          )}
          <input
            className="h-8 w-full rounded border border-slate-200 px-2"
            placeholder="处理说明（必填）"
            value={resolveNote}
            onChange={(event) => setResolveNote(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  serviceDeskApi.resolveSubmission(detail.id, {
                    status: resolveStatus,
                    reviewNote: resolveNote.trim(),
                    ...(selectedPublished
                      ? {
                          expectedAnnouncementId: selectedPublished.announcementId,
                          expectedVersionId: selectedPublished.versionId,
                        }
                      : {}),
                    ...(basis.trim() ? { resolutionBasis: basis.trim() } : {}),
                  }),
                "补录已结案",
              )
            }
          >
            提交结案
          </Button>
        </div>
      )}

      {!terminal && (detail.type === "parse_manual" || detail.type === "source_alert") && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2">
          <p className="font-medium text-slate-700">
            完成排障（{TYPE_LABELS[detail.type]}）
          </p>
          {detail.type === "parse_manual" ? (
            <input
              className="h-8 w-full rounded border border-slate-200 px-2"
              placeholder="交接的提取任务 ID（必填）"
              value={extractionRunId}
              onChange={(event) => setExtractionRunId(event.target.value)}
            />
          ) : (
            <>
              <select
                aria-label="来源处置结论"
                className="h-8 w-full rounded border border-slate-200 px-1"
                value={derivedOutcome}
                onChange={(event) =>
                  setDerivedOutcome(event.target.value as "resolved" | "limited")
                }
              >
                <option value="resolved">已恢复</option>
                <option value="limited">受限/停用（保留覆盖缺口）</option>
              </select>
              {derivedOutcome === "limited" && (
                <input
                  className="h-8 w-full rounded border border-slate-200 px-2"
                  placeholder="覆盖缺口说明（必填）"
                  value={missingCheckNote}
                  onChange={(event) => setMissingCheckNote(event.target.value)}
                />
              )}
            </>
          )}
          <input
            className="h-8 w-full rounded border border-slate-200 px-2"
            placeholder="处理说明（必填）"
            value={resolveNote}
            onChange={(event) => setResolveNote(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  serviceDeskApi.completeDerived(detail.id, {
                    note: resolveNote.trim(),
                    ...(detail.type === "parse_manual"
                      ? { extractionRunId: extractionRunId.trim() }
                      : { outcome: derivedOutcome, missingCheckNote: missingCheckNote.trim() }),
                  }),
                "排障任务已提交",
              )
            }
          >
            提交
          </Button>
        </div>
      )}

      {terminal && detail.resolutionNote && (
        <p className="rounded bg-slate-50 p-2 text-slate-600">
          结案说明：{detail.resolutionNote}
        </p>
      )}

      <div>
        <p className="font-medium text-slate-700">处理历史（含内部记录）</p>
        <ol className="mt-1 space-y-1">
          {detail.events.map((event) => (
            <li key={event.id} className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
              <span className="font-medium text-slate-800">{event.action}</span>
              {event.visibility === "internal" && (
                <span className="ml-1 rounded bg-slate-200 px-1 text-[10px]">内部</span>
              )}
              {event.message && `：${event.message}`}
              <span className="ml-1 text-slate-400">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      </div>

      {isAdmin && !detail.config.complete && (
        <p className="rounded bg-amber-50 px-2 py-1.5 text-amber-700">
          运营责任人未配置完整：{detail.config.issues.join("；")}。请到
          <Link href="/admin/settings/service-desk" className="mx-1 underline">
            负责人配置
          </Link>
          完成设置。
        </p>
      )}

      {currentUserId && detail.assignee?.id !== currentUserId && !terminal && detail.assignee && (
        <p className="text-[11px] text-slate-400">
          该任务当前由 {detail.assignee.name ?? detail.assignee.email} 处理；请先转交再操作。
        </p>
      )}
    </div>
  );
}
