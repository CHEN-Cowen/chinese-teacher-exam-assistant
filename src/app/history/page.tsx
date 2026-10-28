"use client";

/**
 * 往年参考目录（D06 / PRD 11.7 U06）。
 *
 * 不变量：
 * - 只读展示已截止/已撤回的往年公告；无报名、无关注动作，不计入当前可报；
 * - 年份以可靠收录范围开放（years 来自真实数据），无数据时真实空状态，不制造历史资料；
 * - 日期保留公告原文，缺日期显示「待官方通知」，不臆造。
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { Callout } from "@/components/ui/Callout";
import { natureShortLabel, stageLabel } from "@/lib/ia/labels";
import type { HistoryFilters, HistoryListResponse } from "@/lib/opportunities/api-types";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import type { EmploymentNatureCode } from "@/lib/announcements/types";

const NATURE_OPTIONS: { value: EmploymentNatureCode; label: string }[] = [
  { value: "public_institution_staff", label: "事业编" },
  { value: "record_filing", label: "备案制" },
  { value: "post_quota", label: "员额制" },
  { value: "headcount_control", label: "控制数" },
  { value: "other", label: "其他官方用工" },
];

const STAGE_OPTIONS = [
  { value: "primary", label: "小学" },
  { value: "middle", label: "初中" },
  { value: "high", label: "高中" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: HistoryListResponse };

export default function HistoryPage() {
  const online = useOnlineStatus();
  const [year, setYear] = useState<string>("");
  const [regionCode, setRegionCode] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [nature, setNature] = useState<string>("");
  const [educationLevel, setEducationLevel] = useState<string>("");
  const [major, setMajor] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const filters = useMemo<HistoryFilters>(() => {
    const parsedYear = year ? Number(year) : undefined;
    return {
      year: parsedYear,
      regionCode: regionCode || undefined,
      stage: stage || undefined,
      nature: nature || undefined,
      educationLevel:
        (educationLevel as HistoryFilters["educationLevel"]) || undefined,
      major: major || undefined,
      keyword: keyword.trim() || undefined,
      page,
      pageSize: 20,
    };
  }, [year, regionCode, stage, nature, educationLevel, major, keyword, page]);

  useEffect(() => {
    // 筛选/翻页变化时保留旧内容直到新数据就绪，避免整页 Loading 夺走输入焦点
    let cancelled = false;
    opportunitiesApi
      .listHistory(filters)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "加载失败",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadToken]);

  const retry = () => {
    setState({ status: "loading" });
    setReloadToken((value) => value + 1);
  };

  if (state.status === "loading") return <LoadingPage />;
  if (state.status === "error") {
    return (
      <ErrorState
        title={online ? "往年参考暂时加载失败" : "当前离线，无法加载往年参考"}
        description={
          online
            ? `${state.error}。请稍后重试。`
            : "网络已断开。恢复网络后点击重试。"
        }
        onRetry={retry}
      />
    );
  }

  const { data } = state;
  const hasAnyHistory = data.years.length > 0;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-2 sm:px-5">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-ink">往年参考</h1>
        <p className="text-sm leading-6 text-ink-muted">
          这里收录的是往年已截止的招聘公告，帮助你提前了解条件与时间安排。
          <strong className="font-medium text-ink">
            往年已截止，仅供参考；本年度招聘以新公告为准。
          </strong>
          往年记录不进入当前可报名计数，本页也没有报名动作。
        </p>
      </header>

      <Callout variant="ask" title="收录范围">
        {data.sampleNote}
      </Callout>

      {hasAnyHistory && (
        <section
          aria-label="筛选往年公告"
          className="space-y-3 rounded-xl border border-line bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block text-xs text-ink-muted">
              批次年
              <select
                value={year}
                onChange={(event) => {
                  setYear(event.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">全部年份</option>
                {data.years.map((item) => (
                  <option key={item} value={item}>
                    {item} 年
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              地区
              <select
                value={regionCode}
                onChange={(event) => {
                  setRegionCode(event.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">全部地区</option>
                {data.availableRegions.map((region) => (
                  <option key={region.code} value={region.code}>
                    {region.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              学段
              <select
                value={stage}
                onChange={(event) => {
                  setStage(event.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">全部学段</option>
                {STAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              用工性质
              <select
                value={nature}
                onChange={(event) => {
                  setNature(event.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">全部用工性质</option>
                {NATURE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              岗位最低学历
              <select
                value={educationLevel}
                onChange={(event) => {
                  setEducationLevel(event.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">全部学历</option>
                {data.educationLevels.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              专业（公告列明范围）
              <select
                value={major}
                onChange={(event) => {
                  setMajor(event.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">全部专业</option>
                {data.availableMajors.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs text-ink-muted">
            单位或公告关键词
            <input
              type="search"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="如：杭州 / 鄞州 / 语文"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink"
            />
          </label>
        </section>
      )}

      {!hasAnyHistory ? (
        <EmptyState
          title="还没有已收录的往年公告"
          description="往年参考只展示真实收录、带官方依据的已截止公告；未收录不代表当地往年没有招聘。可先查看当年招聘或填写报考信息。"
          actionLabel="查看当年招聘"
          actionHref="/opportunities"
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="当前筛选下没有往年记录"
          description="调整筛选条件试试；样本外的年份或地区不代表当地没有招聘。"
        />
      ) : (
        <>
          <p className="text-xs text-ink-muted" role="status">
            共 {data.total} 个报考单元 · 第 {data.page} / {totalPages} 页
          </p>
          <ul className="space-y-3">
            {data.items.map((item) => (
              <li key={item.unitId}>
                <Link
                  href={`/history/${item.unitId}`}
                  className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {item.unitName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {item.announcement.title}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-line">
                      {item.batchYear !== null ? `${item.batchYear} 年批次` : "批次年待定"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                    <span>
                      {[item.region.province, item.region.city, item.region.district]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                    <span>{stageLabel(item.stage)}</span>
                    <span>{natureShortLabel(item.employmentNature.code as EmploymentNatureCode)}</span>
                    <span>招 {item.headcount} 人</span>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    报名：
                    {item.registrationStart && item.registrationEnd
                      ? `${item.registrationStart.slice(0, 10)} 至 ${item.registrationEnd.slice(0, 10)}`
                      : "时间待官方通知（公告未公布）"}
                  </p>
                  {item.archiveNote && (
                    <p className="mt-1 text-xs text-ink-muted">存档：{item.archiveNote}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="flex items-center justify-between" aria-label="分页">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={data.page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-40"
              >
                下一页
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
