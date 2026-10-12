"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Progress } from "@/components/ui/Progress";
import { useDashboardMetrics } from "@/lib/analytics/useMetrics";
import { clearAllEvents, reseedEvents } from "@/lib/analytics/eventService";
import {
  AnalyticsModule,
  AnomalySeverity,
  MetricValue,
  MetricsRangeKey,
} from "@/lib/analytics/types";
import type { DashboardMetrics } from "@/lib/analytics/metrics/domain";
import { REVIEW_SLA_HOURS } from "@/lib/analytics/metrics/domain";

// ==================== 展示辅助 ====================

const RANGE_OPTIONS: { key: MetricsRangeKey; label: string }[] = [
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
];

export const MODULE_LABELS: Record<AnalyticsModule, string> = {
  profile: "基础画像",
  opportunity: "机会匹配",
  target: "目标",
  evidence: "考情证据",
  review: "人工审核",
  material: "资料分析",
  resource: "资源",
  plan: "计划",
  feedback: "任务反馈",
  replan: "调整复盘",
  correction: "纠错治理",
  privacy: "隐私删除",
  storage: "存储层",
  home: "首页",
  learn: "30 秒说明",
  schedule: "日程",
  subscription: "订阅",
  notification: "通知",
};

function pct(m: MetricValue): string {
  return m.rate === null ? "—" : `${Math.round(m.rate * 100)}%`;
}

function fmtMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

const SEVERITY_STYLE: Record<AnomalySeverity, { bar: string; text: string; label: string }> = {
  high: { bar: "bg-red-500", text: "text-red-700", label: "高" },
  medium: { bar: "bg-amber-500", text: "text-amber-700", label: "中" },
  low: { bar: "bg-slate-400", text: "text-slate-600", label: "低" },
};

// ==================== 时间范围切换 ====================

