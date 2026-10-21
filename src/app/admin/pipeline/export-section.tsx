"use client";

/**
 * WB6：审核导出与实测指标（/admin/pipeline 审核页面区块）。
 *
 * 提供：
 * - 下载 JSON（完整结构：scope、证据定位、alternatives、审核记录、指标）；
 * - 下载 CSV（一行一个「岗位 × 字段」，14 列固定顺序）；
 * - 实测指标摘要（按 run + 按公告公共/逐岗位，每个比例含分子/分母/公式）；
 * - 指标口径说明（含「人工采用率不是准确率」的显式声明）；
 * - 数据集标记：测试 / 演示 / 真实 / 未标记 + 来源域提示（example.* 为测试/演示来源）。
 *
 * 行为约束：
 * - 导出基于服务端已保存记录，不从当前 UI 状态拼装；
 * - 导出失败时给出可恢复错误（显示错误信息，不生成空文件冒充成功）；
 * - 无可靠时间戳显示「未记录」，不补零；无准确率输出。
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  announcementsPipelineApi,
  type ExportMetrics,
} from "@/lib/announcements-pipeline/api";

/** 比例展示：value null（分母为 0）→「未记录」 */
function percent(ratio: { value: number | null }): string {
  if (ratio.value === null) return "未记录";
  return `${(ratio.value * 100).toFixed(1)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "未记录";
  if (ms < 1000) return `${ms}ms`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

const DATASET_LABELS: Record<string, { label: string; className: string }> = {
  test: { label: "测试材料", className: "bg-amber-100 text-amber-700" },
  demo: { label: "演示材料", className: "bg-blue-100 text-blue-700" },
  real: { label: "真实材料", className: "bg-emerald-100 text-emerald-700" },
  unmarked: { label: "未标记（未发布）", className: "bg-slate-100 text-slate-600" },
};

/** 触发浏览器下载 blob */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 后端指标响应的最小形状校验：结构不符按加载失败处理，不渲染半成品 */
function isExportMetrics(value: unknown): value is ExportMetrics {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v["scopes"]) &&
    Array.isArray(v["ratios"]) &&
    typeof v["totals"] === "object" &&
    v["totals"] !== null &&
    typeof v["timing"] === "object" &&
    v["timing"] !== null
  );
}

export function ExportSection({ runId }: { runId: string }) {
  const [metrics, setMetrics] = useState<ExportMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"json" | "csv" | null>(null);
  const [showFormulas, setShowFormulas] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await announcementsPipelineApi.getExportMetrics(runId);
        if (cancelled) return;
        if (!isExportMetrics(m)) {
          // 结构不符：按加载失败处理，绝不渲染半成品指标
          if (!cancelled) setMetricsError("指标响应结构异常");
          return;
        }
        if (!cancelled) setMetrics(m);
      } catch (e) {
        // 指标加载失败不阻断导出按钮，仅提示
        if (!cancelled) setMetricsError(e instanceof Error ? e.message : "指标加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const download = async (kind: "json" | "csv") => {
    setDownloading(kind);
    setExportError(null);
    try {
      const file =
        kind === "json"
          ? await announcementsPipelineApi.exportRunJson(runId)
          : await announcementsPipelineApi.exportRunCsv(runId);
      triggerDownload(file.blob, file.filename);
    } catch (e) {
      // 可恢复错误：保留在页面，不生成空文件
      setExportError(e instanceof Error ? e.message : "导出失败，请重试");
    } finally {
      setDownloading(null);
    }
  };

  const dataset = metrics
    ? (DATASET_LABELS[metrics.datasetMark] ?? DATASET_LABELS.unmarked)
    : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-slate-800">审核导出与实测指标</p>
        {dataset && metrics && (
          <span
            className={cn("px-2 py-0.5 rounded text-xs font-medium", dataset.className)}
            data-testid="dataset-mark"
          >
            {dataset.label}
            {metrics.isExampleSource && " · example 域名（测试/演示来源）"}
          </span>
        )}
      </div>

      {/* 下载按钮 */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => download("json")}
          disabled={downloading !== null}
          aria-label="下载 JSON 导出"
          data-testid="export-json-button"
        >
          {downloading === "json" ? "导出中..." : "下载 JSON"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => download("csv")}
          disabled={downloading !== null}
          aria-label="下载 CSV 导出（一行一个岗位字段）"
          data-testid="export-csv-button"
        >
          {downloading === "csv" ? "导出中..." : "下载 CSV"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowFormulas((v) => !v)}
          aria-expanded={showFormulas}
          aria-label="展开或收起指标口径说明"
          data-testid="formula-notes-toggle"
        >
          {showFormulas ? "收起口径说明" : "指标口径说明"}
        </Button>
      </div>

      {exportError && (
        <div
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
          data-testid="export-error"
        >
          ⚠️ {exportError}
          <span className="block mt-1 text-xs text-red-600">
            导出未完成，未生成文件；可重试或联系管理员。
          </span>
        </div>
      )}

      {/* 指标口径说明（可折叠） */}
      {showFormulas && (
        <div
          className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1"
          data-testid="formula-notes"
        >
          {(metrics?.formulaNotes ?? [
            "应有字段数 = 该范围内去重出现过的字段名数（与 WB3 完整性报告 expected 同口径）",
            "有证据高影响字段数 = 高影响字段中携带证据锚点的数量",
            "人工修改字段数 = decision.action=edit 的字段数",
            "无可靠时间戳记为「未记录」，不补零",
            "人工采用率不是准确率：没有黄金答案或独立人工裁决时，不输出准确率/召回率/提效百分比",
          ]).map((note, i) => (
            <p key={i}>• {note}</p>
          ))}
        </div>
      )}

      {/* 指标摘要 */}
      {metricsError && (
        <p className="mt-3 text-xs text-amber-600" data-testid="metrics-error">
          指标加载失败：{metricsError}（下载导出不受影响）
        </p>
      )}
      {metrics && (
        <div className="mt-3 space-y-3" data-testid="metrics-summary">
          {/* M2 固定分母（期望清单）状态 */}
          {metrics.fixedDenominator && (
            <div
              className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600"
              data-testid="fixed-denominator"
            >
              {metrics.fixedDenominator.completenessNotEvaluated ? (
                <p className="text-slate-500">
                  <strong>未建立固定分母，完整性未评估。</strong>
                  <span className="ml-1">
                    建立期望清单后，完整性将按「预先确认的清单」评估，可发现整项字段漏抽与整岗位漏抽。
                  </span>
                </p>
              ) : (
                <div className="space-y-1">
                  <p>
                    <strong>固定分母完整性：</strong>
                    {metrics.fixedDenominator.completeness === null
                      ? "未记录"
                      : `${(metrics.fixedDenominator.completeness * 100).toFixed(1)}%`}
                    <span className="ml-1 text-slate-400">
                      （{metrics.fixedDenominator.extracted}/
                      {metrics.fixedDenominator.effectiveDenominator}，
                      原始槽位 {metrics.fixedDenominator.rawSlots}，不适用{" "}
                      {metrics.fixedDenominator.notApplicable}，遗漏{" "}
                      {metrics.fixedDenominator.missing}）
                    </span>
                  </p>
                  <p className="text-slate-400">
                    清单版本 v{metrics.fixedDenominator.checklistVersion} ·{" "}
                    {metrics.fixedDenominator.checklistSource === "retrospective"
                      ? "回顾性核对（候选后补建，非独立基准）"
                      : "独立清点"}
                    {metrics.fixedDenominator.retrospective && " · 回顾性核对"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 比例（分子/分母/公式） */}
          <div className="flex flex-wrap gap-2">
            {metrics.ratios.map((r) => (
              <span
                key={r.key}
                className="px-2 py-1 rounded text-xs bg-slate-100 text-slate-700"
                title={r.formula}
              >
                {r.key === "completeness"
                  ? "完整性"
                  : r.key === "highImpactEvidenceCoverage"
                    ? "高影响证据覆盖率"
                    : "人工采用率"}
                ：{percent(r)}（{r.numerator}/{r.denominator}）
              </span>
            ))}
          </div>

          {/* 按 scope 的指标表 */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="按范围实测指标">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1.5 pr-3">范围</th>
                  <th className="py-1.5 pr-3">应有字段</th>
                  <th className="py-1.5 pr-3">已提取</th>
                  <th className="py-1.5 pr-3">未知</th>
                  <th className="py-1.5 pr-3">冲突</th>
                  <th className="py-1.5 pr-3">高影响(有证据/应有)</th>
                  <th className="py-1.5 pr-3">adopt/edit/reject/pending</th>
                  <th className="py-1.5 pr-3">人工修改</th>
                </tr>
              </thead>
              <tbody>
                {[...metrics.scopes, metrics.totals].map((s) => (
                  <tr key={s.key} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 font-medium text-slate-700">
                      {s.key === "run"
                        ? "合计（run）"
                        : s.key === "announcement"
                          ? "公告公共"
                          : s.key === "unknown"
                            ? "归属未知"
                            : `岗位 ${s.key}`}
                    </td>
                    <td className="py-1.5 pr-3">{s.expected}</td>
                    <td className="py-1.5 pr-3">{s.extracted}</td>
                    <td className="py-1.5 pr-3">{s.unknown}</td>
                    <td className="py-1.5 pr-3">{s.conflict}</td>
                    <td className="py-1.5 pr-3">
                      {s.highImpactEvidenced}/{s.highImpactExpected}
                    </td>
                    <td className="py-1.5 pr-3">
                      {s.adopt}/{s.edit}/{s.reject}/{s.pending}
                    </td>
                    <td className="py-1.5 pr-3">{s.humanModified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 时间指标（未记录不补零） */}
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span>
              总耗时：
              <strong className="text-slate-800">
                {formatDuration(metrics.timing.totalDurationMs)}
              </strong>
            </span>
            <span>
              人工审核耗时：
              <strong className="text-slate-800">
                {formatDuration(metrics.timing.reviewDurationMs)}
              </strong>
            </span>
            <span>
              重试次数：<strong className="text-slate-800">{metrics.timing.retryCount}</strong>
            </span>
            {metrics.sourceHost && (
              <span>
                来源域：<strong className="text-slate-800">{metrics.sourceHost}</strong>
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
