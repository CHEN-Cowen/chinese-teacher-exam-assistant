"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingPage } from "@/components/ui/Loading";
import { Button } from "@/components/ui/Button";
import {
  TRIAL_COHORT_LABELS,
  trialApi,
  type SupplySnapshot,
  type TrialCohortKey,
  type TrialCohortReport,
  type TrialDashboardResponse,
  type TrialMetric,
} from "@/lib/analytics/trialApi";
import { TRIAL_METRIC_DICTIONARY } from "@/lib/analytics/dictionary";

/**
 * 受邀试用看板（v7.0 模块 7）。
 *
 * - 唯一数据源：服务端 trial_events（/api/trial/dashboard，AdminGuard）；
 *   与 /admin 首页基于 localStorage Mock 的「后台概览」完全无关；
 * - 四层分群隔离展示：受邀真实（主列）/ 受邀员工 / 演示环境 / 演示种子，绝不混算；
 * - 指标口径以 TRIAL_METRIC_DICTIONARY 为准；分母为 0 显示「—」，绝不显示 0%；
 * - 本页不作为「已上线」依据：发布前检查表存在缺项时停止邀请。
 */

const COHORT_ORDER: TrialCohortKey[] = ["invited", "invited_staff", "demo", "seed"];

function pct(m: TrialMetric): string {
  return m.rate === null ? "—" : `${Math.round(m.rate * 100)}%`;
}

function fmtRate(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function MetricRow({
  label,
  metric,
  hint,
  strong = false,
}: {
  label: string;
  metric: TrialMetric;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
        strong ? "bg-blue-50/60" : ""
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>
          {label}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`text-sm font-semibold tabular-nums ${
            metric.rate === null ? "text-slate-400" : "text-slate-900"
          }`}
        >
          {pct(metric)}
        </p>
        <p className="text-[11px] text-slate-400 tabular-nums">
          {metric.numerator} / {metric.denominator} 人
        </p>
      </div>
    </div>
  );
}

