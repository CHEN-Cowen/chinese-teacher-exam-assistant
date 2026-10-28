"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateTime } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { submissionStatusMeta } from "@/lib/opportunities/announcement-submission";
import type { StaffAnnouncementSubmissionDTO } from "@/lib/opportunities/api-types";

type TabKey =
  | "submitted"
  | "reviewing"
  | "need_supplement"
  | "resolved"
  | "rejected"
  | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "submitted", label: "待处理" },
  { key: "reviewing", label: "处理中" },
  { key: "need_supplement", label: "需补充" },
  { key: "resolved", label: "已处理" },
  { key: "rejected", label: "未采纳" },
  { key: "all", label: "全部" },
];

/**
 * 公告补录处理队列（D08 / PRD 11.9 U08）：
 * 员工核对用户提交的未收录官方公告，推进
 * submitted → reviewing → resolved/rejected（含 need_supplement）。
 * 处理只改变补录记录本身与站内通知；纳入采集与发布仍走既有来源
 * 登记与审核流水线，这里不提供任何直发按钮。
 */
export function AnnouncementSubmissionPanel() {
  const [tab, setTab] = useState<TabKey>("submitted");
  const [items, setItems] = useState<StaffAnnouncementSubmissionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    opportunitiesApi
      .adminListAnnouncementSubmissions(tab === "all" ? undefined : tab)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setError(null);
        setSelectedId((prev) =>
          prev && data.some((d) => d.id === prev) ? prev : (data[0]?.id ?? null),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载补录队列失败");
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const switchTab = (next: TabKey) => {
    setTab(next);
    setLoading(true);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors",
                tab === t.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 py-8 text-center">加载中…</p>
        ) : error ? (
          <p className="text-sm text-red-600 py-8 text-center">{error}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<span className="text-4xl">📭</span>}
            title="该队列暂无补录"
            description="用户提交的未收录官方公告会按状态进入对应队列"
          />
        ) : (
          <ul className="space-y-2">
            {items.map((s) => {
              const meta = submissionStatusMeta(s.status);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      "w-full text-left rounded-xl border bg-white p-3 transition-colors",
                      selectedId === s.id
                        ? "border-blue-400 ring-1 ring-blue-200"
                        : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {s.publisherName}
                      </p>
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {s.officialUrl}
                    </p>
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {s.submitter.name ?? s.submitter.email} · 地区码 {s.regionCode} ·{" "}
                      {formatDateTime(s.createdAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lg:col-span-3">
        {selected ? (
          <SubmissionDetail
            key={selected.id}
            submission={selected}
            onHandled={() => setReloadKey((k) => k + 1)}
          />
        ) : (
          <Card className="min-h-[320px] flex items-center justify-center">
            <EmptyState
              icon={<span className="text-4xl">🔎</span>}
              title="选择一条补录查看详情"
              description="核对官方链接后再推进状态；结果会通知提交人，全程留痕"
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function SubmissionDetail({
  submission: s,
  onHandled,
}: {
  submission: StaffAnnouncementSubmissionDTO;
  onHandled: () => void;
}) {
  const { role } = useCurrentUser();
  const canAct = role === "exam_reviewer" || role === "admin";
  const terminal = s.status === "resolved" || s.status === "rejected";
  const meta = submissionStatusMeta(s.status);

  const [note, setNote] = useState(s.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (
    status: "reviewing" | "need_supplement" | "resolved" | "rejected",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await opportunitiesApi.adminReviewAnnouncementSubmission(s.id, {
        status,
        reviewNote: note.trim() || undefined,
      });
      onHandled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            公告补录 · {s.publisherName}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            地区码 {s.regionCode} · 提交于 {formatDateTime(s.createdAt)}
          </p>
        </div>
        <Badge variant={meta.tone}>{meta.label}</Badge>
      </div>

      <dl className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
        <div>
          <dt className="text-xs text-slate-400">提交人</dt>
          <dd className="mt-0.5 text-slate-700">
            {s.submitter.name ? `${s.submitter.name}（${s.submitter.email}）` : s.submitter.email}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">官方链接</dt>
          <dd className="mt-0.5">
            <a
              href={s.officialUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-xs text-blue-600 hover:underline break-all"
            >
              {s.officialUrl} ↗
            </a>
          </dd>
        </div>
        {s.note && (
          <div>
            <dt className="text-xs text-slate-400">用户补充说明</dt>
            <dd className="mt-0.5 text-slate-700 whitespace-pre-line">{s.note}</dd>
          </div>
        )}
      </dl>

      {s.reviewNote && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="font-medium">处理说明</p>
          <p className="mt-0.5 whitespace-pre-line">{s.reviewNote}</p>
        </div>
      )}

      {terminal ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          该补录已处理完成（终态不可修改）。处理人：{s.reviewerId ?? "—"}；
          处理时间：{s.reviewedAt ? formatDateTime(s.reviewedAt) : "—"}。
        </div>
      ) : canAct ? (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <Textarea
            label="处理说明（不采纳/需补充时必填；将随站内通知发送给提交人）"
            className="min-h-[72px]"
            value={note}
            maxLength={500}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder="例如：已核对链接可访问，将登记该来源并纳入后续采集评估。"
          />
          {s.status === "submitted" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("reviewing")}>
              认领并开始处理
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void act("resolved")}>
              核对完成，标记已处理（收录）
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !note.trim()}
              onClick={() => void act("need_supplement")}
            >
              需要用户补充（需有说明）
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || !note.trim()}
              onClick={() => void act("rejected")}
            >
              不采纳（需有说明）
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            标记已处理只代表这条补录的受理闭环；把来源纳入采集仍走来源登记与审核流水线。
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          资源审核员账号仅可浏览补录队列；开始处理与状态推进需要考情审核员或管理员权限。
        </div>
      )}
    </Card>
  );
}
