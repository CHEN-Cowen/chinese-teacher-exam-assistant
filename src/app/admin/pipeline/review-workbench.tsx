"use client";

/**
 * WB4：按岗位人工审核工作台。
 *
 * 信息架构（5 分区）：
 * 1. 公告公共事实（scope=announcement）；
 * 2. 岗位列表（scope=job 按 jobScope.key 聚合，含 scope=unknown 的"归属未知"组）；
 * 3. 当前岗位字段表（字段名/值/状态/来源/规则版本/证据定位/人工决定）；
 * 4. 原文证据与解析警告；
 * 5. 质量门禁与审核动作（adopt/edit/reject/pending，整岗位提交）。
 *
 * 约束：
 * - 复用现有设计系统（Card/Button/Input/Textarea），不引入第二套视觉语言；
 * - unknown/conflict 必须显著可见，不靠颜色单独表达（附文字徽标）；
 * - 证据定位可复制，不打开带签名/凭据的 URL；
 * - 批量操作只作用于当前岗位并明确列出字段，不提供"一键全部通过"；
 * - AI/OCR 字段仅在明确 adopt/edit 后写入确认时间（后端 applyFieldDecisions 处理）；
 * - 提交失败保留用户输入；提交成功后刷新服务端真实记录。
 */
import { useCallback, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type {
  FieldDecision,
  Run,
} from "@/lib/announcements-pipeline/api";

// ==================== 候选字段前端类型 ====================

interface EvidenceLocator {
  kind: string;
  url?: string;
  anchor?: string;
  fileId?: string;
  fileName?: string;
  page?: number;
  sheet?: string;
  cell?: string;
  selector?: string;
  excerpt?: string;
}

interface CandidateField {
  field: string;
  value: string;
  anchor?: { field?: string; locator?: EvidenceLocator; excerpt?: string };
  /** M3：同值合并的多来源证据（不只保留第一次） */
  anchors?: Array<{ field?: string; locator?: EvidenceLocator; excerpt?: string }>;
  confidence?: number;
  origin?: "rule" | "ai" | "ocr";
  needsHumanConfirm?: boolean;
  humanConfirmedAt?: string | null;
  scope?: "announcement" | "job" | "unknown";
  jobScope?: { key: string; jobCode?: string; sheet?: string; row?: number };
  status?: "extracted" | "unknown" | "conflict";
  ruleVersion?: string;
  /** M3：批次/适用范围（同字段不同批次为不同槽位） */
  batchId?: string;
  alternatives?: Array<{
    value: string;
    source?: unknown;
    excerpt?: string;
    ruleVersion?: string;
    sourceFile?: string;
  }>;
  decision?: {
    action: "adopt" | "edit" | "reject" | "pending";
    beforeValue?: string;
    afterValue?: string;
    reason?: string;
    operatorId?: string;
    decidedAt?: string;
  };
}

// ==================== 状态/来源/展示映射 ====================

const FIELD_LABELS: Record<string, string> = {
  title: "公告标题",
  region: "地区",
  job_code: "岗位编号",
  unit_name: "招聘单位",
  stage: "学段",
  subject: "学科",
  headcount: "招聘人数",
  education: "学历要求",
  degree: "学位要求",
  major: "专业要求",
  teacher_cert: "教师资格",
  age: "年龄要求",
  age_basis_date: "年龄计算基准日",
  age_exception: "年龄例外",
  hukou: "户籍",
  work_experience: "工作经历",
  employment_nature: "编制/用工性质",
  registration_time: "报名时间",
  registration_end_time: "报名截止时点",
  materials: "报名材料",
  official_entry: "官方报名入口",
  batch: "适用批次",
  exam_time: "考试时间",
  subjects: "考试科目",
  score: "分值",
  qualification: "资格条件",
};

const ORIGIN_LABELS: Record<string, string> = {
  rule: "规则",
  ai: "AI 候选",
  ocr: "OCR 候选",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  extracted: { label: "已提取", className: "bg-emerald-100 text-emerald-700" },
  unknown: { label: "未知", className: "bg-slate-200 text-slate-700" },
  conflict: { label: "冲突", className: "bg-red-100 text-red-700" },
};

const DECISION_META: Record<string, { label: string; className: string }> = {
  adopt: { label: "已采用", className: "bg-emerald-100 text-emerald-700" },
  edit: { label: "已修改", className: "bg-blue-100 text-blue-700" },
  reject: { label: "已驳回", className: "bg-red-100 text-red-700" },
  pending: { label: "待确认", className: "bg-amber-100 text-amber-700" },
};

/** 前端 fieldIdentity（与后端 domain.fieldIdentity 对齐） */
function fieldIdentity(f: CandidateField): string {
  const scope = f.scope ?? "announcement";
  if (scope === "job") {
    const jobKey = f.jobScope?.key ?? "";
    return `job:${jobKey}:${f.field}`;
  }
  return `${scope}:${f.field}`;
}

/** 按 scope 分组：announcement / jobs(Map<jobKey, fields>) / unknown */
function groupByScope(fields: CandidateField[]) {
  const announcement: CandidateField[] = [];
  const jobs = new Map<string, CandidateField[]>();
  const unknown: CandidateField[] = [];
  for (const f of fields) {
    const scope = f.scope ?? "announcement";
    if (scope === "announcement") announcement.push(f);
    else if (scope === "job") {
      const key = f.jobScope?.key ?? "";
      const bucket = jobs.get(key);
      if (bucket) bucket.push(f);
      else jobs.set(key, [f]);
    } else unknown.push(f);
  }
  return { announcement, jobs, unknown };
}

/** 证据定位的可复制文本（不输出签名 URL 的敏感 query） */
function evidenceLocatorText(locator?: EvidenceLocator): string | null {
  if (!locator) return null;
  switch (locator.kind) {
    case "html":
      return locator.selector ? `选择器：${locator.selector}` : null;
    case "pdf-text":
      return locator.page != null ? `第 ${locator.page} 页` : null;
    case "ocr":
      return locator.page != null ? `第 ${locator.page} 页（OCR）` : "OCR 识别";
    case "worksheet": {
      const parts: string[] = [];
      if (locator.sheet) parts.push(`工作表 ${locator.sheet}`);
      if (locator.cell) parts.push(`单元格 ${locator.cell}`);
      return parts.join(" ") || null;
    }
    case "file":
      return locator.page != null ? `附件第 ${locator.page} 页` : null;
    case "excerpt":
      return "文本摘录";
    default:
      return null;
  }
}

// ==================== 字段级审核行 ====================

type PendingDecision = {
  action: "adopt" | "edit" | "reject" | "pending";
  afterValue?: string;
  reason: string;
};

function FieldRow({
  field,
  decision,
  onChange,
}: {
  field: CandidateField;
  decision: PendingDecision | undefined;
  onChange: (d: PendingDecision | undefined) => void;
}) {
  const status = field.status ?? "extracted";
  const statusMeta = STATUS_META[status] ?? { label: status, className: "bg-slate-100" };
  const origin = field.origin ? ORIGIN_LABELS[field.origin] : null;
  const isAuto = field.origin === "ai" || field.origin === "ocr";
  const locator = evidenceLocatorText(field.anchor?.locator);
  const existingDecision = field.decision;

  // 已持久化的决策优先展示；未持久化时展示当前编辑中的决策
  const activeDecision = decision ?? (existingDecision ? {
    action: existingDecision.action,
    afterValue: existingDecision.afterValue,
    reason: existingDecision.reason ?? "",
  } : undefined);

  const label = FIELD_LABELS[field.field] ?? field.field;

  return (
    <div
      className="rounded-xl border border-line bg-surface p-3"
      data-testid={`field-row-${field.field}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-ink-muted">({field.field})</span>
        <span className={cn("px-1.5 py-px rounded text-[11px] font-medium", statusMeta.className)}>
          {statusMeta.label}
        </span>
        {origin && (
          <span className="px-1.5 py-px rounded bg-slate-100 text-slate-600 text-[11px]">
            {origin}
          </span>
        )}
        {field.batchId && (
          <span className="px-1.5 py-px rounded bg-indigo-100 text-indigo-700 text-[11px]" data-testid={`batch-badge-${field.field}`}>
            批次 {field.batchId}
          </span>
        )}
        {field.anchors && field.anchors.length > 1 && (
          <span
            className="px-1.5 py-px rounded bg-teal-100 text-teal-700 text-[11px]"
            title={`同值多来源合并，保留 ${field.anchors.length} 条证据`}
            data-testid={`multi-evidence-${field.field}`}
          >
            多来源证据（{field.anchors.length}）
          </span>
        )}
        {isAuto && !field.humanConfirmedAt && (
          <span className="px-1.5 py-px rounded bg-orange-100 text-orange-700 text-[11px]">
            待人工确认
          </span>
        )}
        {activeDecision && (
          <span className={cn("px-1.5 py-px rounded text-[11px] font-medium", DECISION_META[activeDecision.action].className)}>
            {DECISION_META[activeDecision.action].label}
          </span>
        )}
      </div>

      {/* 值：conflict 显著展示全部替代值（含来源文件与提取版本） */}
      {status === "conflict" && field.alternatives && field.alternatives.length > 0 ? (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
          <p className="text-xs font-medium text-red-700 mb-1">
            冲突（{field.alternatives.length} 个来源值，需人工裁决）：
          </p>
          <ul className="space-y-1">
            {field.alternatives.map((a, i) => (
              <li key={i} className="text-sm text-slate-800">
                <span className="font-medium">{a.value}</span>
                {a.sourceFile && (
                  <span className="ml-2 text-xs text-slate-500">来源：{a.sourceFile}</span>
                )}
                {a.ruleVersion && (
                  <span className="ml-2 text-xs text-slate-400">（{a.ruleVersion}）</span>
                )}
                {a.excerpt && <span className="ml-2 text-xs text-slate-500">（{a.excerpt}）</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : status === "unknown" ? (
        <p className="mt-1.5 text-sm text-slate-500 italic">（原文未写明，待人工确认）</p>
      ) : (
        <p className="mt-1.5 text-sm text-ink break-words">{field.value || "（空）"}</p>
      )}

      {/* 证据定位（可复制，不打开签名 URL） */}
      {locator && (
        <p className="mt-1 text-xs text-ink-muted break-all select-all" data-testid={`locator-${field.field}`}>
          证据定位：{locator}
        </p>
      )}
      {field.anchor?.excerpt && !locator && (
        <p className="mt-1 text-xs text-ink-muted italic line-clamp-2">证据：{field.anchor.excerpt}</p>
      )}
      {field.ruleVersion && (
        <p className="mt-0.5 text-[11px] text-ink-muted">规则版本：{field.ruleVersion}</p>
      )}

      {/* 决策编辑区 */}
      <div className="mt-2.5 flex flex-wrap items-start gap-2">
        {(["adopt", "edit", "reject", "pending"] as const).map((act) => (
          <button
            key={act}
            type="button"
            onClick={() => onChange({ action: act, afterValue: activeDecision?.afterValue, reason: activeDecision?.reason ?? "" })}
            className={cn(
              "h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors",
              activeDecision?.action === act
                ? "border-brand bg-brand-soft text-brand"
                : "border-line text-ink-muted hover:border-brand/30 hover:text-ink"
            )}
          >
            {DECISION_META[act].label.replace("已", "")}
          </button>
        ))}
      </div>

      {/* edit 的新值输入 + 原因输入 */}
      {activeDecision && (
        <div className="mt-2 space-y-2">
          {activeDecision.action === "edit" && (
            <Input
              label="新值（必填）"
              value={activeDecision.afterValue ?? ""}
              onChange={(e) => onChange({ ...activeDecision, afterValue: e.target.value })}
              placeholder={`输入 ${label} 的修正值`}
            />
          )}
          <Textarea
            label="原因（必填）"
            value={activeDecision.reason}
            onChange={(e) => onChange({ ...activeDecision, reason: e.target.value })}
            placeholder={
              activeDecision.action === "edit"
                ? "例如：附件为最新口径"
                : activeDecision.action === "reject"
                  ? "例如：来源不可信"
                  : activeDecision.action === "pending"
                    ? "例如：待补充专业目录依据"
                    : "例如：与原文一致"
            }
            className="min-h-[48px] text-sm"
            data-testid={`field-reason-${field.field}`}
          />
          {!activeDecision.reason.trim() && (
            <p className="text-xs text-danger">原因必填</p>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== 主工作台 ====================

export function ReviewWorkbench({
  run,
  originalContent,
  parseWarnings,
  onClose,
  onDone,
}: {
  run: Run;
  originalContent: string;
  parseWarnings: Array<{ type?: string; message?: string } | string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const fields = useMemo<CandidateField[]>(() => {
    const candidate = (run.candidate as { fields?: CandidateField[] } | null) ?? { fields: [] };
    return candidate.fields ?? [];
  }, [run.candidate]);

  const { announcement, jobs, unknown } = useMemo(() => groupByScope(fields), [fields]);
  const quality = run.quality ?? null;

  // 岗位分组顺序：announcement（公共事实）单列，jobs 按 key，unknown 单独一组
  const jobKeys = useMemo(() => [...jobs.keys()], [jobs]);

  // 默认选中第一个存在阻塞的岗位，否则第一个岗位/公告
  const defaultKey = useMemo(() => {
    const blockedJob = jobKeys.find((key) => {
      const scopeQuality = quality?.scopes.find((s) => s.key === key);
      return scopeQuality && (scopeQuality.conflict > 0 || scopeQuality.unknown > 0);
    });
    if (blockedJob) return blockedJob;
    return jobKeys[0] ?? "announcement";
  }, [jobKeys, quality]);

  // 当前选中的"分区"：'announcement' | 'unknown' | 某 jobKey
  const [activeKey, setActiveKey] = useState<string>(defaultKey);
  const [decisions, setDecisions] = useState<Record<string, PendingDecision | undefined>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeFields: CandidateField[] = useMemo(() => {
    if (activeKey === "announcement") return announcement;
    if (activeKey === "unknown") return unknown;
    return jobs.get(activeKey) ?? [];
  }, [activeKey, announcement, jobs, unknown]);

  const activeTitle = useMemo(() => {
    if (activeKey === "announcement") return "公告公共事实";
    if (activeKey === "unknown") return "归属未知的字段";
    const job = activeFields.find((f) => f.jobScope);
    const code = job?.jobScope?.jobCode;
    return code ? `岗位 ${code}` : `岗位 ${activeKey.slice(0, 12)}`;
  }, [activeKey, activeFields]);

  // 当前分区的质量状态（可复算，来自后端 WB3）
  const scopeQuality = quality?.scopes.find((s) => s.key === activeKey);

  const hasDecision = Object.values(decisions).some((d) => d !== undefined);

  const resetForScope = () => {
    setDecisions({});
    setReason("");
    setError(null);
  };

  const switchScope = (key: string) => {
    setActiveKey(key);
    resetForScope();
  };

  const updateDecision = (field: CandidateField, d: PendingDecision | undefined) => {
    const identity = fieldIdentity(field);
    setDecisions((prev) => ({ ...prev, [identity]: d }));
  };

  // 收集当前分区的字段决策
  const collectDecisions = useCallback((): FieldDecision[] => {
    const out: FieldDecision[] = [];
    for (const f of activeFields) {
      const identity = fieldIdentity(f);
      const d = decisions[identity];
      if (!d) continue;
      out.push({
        identity,
        field: f.field,
        action: d.action,
        afterValue: d.afterValue,
        reason: d.reason.trim(),
      });
    }
    return out;
  }, [activeFields, decisions]);

  const submitScope = async () => {
    setError(null);
    const fieldDecisions = collectDecisions();

    // 校验：本分区内每个已选择决策的字段都必须有原因；edit 必须有新值
    const invalid = fieldDecisions.filter(
      (d) => !d.reason || (d.action === "edit" && !d.afterValue?.trim()),
    );
    if (invalid.length > 0) {
      setError(`有 ${invalid.length} 个字段的决策缺少原因或新值，请补齐后再提交`);
      return;
    }
    if (!reason.trim()) {
      setError("请填写本次审核的整体原因");
      return;
    }

    setSubmitting(true);
    try {
      const { announcementsPipelineApi } = await import("@/lib/announcements-pipeline/api");
      await announcementsPipelineApi.submitReview({
        runId: run.id,
        action: "approve_with_edit",
        reason: reason.trim(),
        editedFields: activeFields.map((f) => ({ field: f.field, value: f.value, anchor: f.anchor as object })),
        fieldDecisions,
        baseUpdatedAt: run.updatedAt,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "审核提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 分区导航项
  const navItems: Array<{ key: string; label: string; badge?: string }> = [
    { key: "announcement", label: "公告公共事实", badge: announcement.length ? String(announcement.length) : undefined },
    ...jobKeys.map((k) => {
      const code = jobs.get(k)?.find((f) => f.jobScope?.jobCode)?.jobScope?.jobCode;
      return { key: k, label: code ? `岗位 ${code}` : `岗位 ${k.slice(0, 8)}` };
    }),
  ];
  if (unknown.length > 0) {
    navItems.push({ key: "unknown", label: "归属未知", badge: String(unknown.length) });
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-base font-semibold text-ink">按岗位人工审核</p>
          <p className="text-xs text-ink-muted">
            任务 {run.id.slice(0, 8)} · {run.snapshot?.source?.publisher ?? "未知来源"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          关闭
        </Button>
      </div>

      {/* 分区导航（岗位列表 + 公共事实 + 归属未知） */}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="审核分区">
        {navItems.map((item) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchScope(item.key)}
              className={cn(
                "h-9 px-3 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line text-ink-muted hover:border-brand/30 hover:text-ink"
              )}
            >
              {item.label}
              {item.badge && <span className="ml-1 text-xs opacity-70">({item.badge})</span>}
            </button>
          );
        })}
      </div>

      {/* 质量门禁状态（WB3 可复算，不自行计算正确率） */}
      {/* M2 固定分母（期望清单）总览：未建立清单 → 提示；有清单 → 显示遗漏与完整度 */}
      {run.checklistQuality && (
        <div
          className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
          data-testid="fixed-denominator-summary"
        >
          {run.checklistQuality.completenessNotEvaluated ? (
            <p className="text-slate-500">
              <strong>未建立固定分母，完整性未评估。</strong>
              建立期望清单后可发现整项字段漏抽与整岗位漏抽。
            </p>
          ) : (
            <div className="space-y-0.5">
              <p>
                固定分母完整性：
                <strong className="text-slate-800">
                  {run.checklistQuality.fixedDenominatorCompleteness === null
                    ? "未记录"
                    : `${(run.checklistQuality.fixedDenominatorCompleteness * 100).toFixed(1)}%`}
                </strong>
                <span className="ml-1 text-slate-400">
                  （清单 v{run.checklistQuality.checklistVersion}，有效分母{" "}
                  {run.checklistQuality.evaluation.metrics.effectiveDenominator}，
                  遗漏 {run.checklistQuality.evaluation.metrics.missing}）
                </span>
              </p>
              {run.checklistQuality.retrospective && (
                <p className="text-amber-600">回顾性核对（候选后补建，非独立基准）</p>
              )}
            </div>
          )}
        </div>
      )}

      {scopeQuality && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="quality-summary">
          本分区：已提取 {scopeQuality.extracted} · 未知 {scopeQuality.unknown} · 冲突 {scopeQuality.conflict}（共 {scopeQuality.expected} 个字段）
          {scopeQuality.conflict > 0 && <span className="ml-2 text-red-600 font-medium">含未裁决冲突</span>}
          {scopeQuality.unknown > 0 && <span className="ml-2 text-amber-600 font-medium">含未知字段</span>}
        </div>
      )}

      {/* 当前分区标题 */}
      <p className="text-sm font-semibold text-ink mb-2">{activeTitle}</p>

      {/* 字段表 */}
      {activeFields.length === 0 ? (
        <EmptyState
          icon={<span className="text-3xl">🗂️</span>}
          title="当前分区没有字段"
          description="该分区下暂无候选字段"
        />
      ) : (
        <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
          {activeFields.map((f) => (
            <FieldRow
              key={fieldIdentity(f)}
              field={f}
              decision={decisions[fieldIdentity(f)]}
              onChange={(d) => updateDecision(f, d)}
            />
          ))}
        </div>
      )}

      {/* 解析警告（可折叠展示） */}
      {parseWarnings.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-ink mb-1.5">解析警告（{parseWarnings.length}）</p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1">
            {parseWarnings.map((w, i) => {
              const text = typeof w === "string" ? w : (w.message ?? "");
              return (
                <p key={i} className="text-xs text-amber-800">• {text}</p>
              );
            })}
          </div>
        </div>
      )}

      {/* 原文证据（可折叠，节选） */}
      {originalContent && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-ink mb-1.5">原文证据</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-[200px] overflow-y-auto">
            <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words">{originalContent}</pre>
          </div>
        </div>
      )}

      {/* 审核动作（整分区提交） */}
      <div className="mt-5 space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink">审核动作（当前分区：{activeTitle}）</p>
        <p className="text-xs text-ink-muted">
          逐字段选择「采用 / 修改 / 驳回 / 待确认」，填写整体原因后提交本分区。
          不会一键全部通过。
        </p>

        {hasDecision && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            本分区已记录决策的字段：
            {activeFields
              .filter((f) => decisions[fieldIdentity(f)] !== undefined)
              .map((f) => (
                <span key={fieldIdentity(f)} className="ml-1 inline-flex items-center gap-1">
                  <span className="font-medium">{FIELD_LABELS[f.field] ?? f.field}</span>
                  <span className="text-ink-muted">
                    ({DECISION_META[decisions[fieldIdentity(f)]!.action].label.replace("已", "")})
                  </span>
                </span>
              ))}
          </div>
        )}

        <Textarea
          label="本次审核整体原因（必填）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：已逐字段核对公告原文与岗位表"
          className="min-h-[64px] text-sm"
          data-testid="overall-reason"
        />

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            ⚠️ {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={submitScope}
            disabled={!reason.trim() || submitting}
            loading={submitting}
          >
            {submitting ? "提交中..." : `提交本分区审核（${activeFields.length} 字段）`}
          </Button>
          <Button size="md" variant="outline" onClick={resetForScope} disabled={submitting}>
            重置本分区
          </Button>
        </div>
      </div>
    </Card>
  );
}
