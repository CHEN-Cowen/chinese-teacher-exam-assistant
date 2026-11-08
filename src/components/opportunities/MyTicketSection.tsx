"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { checkOfficialUrl } from "@/lib/opportunities/announcement-submission";
import type {
  TicketPageResult,
  TicketSupplementDTO,
  TicketTimelineEventDTO,
} from "@/lib/opportunities/api-types";

const MAX_BODY = 2000;
const MAX_LINKS = 5;

const STATUS_LABELS: Record<string, string> = {
  submitted: "已提交",
  reviewing: "核对中",
  need_supplement: "待你补充",
  pending_review: "待复核",
  resolved: "已办结",
  rejected: "未采纳",
  open: "处理中",
};

interface TicketSectionProps<T, D extends { timeline: TicketTimelineEventDTO[]; supplements: TicketSupplementDTO[] }> {
  title: string;
  countUnit: string;
  emptyHint: string;
  /** 分页列表查询；失败由组件统一展示重试入口 */
  list: (page: number, pageSize: number) => Promise<TicketPageResult<T>>;
  /** 详情查询（公开时间线 + 历次补充） */
  detail: (id: string) => Promise<D>;
  /** 在原工单补充（编号与原文不变） */
  supplement: (
    id: string,
    input: { body: string; links: string[]; dedupeKey: string },
  ) => Promise<{ status: string; statusLabel?: string }>;
  itemId: (item: T) => string;
  itemStatus: (item: T) => string;
  renderSummary: (item: T) => React.ReactNode;
  renderDetailHeader: (detail: D) => React.ReactNode;
  renderResolved?: (detail: D) => React.ReactNode;
}

/**
 * 「我的纠错 / 我的公告补录」统一外壳：
 * - 入口固定保留：加载中、空、失败、旧数据、分页都不隐藏；
 * - 失败与空列表明确区分，重试只重新查询；
 * - 原工单补充：编号与原文不变，提交中防重复，失败保留草稿；
 * - 深度链接 /me?ticket=correction:<id> 直接打开对应工单详情。
 */