function RangeSelector({
  value,
  onChange,
}: {
  value: MetricsRangeKey;
  onChange: (key: MetricsRangeKey) => void;
}) {
  return (
    <div className="inline-flex p-1 bg-slate-100 rounded-lg" role="group" aria-label="指标时间范围">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={
            value === opt.key
              ? "px-4 py-1.5 text-sm font-medium rounded-md bg-white text-slate-900 shadow-sm"
              : "px-4 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-md"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ==================== 指标卡 ====================

type MetricTone = "default" | "success" | "warning" | "danger";

function MetricCard({
  label,
  value,
  sub,
  tone = "default",
  realtime = false,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  tone?: MetricTone;
  /** 实时存量指标（不随时间范围变化） */
  realtime?: boolean;
  children?: React.ReactNode;
}) {
  const valueColor =
    tone === "danger"
      ? "text-red-600"
      : tone === "warning"
        ? "text-amber-600"
        : tone === "success"
          ? "text-emerald-600"
          : "text-slate-900";
  return (
    <Card padding="sm" className="h-full">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-slate-500 leading-5">{label}</p>
        {realtime ? (
          <Badge variant="info" className="shrink-0">
            实时
          </Badge>
        ) : null}
      </div>
      {value !== undefined && (
        <p className={`mt-1.5 text-2xl font-bold tracking-tight ${valueColor}`}>{value}</p>
      )}
      {children}
      {sub && <p className="mt-1 text-[11px] text-slate-400 leading-4">{sub}</p>}
    </Card>
  );
}

function MiniRate({ label, value, fraction }: { label: string; value: string; fraction: string }) {
  return (
    <div className="mt-1.5 flex items-baseline justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800">
        {value}
        <span className="ml-1 text-[10px] font-normal text-slate-400">{fraction}</span>
      </span>
    </div>
  );
}

// ==================== 区块 ====================

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
    </div>
  );
}

function FunnelPanel({ m }: { m: DashboardMetrics }) {
  const first = m.userValue.funnel[0]?.users ?? 0;
  return (
    <Card>
      <CardHeader
        title="用户闭环漏斗"
        description="创建目标 → 查看证据卡 → 确认首版计划 → 提交执行反馈 → 完成周复盘；按去重账号统计"
      />
      <div className="space-y-3">
        {m.userValue.funnel.map((stage) => {
          const width = first > 0 ? Math.max(4, Math.round((stage.users / first) * 100)) : 0;
          return (
            <div key={stage.key}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-700">{stage.label}</span>
                <span className="text-slate-500">
                  <span className="font-semibold text-slate-900">{stage.users}</span> 人
                  <span className="ml-2 text-xs text-slate-400">
                    {stage.rateFromFirst === null
                      ? "—"
                      : `${Math.round(stage.rateFromFirst * 100)}%`}
                  </span>
                </span>
              </div>
              <Progress value={width} size="sm" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const ACTION_TONE: Record<string, "danger" | "warning" | "info"> = {
  danger: "danger",
  warning: "warning",
  info: "info",
};

function PendingActionsPanel({ m }: { m: DashboardMetrics }) {
  return (
    <Card>
      <CardHeader title="待处理事项" description="按当前实时存量生成，点击直达对应后台队列" />
      {m.pendingActions.length === 0 ? (
        <p className="text-sm text-slate-500 py-4 text-center">🎉 暂无待处理事项</p>
      ) : (
        <ul className="space-y-2">
          {m.pendingActions.map((a) => (
            <li key={a.key}>
              <Link
                href={a.href}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <Badge variant={ACTION_TONE[a.tone]}>{a.count}</Badge>
                  {a.label}
                </span>
                <span className="text-xs text-blue-600 shrink-0">去处理 →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BacklogPanel({ m }: { m: DashboardMetrics }) {
  return (
    <Card>
      <CardHeader
        title="审核积压提醒"
        description={`高影响事实 SLA 为 ${REVIEW_SLA_HOURS} 小时；括号内为高影响字段数`}
        action={
          <Link href="/admin/reviews?queue=pending" className="text-xs text-blue-600 hover:underline">
            审核队列 →
          </Link>
        }
      />
      <ul className="space-y-2">
        {m.backlog.map((b) => {
          const danger = b.label.includes("48");
          return (
            <li
              key={b.label}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                danger && b.count > 0
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-slate-50 text-slate-700"
              }`}
            >
              <span>{b.label}</span>
              <span className="font-semibold">
                {b.count}
                <span className="ml-1 text-xs font-normal opacity-70">（高影响 {b.highImpact}）</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        待审核合计 {m.stock.pendingTotal} 条 · 高影响 {m.stock.pendingHighImpact} 条 · 已超时{" "}
        {m.stock.overdueHighImpact} 条
      </p>
    </Card>
  );
}

function ResourceAlertPanel({ m }: { m: DashboardMetrics }) {
  const s = m.stock;
  return (
    <Card>
      <CardHeader
        title="资源失效提醒"
        description="坏链/过期资源与超 180 天未复核资源（不含已停用）"
        action={
          <Link href="/admin/resources?queue=expired" className="text-xs text-blue-600 hover:underline">
            资源管理 →
          </Link>
        }
      />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-red-50 border border-red-100 py-3">
          <p className={`text-xl font-bold ${s.deadResources > 0 ? "text-red-600" : "text-slate-900"}`}>
            {s.deadResources}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">失效/坏链</p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-100 py-3">
          <p className={`text-xl font-bold ${s.staleResources > 0 ? "text-amber-600" : "text-slate-900"}`}>
            {s.staleResources}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">超期未复核</p>
        </div>
        <div className="rounded-lg bg-slate-50 py-3">
          <p className="text-xl font-bold text-slate-900">{s.pendingResources}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">待复核</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        资源链接失效率：{pct(s.resourceDeadRate)}（{s.deadResources}/{s.resourceTotal}）
      </p>
    </Card>
  );
}

function AnomalyPanel({ m }: { m: DashboardMetrics }) {
  return (
    <Card>
      <CardHeader
        title="最近异常"
        description="AI 任务失败 · 审核超时 · 资源失效 · 计划生成失败 · 反馈保存失败 · 关键写入失败（最多 15 条）"
      />
      {m.anomalies.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">所选范围内没有异常记录</p>
      ) : (
        <ul className="space-y-2">
          {m.anomalies.map((a) => {
            const sev = SEVERITY_STYLE[a.severity];
            return (
              <li
                key={a.id}
                className="flex items-stretch gap-3 rounded-lg border border-slate-200 overflow-hidden"
              >
                <span className={`w-1 shrink-0 ${sev.bar}`} aria-hidden />
                <div className="flex-1 min-w-0 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-medium ${sev.text}`}>{a.title}</span>
                    <Badge variant="muted">{MODULE_LABELS[a.module]}</Badge>
                    <Badge variant="muted" aria-label={`严重度${sev.label}`}>
                      {sev.label}
                    </Badge>
                    {a.source === "seed" ? (
                      <Badge variant="warning">演示种子</Badge>
                    ) : (
                      <Badge variant="primary">真实检出</Badge>
                    )}
                  </div>
                  {a.detail && (
                    <p className="mt-1 text-xs text-slate-500 break-all">{a.detail}</p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">{fmtDateTime(a.at)}</p>
                </div>
                {a.href && (
                  <Link
                    href={a.href}
                    className="shrink-0 self-center px-3 text-xs text-blue-600 hover:underline"
                  >
                    定位 →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ==================== 主组件 ====================

export function AdminOverview() {
  const [range, setRange] = useState<MetricsRangeKey>("7d");
  const m = useDashboardMetrics(range);

  if (!m) {
    return <Card>指标计算中…</Card>;
  }

  const uv = m.userValue;
  const q = m.quality;
  const s = m.stock;
  const rangeLabel = RANGE_OPTIONS.find((r) => r.key === range)?.label ?? "";
  const hasEvents = q.liveEventCount + q.seedEventCount > 0;

  return (
    <div className="space-y-6">
      {/* 标题 + 范围筛选 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">数据指标与异常监控</h1>
          <p className="text-sm text-slate-500 mt-1">
            统一口径计算 · 事件型指标随时间范围变化，存量指标为实时值
            {m.fromIso && `（自 ${fmtDateTime(m.fromIso)} 起）`}
          </p>
        </div>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      {/* 数据来源声明 */}
      <div className="p-3.5 rounded-xl bg-slate-900 text-slate-200 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
        <span>
          数据来源：
          <span className="font-semibold text-white">{q.liveEventCount}</span> 条本浏览器真实操作事件（live）
        </span>
        <span>
          <span className="font-semibold text-white">{q.seedEventCount}</span> 条演示种子事件（seed，10 个模拟用户）
        </span>
        <span className="text-slate-400">事件不含公告正文、反馈备注、纠错描述与链接 URL</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={clearAllEvents}
            className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
            title="只清空分析事件流（不动业务数据），用于演示空状态"
          >
            演示空态
          </button>
          <button
            type="button"
            onClick={reseedEvents}
            className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
            title="重新生成 10 个模拟用户的演示种子事件"
          >
            重播演示种子
          </button>
        </span>
      </div>

      {!hasEvents && (
        <EmptyState
          icon={<span className="text-4xl">📭</span>}
          title={`${rangeLabel}范围内暂无分析事件`}
          description="切换到“全部”可查看演示种子数据；真实操作（创建目标、确认计划、提交反馈等）会自动计入。"
        />
      )}

      {/* —— 用户价值指标 —— */}
      <section>
        <SectionTitle
          title="用户价值指标"
          desc={`${rangeLabel} · 判断核心闭环是否成立（按去重账号）`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="首次填写完成率"
            value={pct(uv.firstFill)}
            sub={`${uv.readyCreators}/${uv.targetCreators} 人达到计划门禁`}
          />
          <MetricCard
            label="证据卡查看率"
            value={pct(uv.evidenceViewRate)}
            sub={`${uv.evidenceViewers}/${uv.targetCreators} 人查看过`}
          />
          <MetricCard
            label="计划确认率（首版）"
            value={pct(uv.planConfirmRate)}
            sub={`${uv.planConfirmedUsers}/${uv.targetCreators} 人确认`}
          />
          <MetricCard label="第 1 / 4 / 7 天反馈完成率">
            {uv.dayRates.map((d) => (
              <MiniRate
                key={d.day}
                label={`第 ${d.day} 天`}
                value={d.rate === null ? "—" : `${Math.round(d.rate * 100)}%`}
                fraction={`${d.submitted}/${d.eligible} 个计划`}
              />
            ))}
          </MetricCard>
          <MetricCard
            label="7 天内完成核心任务的平均天数"
            value={uv.avgCoreCompletedDays === null ? "—" : uv.avgCoreCompletedDays.toFixed(1)}
            sub={`基于 ${uv.coreDayPlans} 个有反馈的计划`}
          />
          <MetricCard
            label="中断后重新开始率"
            value={pct(uv.restartRate)}
            sub={`${uv.restartedUsers}/${uv.interruptedUsers} 人中断后恢复`}
          />
          <MetricCard label="资源 查看 → 加入 → 使用 转化">
            <MiniRate
              label="查看资源人数"
              value={`${uv.resourceViewers}`}
              fraction="去重"
            />
            <MiniRate
              label="加入计划率"
              value={pct(uv.resourceAddRate)}
              fraction={`${uv.resourceAdders}/${uv.resourceViewers}`}
            />
            <MiniRate
              label="实际使用率"
              value={pct(uv.resourceUseRate)}
              fraction={`${uv.resourceUsers}/${uv.resourceAdders}`}
            />
          </MetricCard>
          <MetricCard
            label="完整闭环用户数"
            value={`${uv.closedLoopUsers}`}
            sub={`占创建用户 ${pct(uv.closedLoopRate)}（确认计划+反馈+周复盘）`}
            tone="success"
          />
        </div>
      </section>

      {/* —— 质量与运营指标 —— */}
      <section>
        <SectionTitle
          title="质量与运营指标"
          desc={`${rangeLabel}事件型指标 + 实时存量（标“实时”的卡片不随时间范围变化）`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="高影响事实待审核"
            value={`${s.pendingHighImpact}`}
            sub={`全部待审核 ${s.pendingTotal} · 已超时 ${s.overdueHighImpact}`}
            tone={s.overdueHighImpact > 0 ? "danger" : s.pendingHighImpact > 0 ? "warning" : "default"}
            realtime
          />
          <MetricCard
            label="审核平均处理时间"
            value={fmtMinutes(q.reviewAvgMinutes)}
            sub={`基于 ${q.reviewCount} 次审核动作`}
          />
          <MetricCard
            label="AI 提取人工修正率"
            value={pct(q.aiEditRate)}
            sub={`${q.reviewEdited} 次修改后通过`}
          />
          <MetricCard
            label="用户纠错数量"
            value={`${q.correctionCount}`}
            sub={`当前待处理 ${s.openCorrections} 条`}
          />
          <MetricCard
            label="错误结论撤回数量"
            value={`${q.retractionCount}`}
            sub={`影响 ${q.affectedUsers} 个去重用户`}
          />
          <MetricCard label="受影响用户数量" value={`${q.affectedUsers}`} sub="撤回记录 impact 去重并集" />
          <MetricCard
            label="资源链接失效率"
            value={pct(s.resourceDeadRate)}
            sub={`失效 ${s.deadResources}/${s.resourceTotal} · 超期未复核 ${s.staleResources}`}
            tone={s.deadResources > 0 ? "danger" : "default"}
            realtime
          />
          <MetricCard
            label="计划生成失败率"
            value={pct(q.planFailRate)}
            sub={`${q.planFailures} 次失败（数据不足拦截不计）`}
            tone={q.planFailures > 0 ? "warning" : "default"}
          />
          <MetricCard
            label="反馈提交失败率"
            value={pct(q.feedbackFailRate)}
            sub={`${q.feedbackFailures} 次保存失败`}
            tone={q.feedbackFailures > 0 ? "warning" : "default"}
          />
          <MetricCard
            label="单个用户人工审核时间"
            value={fmtMinutes(q.reviewMinutesPerUser)}
            sub={`平均到 ${q.reviewOwnerUsers} 位被审核用户`}
          />
          <MetricCard
            label="关键数据写入失败"
            value={`${q.criticalWriteFailures}`}
            sub="目标/资料/纠错/删除申请等持久化失败"
            tone={q.criticalWriteFailures > 0 ? "danger" : "default"}
          />
        </div>
      </section>

      {/* —— 漏斗与待办 —— */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunnelPanel m={m} />
        <PendingActionsPanel m={m} />
      </div>

      {/* —— 积压与资源失效 —— */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BacklogPanel m={m} />
        <ResourceAlertPanel m={m} />
      </div>

      {/* —— 异常监控 —— */}
      <AnomalyPanel m={m} />
    </div>
  );
}
