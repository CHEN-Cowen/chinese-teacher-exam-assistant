"use client";

/**
 * 按地区浏览当年公告（B2 省市区级联检索）。
 *
 * 数据源：公开公告摘要 GET /opportunities/public-notices（无需画像，访客可读）。
 * 交互：省 → 市 → 区县 级联选择 + 关键词过滤，选完直接出该地区公告列表。
 *
 * 过滤口径：
 * - 省 = region.province 精确匹配；市 = region.city 精确匹配；
 * - 区县 = region.district 精确匹配，同时保留该市的市级公告
 *   （district 为空的公告覆盖全市，视为也属于该区县）；
 * - 报名状态以 checkedAt 为基准计算（与后端口径一致）。
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingPage } from "@/components/ui/Loading";
import { stageLabel, subjectLabel } from "@/lib/ia/labels";
import type { PublicNoticeDTO } from "@/lib/opportunities/api-types";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: PublicNoticeDTO[] };

/** 报名状态：以 checkedAt 为基准（demo 模式为种子快照时点） */
function registrationStatus(notice: PublicNoticeDTO): {
  label: string;
  variant: "success" | "warning" | "info" | "muted";
} {
  const now = Date.parse(notice.checkedAt);
  const start = Date.parse(notice.registrationStart ?? "");
  const end = Date.parse(notice.registrationEnd ?? "");
  if (!Number.isNaN(end) && end <= now) {
    return { label: "已截止", variant: "muted" };
  }
  if (!Number.isNaN(start) && start > now) {
    return { label: "未开始", variant: "info" };
  }
  if (Number.isNaN(start) || Number.isNaN(end) || !(start <= now && end > now)) {
    return { label: "报名时间待核对", variant: "muted" };
  }
  return end - now <= 3 * 86400000
    ? { label: "即将截止", variant: "warning" }
    : { label: "报名中", variant: "success" };
}

function regionText(notice: PublicNoticeDTO): string {
  return [
    notice.region.province,
    notice.region.city,
    notice.region.district,
  ]
    .filter(Boolean)
    .join(" ");
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN"),
  );
}

export function RegionNoticeBrowser() {
  const online = useOnlineStatus();
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [keyword, setKeyword] = useState("");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    opportunitiesApi
      .listPublicNotices()
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
  }, [reloadToken]);

  const notices = useMemo(
    () => (state.status === "ready" ? state.data : []),
    [state],
  );

  const provinces = useMemo(
    () => dedupeSorted(notices.map((notice) => notice.region.province)),
    [notices],
  );
  const cities = useMemo(
    () =>
      dedupeSorted(
        notices
          .filter((notice) => !province || notice.region.province === province)
          .map((notice) => notice.region.city ?? ""),
      ),
    [notices, province],
  );
  const districts = useMemo(
    () =>
      dedupeSorted(
        notices
          .filter(
            (notice) =>
              (!province || notice.region.province === province) &&
              (!city || notice.region.city === city),
          )
          .map((notice) => notice.region.district ?? ""),
      ),
    [notices, province, city],
  );

  const visible = useMemo(() => {
    const kw = keyword.trim();
    return notices.filter((notice) => {
      if (province && notice.region.province !== province) return false;
      if (city && notice.region.city !== city) return false;
      if (
        district &&
        notice.region.district !== district &&
        !(notice.region.city === city && !notice.region.district)
      ) {
        return false;
      }
      if (
        kw &&
        !notice.title.includes(kw) &&
        !notice.publisher.includes(kw)
      ) {
        return false;
      }
      return true;
    });
  }, [notices, province, city, district, keyword]);

  if (state.status === "loading") return <LoadingPage />;
  if (state.status === "error") {
    return (
      <ErrorState
        title={online ? "公告暂时加载失败" : "当前离线，无法加载公告列表"}
        description={
          online
            ? `${state.error}。请稍后重试。`
            : "网络已断开。恢复网络后点击重试。"
        }
        onRetry={() => {
          setState({ status: "loading" });
          setReloadToken((value) => value + 1);
        }}
      />
    );
  }

  const hasAnyNotice = notices.length > 0;
  const selectClass =
    "mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm text-ink";

  return (
    <div className="space-y-5 pb-2">
      <section
        aria-label="按地区筛选公告"
        className="space-y-3 rounded-xl border border-line bg-surface p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs text-ink-muted">
            省份
            <select
              value={province}
              data-testid="region-province-select"
              onChange={(event) => {
                setProvince(event.target.value);
                setCity("");
                setDistrict("");
              }}
              className={selectClass}
            >
              <option value="">全部省份</option>
              {provinces.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-ink-muted">
            城市
            <select
              value={city}
              data-testid="region-city-select"
              onChange={(event) => {
                setCity(event.target.value);
                setDistrict("");
              }}
              className={selectClass}
            >
              <option value="">全部城市</option>
              {cities.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-ink-muted">
            区县
            <select
              value={district}
              data-testid="region-district-select"
              onChange={(event) => setDistrict(event.target.value)}
              className={selectClass}
            >
              <option value="">全部区县</option>
              {districts.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-xs text-ink-muted">
          公告或发布单位关键词
          <input
            type="search"
            value={keyword}
            data-testid="region-keyword"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="如：杭州 / 教育局"
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
        </label>
      </section>

      {!hasAnyNotice ? (
        <EmptyState
          title="还没有已收录的当年公告"
          description="公告只展示真实收录、带官方依据的当年发布记录；未收录不代表当地没有招聘。可先填写报考信息查看匹配结果。"
          actionLabel="填写报考信息"
          actionHref="/onboarding?from=opportunities"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="当前筛选下没有公告"
          description="换一个地区或关键词试试；未列出的地区不代表当地没有招聘。"
        />
      ) : (
        <>
          <p className="text-xs text-ink-muted" role="status">
            共 {visible.length} 条公告
          </p>
          <ul className="space-y-3" aria-label="按地区浏览的公告列表">
            {visible.map((notice) => {
              const status = registrationStatus(notice);
              return (
                <li key={notice.id}>
                  <article
                    data-testid="region-notice-card"
                    className="rounded-xl border border-line bg-surface p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <a
                        href={notice.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 text-sm font-semibold text-ink hover:text-brand"
                      >
                        {notice.title}
                      </a>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {notice.publisher} · {regionText(notice)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      {notice.subjects.slice(0, 4).map((code) => (
                        <span key={code}>{subjectLabel(code)}</span>
                      ))}
                      {notice.stages.slice(0, 4).map((code) => (
                        <span key={code}>{stageLabel(code)}</span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">
                      报名：
                      {notice.registrationStart && notice.registrationEnd
                        ? `${notice.registrationStart.slice(0, 10)} 至 ${notice.registrationEnd.slice(0, 10)}`
                        : "时间待官方通知（公告未公布）"}
                    </p>
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
