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
  ChecklistQualityReport,
  FieldDecision,
  QualityReport,
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

/**
 * 单岗位未解决项计数（M4-01）。来自服务端质量报告与固定分母清单，前端只聚合展示，
 * 不复制门禁算法。未解决项 = 冲突字段 + 未知字段 + 该岗位漏抽槽位 + 来源不可核验。
 */
interface JobIssueCounts {
  conflict: number;
  unknown: number;
  missing: number;
  unverifiable: number;
  /** 未解决总数（冲突+未知+遗漏+不可核验） */
  unresolved: number;
}

/**
 * 计算每个岗位（含清单里的零输出岗位）的未解决项数与风险等级。
 * 风险分级（M4-01 实施要求 1）：
 *   3 = 冲突 / 来源失败(不可核验) / 必需遗漏（最影响可信度）
 *   2 = 高影响字段缺证据
 *   1 = 普通待审（unknown 等）
 *   0 = 无未解决项
 * 同等级按岗位 key 稳定排序。
 */
function computeJobRisk(
  jobKey: string,
  quality: QualityReport | null,
  checklistQuality: ChecklistQualityReport | null,
): { counts: JobIssueCounts; risk: number } {
  const scope = quality?.scopes.find((s) => s.key === jobKey);
  const counts: JobIssueCounts = {
    conflict: scope?.conflict ?? 0,
    unknown: scope?.unknown ?? 0,
    missing: 0,
    unverifiable: 0,
    unresolved: 0,
  };

  // M2 清单：该岗位漏抽槽位 + 来源不可核验
  if (checklistQuality?.evaluation?.jobs) {
    const jobEval = checklistQuality.evaluation.jobs.find((j) => j.key === jobKey);
    if (jobEval) {
      for (const r of jobEval.results ?? []) {
        if (r.status === "should_have_but_missing") counts.missing += 1;
        else if (r.status === "source_missing_unverifiable") counts.unverifiable += 1;
      }
    }
  }

  // 高影响缺证据（按 jobKey 归属）
  const missingEvidence = (quality?.missingEvidence ?? []).filter(
    (m) => m.jobKey === jobKey || m.scope === "job",
  ).length;

  counts.unresolved =
    counts.conflict + counts.unknown + counts.missing + counts.unverifiable;

  // 风险分级
  let risk = 0;
  if (counts.conflict > 0 || counts.unverifiable > 0 || counts.missing > 0) risk = 3;
  else if (missingEvidence > 0) risk = 2;
  else if (counts.unknown > 0) risk = 1;

  return { counts, risk };
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

// ==================== 分阶段专业口径（R02） ====================

/**
 * 审核员可为 `major` 字段显式确认结构化的分阶段口径。
 *
 * 写入格式与后端 `catalog-payload-assembler` 一致：
 * `{"names":[...],"stages":["bachelor","master"],"stageMode":"any"}`
 * 不选择阶段时保持“未明确阶段”，系统不会自动按最高学历推断。
 */
const MAJOR_STAGE_OPTIONS = [
  { code: "bachelor", label: "本科" },
  { code: "master", label: "硕士研究生" },
  { code: "doctorate", label: "博士研究生" },
  { code: "college", label: "大专" },
  { code: "secondary", label: "中专/高中" },
] as const;

type MajorStageCode = (typeof MAJOR_STAGE_OPTIONS)[number]["code"];

interface StructuredMajorDraft {
  names: string;
  stages: MajorStageCode[];
  stageMode: "any" | "all";
  ambiguous: boolean;
}

function isMajorStageCode(value: unknown): value is MajorStageCode {
  return MAJOR_STAGE_OPTIONS.some((option) => option.code === value);
}

/** 解析已结构化（JSON）的专业值；普通文本返回 null */
function parseMajorDraft(raw: string): StructuredMajorDraft | null {
  const text = raw.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      names: Array.isArray(parsed.names)
        ? parsed.names.filter((item): item is string => typeof item === "string").join("、")
        : "",
      stages: Array.isArray(parsed.stages) ? parsed.stages.filter(isMajorStageCode) : [],
      stageMode: parsed.stageMode === "all" ? "all" : "any",
      ambiguous: parsed.ambiguous === true,
    };
  } catch {
    return null;
  }
}

/** 把草稿序列化为后端可解析的结构化专业值；非法输入返回错误提示 */
function serializeMajorDraft(draft: StructuredMajorDraft): { value?: string; error?: string } {
  const names = [...new Set(
    draft.names.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean),
  )];
  if (names.length === 0) return { error: "请先填写专业名称（多个用顿号分隔）" };
  const stages = [...new Set(draft.stages)];
  return {
    value: JSON.stringify({
      names,
      ...(stages.length > 0 ? { stages } : {}),
      ...(stages.length > 1 ? { stageMode: draft.stageMode } : {}),
      ...(draft.ambiguous ? { ambiguous: true } : {}),
    }),
  };
}