function CohortReport({ report }: { report: TrialCohortReport }) {
  if (report.users === 0) {
    return (
      <EmptyState
        title="该分群暂无服务端事件（空样本）"
        description="分母为 0 时所有比率显示「—」而不是 0%。等待真实使用数据，或用下方按钮灌入演示种子（只进 seed 分群，绝不混入受邀指标）。"
      />
    );
  }
  return (
    <div className="space-y-4">
      {/* 北极星 */}
      <Card>
        <CardHeader
          title="北极星 · 7 日有效目标推进率（north_star_progress_7d）"
          description="分母 = 获得真实有效机会且满 7 日观察期的去重用户；分子 = 其中 7 日内关注并完成有效推进动作的人数"
        />
        <div className="flex items-end gap-6 px-4 pb-4">
          <div>
            <p
              className={`text-4xl font-bold tabular-nums ${
                report.northStar.rate === null ? "text-slate-300" : "text-blue-700"
              }`}
            >
              {fmtRate(report.northStar.rate)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {report.northStar.numerator} / {report.northStar.denominator} 人（满观察期）
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <p className="text-lg font-semibold tabular-nums text-amber-700">
              {report.northStar.observing}
            </p>
            <p className="text-[11px] text-amber-700">未满 7 日 · 观察中（不计入分母）</p>
          </div>
        </div>
      </Card>

      {/* 漏斗单列指标 */}
      <Card>
        <CardHeader title="受邀试用漏斗（单列指标）" description="口径见下方指标字典；每行分子/分母均为去重人数" />
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          <MetricRow label="有效机会获得率" metric={report.opportunityRate} strong />
          <div className="px-4 pt-3">
            <p className="text-xs font-medium text-slate-500">画像各步（以第 1 步完成人数为基准）</p>
          </div>
          {report.profileSteps.map((s) => (
            <MetricRow
              key={s.step}
              label={s.label}
              metric={{ numerator: s.users, denominator: report.profileSteps[0].users, rate: s.rateFromFirst }}
            />
          ))}
          <MetricRow label="依据理解（查看匹配依据）" metric={report.matchBasis} />
          <MetricRow label="关注机会" metric={report.follow} />
          <MetricRow label="补信息导致结论变化" metric={report.conclusionChanged} />
          <MetricRow label="材料完成（任一报名材料置为完成）" metric={report.materialsDone} />
          <MetricRow label="准备报名" metric={report.preparing} />
          <MetricRow label="进入官方报名入口" metric={report.registerEntry} />
          <MetricRow label="已报名" metric={report.registered} />
          <MetricRow label="主要目标" metric={report.primaryTarget} />
        </div>
      </Card>

      {/* v7.1 M9 首次体验与行为指标：回答 7 个核心问题 */}
      <Card>
        <CardHeader
          title="首次体验与行为（M9）"
          description="首页理解 / 无结果原因 / 订阅 / 地图 / 日程同步与冲突；10 人样本展示人数与次数，不伪装成稳定总体比例"
        />
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          <MetricRow
            label="首页是否理解（主按钮点击 ÷ 画像首步到达）"
            metric={report.homeUnderstanding}
            hint="近似：到达首页的用户中点击了唯一开始按钮的比例"
          />
          {/* 无结果原因分布：展示次数而非比例 */}
          <div className="px-4 py-2.5">
            <p className="text-sm text-slate-700">无结果原因曝光（按 reasonCode 分组计数）</p>
            <p className="mt-0.5 text-[11px] text-slate-400">10 人样本展示具体次数，不折算为比例</p>
            {report.noResultReasons.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-400">暂无无结果曝光事件</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {report.noResultReasons.map((r) => (
                  <li key={r.reasonCode} className="text-xs tabular-nums text-slate-600">
                    {r.reasonCode} · <span className="font-semibold">{r.count}</span> 次
                  </li>
                ))}
              </ul>
            )}
          </div>
          <MetricRow
            label="订阅使用（创建订阅 ÷ 获得有效机会）"
            metric={report.subscriptionUsage}
            hint={`关闭订阅 ${report.subscriptionClosedCount} 人`}
          />
          <MetricRow
            label="地图使用（地图入口点击 ÷ 查看匹配依据）"
            metric={report.mapUsage}
            hint="地图入口点击前零地图请求，不内嵌 SDK"
          />
          {/* 日程同步健康度 */}
          <div className="px-4 py-2.5">
            <p className="text-sm text-slate-700">日程自动同步健康度</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              成功 {report.scheduleSyncHealth.success} / 失败 {report.scheduleSyncHealth.failure}
              {report.scheduleSyncHealth.rate !== null
                ? ` · 成功率 ${Math.round(report.scheduleSyncHealth.rate * 100)}%`
                : " · —"}
            </p>
            {report.scheduleSyncHealth.failureReasons.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {report.scheduleSyncHealth.failureReasons.map((r) => (
                  <li key={r.reasonCode} className="text-[11px] tabular-nums text-red-600">
                    {r.reasonCode} · {r.count} 次
                  </li>
                ))}
              </ul>
            )}
          </div>
          <MetricRow
            label="时间冲突曝光率（看到冲突提醒 ÷ 关注用户）"
            metric={report.scheduleConflictRate}
            hint="冲突来自多岗位报考日程时间重叠"
          />
        </div>
      </Card>

      {/* 机会数据集分列 */}
      <Card>
        <CardHeader title="机会数据集分列" description="按服务端目录解析的机会归属分列，演示机会不冒充真实机会" />
        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          {(
            [
              ["真实监测台账（real）", report.datasetSplit.real],
              ["演示台账（demo）", report.datasetSplit.demo],
              ["与机会无关事件", report.datasetSplit.unknown],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-lg font-semibold tabular-nums text-slate-900">{count}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const COVERAGE_STATUS_LABELS: Record<SupplySnapshot["coverage"]["status"], string> = {
  monitoring_no_open: "监测中 · 当前无在报批次",
  open_batch_exists: "监测中 · 存在在报批次",
  paused: "监测暂停",
};

/**
 * 机会供给卡片（模块 8）：市场侧存量，来自人工巡检登记与真实公告台账，
 * 不是用户行为事件；演示台账岗位永远不计入。
 */
function SupplyCard({ supply }: { supply: SupplySnapshot }) {
  const { coverage, announcements: a, units, crossCheck } = supply;
  return (
    <Card>
      <CardHeader
        title="机会供给（真实监测台账）"
        description="市场侧存量：人工巡检 + 官方公告台账计算，非用户行为事件；每日台账的供给行从此抄录"
      />
      <div className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-3xl font-bold tabular-nums text-slate-900">
              {coverage.openOpportunityCount}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              当前在报{coverage.subjectLabel}岗位（人工巡检登记 · 报考单元口径）
            </p>
          </div>
          <Badge variant={coverage.status === "paused" ? "warning" : "info"}>
            {COVERAGE_STATUS_LABELS[coverage.status]}
          </Badge>
          <p className="text-[11px] text-slate-400">
            监测 {coverage.monitoredRegions} 地区 / {coverage.monitoredSources} 个官方栏目
            {coverage.sourcesUnhealthy > 0 && (
              <span className="ml-1 text-red-600">（{coverage.sourcesUnhealthy} 个来源失效）</span>
            )}
            ，最近核对 {new Date(coverage.lastCheckedAt).toLocaleString("zh-CN", { hour12: false })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(
            [
              ["在报公告", a.open],
              ["预告 · 待官方通知", a.preview],
              ["已截止", a.closed],
              ["已取消", a.withdrawn],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-lg font-semibold tabular-nums text-slate-900">{count}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
          <span>
            岗位单元合计 <span className="font-semibold tabular-nums">{units.total}</span>（在报{" "}
            <span className="font-semibold tabular-nums">{units.open}</span>，各公告取最新版本）
          </span>
          <span>
            人工复核 <span className="font-semibold tabular-nums">{a.review.humanReviewed}</span> /
            待复核 <span className="font-semibold tabular-nums">{a.review.pending}</span>
          </span>
          {a.sourceFailed > 0 && (
            <span className="text-red-600">
              来源失效公告 <span className="font-semibold tabular-nums">{a.sourceFailed}</span>
            </span>
          )}
        </div>

        {crossCheck.consistent ? (
          <p className="text-[11px] text-slate-400">
            交叉核对一致：人工巡检登记 {crossCheck.manualOpenCount} = 按公告报名时间计算{" "}
            {crossCheck.computedOpenUnits}
          </p>
        ) : (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            交叉核对不一致：人工巡检登记 {crossCheck.manualOpenCount} ≠ 按公告报名时间计算{" "}
            {crossCheck.computedOpenUnits}
            。可能是巡检未更新或延期/取消公告未录入，必须人工排查后才能把供给数写入每日台账，
            不得静默取其一。
          </p>
        )}
      </div>
    </Card>
  );
}

export default function TrialDashboardPage() {
  const [data, setData] = useState<TrialDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cohort, setCohort] = useState<TrialCohortKey>("invited");
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await trialApi.getDashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : "看板加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初次加载：setState 只在异步回调中，避免 effect 内同步 setState（react-hooks 规则）
  useEffect(() => {
    let cancelled = false;
    trialApi
      .getDashboard()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "看板加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSeed = async () => {
    setSeedBusy(true);
    setSeedNotice(null);
    try {
      const result = await trialApi.seed();
      setSeedNotice(result.seeded ? "演示种子已灌入（seed 分群）" : "演示种子已存在，未重复灌入");
      await load();
    } catch (e) {
      setSeedNotice(e instanceof Error ? e.message : "灌入失败");
    } finally {
      setSeedBusy(false);
    }
  };

  if (loading && !data) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">受邀试用看板</h1>
          <p className="mt-1 text-xs text-slate-500">
            数据源：服务端 trial_events 事件（近 90 天）。seed/live、员工/真实、演示/受邀分群隔离；
            事件不含资格原文或证件信息。
            {data && (
              <span className="ml-1">
                生成于 {new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleSeed()} disabled={seedBusy}>
            {seedBusy ? "灌入中…" : "灌入演示种子（seed）"}
          </Button>
        </div>
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
        受邀试用数据看板仅用于受邀试用评估，不写「已上线」：真实受邀地址、账号权限、
        普通国内网络可达、岗位复核人与纠错处理人等发布前检查项全部通过后才能开始邀请；
        存在缺项即停止邀请（见《模块 7 · 受邀试用发布前检查表》）。
      </p>

      {seedNotice && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {seedNotice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => void load()} className="ml-2 underline underline-offset-2">
            重试
          </button>
        </p>
      )}

      {/* 机会供给：市场侧存量（全局，不随分群切换） */}
      {data && <SupplyCard supply={data.supply} />}

      {/* 分群切换 */}
      <div className="inline-flex p-1 bg-slate-100 rounded-lg" role="group" aria-label="看板分群">
        {COHORT_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setCohort(key)}
            aria-pressed={cohort === key}
            className={
              cohort === key
                ? "px-3 py-1.5 text-sm font-medium rounded-md bg-white text-slate-900 shadow-sm"
                : "px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-md"
            }
          >
            {TRIAL_COHORT_LABELS[key]}
          </button>
        ))}
      </div>

      {data && (
        <>
          {/* 分群概览条：users + 北极星，一眼对比，指标细节看选中分群 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {COHORT_ORDER.map((key) => {
              const r = data.cohorts[key];
              const active = key === cohort;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCohort(key)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    active ? "border-blue-400 bg-blue-50/60" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <p className="text-[11px] text-slate-500">{TRIAL_COHORT_LABELS[key]}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
                    {r.users} 人 · 北极星 {fmtRate(r.northStar.rate)}
                  </p>
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {r.northStar.numerator}/{r.northStar.denominator} 满观察期 · {r.northStar.observing} 观察中
                  </p>
                </button>
              );
            })}
          </div>

          <CohortReport report={data.cohorts[cohort]} />
        </>
      )}

      {/* 指标字典 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">受邀试用指标字典</h2>
          <Badge variant="info">模块 7</Badge>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">指标</th>
                <th className="px-4 py-2 font-medium">口径</th>
                <th className="px-4 py-2 font-medium">数据来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {TRIAL_METRIC_DICTIONARY.map((m) => (
                <tr key={m.key}>
                  <td className="px-4 py-2.5 align-top">
                    <p className="font-medium text-slate-900">{m.label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{m.key}</p>
                  </td>
                  <td className="max-w-md px-4 py-2.5 align-top text-xs leading-relaxed text-slate-600">
                    {m.formula}
                  </td>
                  <td className="max-w-xs px-4 py-2.5 align-top text-xs leading-relaxed text-slate-500">
                    {m.dataSource}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          事件字典见{" "}
          <Link href="/admin" className="underline underline-offset-2 hover:text-slate-600">
            后台概览 · 指标与事件字典
          </Link>
          （profile_step_completed / opportunity_unfollowed / material_status_changed /
          register_entry_opened 已登记）。
        </p>
      </section>
    </div>
  );
}