export function MyTicketSection<T, D extends { timeline: TicketTimelineEventDTO[]; supplements: TicketSupplementDTO[] }>({
  title,
  countUnit,
  emptyHint,
  list,
  detail,
  supplement,
  itemId,
  itemStatus,
  renderSummary,
  renderDetailHeader,
  renderResolved,
}: TicketSectionProps<T, D>) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TicketPageResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const requestSeq = useRef(0);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<D | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailStale, setDetailStale] = useState(false);

  const [draftBody, setDraftBody] = useState("");
  const [draftLinks, setDraftLinks] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshFailedMessage, setRefreshFailedMessage] = useState<string | null>(null);

  const loadList = useCallback(
    async (targetPage: number, options?: { silent?: boolean }): Promise<boolean> => {
      const seq = ++requestSeq.current;
      if (!options?.silent) setLoading(true);
      setError(null);
      setUnauthorized(false);
      try {
        const data = await list(targetPage, 10);
        // 延迟响应不覆盖新请求
        if (seq !== requestSeq.current) return false;
        setResult(data);
        setPage(data.page);
        setLastSuccessAt(new Date().toISOString());
        setRefreshFailed(false);
        setRefreshFailedMessage(null);
        return true;
      } catch (err) {
        if (seq !== requestSeq.current) return false;
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) setUnauthorized(true);
        setError(
          err instanceof Error ? err.message : "查询失败，请稍后重试",
        );
        return false;
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [list],
  );

  useEffect(() => {
    const timer = setTimeout(() => void loadList(1), 0);
    return () => {
      clearTimeout(timer);
      requestSeq.current += 1;
    };
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string, options?: { silent?: boolean }): Promise<boolean> => {
      if (!options?.silent) {
        setDetailLoading(true);
        setDetailData(null);
      }
      setDetailError(null);
      try {
        const data = await detail(id);
        setDetailData(data);
        setDetailStale(false);
        return true;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) setUnauthorized(true);
        setDetailError(
          err instanceof Error ? err.message : "无法加载工单详情，请重试",
        );
        setDetailStale(true);
        return false;
      } finally {
        setDetailLoading(false);
      }
    },
    [detail],
  );

  const openTicket = useCallback(
    (id: string) => {
      setOpenId(id);
      setDraftBody("");
      setDraftLinks("");
      setFormError(null);
      setFormNotice(null);
      setRefreshFailed(false);
      setRefreshFailedMessage(null);
      void loadDetail(id);
    },
    [loadDetail],
  );

  // 站内通知/登录回跳：/me?ticket=correction:<id> 或 ?ticket=announcement_submission:<id>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ticket");
    if (!raw) return;
    const [kind, id] = raw.split(":");
    const expected =
      title.includes("纠错") ? "correction" : "announcement_submission";
    if (!id || kind !== expected) return;
    const timer = setTimeout(() => openTicket(id), 0);
    // 打开后清理查询串，避免刷新反复触发
    window.history.replaceState({}, "", window.location.pathname);
    return () => clearTimeout(timer);
  }, [openTicket, title]);

  const currentStatus = detailData
    ? ((detailData as unknown as { status: string }).status ?? "")
    : "";
  const canSupplement = !!detailData && currentStatus === "need_supplement";
  const supplementRequest =
    (detailData as unknown as { supplementRequest?: string | null })?.supplementRequest ??
    null;

  const submitSupplement = async () => {
    if (!openId || submitting) return;
    const body = draftBody.trim();
    if (body.length < 1 || body.length > MAX_BODY) {
      setFormError(`补充说明需要 1—${MAX_BODY} 字`);
      return;
    }
    const rawLinks = draftLinks
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (rawLinks.length > MAX_LINKS) {
      setFormError(`最多添加 ${MAX_LINKS} 个链接`);
      return;
    }
    for (const link of rawLinks) {
      const check = checkOfficialUrl(link);
      if (!check.ok) {
        setFormError(check.message ?? "链接只支持 http/https 官方地址");
        return;
      }
    }
    setSubmitting(true);
    setFormError(null);
    setFormNotice(null);
    const dedupeKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await supplement(openId, { body, links: rawLinks, dedupeKey });
      // 成功后才清空草稿
      setDraftBody("");
      setDraftLinks("");
      setFormNotice("补充已提交，等待工作人员复核。");
      // 列表刷新失败不能误报提交失败：单独提示并保留旧数据
      const listOk = await loadList(page, { silent: true });
      const detailOk = await loadDetail(openId, { silent: true });
      if (!listOk || !detailOk) {
        setRefreshFailed(true);
        setRefreshFailedMessage("补充已提交，但进度刷新失败，请稍后重试。");
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        setUnauthorized(true);
        setFormError("登录状态已失效，请重新登录后再提交；你的输入已保留。");
      } else if (status === 409) {
        setFormError(
          `工单状态已变化：${err instanceof Error ? err.message : "请刷新后重试"}；你的输入已保留。`
        );
      } else {
        setFormError(
          err instanceof Error
            ? `${err.message}（输入已保留，可重试）`
            : "提交失败，输入已保留，可重试",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const total = result?.total ?? 0;
  const pageCount = result ? Math.max(1, Math.ceil(total / result.pageSize)) : 1;
  const hasStale = !!result && !!error;
  const showList = !!result && result.items.length > 0;

  return (
    <section
      className="rounded-2xl border border-line bg-surface"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {loading && !result
              ? "加载中…"
              : result
                ? `${total} ${countUnit}`
                : "进度查询"}
            {lastSuccessAt && hasStale
              ? ` · 最后成功 ${formatDateTime(lastSuccessAt)}`
              : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadList(page)}
          disabled={loading}
        >
          {loading ? "刷新中…" : "刷新"}
        </Button>
      </div>

      {unauthorized && (
        <div className="mx-4 mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-ink">
          登录状态已失效，请
          <Link
            className="ml-1 font-medium text-brand underline"
            href={`/login?redirect=${encodeURIComponent("/me")}`}
          >
            重新登录
          </Link>
          后继续查看。
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mx-4 mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-ink"
        >
          {hasStale
            ? `${error}（下面保留上次成功加载的记录）`
            : `查询失败：${error}`}
          <button
            type="button"
            className="ml-2 font-medium text-brand underline"
            onClick={() => void loadList(page)}
          >
            重试
          </button>
        </div>
      )}

      {loading && !result && (
        <div className="mx-4 mb-4 h-16 animate-pulse rounded-lg bg-canvas" aria-hidden />
      )}

      {!loading && !error && result && total === 0 && (
        <p className="px-4 pb-4 text-xs text-ink-muted">{emptyHint}</p>
      )}

      {showList && (
        <ul className="space-y-3 px-4 pb-4">
          {result.items.map((item) => {
            const id = itemId(item);
            const status = itemStatus(item);
            return (
              <li key={id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  {renderSummary(item)}
                  <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[11px] text-ink-muted">
                    {STATUS_LABELS[status] ?? status}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-ink-muted">
                    {status === "need_supplement"
                      ? "需要你补充信息：请点开此工单补充，编号与原文不变"
                      : "可展开查看公开处理进度与补充记录"}
                  </p>
                  <button
                    type="button"
                    className="text-xs font-medium text-brand underline"
                    aria-expanded={openId === id}
                    onClick={() => (openId === id ? setOpenId(null) : openTicket(id))}
                  >
                    {openId === id ? "收起" : "查看详情"}
                  </button>
                </div>

                {openId === id && (
                  <div className="mt-3 rounded-lg border border-line bg-canvas/60 p-3">
                    {detailLoading && (
                      <p className="text-xs text-ink-muted">详情加载中…</p>
                    )}
                    {detailError && (
                      <div role="alert" className="text-xs text-ink">
                        详情加载失败：{detailError}
                        {detailStale && "（工单仍可能存在，可重试）"}
                        <button
                          type="button"
                          className="ml-2 font-medium text-brand underline"
                          onClick={() => void loadDetail(id)}
                        >
                          重试
                        </button>
                      </div>
                    )}
                    {detailData && (
                      <>
                        {renderDetailHeader(detailData)}
                        {currentStatus === "resolved" && renderResolved?.(detailData)}
                        {detailData.supplements.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-[11px] font-medium text-ink">补充记录</p>
                            {detailData.supplements.map((sup) => (
                              <div
                                key={sup.id}
                                className="rounded bg-surface px-2 py-1.5 text-xs text-ink whitespace-pre-line break-words"
                              >
                                {sup.body}
                                {sup.links.length > 0 && (
                                  <span className="mt-1 block space-y-0.5">
                                    {sup.links.map((link) => (
                                      <a
                                        key={link}
                                        href={link}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                        className="block truncate text-brand underline"
                                      >
                                        {link}
                                      </a>
                                    ))}
                                  </span>
                                )}
                                <span className="mt-1 block text-[10px] text-ink-muted">
                                  {formatDateTime(sup.createdAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {canSupplement && (
                          <div className="mt-3 rounded-lg border border-brand/30 bg-surface p-3">
                            <p className="text-xs font-medium text-ink">
                              需要你补充信息
                            </p>
                            {supplementRequest && (
                              <p className="mt-1 text-xs text-ink-muted">
                                工作人员需要：{supplementRequest}
                              </p>
                            )}
                            <label htmlFor={`supplement-body-${id}`} className="mt-2 block text-xs text-ink">
                              补充说明（1—{MAX_BODY} 字）
                            </label>
                            <textarea
                              id={`supplement-body-${id}`}
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
                              rows={4}
                              maxLength={MAX_BODY}
                              value={draftBody}
                              onChange={(event) => setDraftBody(event.target.value)}
                              placeholder="例如：毕业证上的完整专业名称为……"
                            />
                            <label htmlFor={`supplement-links-${id}`} className="mt-2 block text-xs text-ink">
                              参考链接（可选，最多 {MAX_LINKS} 个，每行一个 http/https 地址）
                            </label>
                            <textarea
                              id={`supplement-links-${id}`}
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
                              rows={2}
                              value={draftLinks}
                              onChange={(event) => setDraftLinks(event.target.value)}
                            />
                            <p className="mt-1 text-[11px] text-ink-muted">
                              仅保存你提供的链接，不会自动抓取页面。
                            </p>
                            {formError && (
                              <p role="alert" aria-live="polite" className="mt-1 text-xs text-danger">
                                {formError}
                              </p>
                            )}
                            {formNotice && (
                              <p role="status" className="mt-1 text-xs text-success">
                                {formNotice}
                              </p>
                            )}
                            {refreshFailed && refreshFailedMessage && (
                              <p role="status" className="mt-1 text-xs text-warning">
                                {refreshFailedMessage}
                              </p>
                            )}
                            <Button
                              className="mt-2"
                              size="sm"
                              onClick={() => void submitSupplement()}
                              disabled={submitting}
                            >
                              {submitting ? "提交中…" : "提交补充"}
                            </Button>
                          </div>
                        )}

                        {detailData.timeline.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-medium text-ink">公开处理进度</p>
                            <ol className="mt-1 space-y-1">
                              {detailData.timeline.map((event, index) => (
                                <li key={`${event.action}-${event.createdAt}-${index}`} className="text-xs text-ink-muted">
                                  <span className="text-ink">{event.label}</span>
                                  {event.message ? `：${event.message}` : ""}
                                  <span className="ml-1 text-[10px]">
                                    {formatDateTime(event.createdAt)}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {result && pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => void loadList(page - 1)}
          >
            上一页
          </Button>
          <span className="text-xs text-ink-muted">
            第 {page} / {pageCount} 页 · 共 {total} {countUnit}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pageCount || loading}
            onClick={() => void loadList(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
}
