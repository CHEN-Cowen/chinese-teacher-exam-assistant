"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateTime } from "@/lib/utils";
import {
  announcementsPipelineApi,
  type ProjectionStatus,
  type PublishedVersion,
  type Run,
  type SnapshotParsedResponse,
} from "@/lib/announcements-pipeline/api";

// ==================== 状态映射 ====================

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  submitted: { label: "已提交", className: "bg-slate-100 text-slate-600" },
  extracting: { label: "提取中", className: "bg-blue-100 text-blue-700" },
  pending_review: { label: "待审核", className: "bg-amber-100 text-amber-700" },
  approved: { label: "审核通过", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "已驳回", className: "bg-red-100 text-red-700" },
  failed: { label: "提取失败", className: "bg-red-100 text-red-700" },
  published: { label: "已发布", className: "bg-emerald-100 text-emerald-700" },
};

const HIGH_IMPACT_FIELDS = new Set([
  "registration_time",
  "exam_time",
  "subjects",
  "score",
  "qualification",
  "headcount",
  "employment_nature",
  "education",
  "major",
  "teacher_cert",
  "age",
]);

const FIELD_LABELS: Record<string, string> = {
  title: "公告标题",
  registration_time: "报名时间",
  exam_time: "考试时间",
  subjects: "考试科目",
  score: "分值",
  qualification: "资格条件",
  headcount: "招聘人数",
  exam_scope: "考试范围",
  employment_nature: "用工性质",
  education: "学历要求",
  major: "专业要求",
  teacher_cert: "教师资格",
  age: "年龄要求",
};

// ==================== 候选字段类型 ====================

interface CandidateField {
  field: string;
  value: string;
  anchor?: { locator: { kind: string; excerpt?: string }; excerpt?: string };
  confidence?: number;
  /** v7.2：字段来源（规则 / AI / OCR），缺省视为规则 */
  origin?: string;
  /** v7.2：机器要求人工确认时才展示「待人工确认」 */
  needsHumanConfirm?: boolean;
  humanConfirmedAt?: string | null;
}

/** 字段来源徽标：ai/ocr 用紫色系，规则用蓝色系 */
const ORIGIN_BADGES: Record<string, { label: string; className: string }> = {
  rule: { label: "规则", className: "bg-blue-100 text-blue-700" },
  ai: { label: "AI 候选", className: "bg-purple-100 text-purple-700" },
  ocr: { label: "OCR 候选", className: "bg-purple-100 text-purple-700" },
};

/** 标准文档块类型徽标（防御未知块类型：原样展示 kind） */
const BLOCK_KIND_LABELS: Record<string, string> = {
  heading: "标题",
  paragraph: "段落",
  "table-cell": "表格单元格",
  "list-item": "列表项",
};

/** 解析警告按类型分徽标（PDF / OCR / 表格 / 其他） */
function warningBadge(warning: { type?: string; message?: string } | string): {
  label: string;
  className: string;
  text: string;
} {
  const rawType = typeof warning === "object" && warning ? (warning.type ?? "") : "";
  const text = typeof warning === "string" ? warning : (warning?.message ?? "");
  const probe = `${rawType} ${text}`.toLowerCase();
  if (rawType.toUpperCase() === "PDF" || probe.includes("pdf")) {
    return { label: "PDF", className: "bg-blue-100 text-blue-700", text };
  }
  if (rawType.toUpperCase() === "OCR" || probe.includes("ocr") || probe.includes("扫描")) {
    return { label: "OCR", className: "bg-purple-100 text-purple-700", text };
  }
  if (rawType.toLowerCase() === "table" || probe.includes("表格") || probe.includes("table")) {
    return { label: "表格", className: "bg-teal-100 text-teal-700", text };
  }
  return { label: "其他", className: "bg-slate-100 text-slate-600", text };
}

