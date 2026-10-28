"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateTime } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type {
  OpportunityCorrectionStatus,
  StaffOpportunityCorrectionDTO,
} from "@/lib/opportunities/api-types";

type TabKey =
  | "submitted"
  | "reviewing"
  | "need_supplement"
  | "resolved"
  | "rejected"
  | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "submitted", label: "待核对" },
  { key: "reviewing", label: "核对中" },
  { key: "need_supplement", label: "需补充" },
  { key: "resolved", label: "已修正" },
  { key: "rejected", label: "不采纳" },
  { key: "all", label: "全部" },
];

const STATUS_META: Record<
  OpportunityCorrectionStatus,
  { label: string; variant: "warning" | "info" | "success" | "muted" }
> = {
  submitted: { label: "待核对", variant: "warning" },
  reviewing: { label: "核对中", variant: "info" },
  need_supplement: { label: "需补充", variant: "warning" },
  resolved: { label: "已修正", variant: "success" },
  rejected: { label: "不采纳", variant: "muted" },
};

/**
 * 机会纠错处理队列（v7.0 P0-F）：
 * 员工核对用户在机会详情提交的信息纠错，推进
 * submitted → reviewing → resolved/rejected；不采纳必须写处理说明，
 * 终态结果由后端发站内通知给提交人。权限以后端 ReviewGuard 为准，
 * 前端的只读/可操作切换只用于界面呈现。
 * R05：数据类问题必须登记已发布的修正版本才能结案；非数据类问题必须写明
 * 实际处理结果（与后端 corrections.domain 同口径，后端仍做最终校验）。
 */
const VERSION_CORRECTABLE_FIELDS = ["major", "timeline", "headcount", "evidence"];