function StructuredMajorEditor({
  field,
  activeDecision,
  onChange,
}: {
  field: CandidateField;
  activeDecision: PendingDecision | undefined;
  onChange: (d: PendingDecision) => void;
}) {
  const initial = parseMajorDraft(activeDecision?.afterValue ?? field.value);
  const [draft, setDraft] = useState<StructuredMajorDraft>(
    initial ?? { names: "", stages: [], stageMode: "any", ambiguous: false },
  );
  const [error, setError] = useState<string | null>(null);

  const toggleStage = (code: MajorStageCode) => {
    setDraft((prev) => ({
      ...prev,
      stages: prev.stages.includes(code)
        ? prev.stages.filter((item) => item !== code)
        : [...prev.stages, code],
    }));
  };

  const apply = () => {
    const result = serializeMajorDraft(draft);
    if (result.error || !result.value) {
      setError(result.error ?? "结构化专业要求生成失败");
      return;
    }
    setError(null);
    onChange({
      action: "edit",
      afterValue: result.value,
      reason: activeDecision?.reason ?? "",
    });
  };

  return (
    <details
      className="mt-2 rounded-lg border border-line bg-surface-muted/60 p-2"
      data-testid={`major-structured-${field.field}`}
    >
      <summary className="cursor-pointer text-xs font-medium text-ink-muted">
        分阶段专业口径（可选，显式确认后才写入发布版本）
      </summary>
      <div className="mt-2 space-y-2">
        <Input
          label="专业名称（多个用顿号分隔）"
          value={draft.names}
          onChange={(e) => setDraft({ ...draft, names: e.target.value })}
          placeholder="例如：汉语言文学、学科教学（语文）"
          data-testid="major-names-input"
        />
        <fieldset>
          <legend className="text-xs text-ink-muted">
            适用阶段（不选 = 公告未明确阶段，系统不会自动按最高学历推断）
          </legend>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {MAJOR_STAGE_OPTIONS.map((option) => (
              <label key={option.code} className="flex items-center gap-1 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={draft.stages.includes(option.code)}
                  onChange={() => toggleStage(option.code)}
                  data-testid={`major-stage-${option.code}`}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        {draft.stages.length > 1 && (
          <fieldset>
            <legend className="text-xs text-ink-muted">多阶段口径（必填）</legend>
            <div className="mt-1 flex flex-wrap gap-x-3">
              <label className="flex items-center gap-1 text-xs text-ink">
                <input
                  type="radio"
                  name={`major-stage-mode-${field.field}`}
                  checked={draft.stageMode === "any"}
                  onChange={() => setDraft({ ...draft, stageMode: "any" })}
                />
                任一阶段符合即可
              </label>
              <label className="flex items-center gap-1 text-xs text-ink">
                <input
                  type="radio"
                  name={`major-stage-mode-${field.field}`}
                  checked={draft.stageMode === "all"}
                  onChange={() => setDraft({ ...draft, stageMode: "all" })}
                />
                各阶段均须符合
              </label>
            </div>
          </fieldset>
        )}
        <label className="flex items-start gap-1 text-xs text-ink">
          <input
            type="checkbox"
            checked={draft.ambiguous}
            onChange={(e) => setDraft({ ...draft, ambiguous: e.target.checked })}
            className="mt-0.5"
          />
          公告专业目录表述存在解释空间（精确不中时转人工确认）
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button size="sm" variant="outline" onClick={apply} data-testid="major-structured-apply">
          使用结构化专业要求
        </Button>
      </div>
    </details>
  );
}

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
  const structuredMajor = field.field === "major" ? parseMajorDraft(field.value) : null;

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

      {/* 已结构化专业值的人读摘要（原始 JSON 仍在上方作为审计值） */}
      {structuredMajor && (
        <p className="mt-1 text-xs text-brand" data-testid={`major-structured-summary-${field.field}`}>
          结构化口径：{structuredMajor.names || "（未填写专业名称）"}
          {structuredMajor.stages.length > 0
            ? `（${structuredMajor.stages
                .map((code) => MAJOR_STAGE_OPTIONS.find((option) => option.code === code)?.label ?? code)
                .join("、")}${structuredMajor.stages.length > 1
                ? structuredMajor.stageMode === "all" ? "阶段均须符合" : "阶段任一符合"
                : "阶段"}）`
            : "（未明确阶段）"}
          {structuredMajor.ambiguous ? "；表述存在解释空间" : ""}
        </p>
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

      {/* R02：专业字段可显式确认分阶段口径（任一/同时） */}
      {field.field === "major" && (
        <StructuredMajorEditor
          field={field}
          activeDecision={activeDecision}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// ==================== 漏抽岗位视图（M4-01） ====================

/**
 * 整岗位漏抽（候选无字段，但清单里有该岗位的遗漏槽位）时的视图。
 * 显示该岗位在固定分母清单里被标记为 should_have_but_missing /
 * source_missing_unverifiable 的槽位，供人工确认「整岗位漏抽」还是「不适用」。
 */
function MissingJobView({
  jobKey,
  checklistQuality,
}: {
  jobKey: string;
  checklistQuality: ChecklistQualityReport | null;
}) {
  const jobEval = checklistQuality?.evaluation?.jobs?.find((j) => j.key === jobKey);
  const missingSlots = (jobEval?.results ?? []).filter(
    (r) => r.status === "should_have_but_missing" || r.status === "source_missing_unverifiable",
  );

  if (!checklistQuality || !jobEval) {
    return (
      <EmptyState
        icon={<span className="text-3xl">🗂️</span>}
        title="当前分区没有字段"
        description="该分区下暂无候选字段"
      />
    );
  }

  if (missingSlots.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-3xl">✅</span>}
        title="该岗位在清单中已全部提取"
        description="候选里没有该岗位的字段，但固定分母清单也未标记遗漏槽位"
      />
    );
  }

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 p-3"
      data-testid="missing-job-view"
    >
      <p className="text-sm font-medium text-amber-800">
        该岗位疑似整岗位漏抽，清单标记 {missingSlots.length} 个缺失槽位：
      </p>
      <ul className="mt-2 space-y-1">
        {missingSlots.map((s, i) => (
          <li key={i} className="text-xs text-slate-700">
            <span className="font-medium">{FIELD_LABELS[s.field] ?? s.field}</span>
            <span className="ml-1 text-slate-500">({s.field})</span>
            {s.status === "source_missing_unverifiable" && (
              <span className="ml-2 text-amber-600">（来源不可读，无法核验）</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        请核对：该岗位是确实漏抽，还是清单里本就不适用（应标记 not_applicable）。
      </p>
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
  const checklistQuality = run.checklistQuality ?? null;

  // M4：合并「候选岗位」与「清单里的漏抽岗位」为统一岗位 key 集合，并做风险排序。
  // 漏抽岗位在候选里没有字段（jobs.get 返回空），但仍要能点进去看遗漏槽位（M4-01）。
  const allJobKeys = useMemo(() => {
    const set = new Set<string>(jobs.keys());
    for (const j of checklistQuality?.evaluation?.jobs ?? []) set.add(j.key);
    return [...set];
  }, [jobs, checklistQuality]);

  // 每岗位未解决项数 + 风险等级（来自服务端质量报告 + 固定分母清单）
  const jobRisk = useMemo(() => {
    const map = new Map<string, { counts: JobIssueCounts; risk: number }>();
    for (const key of allJobKeys) {
      map.set(key, computeJobRisk(key, quality, checklistQuality));
    }
    return map;
  }, [allJobKeys, quality, checklistQuality]);

  // M4-01：风险排序（冲突/遗漏/不可核验 > 高影响缺证据 > 普通待审），同等级按 key 稳定排序。
  const orderedJobKeys = useMemo(() => {
    return [...allJobKeys].sort((a, b) => {
      const ra = jobRisk.get(a)?.risk ?? 0;
      const rb = jobRisk.get(b)?.risk ?? 0;
      if (ra !== rb) return rb - ra;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }, [allJobKeys, jobRisk]);

  // 默认选中风险最高的岗位；无岗位则回退公告公共事实
  const defaultKey = useMemo(() => {
    return orderedJobKeys[0] ?? "announcement";
  }, [orderedJobKeys]);

  // 当前选中的"分区"：'announcement' | 'unknown' | 某 jobKey
  const [activeKey, setActiveKey] = useState<string>(defaultKey);
  const [decisions, setDecisions] = useState<Record<string, PendingDecision | undefined>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M4-09：切换分区前的未保存确认（弹窗内容）
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

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
    if (code) return `岗位 ${code}`;
    // 漏抽岗位（无候选字段）从清单拿 jobCode
    const checklistCode = checklistQuality?.evaluation?.jobs?.find((j) => j.key === activeKey)?.jobCode;
    if (checklistCode) return `岗位 ${checklistCode}`;
    return `岗位 ${activeKey.slice(0, 12)}`;
  }, [activeKey, activeFields, checklistQuality]);

  // 当前分区的质量状态（可复算，来自后端 WB3）
  const scopeQuality = quality?.scopes.find((s) => s.key === activeKey);

  const hasDecision = Object.values(decisions).some((d) => d !== undefined);
  const hasUnsavedChanges = hasDecision || reason.trim() !== "";

  const resetForScope = () => {
    setDecisions({});
    setReason("");
    setError(null);
  };

  const switchScope = (key: string) => {
    // M4-09：有未保存变更时先提示，确认后才清空并切换，防止丢失
    if (key !== activeKey && hasUnsavedChanges) {
      setPendingSwitch(key);
      return;
    }
    setActiveKey(key);
    resetForScope();
  };

  const confirmSwitch = () => {
    const target = pendingSwitch;
    setPendingSwitch(null);
    if (target != null) {
      setActiveKey(target);
      resetForScope();
    }
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
      // M4-03 修复：只用逐字段 fieldDecisions（approve），不再用 approve_with_edit 的
      // editedFields 整体覆盖（那会丢弃 edit 决策的 afterValue）。后端 applyFieldDecisions
      // 会正确写入 before/after 与原因，并处理 conflict→extracted 状态转移。
      await announcementsPipelineApi.submitReview({
        runId: run.id,
        action: "approve",
        reason: reason.trim(),
        fieldDecisions,
        baseUpdatedAt: run.updatedAt,
      });
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "审核提交失败";
      // M4-05/M4-08：409 并发冲突 → 引导重新加载/比对，不静默覆盖。
      // 只匹配明确的并发冲突语义，不误伤「冲突字段未裁决」等普通门禁错误。
      if (/409|已被他人更新|并发冲突/i.test(msg)) {
        setError("审核记录已被他人更新，请重新加载后再比对提交，避免覆盖他人修改。");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 分区导航项（M4-01：岗位按风险排序，显示未解决项数；漏抽岗位也进入导航）
  const navItems: Array<{
    key: string;
    label: string;
    badge?: string;
    badgeTone?: "danger" | "warning" | "neutral";
  }> = [
    { key: "announcement", label: "公告公共事实", badge: announcement.length ? String(announcement.length) : undefined },
    ...orderedJobKeys.map((k) => {
      const code =
        jobs.get(k)?.find((f) => f.jobScope?.jobCode)?.jobScope?.jobCode ??
        checklistQuality?.evaluation?.jobs?.find((j) => j.key === k)?.jobCode;
      const { counts } = jobRisk.get(k) ?? { counts: { unresolved: 0 } as JobIssueCounts, risk: 0 };
      const badgeTone: "danger" | "warning" | "neutral" =
        counts.conflict > 0 || counts.unverifiable > 0
          ? "danger"
          : counts.missing > 0 || counts.unknown > 0
            ? "warning"
            : "neutral";
      return {
        key: k,
        label: code ? `岗位 ${code}` : `岗位 ${k.slice(0, 8)}`,
        badge: counts.unresolved > 0 ? String(counts.unresolved) : undefined,
        badgeTone,
      };
    }),
  ];
  if (unknown.length > 0) {
    navItems.push({ key: "unknown", label: "归属未知", badge: String(unknown.length), badgeTone: "warning" });
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

      {/* 分区导航（岗位列表 + 公共事实 + 归属未知，M4 按风险排序） */}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="审核分区">
        {navItems.map((item, idx) => {
          const active = activeKey === item.key;
          const tone = item.badgeTone === "danger"
            ? "text-red-600"
            : item.badgeTone === "warning"
              ? "text-amber-600"
              : "text-ink-muted";
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              ref={(el) => {
                if (el && active) el.focus();
              }}
              onClick={() => switchScope(item.key)}
              onKeyDown={(e) => {
                // M4-08：方向键在分区间导航（roving tabindex）
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const dir = e.key === "ArrowRight" ? 1 : -1;
                  const next = navItems[(idx + dir + navItems.length) % navItems.length];
                  switchScope(next.key);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  switchScope(navItems[0].key);
                } else if (e.key === "End") {
                  e.preventDefault();
                  switchScope(navItems[navItems.length - 1].key);
                }
              }}
              className={cn(
                "h-9 px-3 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                active
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line text-ink-muted hover:border-brand/30 hover:text-ink"
              )}
            >
              {item.label}
              {item.badge && (
                <span className={cn("ml-1 text-xs font-semibold", tone)} data-testid={`nav-badge-${item.key}`}>
                  ({item.badge})
                </span>
              )}
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
        <MissingJobView
          jobKey={activeKey}
          checklistQuality={checklistQuality}
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

      {/* M4-09：切岗位前的未保存变更确认 */}
      {pendingSwitch != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          role="dialog"
          aria-modal="true"
          aria-label="未保存变更确认"
          data-testid="switch-confirm-dialog"
        >
          <div className="w-full max-w-sm rounded-xl bg-surface p-4 shadow-xl">
            <p className="text-sm font-semibold text-ink">当前分区有未保存的变更</p>
            <p className="mt-1 text-xs text-ink-muted">
              切换到其他分区会丢失本分区尚未提交的决策与原因。确定要切换吗？
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setPendingSwitch(null)}>
                继续编辑
              </Button>
              <Button size="sm" variant="danger" onClick={confirmSwitch} data-testid="confirm-switch">
                放弃并切换
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