/** 块定位信息的一行灰小字（按 locator.kind 分格式，未知类型不展示） */
function locatorText(locator: unknown): string | null {
  if (!locator || typeof locator !== "object") return null;
  const l = locator as Record<string, unknown>;
  switch (l.kind) {
    case "html":
      return typeof l.selector === "string" ? `选择器：${l.selector}` : null;
    case "pdf-text":
      return typeof l.page === "number" ? `第 ${l.page} 页` : null;
    case "ocr":
      return typeof l.page === "number" ? `第 ${l.page} 页（OCR）` : "OCR 识别";
    case "worksheet":
      return (
        [
          typeof l.sheet === "string" ? `工作表 ${l.sheet}` : null,
          typeof l.cell === "string" ? `单元格 ${l.cell}` : null,
        ]
          .filter(Boolean)
          .join(" ") || null
      );
    case "docx-paragraph":
      return typeof l.index === "number" ? `段落 #${l.index}` : null;
    case "docx-table-cell":
      return `表格 ${String(l.table ?? "?")} 行 ${String(l.row ?? "?")} 列 ${String(l.column ?? "?")}`;
    case "excerpt":
      return "文本摘录";
    default:
      return null;
  }
}

// ==================== 主页面 ====================

export default function AdminPipelinePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // 提交表单
  const [submitMode, setSubmitMode] = useState<"url" | "text">("url");
  const [publisher, setPublisher] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    try {
      setError(null);
      const list = await announcementsPipelineApi.listRuns();
      setRuns(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  // 初始加载：内联 fetch，避免在 effect 中直接调用含 setState 的函数
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await announcementsPipelineApi.listRuns();
        if (!cancelled) setRuns(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        publisher: publisher.trim() || "未命名来源",
        officialUrl: submitMode === "url" ? officialUrl.trim() : `text://${Date.now()}`,
        sourceType: submitMode === "url" ? "government" : "manual_text",
        content: submitMode === "url" ? officialUrl.trim() : content,
        mimeType: submitMode === "url" ? "text/plain" : "text/plain",
      };
      // 文本模式：content 是正文；URL 模式：首版把 URL 当作内容提交（生产环境应抓取）
      if (submitMode === "url") {
        // 首版 URL 模式实际提交 URL 字符串作为内容，解析器会提取标题等
        input.content = officialUrl.trim();
      }
      await announcementsPipelineApi.submitSource(input);
      setOfficialUrl("");
      setContent("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExtract = async (runId: string) => {
    try {
      await announcementsPipelineApi.runExtraction(runId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提取失败");
    }
  };

  const handleRetry = async (runId: string) => {
    try {
      await announcementsPipelineApi.retryRun(runId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重试失败");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">公告提取与审核流水线</h1>
        <p className="text-sm text-slate-500 mt-1">
          提交官方公告 → 机器提取候选 → 人工审核 → 发布不可变版本。高影响字段必须有证据锚点才能通过。
        </p>
      </div>

      {/* 提交区 */}
      <Card>
        <p className="text-sm font-semibold text-slate-800 mb-3">提交公告来源</p>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setSubmitMode("url")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm border",
              submitMode === "url"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600"
            )}
          >
            公告链接
          </button>
          <button
            type="button"
            onClick={() => setSubmitMode("text")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm border",
              submitMode === "text"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600"
            )}
          >
            粘贴正文
          </button>
        </div>

        <div className="space-y-3">
          <Input
            label="发布主体（如：杭州市教育局）"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            placeholder="可选，默认未命名来源"
          />
          {submitMode === "url" ? (
            <Input
              label="官方公告链接"
              value={officialUrl}
              onChange={(e) => setOfficialUrl(e.target.value)}
              placeholder="https://www.example.gov.cn/...（首版提交链接文本，生产环境抓取网页）"
            />
          ) : (
            <Textarea
              label="公告正文"
              className="min-h-[160px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴公告 HTML 或纯文本正文，系统会自动提取报名时间、考试时间、科目、分值、资格条件等字段"
            />
          )}
          <Button onClick={handleSubmit} disabled={submitting || (submitMode === "url" ? !officialUrl : !content)}>
            {submitting ? "提交中..." : "提交并创建提取任务"}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* 任务列表 */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-800">提取任务列表</p>
          <Button size="sm" variant="outline" onClick={refresh}>
            刷新
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">加载中...</p>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={<span className="text-4xl">📭</span>}
            title="还没有提取任务"
            description="在上方提交公告链接或正文，系统会创建提取任务"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">提交时间</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const st = STATUS_LABELS[run.status] ?? { label: run.status, className: "bg-slate-100" };
                  return (
                    <tr key={run.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-800 truncate max-w-[200px]">
                          {run.snapshot?.source?.publisher ?? "未知来源"}
                        </p>
                        <p className="text-xs text-slate-400 truncate max-w-[200px]">
                          {run.snapshot?.officialUrl ?? run.snapshot?.contentHash?.slice(0, 12)}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium", st.className)}>
                          {st.label}
                        </span>
                        {run.errorMessage && (
                          <p className="text-xs text-red-500 mt-1 max-w-[180px] truncate">
                            {run.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">
                        {formatDateTime(run.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {(run.status === "submitted" || run.status === "failed") && (
                            <Button size="sm" onClick={() => handleExtract(run.id)}>
                              {run.status === "failed" ? "重新提取" : "开始提取"}
                            </Button>
                          )}
                          {run.status === "failed" && (
                            <Button size="sm" variant="outline" onClick={() => handleRetry(run.id)}>
                              重置任务
                            </Button>
                          )}
                          {run.status === "pending_review" && (
                            <Button size="sm" onClick={() => setSelectedRunId(run.id)}>
                              去审核
                            </Button>
                          )}
                          {run.status === "approved" && (
                            <PublishButton runId={run.id} onPublished={refresh} />
                          )}
                          {run.status === "published" && (
                            <span className="text-xs text-emerald-600">已发布 v{run.publishedVersion?.versionNumber}</span>
                          )}
                          {(run.status === "approved" || run.status === "published") && (
                            <Button size="sm" variant="outline" onClick={() => setSelectedRunId(run.id)}>
                              查看
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 审核面板 */}
      {selectedRunId && (
        <ReviewPanel
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
          onDone={() => {
            setSelectedRunId(null);
            refresh();
          }}
        />
      )}

      {/* 已发布版本 */}
      <PublishedVersionsSection runs={runs} />
    </div>
  );
}

// ==================== 发布按钮 ====================

function PublishButton({ runId, onPublished }: { runId: string; onPublished: () => void }) {
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={async () => {
          setPublishing(true);
          setErr(null);
          try {
            await announcementsPipelineApi.publish(runId);
            onPublished();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "发布失败");
          } finally {
            setPublishing(false);
          }
        }}
        disabled={publishing}
      >
        {publishing ? "发布中..." : "发布"}
      </Button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </div>
  );
}

// ==================== 审核面板（三层对照：原始快照 / 标准文档 / 候选字段） ====================

function ReviewPanel({
  runId,
  onClose,
  onDone,
}: {
  runId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [originalContent, setOriginalContent] = useState("");
  const [parsed, setParsed] = useState<SnapshotParsedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"approve" | "approve_with_edit" | "reject" | "mark_incomplete" | null>(null);
  const [reason, setReason] = useState("");
  const [editedFields, setEditedFields] = useState<CandidateField[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await announcementsPipelineApi.getRun(runId);
        if (cancelled) return;
        setRun(r);
        const candidate = (r.candidate as { fields: CandidateField[] } | null) ?? { fields: [] };
        setEditedFields(candidate.fields);
        if (r.snapshot?.id) {
          // 层 1 原文与层 2 标准文档并行加载；
          // 解析接口后端并行开发中，失败时仅降级层 2 展示，不阻断审核面板
          const [snap, parsedRes] = await Promise.all([
            announcementsPipelineApi.getSnapshotContent(r.snapshot.id),
            announcementsPipelineApi.getSnapshotParsed(r.snapshot.id).catch(() => null),
          ]);
          if (cancelled) return;
          setOriginalContent(snap.content);
          setParsed(parsedRes);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-slate-400">加载审核详情...</p>
      </Card>
    );
  }

  if (error || !run) {
    return (
      <Card>
        <p className="text-sm text-red-600">{error ?? "任务不存在"}</p>
        <Button size="sm" variant="outline" onClick={onClose} className="mt-2">
          关闭
        </Button>
      </Card>
    );
  }

  const candidate = (run.candidate as { fields: CandidateField[] } | null) ?? { fields: [] };
  const highImpactMissing = candidate.fields.filter(
    (f) => HIGH_IMPACT_FIELDS.has(f.field) && !f.anchor
  );
  const parseRun = parsed?.parseRun ?? null;
  const parseWarnings = parseRun?.warnings ?? [];
  const parsedBlocks: Array<{ kind?: string; text?: string; locator?: unknown }> =
    parseRun && Array.isArray(parseRun.blocks)
      ? (parseRun.blocks as Array<{ kind?: string; text?: string; locator?: unknown }>)
      : [];

  const handleSubmit = async () => {
    if (!action || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await announcementsPipelineApi.submitReview({
        runId,
        action,
        reason: reason.trim(),
        editedFields: action === "approve_with_edit" ? editedFields : undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "审核提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">审核任务 {run.id.slice(0, 8)}</p>
          <p className="text-xs text-slate-500">
            来源：{run.snapshot?.source?.publisher ?? "未知"} · 解析器：{run.parserVersion}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          关闭
        </Button>
      </div>

      {/* 警告汇总区：PDF/OCR/表格解析警告（逐条） */}
      {parseWarnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm font-medium text-amber-800">解析警告（{parseWarnings.length}）</p>
          {parseWarnings.map((w, i) => {
            const badge = warningBadge(w);
            return (
              <p key={i} className="text-xs text-amber-800 flex items-start gap-1.5">
                <span
                  className={cn(
                    "px-1.5 py-px rounded text-[10px] font-medium shrink-0",
                    badge.className
                  )}
                >
                  {badge.label}
                </span>
                <span>{badge.text}</span>
              </p>
            );
          })}
        </div>
      )}

      {highImpactMissing.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ 以下高影响字段缺少证据锚点，无法审核通过：
          {highImpactMissing.map((f) => (
            <span key={f.field} className="ml-1 font-medium">
              {FIELD_LABELS[f.field] ?? f.field}
            </span>
          ))}
        </div>
      )}

      {/* 层 1 原始快照 / 层 2 标准文档 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">层 1 · 原始快照（公告原文）</p>
          {/* 快照元信息：接口字段缺省时只展示可用项 */}
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            {run.snapshot?.contentHash && <span>哈希：{run.snapshot.contentHash.slice(0, 12)}</span>}
            {run.snapshot?.mimeType && <span>类型：{run.snapshot.mimeType}</span>}
            {run.snapshot?.httpStatus != null && <span>HTTP：{run.snapshot.httpStatus}</span>}
            {run.snapshot?.fetchedAt && <span>抓取时间：{formatDateTime(run.snapshot.fetchedAt)}</span>}
          </div>
          {parsed?.change?.hasPreviousSnapshot && (
            <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
              内容较上次抓取已更新（上次：
              {parsed.change.previousFetchedAt
                ? formatDateTime(parsed.change.previousFetchedAt)
                : "未知"}
              ）
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-[400px] overflow-y-auto">
            <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words">
              {originalContent || "（无法读取原始内容）"}
            </pre>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">层 2 · 标准文档（格式解析）</p>
          {!parseRun ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
              尚未进行格式解析
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                <span>格式：{parseRun.format}</span>
                <span>解析器：{parseRun.parserVersion}</span>
                <span>状态：{parseRun.status}</span>
                {parseRun.scanned && <span className="text-amber-600">扫描件</span>}
                {parseRun.ocrStatus && <span>OCR：{parseRun.ocrStatus}</span>}
              </div>
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {parsedBlocks.length === 0 ? (
                  <p className="text-xs text-slate-400">无内容块</p>
                ) : (
                  parsedBlocks.map((b, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-2">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-px rounded bg-slate-100 text-slate-500 text-[10px]">
                          {BLOCK_KIND_LABELS[b.kind ?? ""] ?? b.kind ?? "未知块"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-800 break-words">{b.text ?? ""}</p>
                      {locatorText(b.locator) && (
                        <p className="mt-0.5 text-[10px] text-slate-400">{locatorText(b.locator)}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 层 3 提取候选字段与证据 */}
      <div className="mt-4">
        <p className="text-xs font-semibold text-slate-700 mb-2">
          层 3 · 提取候选字段与证据（{candidate.fields.length} 项）
        </p>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {candidate.fields.length === 0 ? (
            <p className="text-sm text-slate-400">未提取到任何字段</p>
          ) : (
            candidate.fields.map((f, idx) => {
              const isHigh = HIGH_IMPACT_FIELDS.has(f.field);
              const hasAnchor = !!f.anchor;
              const origin = f.origin ? ORIGIN_BADGES[f.origin] : undefined;
              const lowConfidence = typeof f.confidence === "number" && f.confidence < 0.6;
              const needsConfirm = !!f.needsHumanConfirm && !f.humanConfirmedAt;
              return (
                <div key={f.field} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-700">
                      {FIELD_LABELS[f.field] ?? f.field}
                    </span>
                    {isHigh && (
                      <span className="px-1.5 py-px rounded bg-amber-100 text-amber-700 text-[10px]">
                        高影响
                      </span>
                    )}
                    {origin && (
                      <span
                        className={cn("px-1.5 py-px rounded text-[10px]", origin.className)}
                      >
                        {origin.label}
                      </span>
                    )}
                    {lowConfidence && (
                      <span className="px-1.5 py-px rounded bg-amber-100 text-amber-700 text-[10px]">
                        低置信度
                      </span>
                    )}
                    {needsConfirm && (
                      <span className="px-1.5 py-px rounded bg-orange-100 text-orange-700 text-[10px]">
                        待人工确认
                      </span>
                    )}
                    {hasAnchor ? (
                      <span className="px-1.5 py-px rounded bg-emerald-100 text-emerald-700 text-[10px]">
                        有证据
                      </span>
                    ) : (
                      <span className="px-1.5 py-px rounded bg-red-100 text-red-700 text-[10px]">
                        无证据
                      </span>
                    )}
                  </div>
                  {action === "approve_with_edit" ? (
                    <Textarea
                      className="mt-1.5 min-h-[48px] text-xs"
                      value={editedFields[idx]?.value ?? f.value}
                      onChange={(e) => {
                        const next = [...editedFields];
                        next[idx] = { ...f, value: e.target.value };
                        setEditedFields(next);
                      }}
                    />
                  ) : (
                    <p className="mt-1 text-sm text-slate-900 break-words">{f.value}</p>
                  )}
                  {f.anchor?.excerpt && (
                    <p className="mt-1 text-[11px] text-slate-400 italic line-clamp-2">
                      证据：{f.anchor.excerpt}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 投影状态区：审核通过/已发布时展示用户目录投影结果 */}
      {(run.status === "approved" || run.status === "published") && run.announcementId && (
        <ProjectionSection announcementId={run.announcementId} />
      )}

      {/* 版本链与撤回：该任务关联公告时展示 */}
      {run.announcementId && <VersionChainSection announcementId={run.announcementId} />}

      {/* 审核动作 */}
      <div className="mt-5 space-y-3">
        <p className="text-sm font-semibold text-slate-800">审核动作</p>
        <div className="flex flex-wrap gap-2">
          {([
            { key: "approve", label: "通过", style: "border-emerald-600 bg-emerald-600 text-white" },
            { key: "approve_with_edit", label: "修改后通过", style: "border-blue-600 bg-blue-600 text-white" },
            { key: "mark_incomplete", label: "信息缺失", style: "border-amber-500 bg-amber-500 text-white" },
            { key: "reject", label: "驳回", style: "border-red-600 bg-red-600 text-white" },
          ] as const).map((act) => (
            <button
              key={act.key}
              type="button"
              onClick={() => setAction(act.key)}
              className={cn(
                "h-9 px-3.5 rounded-lg text-sm font-medium border transition-colors",
                action === act.key ? act.style : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              {act.label}
            </button>
          ))}
        </div>

        {action && (
          <div className="space-y-3">
            <Input
              label="操作原因（必填）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：与公告原文一致"
            />
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                ⚠️ {error}
              </div>
            )}
            <Button onClick={handleSubmit} disabled={!reason.trim() || submitting}>
              {submitting ? "提交中..." : "确认审核"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ==================== 投影状态区（v7.2） ====================

function ProjectionSection({ announcementId }: { announcementId: string }) {
  const [projection, setProjection] = useState<ProjectionStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await announcementsPipelineApi.getProjection(announcementId);
        if (!cancelled) setProjection(p);
      } catch {
        // 投影接口后端并行开发中：未就绪时静默降级，不阻断审核
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [announcementId]);

  if (unavailable) return null;

  return (
    <div className="mt-4" data-testid="projection-section">
      <p className="text-xs font-semibold text-slate-700 mb-2">用户目录投影</p>
      {!projection ? (
        <p className="text-xs text-slate-400">加载投影状态...</p>
      ) : projection.status === "projected" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          已进入用户目录（v{projection.versionNumber}，{projection.unitCount} 个岗位单元）
        </div>
      ) : projection.status === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          投影失败：{projection.message ?? "未知错误"}
          {projection.fieldPath ? `（${projection.fieldPath}）` : ""}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
          尚未发布到用户目录
        </div>
      )}
    </div>
  );
}

// ==================== 版本链与撤回（v7.2） ====================

const VERSION_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  published: { label: "当前生效", className: "bg-emerald-100 text-emerald-700" },
  superseded: { label: "已被取代", className: "bg-slate-100 text-slate-500" },
  withdrawn: { label: "已撤回", className: "bg-red-100 text-red-700" },
};

function VersionChainSection({ announcementId }: { announcementId: string }) {
  const [versions, setVersions] = useState<PublishedVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const vs = await announcementsPipelineApi.listVersions(announcementId);
      setVersions(vs);
    } catch {
      setVersions([]);
    }
  }, [announcementId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vs = await announcementsPipelineApi.listVersions(announcementId);
        if (!cancelled) setVersions(vs);
      } catch {
        if (!cancelled) setVersions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [announcementId]);

  const handleWithdraw = async (versionId: string) => {
    if (!withdrawReason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await announcementsPipelineApi.withdrawVersion(announcementId, versionId, withdrawReason.trim());
      setWithdrawingId(null);
      setWithdrawReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤回失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (!versions || versions.length === 0) return null;

  return (
    <div className="mt-4" data-testid="version-chain-section">
      <p className="text-xs font-semibold text-slate-700 mb-2">版本链</p>
      <div className="space-y-2">
        {versions.map((v) => {
          const st = VERSION_STATUS_LABELS[v.status] ?? {
            label: v.status,
            className: "bg-slate-100 text-slate-500",
          };
          return (
            <div key={v.id} className="rounded-lg border border-slate-200 p-2.5 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">v{v.versionNumber}</span>
                <span className={cn("px-1.5 py-px rounded font-medium", st.className)}>{st.label}</span>
                <span className="text-slate-400">{formatDateTime(v.publishedAt)}</span>
                {v.status === "published" && withdrawingId !== v.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setWithdrawingId(v.id);
                      setWithdrawReason("");
                      setError(null);
                    }}
                  >
                    撤回
                  </Button>
                )}
              </div>

              {v.status === "withdrawn" && (
                <p className="text-slate-500">
                  撤回原因：{v.withdrawReason ?? "—"}
                  {v.withdrawnAt && ` · ${formatDateTime(v.withdrawnAt)}`}
                  {v.withdrawnBy && ` · 操作人：${v.withdrawnBy}`}
                </p>
              )}

              {withdrawingId === v.id && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-2">
                  <Input
                    label="撤回原因（必填）"
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="例如：公告被官方撤销"
                  />
                  {error && <p className="text-red-500">⚠️ {error}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleWithdraw(v.id)}
                      disabled={!withdrawReason.trim() || submitting}
                    >
                      {submitting ? "撤回中..." : "确认撤回"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setWithdrawingId(null)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 已发布版本与差异 ====================

function PublishedVersionsSection({ runs }: { runs: Run[] }) {
  const [announcementId, setAnnouncementId] = useState<string>("");
  const [versions, setVersions] = useState<Array<{ id: string; versionNumber: number; status: string; publishedAt: string }>>([]);
  const [diff, setDiff] = useState<Array<{ field: string; before: string; after: string; changed: boolean }> | null>(null);
  const [loading, setLoading] = useState(false);

  const publishedRuns = runs.filter((r) => r.status === "published");

  const loadVersions = async (annId: string) => {
    setAnnouncementId(annId);
    setDiff(null);
    setLoading(true);
    try {
      const vs = await announcementsPipelineApi.listVersions(annId);
      setVersions(
        vs.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          status: v.status,
          publishedAt: v.publishedAt,
        }))
      );
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  const showDiff = async (v1: number, v2: number) => {
    try {
      const result = await announcementsPipelineApi.getVersionDiff(announcementId, v1, v2);
      setDiff(result as Array<{ field: string; before: string; after: string; changed: boolean }>);
    } catch {
      setDiff(null);
    }
  };

  return (
    <Card>
      <p className="text-sm font-semibold text-slate-800 mb-3">已发布版本与差异</p>

      {publishedRuns.length === 0 ? (
        <p className="text-sm text-slate-400">还没有已发布的版本。审核通过后点击「发布」即可创建不可变版本。</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {publishedRuns.map((r) => (
              <Button
                key={r.id}
                size="sm"
                variant={announcementId === (r.announcementId ?? r.id) ? "primary" : "outline"}
                onClick={() => loadVersions(r.announcementId ?? r.id)}
              >
                {r.snapshot?.source?.publisher ?? r.id.slice(0, 8)} (v{r.publishedVersion?.versionNumber})
              </Button>
            ))}
          </div>

          {announcementId && (
            <div>
              {loading ? (
                <p className="text-xs text-slate-400">加载版本列表...</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-slate-400">暂无版本</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {versions.map((v) => (
                      <span
                        key={v.id}
                        className={cn(
                          "px-2 py-1 rounded text-xs",
                          v.status === "published"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        )}
                      >
                        v{v.versionNumber} · {v.status === "published" ? "当前" : "已取代"} ·{" "}
                        {formatDateTime(v.publishedAt)}
                      </span>
                    ))}
                  </div>

                  {versions.length >= 2 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-slate-700 mb-2">查看版本差异</p>
                      <div className="flex items-center gap-2">
                        <select
                          className="text-xs border border-slate-300 rounded px-2 py-1"
                          onChange={(e) => {
                            const [a, b] = e.target.value.split(",").map(Number);
                            if (a && b) showDiff(a, b);
                          }}
                          defaultValue=""
                        >
                          <option value="">选择两个版本对比...</option>
                          {versions.flatMap((v1, i) =>
                            versions.slice(i + 1).map((v2) => (
                              <option key={`${v1.versionNumber}-${v2.versionNumber}`} value={`${v1.versionNumber},${v2.versionNumber}`}>
                                v{v1.versionNumber} → v{v2.versionNumber}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {diff && (
                        <div className="mt-3 rounded-lg border border-slate-200 divide-y divide-slate-100">
                          {diff.map((d) => (
                            <div key={d.field} className="p-2.5 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-700">
                                  {FIELD_LABELS[d.field] ?? d.field}
                                </span>
                                {d.changed && (
                                  <span className="px-1.5 py-px rounded bg-amber-100 text-amber-700 text-[10px]">
                                    已变更
                                  </span>
                                )}
                              </div>
                              {d.changed ? (
                                <div className="mt-1 flex flex-wrap gap-3">
                                  <span className="text-slate-400 line-through">{d.before || "（空）"}</span>
                                  <span className="text-slate-300">→</span>
                                  <span className="text-slate-800">{d.after || "（空）"}</span>
                                </div>
                              ) : (
                                <p className="mt-1 text-slate-600">{d.after || "（空）"}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