export function OpportunityCorrectionPanel() {
  const [tab, setTab] = useState<TabKey>("submitted");
  const [items, setItems] = useState<StaffOpportunityCorrectionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 用户处理动作完成后递增以重新拉取；setState 只在事件处理器与异步回调中
  const [reloadKey, setReloadKey] = useState(0);

  // 初次加载与 tab/刷新：setState 只在异步回调中（与 useSchedule 同模式）
  useEffect(() => {
    let cancelled = false;
    opportunitiesApi
      .adminListCorrections(tab === "all" ? undefined : tab)
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
        setError(e instanceof Error ? e.message : "加载纠错队列失败");
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
      {/* 队列 */}
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
            title="该队列暂无纠错"
            description="用户在机会详情页提交的信息纠错会按状态进入对应队列"
          />
        ) : (
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "w-full text-left rounded-xl border bg-white p-3 transition-colors",
                    selectedId === c.id
                      ? "border-blue-400 ring-1 ring-blue-200"
                      : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {c.unitName ?? "岗位已随旧版本移除"}
                    </p>
                    <Badge variant={STATUS_META[c.status].variant}>
                      {STATUS_META[c.status].label}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                    {c.fieldLabel}：{c.content}
                  </p>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {c.submitter.name ?? c.submitter.email} ·{" "}
                    {formatDateTime(c.createdAt)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 详情与处理 */}
      <div className="lg:col-span-3">
        {selected ? (
          <CorrectionDetail key={selected.id} correction={selected} onHandled={() => setReloadKey((k) => k + 1)} />
        ) : (
          <Card className="min-h-[320px] flex items-center justify-center">
            <EmptyState
              icon={<span className="text-4xl">🔎</span>}
              title="选择一条纠错查看详情"
              description="核对官方原文后再推进状态；处理结果会通知提交人，全程留痕"
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function CorrectionDetail({
  correction: c,
  onHandled,
}: {
  correction: StaffOpportunityCorrectionDTO;
  onHandled: () => void;
}) {
  const { role } = useCurrentUser();
  const canAct = role === "exam_reviewer" || role === "admin";
  const terminal = c.status === "resolved" || c.status === "rejected";
  const versionCorrectable = VERSION_CORRECTABLE_FIELDS.includes(c.fieldPath);

  const [note, setNote] = useState(c.reviewNote ?? "");
  const [resolvedVersionId, setResolvedVersionId] = useState(
    c.resolvedVersionId ?? "",
  );
  const resolvedBlocked = versionCorrectable
    ? !resolvedVersionId.trim()
    : note.trim().length < 5;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);

  const act = async (
    status: "reviewing" | "need_supplement" | "resolved" | "rejected",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await opportunitiesApi.adminReviewCorrection(c.id, {
        status,
        reviewNote: note.trim() || undefined,
        resolvedVersionId:
          status === "resolved" && resolvedVersionId.trim()
            ? resolvedVersionId.trim()
            : undefined,
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
            机会信息纠错 · {c.fieldLabel}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {c.unitName ?? "岗位已随旧版本移除"}
            {c.announcementTitle ? ` · ${c.announcementTitle}` : ""} · 提交于{" "}
            {formatDateTime(c.createdAt)}
          </p>
        </div>
        <Badge variant={STATUS_META[c.status].variant}>
          {STATUS_META[c.status].label}
        </Badge>
      </div>

      <dl className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
        <div>
          <dt className="text-xs text-slate-400">提交人</dt>
          <dd className="mt-0.5 text-slate-700">
            {c.submitter.name ? `${c.submitter.name}（${c.submitter.email}）` : c.submitter.email}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">纠错说明</dt>
          <dd className="mt-0.5 text-slate-700 whitespace-pre-line">{c.content}</dd>
        </div>
        {c.contact && (
          <div>
            <dt className="text-xs text-slate-400">提交人联系方式（仅员工可见）</dt>
            <dd className="mt-0.5 text-slate-700 break-all">{c.contact}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-slate-400">官方来源核对</dt>
          <dd className="mt-0.5">
            <Link
              href={`/opportunities/${encodeURIComponent(c.unitId)}`}
              target="_blank"
              className="text-xs text-blue-600 hover:underline"
            >
              打开该机会详情核对原文 ↗
            </Link>
          </dd>
        </div>
      </dl>

      {c.reviewNote && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            c.status === "resolved"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-slate-50 text-slate-600",
          )}
        >
          <p className="font-medium">处理说明</p>
          <p className="mt-0.5 whitespace-pre-line">{c.reviewNote}</p>
        </div>
      )}

      {terminal ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          该纠错已处理完成（终态不可修改）。处理人：{c.reviewerId ?? "—"}；
          处理时间：{c.reviewedAt ? formatDateTime(c.reviewedAt) : "—"}。
          {c.resolvedVersionId && (
            <>修正版本：{c.resolvedVersionId}。</>
          )}
        </div>
      ) : canAct ? (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <Textarea
            label={
              versionCorrectable
                ? "处理说明（将随站内通知发送给提交人）"
                : "处理说明（结案必填：写清实际处理结果，至少 5 个字）"
            }
            className="min-h-[72px]"
            value={note}
            maxLength={500}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder={
              versionCorrectable
                ? "例如：已核对补充公告原文，该岗位人数确已调整为 12 人。"
                : "例如：已复核匹配规则并复测，结论已在系统订正；或已替换为官方新链接。"
            }
          />
          {versionCorrectable && (
            <Input
              label="修正版本号（结案必填：必须是已发布且晚于提交时版本的公告版本）"
              value={resolvedVersionId}
              maxLength={100}
              onChange={(e) => {
                setResolvedVersionId(e.target.value);
                setError(null);
              }}
              placeholder="例如：ann-hefei-v3"
            />
          )}
          {c.status === "submitted" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("reviewing")}>
              认领并开始核对
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || resolvedBlocked}
              onClick={() => void act("resolved")}
            >
              {versionCorrectable ? "已发布修正版本，标记已修正" : "已处理完成，标记已修正"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !note.trim()}
              onClick={() => void act("need_supplement")}
            >
              需要用户补充（需有说明）
            </Button>
            {confirmReject ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || !note.trim()}
                  onClick={() => void act("rejected")}
                >
                  确认不采纳（需有说明）
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReject(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmReject(true)}>
                不采纳
              </Button>
            )}
          </div>
          {resolvedBlocked && (
            <p className="text-xs text-slate-500">
              {versionCorrectable
                ? "该问题属于公告数据：请先发布修正版本并填写版本号；修正尚未发布时保持处理中，不要标记已修正。"
                : "这类问题不需要新版本：请在处理说明中写清实际处理结果（至少 5 个字）后再结案。"}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          资源审核员账号仅可浏览纠错队列；开始核对、标记已修正与不采纳需要考情审核员或管理员权限。
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </Card>
  );
}
